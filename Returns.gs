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
  // The rental day runs until the configured end time (Settings → rentalEndTime,
  // default 21:00 IST). CHECK_OUT is stored as a plain "YYYY-MM-DD" string; build
  // the deadline explicitly so we don't let new Date() read it as 00:00 UTC
  // (05:30 IST) and start late fees ~15h early.
  const endTime = getSettingValue('rentalEndTime') || '21:00';
  // _ymd() handles a Date OR string cell, so the deadline is always the real
  // end-of-day (e.g. 21:00 IST), never misread as midnight (which inflated late fees).
  const coYmd = _ymd(booking[BC.CHECK_OUT]);
  let checkOutDate = coYmd ? _istDeadlineUtc(coYmd, endTime) : null;
  const actualReturn  = returnData.actualReturn ? new Date(returnData.actualReturn) : new Date();
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
        const days = Number(booking[BC.DAYS]) || 1;
        const newDays = days + 1;
        const extraRent = rates.dayRate; // one extra day
        const newDepositWeeks = Math.ceil(newDays / 7);
        const oldDepositWeeks = Math.ceil(days / 7);
        const extraDeposit = (newDepositWeeks - oldDepositWeeks) * rates.depositPerWeek;
        lateFee = extraRent + extraDeposit;
      } else {
        // Per-hour, but CAPPED so being late never costs more than the extra days' rent
        // (a full day late = +1 day's rent, not 24 unbounded hourly charges). The owner's
        // model: a later return day is just another day. See B5_B6_PLAYBOOK Step 2.
        const perHour  = lateHours * rates.lateFeePerHour;
        const extraDays = Math.ceil(lateHours / 24);
        const dayCap   = extraDays * rates.dayRate;
        lateFee = Math.min(perHour, dayCap);
      }
    }
  }

  // ── Deductions ────────────────────────────────────────────────────────────
  const deductSheet = _getSS().getSheetByName('Deductions');
  let deductionTotal = 0;

  if (returnData.deductions && returnData.deductions.length > 0) {
    returnData.deductions.forEach((d, idx) => {
      const amt = Math.max(0, Number(d.amount) || 0);
      if (amt === 0) return;
      deductionTotal += amt;
      const deductId = 'DED-' + bookingId + '-' + String(idx + 1).padStart(2, '0');
      deductSheet.appendRow([
        deductId, bookingId, amt, d.reason || 'Damage/Loss',
        returnData.operatorName || '', new Date()
      ]);
    });
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
  if (refundMode === 'cash') {
    refundCash = refundAmount;
  } else {
    refundUPI = refundAmount;
  }

  // ── Write to sheet ────────────────────────────────────────────────────────
  sheet.getRange(targetRow, BC.STATUS            + 1).setValue('Returned');
  sheet.getRange(targetRow, BC.ACTUAL_RETURN     + 1).setValue(actualReturn);
  sheet.getRange(targetRow, BC.LATE_HOURS        + 1).setValue(lateHours);
  sheet.getRange(targetRow, BC.LATE_FEE          + 1).setValue(lateFee);
  sheet.getRange(targetRow, BC.DEDUCTION_TOTAL   + 1).setValue(deductionTotal);
  sheet.getRange(targetRow, BC.REFUND_CASH       + 1).setValue(refundCash);
  sheet.getRange(targetRow, BC.REFUND_UPI        + 1).setValue(refundUPI);
  sheet.getRange(targetRow, BC.REFUND_TOTAL      + 1).setValue(refundAmount);
  // Server-resolved operator — the drawer that pays the refund is attributed to
  // whoever is actually signed in, never a client-sent name.
  const opName = _opName(token) || returnData.operatorName || '';
  sheet.getRange(targetRow, BC.OPERATOR_RETURNED + 1).setValue(opName);
  sheet.getRange(targetRow, BC.RETURN_NOTES      + 1).setValue(returnData.notes || '');

  // Free the vehicle
  _setVehicleStatusById(String(booking[BC.VEHICLE_ID]), 'Available');

  // Immutable ledger. Late fee + deductions are WITHHELD from the deposit (the refund
  // is already reduced by them), so they are NOT a separate cash/UPI movement — they
  // post to a non-cash 'income' account: visible in the passbook, but they must not
  // move the running cash balance (that would double-count what the smaller refund
  // already reflects). Only the actual refund pays out cash/UPI.
  _appendLedgerRows([
    { type: 'LateFeeIn',     direction: 'credit', amount: lateFee,        account: 'income', operator: opName, bookingId: bookingId },
    { type: 'DeductionIn',   direction: 'credit', amount: deductionTotal, account: 'income', operator: opName, bookingId: bookingId },
    { type: 'Refund',        direction: 'debit',  amount: refundCash,     account: 'cash',   operator: opName, bookingId: bookingId },
    { type: 'DepositRefund', direction: 'debit',  amount: refundUPI,      account: 'upi',    operator: opName, bookingId: bookingId }
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
}

function getDeductionsByBooking(bookingId, token) {
  requireAdmin(token);
  const sheet = _getSS().getSheetByName('Deductions');
  const data  = sheet.getDataRange().getValues();
  const out   = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === bookingId) {
      out.push({
        deductionId: String(data[i][0]),
        bookingId:   String(data[i][1]),
        amount:      Number(data[i][2]) || 0,
        reason:      String(data[i][3] || ''),
        appliedBy:   String(data[i][4] || ''),
        timestamp:   data[i][5] ? _formatIST(data[i][5]) : ''
      });
    }
  }
  return out;
}
