// ─── Returns & Deductions ──────────────────────────────────────────────────────

function processReturn(bookingId, returnData, token) {
  requireAdmin(token);
  // returnData: {
  //   actualReturn: Date string,
  //   refundMode: 'same'|'cash'|'upi',
  //   deductions: [{ amount, reason }],
  //   operatorName: string,
  //   notes: string
  // }

  // Serialize the whole read-check-settle under a lock so a double-tap or two devices
  // can't both pass the Active guard and post the refund twice (corrupting the ledger).
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  try {
  const sheet  = _getBookingsSheet();
  const data   = sheet.getDataRange().getValues();
  let targetRow = -1;
  let booking   = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][BC.BOOKING_ID]) === bookingId) {
      targetRow = i + 1;
      booking   = data[i];
      break;
    }
  }
  if (!booking) throw new Error('Booking not found: ' + bookingId);
  if (String(booking[BC.STATUS]) !== 'Active') throw new Error('Booking is not Active.');

  const rates         = resolveRatesForBooking();
  // Late-fee day rate + deposit/week come from the booking's OWN snapshot (mirrors
  // extendBooking) so a return is never repriced by a later Settings change; fall back
  // to current rates only for legacy rows missing a snap. (lateFeeMode / lateFeePerHour /
  // graceMinutes are not snapshotted — they use current Settings.)
  const dayRate    = Number(booking[BC.DAY_RATE_SNAP])         || rates.dayRate;
  const depPerWeek = Number(booking[BC.DEPOSIT_PER_WEEK_SNAP]) || rates.depositPerWeek;
  // The rental day runs until the configured end time (Settings → rentalEndTime,
  // default 21:00 IST). CHECK_OUT is stored as a plain "YYYY-MM-DD" string; build
  // the deadline explicitly so we don't let new Date() read it as 00:00 UTC
  // (05:30 IST) and start late fees ~15h early.
  const endTime = getSettingValue('rentalEndTime') || '21:00';
  // _ymd() handles a Date OR string cell, so the deadline is always the real
  // end-of-day (e.g. 21:00 IST), never misread as midnight (which inflated late fees).
  const coYmd = _ymd(booking[BC.CHECK_OUT]);
  let checkOutDate = coYmd ? _istDeadlineUtc(coYmd, endTime) : null;
  let actualReturn = returnData.actualReturn ? new Date(returnData.actualReturn) : new Date();
  // Never trust a client-sent timestamp unbounded: an invalid date or one in the future
  // (clock skew, a typo, or a malicious payload) gets clamped to now. This does NOT block
  // an earlier/backdated timestamp — that's a pricing-policy call the owner has reserved.
  if (!(actualReturn instanceof Date) || isNaN(actualReturn) || actualReturn > new Date()) actualReturn = new Date();
  // True server processing time (distinct from actualReturn, which the operator can set
  // to any earlier moment). Used only to FLAG — never block — a backdated return: one
  // recorded as on-time (actualReturn <= deadline) but actually processed after the
  // deadline, i.e. a late fee that was dodged by claiming an earlier return. Surfaced to
  // a manager via runSelfAudit (Ledger.gs); does not change any amount/account/direction.
  const recordedAt = new Date();
  const backdatedFlag = !!returnData.actualReturn && checkOutDate && recordedAt > checkOutDate && actualReturn <= checkOutDate;
  const depositAmount = Number(booking[BC.DEPOSIT_AMOUNT]) || 0;

  // ── Late fee calculation ──────────────────────────────────────────────────
  let lateHours = 0;
  let lateFee   = 0;

  if (checkOutDate && actualReturn > checkOutDate) {
    const diffMs = actualReturn.getTime() - checkOutDate.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const graceMinutes = rates.graceMinutes || 0;

    if (diffMinutes > graceMinutes) {
      const billableMinutes = diffMinutes - graceMinutes;
      lateHours = Math.ceil(billableMinutes / 60);

      if (rates.lateFeeMode === 'fullExtraDay') {
        // Charge per ACTUAL day late (not a flat +1): 2 days late = 2 extra days' rent,
        // plus any deposit-week crossings the longer stay causes.
        const days = Number(booking[BC.DAYS]) || 1;
        const daysLate = Math.ceil(lateHours / 24);
        const newDays = days + daysLate;
        const extraRent = dayRate * daysLate;
        const newDepositWeeks = Math.ceil(newDays / 7);
        const oldDepositWeeks = Math.ceil(days / 7);
        const extraDeposit = (newDepositWeeks - oldDepositWeeks) * depPerWeek;
        lateFee = extraRent + extraDeposit;
      } else {
        // Per-hour, but CAPPED so being late never costs more than the extra days' rent
        // (a full day late = +1 day's rent, not 24 unbounded hourly charges). The owner's
        // model: a later return day is just another day. See B5_B6_PLAYBOOK Step 2.
        const perHour  = lateHours * rates.lateFeePerHour;
        const extraDays = Math.ceil(lateHours / 24);
        const dayCap   = extraDays * dayRate;
        lateFee = Math.min(perHour, dayCap);
      }
    }
  }

  // ── Deductions ────────────────────────────────────────────────────────────
  const deductSheet = _getSS().getSheetByName('Deductions');
  let deductionTotal = 0;

  if (returnData.deductions && returnData.deductions.length > 0) {
    // Build the rows first, then write them in ONE batched range — instead of one
    // appendRow per deduction — so we're not doing N Sheets round-trips while holding
    // the script lock. Same column order/values per row as before.
    const deductRows = [];
    returnData.deductions.forEach((d, idx) => {
      const amt = Math.max(0, Number(d.amount) || 0);
      if (amt === 0) return;
      deductionTotal += amt;
      const deductId = 'DED-' + bookingId + '-' + String(idx + 1).padStart(2, '0');
      deductRows.push([
        deductId, bookingId, amt, d.reason || 'Damage/Loss',
        returnData.operatorName || '', new Date()
      ]);
    });
    if (deductRows.length > 0) {
      const startRow = deductSheet.getLastRow() + 1;
      deductSheet.getRange(startRow, 1, deductRows.length, deductRows[0].length).setValues(deductRows);
    }
  }

  // ── Refund calculation ────────────────────────────────────────────────────
  const totalDeductions = lateFee + deductionTotal;
  const refundAmount    = Math.max(0, depositAmount - totalDeductions);

  // Determine refund mode
  const collectedCash = Number(booking[BC.DEPOSIT_CASH]) || 0;
  const collectedUPI  = Number(booking[BC.DEPOSIT_UPI])  || 0;
  let refundMode = returnData.refundMode || 'same';

  if (refundMode === 'same') {
    // Default: same as how deposit was collected
    refundMode = collectedCash >= collectedUPI ? 'cash' : 'upi';
  }

  let refundCash = 0, refundUPI = 0;
  if (refundMode === 'split') {
    // Operator explicitly chose how to split the refund
    refundCash = Number(returnData.refundCash) || 0;
    refundUPI  = Number(returnData.refundUPI)  || 0;
    if (refundCash + refundUPI !== refundAmount) {
      throw new Error('Split refund (' + refundCash + ' + ' + refundUPI + ') does not equal refund amount (' + refundAmount + ').');
    }
  } else if (refundMode === 'cash') {
    refundCash = refundAmount;
  } else {
    refundUPI = refundAmount;
  }

  // Cap each channel to what was actually COLLECTED for this booking, then fill any
  // shortfall from the other channel. A UPI-collected deposit refunded "as cash" must
  // not pay out cash that was never collected (which would drive the drawer negative).
  // Total deposit collected is always ≥ refundAmount, so the fill always closes the gap.
  refundCash = Math.min(refundCash, collectedCash);
  refundUPI  = Math.min(refundUPI,  collectedUPI);
  let _short = refundAmount - refundCash - refundUPI;
  if (_short > 0) { const ac = Math.min(_short, collectedCash - refundCash); refundCash += ac; _short -= ac;
                    const au = Math.min(_short, collectedUPI  - refundUPI ); refundUPI  += au; }

  // ── Write to sheet ────────────────────────────────────────────────────────
  // Server-resolved operator — the drawer that pays the refund is attributed to
  // whoever is actually signed in, never a client-sent name.
  const opName = _opName(token) || returnData.operatorName || '';
  booking[BC.STATUS]            = 'Returned';
  booking[BC.ACTUAL_RETURN]     = actualReturn;
  booking[BC.LATE_HOURS]        = lateHours;
  booking[BC.LATE_FEE]          = lateFee;
  booking[BC.DEDUCTION_TOTAL]   = deductionTotal;
  booking[BC.REFUND_CASH]       = refundCash;
  booking[BC.REFUND_UPI]        = refundUPI;
  booking[BC.REFUND_TOTAL]      = refundAmount;
  booking[BC.OPERATOR_RETURNED] = opName;
  booking[BC.RETURN_NOTES]      = returnData.notes || '';
  // One batched range write (status + the contiguous ActualReturn…ReturnNotes block)
  // instead of ten per-cell writes — fewer Sheets round-trips, faster return.
  sheet.getRange(targetRow, BC.STATUS + 1).setValue('Returned');
  sheet.getRange(targetRow, BC.ACTUAL_RETURN + 1, 1, BC.RETURN_NOTES - BC.ACTUAL_RETURN + 1)
       .setValues([booking.slice(BC.ACTUAL_RETURN, BC.RETURN_NOTES + 1)]);

  // Free the vehicle
  _setVehicleStatusById(String(booking[BC.VEHICLE_ID]), 'Available');

  // Immutable ledger. Late fee + deductions are WITHHELD from the deposit (the refund
  // is already reduced by them), so they are NOT a separate cash/UPI movement — they
  // post to a non-cash 'income' account: visible in the passbook, but they must not
  // move the running cash balance (that would double-count what the smaller refund
  // already reflects). Only the actual refund pays out cash/UPI.
  // Income == deposit − refund (the law): cap the posted late fee + deduction so their
  // sum never exceeds what was actually withheld (deposit − refund). If the charges
  // exceed the deposit, the refund floors at ₹0 and the excess is simply not collectable
  // in this model — so it must not be booked as income.
  const withheld       = Math.max(0, depositAmount - refundAmount);
  const postedLateFee  = Math.min(lateFee, withheld);
  const postedDeduction = Math.min(deductionTotal, withheld - postedLateFee);
  // Machine-readable audit marker on the refund rows only (they're the payoff of the
  // evasion — a bigger refund because the late fee never got charged). Empty string when
  // not flagged, matching the prior no-note behavior; note is purely informational and
  // never affects amount/account/direction.
  const backdatedNote = backdatedFlag
    ? 'FLAG:backdated claimed ' + Utilities.formatDate(actualReturn, 'Asia/Kolkata', 'dd MMM HH:mm') +
      ' recorded ' + Utilities.formatDate(recordedAt, 'Asia/Kolkata', 'dd MMM HH:mm')
    : '';
  const returnNote = opName ? 'Return processed by ' + opName : '';
  const refundNote = backdatedNote ? (returnNote ? returnNote + ' · ' + backdatedNote : backdatedNote) : returnNote;
  _appendLedgerRows([
    { type: 'LateFeeIn',     direction: 'credit', amount: postedLateFee,   account: 'income', operator: opName, bookingId: bookingId },
    { type: 'DeductionIn',   direction: 'credit', amount: postedDeduction, account: 'income', operator: opName, bookingId: bookingId },
    { type: 'Refund',        direction: 'debit',  amount: refundCash,     account: 'cash',   operator: opName, bookingId: bookingId, note: refundNote },
    { type: 'DepositRefund', direction: 'debit',  amount: refundUPI,      account: 'upi',    operator: opName, bookingId: bookingId, note: refundNote }
  ]);

  _bumpDataVersion();
  return {
    success:         true,
    lateHours:       lateHours,
    lateFee:         lateFee,
    deductionTotal:  deductionTotal,
    totalDeductions: totalDeductions,
    refundAmount:    refundAmount,
    refundCash:      refundCash,
    refundUPI:       refundUPI,
    refundMode:      refundMode
  };
  } finally {
    lock.releaseLock();
  }
}
