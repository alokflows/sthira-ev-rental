// ─── Bookings ──────────────────────────────────────────────────────────────────

function _getBookingsSheet() {
  return _getSS().getSheetByName('Bookings');
}

// Neutralize spreadsheet formula injection: any value a guest could control that
// starts with =, +, -, @ (or a control char) is prefixed with an apostrophe so
// Sheets treats it as literal text, never an executable formula.
function _sanitizeCell(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r\n]/.test(s) ? "'" + s : s;
}

// Highest trailing sequence number among ids of the form DDMMYY-N for the given
// day (0 if none). Scans ALL rows — including Deleted/Cancelled — so a hard-deleted
// or out-of-band-imported row can never let the next id reuse an existing one.
function _maxBookingSeq(ddmmyy) {
  const data = _getBookingsSheet().getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][BC.BOOKING_ID] || '');
    if (id.indexOf(ddmmyy + '-') !== 0) continue;
    // id is DDMMYY-N; the prefix DDMMYY has no '-', so the sequence is after the first '-'.
    const n = parseInt(id.substring(id.indexOf('-') + 1), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

// Booking id = DDMMYY-N (e.g. 220626-1), N resets each day. N = max existing
// sequence + 1 (high-water mark, not a row count) so deletes/imports never collide.
function _generateBookingId() {
  const ddmmyy = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'ddMMyy');
  return ddmmyy + '-' + (_maxBookingSeq(ddmmyy) + 1);
}

function _formatIST(date) {
  if (!date) return '';
  try {
    return Utilities.formatDate(new Date(date), 'Asia/Kolkata', 'dd MMM yyyy, HH:mm');
  } catch (e) { return String(date); }
}

function _formatDateIST(date) {
  if (!date) return '';
  try {
    return Utilities.formatDate(new Date(date), 'Asia/Kolkata', 'dd MMM yyyy');
  } catch (e) { return String(date); }
}

function _rowToBooking(row) {
  return {
    bookingId:       String(row[BC.BOOKING_ID]),
    createdAt:       _formatIST(row[BC.CREATED_AT]),
    status:          String(row[BC.STATUS]),
    riderName:       String(row[BC.RIDER_NAME]),
    dlNumber:        String(row[BC.DL_NUMBER]),
    cottageName:     String(row[BC.COTTAGE_NAME] || ''),
    mobile:          String(row[BC.MOBILE]),
    altMobile:       String(row[BC.ALT_MOBILE] || ''),
    checkIn:         _formatDateIST(row[BC.CHECK_IN]),
    checkInYmd:      _ymd(row[BC.CHECK_IN]),    // machine-readable; lets the desk recompute days when extending
    checkOut:        _formatDateIST(row[BC.CHECK_OUT]),
    checkOutYmd:     _ymd(row[BC.CHECK_OUT]),   // machine-readable; lets the desk preview the late fee exactly as the server computes it
    days:            Number(row[BC.DAYS]) || 0,
    vehicleId:       String(row[BC.VEHICLE_ID] || ''),
    vehicleLabel:    String(row[BC.VEHICLE_LABEL] || ''),
    dayRateSnap:     Number(row[BC.DAY_RATE_SNAP]) || 0,
    depositPerWeekSnap: Number(row[BC.DEPOSIT_PER_WEEK_SNAP]) || 0,
    rentAmount:      Number(row[BC.RENT_AMOUNT]) || 0,
    depositAmount:   Number(row[BC.DEPOSIT_AMOUNT]) || 0,
    totalAmount:     Number(row[BC.TOTAL_AMOUNT]) || 0,
    rentCash:        Number(row[BC.RENT_CASH]) || 0,
    rentUPI:         Number(row[BC.RENT_UPI]) || 0,
    depositCash:     Number(row[BC.DEPOSIT_CASH]) || 0,
    depositUPI:      Number(row[BC.DEPOSIT_UPI]) || 0,
    consentAccepted: Boolean(row[BC.CONSENT_ACCEPTED]),
    consentAt:       _formatIST(row[BC.CONSENT_AT]),
    signatureFileId: String(row[BC.SIGNATURE_FILE_ID] || ''),
    operatorBooked:  String(row[BC.OPERATOR_BOOKED] || ''),
    actualReturn:    _formatIST(row[BC.ACTUAL_RETURN]),
    lateHours:       Number(row[BC.LATE_HOURS]) || 0,
    lateFee:         Number(row[BC.LATE_FEE]) || 0,
    deductionTotal:  Number(row[BC.DEDUCTION_TOTAL]) || 0,
    refundCash:      Number(row[BC.REFUND_CASH]) || 0,
    refundUPI:       Number(row[BC.REFUND_UPI]) || 0,
    refundTotal:     Number(row[BC.REFUND_TOTAL]) || 0,
    operatorReturned:String(row[BC.OPERATOR_RETURNED] || ''),
    returnNotes:     String(row[BC.RETURN_NOTES] || ''),
    email:           String(row[BC.EMAIL] || ''),
    cancelledAt:     _formatIST(row[BC.CANCELLED_AT]),
    cancelledBy:     String(row[BC.CANCELLED_BY] || ''),
    yardDoneAt:      _formatIST(row[BC.YARD_DONE_AT])
  };
}

// ─── Rider Tablet (no auth) ────────────────────────────────────────────────────

function createPendingBooking(data) {
  if (!data.consentAccepted) throw new Error('Terms & Conditions must be accepted.');
  if (!data.riderName)  throw new Error('Rider name is required.');
  if (!data.dlNumber)   throw new Error('Driving licence number is required.');
  if (!data.mobile)     throw new Error('Mobile number is required.');

  const rates      = resolveRatesForBooking();
  const now        = new Date();

  // Check-in (guest may pick it; else today IST). Check-out = the date they'll return.
  let checkInIST = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
  if (data.checkIn && _isRealYmd(data.checkIn)) {
    checkInIST = String(data.checkIn).trim();
  }
  let checkOutIST = checkInIST;
  if (data.checkOut && _isRealYmd(data.checkOut)) {
    checkOutIST = String(data.checkOut).trim();
  }
  if (checkOutIST < checkInIST) checkOutIST = checkInIST;

  // Days + amounts computed HERE — the single source of truth. The client's numbers
  // are never trusted for billing (that was the ₹850 bug). daysInclusive() lives in
  // Config.gs and the client preview mirrors it.
  const days       = daysInclusive(checkInIST, checkOutIST);
  const rentAmount = rates.dayRate * days;
  const depositAmt = rates.depositPerWeek * Math.ceil(days / 7);

  // Serialize id-generation + append so two concurrent guests can never receive
  // the same DDMMYY-N id (which would silently corrupt every later lookup).
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }

  let bookingId;
  try {
    bookingId = _generateBookingId();

    const row = new Array(36).fill('');
    row[BC.BOOKING_ID]            = bookingId;
    row[BC.CREATED_AT]            = now;
    row[BC.STATUS]                = 'Pending';
    row[BC.RIDER_NAME]            = _sanitizeCell(data.riderName);
    row[BC.DL_NUMBER]             = _sanitizeCell(data.dlNumber);
    row[BC.COTTAGE_NAME]          = _sanitizeCell(data.cottageName || '');
    row[BC.MOBILE]                = _sanitizeCell(data.mobile);
    row[BC.ALT_MOBILE]            = _sanitizeCell(data.altMobile || '');
    row[BC.CHECK_IN]              = checkInIST;
    row[BC.CHECK_OUT]             = checkOutIST;
    row[BC.DAYS]                  = days;
    row[BC.DAY_RATE_SNAP]         = rates.dayRate;
    row[BC.DEPOSIT_PER_WEEK_SNAP] = rates.depositPerWeek;
    row[BC.RENT_AMOUNT]           = rentAmount;
    row[BC.DEPOSIT_AMOUNT]        = depositAmt;
    row[BC.TOTAL_AMOUNT]          = rentAmount + depositAmt;
    row[BC.CONSENT_ACCEPTED]      = true;
    row[BC.CONSENT_AT]            = now;
    row[BC.EMAIL]                 = _sanitizeCell(data.email || '');

    _getBookingsSheet().appendRow(row);
  } finally {
    lock.releaseLock();
  }

  _bumpDataVersion();   // a kiosk submit shows on the desk within seconds
  return {
    success:       true,
    bookingId:     bookingId,
    rentAmount:    rentAmount,
    depositAmount: depositAmt,
    totalAmount:   rentAmount + depositAmt,
    dayRate:       rates.dayRate
  };
}

// ─── Admin — Confirm a pending booking ────────────────────────────────────────

function confirmBooking(bookingId, vehicleId, payment, operatorName, token) {
  requireAdmin(token);
  // payment: { mode: 'cash'|'upi'|'split', rentCash, rentUPI, depositCash, depositUPI }

  // Serialize the read-check-assign so two operators can't hand out the same
  // scooter (or confirm the same booking) at the same instant.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  let result;
  try {
    const sheet   = _getBookingsSheet();
    const data    = sheet.getDataRange().getValues();
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
    if (String(booking[BC.STATUS]) !== 'Pending') throw new Error('Booking is not in Pending status.');

    // Validate vehicle availability
    const vehicle = _getVehiclesData().find(v => v.vehicleId === vehicleId);
    if (!vehicle) throw new Error('Vehicle not found.');
    if (vehicle.status !== 'Available' && vehicle.status !== 'Charging') throw new Error('Vehicle ' + vehicle.label + ' is not available.');

    // Resolve payment amounts
    const rentAmount    = Number(booking[BC.RENT_AMOUNT]);
    const depositAmount = Number(booking[BC.DEPOSIT_AMOUNT]);
    let rentCash = 0, rentUPI = 0, depositCash = 0, depositUPI = 0;

    if (payment.mode === 'cash') {
      rentCash    = rentAmount;
      depositCash = depositAmount;
    } else if (payment.mode === 'upi') {
      rentUPI    = rentAmount;
      depositUPI = depositAmount;
    } else {
      // split — never trust the client's arithmetic; the parts must add up.
      rentCash    = Number(payment.rentCash)    || 0;
      rentUPI     = Number(payment.rentUPI)     || 0;
      depositCash = Number(payment.depositCash) || 0;
      depositUPI  = Number(payment.depositUPI)  || 0;
      // Reject negative parts: they'd pass the sum check (−500 + 800 = 300) yet post a
      // negative ledger credit and corrupt a drawer. The parts must be real, non-negative.
      if (rentCash < 0 || rentUPI < 0 || depositCash < 0 || depositUPI < 0) throw new Error('Payment amounts cannot be negative.');
      if (Math.abs((rentCash + rentUPI) - rentAmount) > 1) {
        throw new Error('Rent split (₹' + (rentCash + rentUPI) + ') must equal the rent due (₹' + rentAmount + ').');
      }
      if (Math.abs((depositCash + depositUPI) - depositAmount) > 1) {
        throw new Error('Deposit split (₹' + (depositCash + depositUPI) + ') must equal the deposit due (₹' + depositAmount + ').');
      }
    }

    // Update booking row (server-resolved operator — never trust the client name).
    const opName = _opName(token) || operatorName || '';
    booking[BC.STATUS]          = 'Active';
    booking[BC.VEHICLE_ID]      = vehicleId;
    booking[BC.VEHICLE_LABEL]   = vehicle.label;
    booking[BC.RENT_CASH]       = rentCash;
    booking[BC.RENT_UPI]        = rentUPI;
    booking[BC.DEPOSIT_CASH]    = depositCash;
    booking[BC.DEPOSIT_UPI]     = depositUPI;
    booking[BC.OPERATOR_BOOKED] = opName;
    // One batched range write (status + the contiguous VehicleId…OperatorBooked block)
    // instead of eight per-cell writes — far fewer Sheets round-trips, faster confirm.
    sheet.getRange(targetRow, BC.STATUS + 1).setValue('Active');
    sheet.getRange(targetRow, BC.VEHICLE_ID + 1, 1, BC.OPERATOR_BOOKED - BC.VEHICLE_ID + 1)
         .setValues([booking.slice(BC.VEHICLE_ID, BC.OPERATOR_BOOKED + 1)]);

    // Mark vehicle as Out
    _setVehicleStatusById(vehicleId, 'Out');

    // Immutable ledger rows — rent + deposit collected, split by cash/UPI.
    _appendLedgerRows([
      { type: 'RentIn',    direction: 'credit', amount: rentCash,    account: 'cash', operator: opName, bookingId: bookingId },
      { type: 'RentIn',    direction: 'credit', amount: rentUPI,     account: 'upi',  operator: opName, bookingId: bookingId },
      { type: 'DepositIn', direction: 'credit', amount: depositCash, account: 'cash', operator: opName, bookingId: bookingId },
      { type: 'DepositIn', direction: 'credit', amount: depositUPI,  account: 'upi',  operator: opName, bookingId: bookingId }
    ]);

    _bumpDataVersion();
    result = { success: true, vehicleLabel: vehicle.label };
  } finally {
    lock.releaseLock();
  }

  // Confirmation email is sent AFTER releasing the lock — sending mail can take a
  // second or two and must never hold up another operator's action. Best-effort: a
  // mail failure never voids a booking that is already saved.
  result.emailSent = false;
  try {
    if (String(getSettingValue('emailEnabled')).toLowerCase() === 'yes') {
      result.emailSent = sendBookingConfirmationEmail(bookingId);
    }
  } catch (e) {
    Logger.log('Confirmation email failed for ' + bookingId + ': ' + e.message);
  }
  return result;
}

// ─── Admin — Extend a booking's return date ───────────────────────────────────
// Moves the return date later and recalculates rent (and deposit, if the longer
// stay crosses into another week) on the booking's OWN snapshot rates. For an
// Active booking the extra is COLLECTED now (cash/UPI/split) and posted to the
// immutable ledger exactly like a confirm — so the money invariant stays true:
// we add real collected cash with matching ledger credits (Σ drawers == cash on
// hand). For a Pending booking nothing is collected yet; the larger amount is taken
// at confirmation. The new date legitimately moves the deadline, so the guest is not
// charged a late fee for the days they paid to extend.
function extendBooking(bookingId, newCheckOut, payment, token) {
  requireAdmin(token);
  if (!_isRealYmd(newCheckOut)) {
    throw new Error('Pick a valid new return date.');
  }
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  try {
    const sheet = _getBookingsSheet();
    const data  = sheet.getDataRange().getValues();
    let targetRow = -1, booking = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][BC.BOOKING_ID]) === bookingId) { targetRow = i + 1; booking = data[i]; break; }
    }
    if (!booking) throw new Error('Booking not found: ' + bookingId);
    const st = String(booking[BC.STATUS]);
    if (st !== 'Active' && st !== 'Pending') throw new Error('Only an active or pending booking can be extended.');

    const checkIn     = _ymd(booking[BC.CHECK_IN]);
    const oldCheckOut = _ymd(booking[BC.CHECK_OUT]);
    const newOut      = String(newCheckOut).trim();
    if (newOut <= oldCheckOut) throw new Error('The new return date must be later than the current one (' + oldCheckOut + ').');

    // Recompute on the booking's OWN snapshot rates so the original days are never
    // silently repriced (fall back to current rates only for legacy rows missing a snap).
    const rates      = resolveRatesForBooking();
    const dayRate    = Number(booking[BC.DAY_RATE_SNAP])         || rates.dayRate;
    const depPerWeek = Number(booking[BC.DEPOSIT_PER_WEEK_SNAP]) || rates.depositPerWeek;
    const newDays    = daysInclusive(checkIn, newOut);
    const oldRent    = Number(booking[BC.RENT_AMOUNT])    || 0;
    const oldDeposit = Number(booking[BC.DEPOSIT_AMOUNT]) || 0;
    const newRent    = dayRate * newDays;
    const newDeposit = depPerWeek * Math.ceil(newDays / 7);
    const addRent    = newRent - oldRent;
    const addDeposit = newDeposit - oldDeposit;
    const addTotal   = addRent + addDeposit;
    if (addTotal < 0) throw new Error('Extending should not reduce the amount due.');

    // Collect the extra only for an Active booking (a Pending one pays at confirm).
    let rentCash = 0, rentUPI = 0, depositCash = 0, depositUPI = 0;
    const collect = (st === 'Active' && addTotal > 0);
    if (collect) {
      const pay = payment || { mode: 'cash' };
      if (pay.mode === 'cash')      { rentCash = addRent; depositCash = addDeposit; }
      else if (pay.mode === 'upi')  { rentUPI  = addRent; depositUPI  = addDeposit; }
      else {
        rentCash    = Number(pay.rentCash)    || 0;
        rentUPI     = Number(pay.rentUPI)     || 0;
        depositCash = Number(pay.depositCash) || 0;
        depositUPI  = Number(pay.depositUPI)  || 0;
        if (rentCash < 0 || rentUPI < 0 || depositCash < 0 || depositUPI < 0) throw new Error('Payment amounts cannot be negative.');
        if (Math.abs((rentCash + rentUPI) - addRent) > 1) {
          throw new Error('Rent split (₹' + (rentCash + rentUPI) + ') must equal the extra rent due (₹' + addRent + ').');
        }
        if (Math.abs((depositCash + depositUPI) - addDeposit) > 1) {
          throw new Error('Deposit split (₹' + (depositCash + depositUPI) + ') must equal the extra deposit due (₹' + addDeposit + ').');
        }
      }
    }

    const opName = _opName(token) || '';
    // Cash is modelled as sitting in the drawer of whoever the booking was booked under
    // (getDrawers attributes a booking's collected cash to OPERATOR_BOOKED). Attribute the
    // extension's ledger rows to that SAME operator so Bookings- and Ledger-derived books
    // stay reconcilable down to the operator (mirrors confirmBooking). Note records who took it.
    const bookedOp = String(booking[BC.OPERATOR_BOOKED] || '') || opName;
    // Update dates + amounts; add freshly collected money onto what's already recorded.
    sheet.getRange(targetRow, BC.CHECK_OUT     + 1).setValue(newOut);
    sheet.getRange(targetRow, BC.DAYS          + 1).setValue(newDays);
    sheet.getRange(targetRow, BC.RENT_AMOUNT   + 1).setValue(newRent);
    sheet.getRange(targetRow, BC.DEPOSIT_AMOUNT+ 1).setValue(newDeposit);
    sheet.getRange(targetRow, BC.TOTAL_AMOUNT  + 1).setValue(newRent + newDeposit);
    if (collect) {
      sheet.getRange(targetRow, BC.RENT_CASH    + 1).setValue((Number(booking[BC.RENT_CASH])    || 0) + rentCash);
      sheet.getRange(targetRow, BC.RENT_UPI     + 1).setValue((Number(booking[BC.RENT_UPI])     || 0) + rentUPI);
      sheet.getRange(targetRow, BC.DEPOSIT_CASH + 1).setValue((Number(booking[BC.DEPOSIT_CASH]) || 0) + depositCash);
      sheet.getRange(targetRow, BC.DEPOSIT_UPI  + 1).setValue((Number(booking[BC.DEPOSIT_UPI])  || 0) + depositUPI);
      const note = 'Extended ' + oldCheckOut + ' → ' + newOut + (opName && opName !== bookedOp ? ' (by ' + opName + ')' : '');
      _appendLedgerRows([
        { type: 'RentIn',    direction: 'credit', amount: rentCash,    account: 'cash', operator: bookedOp, bookingId: bookingId, note: note },
        { type: 'RentIn',    direction: 'credit', amount: rentUPI,     account: 'upi',  operator: bookedOp, bookingId: bookingId, note: note },
        { type: 'DepositIn', direction: 'credit', amount: depositCash, account: 'cash', operator: bookedOp, bookingId: bookingId, note: note },
        { type: 'DepositIn', direction: 'credit', amount: depositUPI,  account: 'upi',  operator: bookedOp, bookingId: bookingId, note: note }
      ]);
    }

    _bumpDataVersion();
    return {
      success: true, checkOut: newOut, days: newDays,
      rentAmount: newRent, depositAmount: newDeposit, totalAmount: newRent + newDeposit,
      addRent: addRent, addDeposit: addDeposit, addTotal: collect ? addTotal : 0
    };
  } finally {
    lock.releaseLock();
  }
}

// ─── Admin — Edit a booking ───────────────────────────────────────────────────
// Pending: correct any guest detail AND the dates (recomputes rent/deposit on the
// booking's own snapshot rates; nothing is collected yet — payment is taken at
// confirm, so no money moves). Active: correct guest details only — changing the
// length/money of a PAID rental goes through Extend (longer) or Process return
// (early) so the cash books stay exact. Only fields actually sent are overwritten.
function editBooking(bookingId, data, token) {
  requireAdmin(token);
  data = data || {};
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  try {
    const sheet = _getBookingsSheet();
    const rows  = sheet.getDataRange().getValues();
    let targetRow = -1, booking = null;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][BC.BOOKING_ID]) === bookingId) { targetRow = i + 1; booking = rows[i]; break; }
    }
    if (!booking) throw new Error('Booking not found: ' + bookingId);
    const st = String(booking[BC.STATUS]);
    if (st !== 'Pending' && st !== 'Active') throw new Error('Only a pending or active booking can be edited.');

    // Guest details — editable in both states. Only overwrite a field that was sent
    // (a partial payload never blanks something); the name may not be cleared.
    if (data.riderName  !== undefined && String(data.riderName).trim() !== '') sheet.getRange(targetRow, BC.RIDER_NAME   + 1).setValue(_sanitizeCell(String(data.riderName).trim()));
    if (data.mobile     !== undefined) sheet.getRange(targetRow, BC.MOBILE       + 1).setValue(_sanitizeCell(String(data.mobile).trim()));
    if (data.altMobile  !== undefined) sheet.getRange(targetRow, BC.ALT_MOBILE   + 1).setValue(_sanitizeCell(String(data.altMobile).trim()));
    if (data.cottageName!== undefined) sheet.getRange(targetRow, BC.COTTAGE_NAME  + 1).setValue(_sanitizeCell(String(data.cottageName).trim()));
    if (data.email      !== undefined) sheet.getRange(targetRow, BC.EMAIL        + 1).setValue(_sanitizeCell(String(data.email).trim()));
    if (data.dlNumber   !== undefined) sheet.getRange(targetRow, BC.DL_NUMBER    + 1).setValue(_sanitizeCell(String(data.dlNumber).trim()));

    const out = { success: true, status: st };

    // Dates + money — PENDING only (no cash has moved yet, so recompute freely).
    if (st === 'Pending' && (data.checkIn !== undefined || data.checkOut !== undefined)) {
      const ymd = function (s, def) { return _isRealYmd(s) ? String(s).trim() : def; };
      const checkIn = ymd(data.checkIn, _ymd(booking[BC.CHECK_IN]));
      let   checkOut = ymd(data.checkOut, _ymd(booking[BC.CHECK_OUT]));
      if (checkOut < checkIn) checkOut = checkIn;
      const rates      = resolveRatesForBooking();
      const dayRate    = Number(booking[BC.DAY_RATE_SNAP])         || rates.dayRate;
      const depPerWeek = Number(booking[BC.DEPOSIT_PER_WEEK_SNAP]) || rates.depositPerWeek;
      const days       = daysInclusive(checkIn, checkOut);
      const rent       = dayRate * days;
      const deposit    = depPerWeek * Math.ceil(days / 7);
      sheet.getRange(targetRow, BC.CHECK_IN      + 1).setValue(checkIn);
      sheet.getRange(targetRow, BC.CHECK_OUT     + 1).setValue(checkOut);
      sheet.getRange(targetRow, BC.DAYS          + 1).setValue(days);
      sheet.getRange(targetRow, BC.RENT_AMOUNT   + 1).setValue(rent);
      sheet.getRange(targetRow, BC.DEPOSIT_AMOUNT+ 1).setValue(deposit);
      sheet.getRange(targetRow, BC.TOTAL_AMOUNT  + 1).setValue(rent + deposit);
      out.days = days; out.rentAmount = rent; out.depositAmount = deposit; out.totalAmount = rent + deposit;
    }

    _bumpDataVersion();
    return out;
  } finally {
    lock.releaseLock();
  }
}

// ─── Admin — Swap the scooter allocated to an Active booking ─────────────────
// A rented scooter breaks down mid-rental: move the booking onto a different one
// without touching money. Same rent/deposit as already collected — only the
// booking's VEHICLE_ID/VEHICLE_LABEL change (no ledger rows, no RENT_*/DEPOSIT_*
// columns touched). The old scooter goes to Available, Maintenance, or Charging
// (the desk's call); the new one goes Out — exactly like confirmBooking's allocation.
function swapBookingVehicle(bookingId, newVehicleId, oldStatus, token) {
  requireAdmin(token);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  try {
    const sheet = _getBookingsSheet();
    const data  = sheet.getDataRange().getValues();
    let targetRow = -1, booking = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][BC.BOOKING_ID]) === bookingId) { targetRow = i + 1; booking = data[i]; break; }
    }
    if (!booking) throw new Error('Booking not found: ' + bookingId);
    const st = String(booking[BC.STATUS]);
    if (st !== 'Active') throw new Error('Only an active booking has a scooter to swap — a pending booking has no vehicle allocated yet.');

    const oldVehicleId = String(booking[BC.VEHICLE_ID] || '');
    const oldLabel      = String(booking[BC.VEHICLE_LABEL] || '');

    const vehicle = _getVehiclesData().find(v => v.vehicleId === newVehicleId);
    if (!vehicle) throw new Error('Vehicle not found.');
    if (newVehicleId === oldVehicleId) throw new Error('That scooter is already allocated to this booking.');
    if (vehicle.type === 'Staff') throw new Error('A staff vehicle can’t be allocated to a booking.');
    if (vehicle.status !== 'Available' && vehicle.status !== 'Charging') throw new Error('Vehicle ' + vehicle.label + ' is not available.');

    // What the OLD scooter becomes — only meaningful states; default Available.
    let toOld = String(oldStatus || '').trim();
    if (toOld !== 'Available' && toOld !== 'Maintenance' && toOld !== 'Charging') toOld = 'Available';

    // Reassign the booking (VEHICLE_ID + VEHICLE_LABEL are contiguous — one batched write).
    booking[BC.VEHICLE_ID]    = newVehicleId;
    booking[BC.VEHICLE_LABEL] = vehicle.label;
    sheet.getRange(targetRow, BC.VEHICLE_ID + 1, 1, BC.VEHICLE_LABEL - BC.VEHICLE_ID + 1)
         .setValues([[newVehicleId, vehicle.label]]);

    _setVehicleStatusById(newVehicleId, 'Out');
    if (oldVehicleId) _setVehicleStatusById(oldVehicleId, toOld);

    _bumpDataVersion();
    return { success: true, oldLabel: oldLabel, newLabel: vehicle.label };
  } finally {
    lock.releaseLock();
  }
}

// ─── Admin/Yard — acknowledge a scooter has been brought out ─────────────────
// The desk confirms a booking (Active + a scooter allocated) — the yard must notice
// and physically bring that scooter out to the guest. This just stamps WHEN the yard
// did that, so the Yard view's task queue can show only what's still outstanding.
// Idempotent by design: two staff tapping "handed over" on the same task at once both
// succeed — the second is a harmless no-op (no lock: it's a single cell write with no
// money/race-sensitive read-modify-write, unlike confirmBooking's vehicle allocation).
function markYardDone(bookingId, token) {
  requireAdmin(token);
  const sheet = _getBookingsSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][BC.BOOKING_ID]) !== bookingId) continue;
    if (String(data[i][BC.STATUS]) !== 'Active') throw new Error('This booking is not active.');
    if (data[i][BC.YARD_DONE_AT]) return { success: true, already: true };
    sheet.getRange(i + 1, BC.YARD_DONE_AT + 1).setValue(new Date());
    _bumpDataVersion();
    return { success: true };
  }
  throw new Error('Booking not found: ' + bookingId);
}

// Cancel a booking.
//  • Pending  — nothing was collected: a plain void (any operator), no refund.
//  • Active   — money was already collected at confirm/extension. Dropping it silently
//    (the old bug) left the cash in the ledger but out of accounting. Instead we settle
//    it: the operator states how much cash / UPI to hand back (capped per channel to what
//    was collected), a reason is required, the vehicle is freed, and immutable Ledger
//    refund rows are appended. A Cancelled booking that held money now COUNTS in
//    accounting + drawers (see getAccountingSummary/getDrawers) so Σ drawers == cash on
//    hand stays true. Permission for an Active cancel: managers always; ordinary operators
//    only when Settings → allowOperatorCancelActive is on.
// refund: { cash, upi } — amounts (₹) to return to the guest for an Active cancel.
function cancelBooking(bookingId, reason, refund, token) {
  requireAdmin(token);
  refund = refund || {};
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  try {
    const sheet = _getBookingsSheet();
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][BC.BOOKING_ID]) !== bookingId) continue;
      const booking = data[i];
      // Only a Pending or Active booking may be cancelled. Cancelling a Returned booking
      // would flip a settled record to Cancelled and re-derive its money incorrectly.
      const st = String(booking[BC.STATUS]);
      if (st !== 'Pending' && st !== 'Active') {
        throw new Error('Only a pending or active booking can be cancelled.');
      }
      const me = _opName(token) || '';

      if (st === 'Pending') {
        // Nothing collected yet — a plain void.
        sheet.getRange(i + 1, BC.STATUS       + 1).setValue('Cancelled');
        sheet.getRange(i + 1, BC.RETURN_NOTES + 1).setValue(reason || 'Cancelled');
        sheet.getRange(i + 1, BC.CANCELLED_AT + 1).setValue(new Date());
        sheet.getRange(i + 1, BC.CANCELLED_BY + 1).setValue(me);
        _bumpDataVersion();
        return { success: true, status: 'Cancelled' };
      }

      // ── Active cancel — money was collected, so this pays a refund. ──
      // Managers always; operators only via the Settings toggle (default off).
      if (!_isManager(token) &&
          String(getSettingValue('allowOperatorCancelActive') || 'no').toLowerCase() !== 'yes') {
        throw new Error('Cancelling a paid (active) booking is a manager action. Ask the manager to enable it in Settings.');
      }
      if (!reason || !String(reason).trim()) {
        throw new Error('A reason is required to cancel a paid booking.');
      }
      const collectedCash = (Number(booking[BC.RENT_CASH]) || 0) + (Number(booking[BC.DEPOSIT_CASH]) || 0);
      const collectedUPI  = (Number(booking[BC.RENT_UPI])  || 0) + (Number(booking[BC.DEPOSIT_UPI])  || 0);
      let refundCash = Math.round(Number(refund.cash) || 0);
      let refundUPI  = Math.round(Number(refund.upi)  || 0);
      if (refundCash < 0 || refundUPI < 0) throw new Error('Refund amounts cannot be negative.');
      // Per-channel caps: never hand back more cash (or UPI) than was collected in that
      // channel — that would drive the collector's drawer / cash on hand negative.
      if (refundCash > collectedCash + 1) throw new Error('Cash refund (₹' + refundCash + ') cannot exceed the cash collected (₹' + collectedCash + ').');
      if (refundUPI  > collectedUPI  + 1) throw new Error('UPI refund (₹' + refundUPI + ') cannot exceed the UPI collected (₹' + collectedUPI + ').');
      refundCash = Math.min(refundCash, collectedCash);
      refundUPI  = Math.min(refundUPI,  collectedUPI);

      // Free the vehicle.
      _setVehicleStatusById(String(booking[BC.VEHICLE_ID]), 'Available');

      // Record the cancellation + refund. The REFUND_* columns hold the refund paid; the
      // server-resolved actor + timestamp are stamped (never a client-sent name).
      sheet.getRange(i + 1, BC.STATUS       + 1).setValue('Cancelled');
      sheet.getRange(i + 1, BC.RETURN_NOTES + 1).setValue(String(reason).trim());
      sheet.getRange(i + 1, BC.REFUND_CASH  + 1).setValue(refundCash);
      sheet.getRange(i + 1, BC.REFUND_UPI   + 1).setValue(refundUPI);
      sheet.getRange(i + 1, BC.REFUND_TOTAL + 1).setValue(refundCash + refundUPI);
      sheet.getRange(i + 1, BC.CANCELLED_AT + 1).setValue(new Date());
      sheet.getRange(i + 1, BC.CANCELLED_BY + 1).setValue(me);

      // Immutable ledger refund rows — attributed to whoever COLLECTED the cash
      // (OPERATOR_BOOKED), matching how getDrawers attributes the drawer that pays it,
      // so Bookings- and Ledger-derived books stay reconcilable (mirrors extendBooking).
      const payer = String(booking[BC.OPERATOR_BOOKED] || '') || me;
      const note  = 'Cancelled · ' + String(reason).trim() + (me && me !== payer ? ' (by ' + me + ')' : '');
      _appendLedgerRows([
        { type: 'Refund',        direction: 'debit', amount: refundCash, account: 'cash', operator: payer, bookingId: bookingId, note: note },
        { type: 'DepositRefund', direction: 'debit', amount: refundUPI,  account: 'upi',  operator: payer, bookingId: bookingId, note: note }
      ]);

      _bumpDataVersion();
      return { success: true, status: 'Cancelled', refundCash: refundCash, refundUPI: refundUPI, refundTotal: refundCash + refundUPI };
    }
    throw new Error('Booking not found.');
  } finally {
    lock.releaseLock();
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function getBookingsByStatus(status, token, bDataIn) {
  requireAdmin(token);
  const data = bDataIn || _getBookingsSheet().getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][BC.BOOKING_ID]) continue;
    if (status === 'All' || String(data[i][BC.STATUS]) === status) {
      out.push(_rowToBooking(data[i]));
    }
  }
  return out.reverse();
}

// ─── Manager: add a historical (backdated) booking ────────────────────────────
// For entering rentals that happened before the app (or offline). The booking row
// can carry a past date, BUT its ledger entries are stamped NOW — so money always
// counts under the current books and the immutable ledger can never be rewritten.
function createBackdatedBooking(data, token) {
  requireAdmin(token);
  if (String(getSettingValue('allowPastBookings') || 'yes').toLowerCase() !== 'yes') {
    throw new Error('Adding past bookings is turned off in Settings.');
  }
  // Past bookings are a manager power by default. The manager may grant them to a
  // supervisor (supRunBookings) or to ordinary operators (allowOperatorPastBookings).
  if (!_isManager(token) && !_hasPower(token, 'supRunBookings') &&
      String(getSettingValue('allowOperatorPastBookings') || 'no').toLowerCase() !== 'yes') {
    throw new Error('Adding past bookings is a manager action. Ask the manager to enable access in Settings.');
  }
  if (!data.riderName) throw new Error('Rider name is required.');

  const rates = resolveRatesForBooking();
  const ymd = function (s, def) { return _isRealYmd(s) ? String(s).trim() : def; };
  const todayIST = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const checkIn  = ymd(data.checkIn, todayIST);
  let   checkOut = ymd(data.checkOut, checkIn);
  if (checkOut < checkIn) checkOut = checkIn;
  const days = daysInclusive(checkIn, checkOut);
  const rentAmount = Number(data.rentAmount) > 0 ? Number(data.rentAmount) : rates.dayRate * days;
  const depositAmt = Number(data.depositAmount) >= 0 && data.depositAmount !== undefined && data.depositAmount !== '' ? Number(data.depositAmount) : rates.depositPerWeek * Math.ceil(days / 7);

  // Payment split (manager states how it was paid)
  const rentCash = Number(data.rentCash) || 0, rentUPI = Number(data.rentUPI) || 0;
  const depCash  = Number(data.depositCash) || 0, depUPI = Number(data.depositUPI) || 0;
  if (rentCash < 0 || rentUPI < 0 || depCash < 0 || depUPI < 0) throw new Error('Payment amounts cannot be negative.');
  // The split must add up to the stated amounts — the same guard confirmBooking enforces.
  // Without it a backdated row can post cash/UPI that disagrees with rent/deposit and fail
  // runSelfAudit's per-booking reconciliation (and leave the Returned refund columns off).
  if (Math.abs((rentCash + rentUPI) - rentAmount) > 1) {
    throw new Error('Rent split (₹' + (rentCash + rentUPI) + ') must equal the rent (₹' + rentAmount + ').');
  }
  if (Math.abs((depCash + depUPI) - depositAmt) > 1) {
    throw new Error('Deposit split (₹' + (depCash + depUPI) + ') must equal the deposit (₹' + depositAmt + ').');
  }

  const status = (String(data.status) === 'Active') ? 'Active' : 'Returned';
  const createdAt = ymd(data.createdAt, checkIn);   // historical creation date
  const createdDate = new Date(createdAt + 'T12:00:00');
  const me = _opName(token) || 'Manager';

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('The desk is busy — try again.'); }
  let bookingId;
  try {
    // Booking id keyed to the historical date (DDMMYY-N) so it sorts in place.
    // High-water mark (not a row count) so deletes/imports can't reuse an id.
    const ddmmyy = Utilities.formatDate(createdDate, 'Asia/Kolkata', 'ddMMyy');
    bookingId = ddmmyy + '-' + (_maxBookingSeq(ddmmyy) + 1);

    const row = new Array(36).fill('');
    row[BC.BOOKING_ID] = bookingId; row[BC.CREATED_AT] = createdDate; row[BC.STATUS] = status;
    row[BC.RIDER_NAME] = _sanitizeCell(data.riderName); row[BC.DL_NUMBER] = _sanitizeCell(data.dlNumber || '');
    row[BC.COTTAGE_NAME] = _sanitizeCell(data.cottageName || ''); row[BC.MOBILE] = _sanitizeCell(data.mobile || '');
    row[BC.ALT_MOBILE] = _sanitizeCell(data.altMobile || '');
    row[BC.CHECK_IN] = checkIn; row[BC.CHECK_OUT] = checkOut; row[BC.DAYS] = days;
    row[BC.VEHICLE_LABEL] = _sanitizeCell(data.vehicleLabel || '');
    row[BC.DAY_RATE_SNAP] = rates.dayRate; row[BC.DEPOSIT_PER_WEEK_SNAP] = rates.depositPerWeek;
    row[BC.RENT_AMOUNT] = rentAmount; row[BC.DEPOSIT_AMOUNT] = depositAmt; row[BC.TOTAL_AMOUNT] = rentAmount + depositAmt;
    row[BC.RENT_CASH] = rentCash; row[BC.RENT_UPI] = rentUPI; row[BC.DEPOSIT_CASH] = depCash; row[BC.DEPOSIT_UPI] = depUPI;
    row[BC.CONSENT_ACCEPTED] = true; row[BC.CONSENT_AT] = createdDate;
    row[BC.OPERATOR_BOOKED] = me + ' (backdated)';
    row[BC.EMAIL] = _sanitizeCell(data.email || '');
    if (status === 'Returned') {
      row[BC.ACTUAL_RETURN] = new Date(checkOut + 'T12:00:00');
      row[BC.REFUND_CASH] = depCash; row[BC.REFUND_UPI] = depUPI; row[BC.REFUND_TOTAL] = depCash + depUPI;
      row[BC.OPERATOR_RETURNED] = me + ' (backdated)';
    }
    _getBookingsSheet().appendRow(row);
  } finally { lock.releaseLock(); }

  // Ledger rows stamped NOW (the books move forward; history is never rewritten).
  const note = 'Backdated · booked ' + createdAt;
  const entries = [
    { type: 'RentIn', direction: 'credit', amount: rentCash, account: 'cash', operator: me, bookingId: bookingId, note: note },
    { type: 'RentIn', direction: 'credit', amount: rentUPI, account: 'upi', operator: me, bookingId: bookingId, note: note },
    { type: 'DepositIn', direction: 'credit', amount: depCash, account: 'cash', operator: me, bookingId: bookingId, note: note },
    { type: 'DepositIn', direction: 'credit', amount: depUPI, account: 'upi', operator: me, bookingId: bookingId, note: note }
  ];
  if (status === 'Returned') {
    if (depCash) entries.push({ type: 'Refund', direction: 'debit', amount: depCash, account: 'cash', operator: me, bookingId: bookingId, note: note });
    if (depUPI) entries.push({ type: 'DepositRefund', direction: 'debit', amount: depUPI, account: 'upi', operator: me, bookingId: bookingId, note: note });
  }
  _appendLedgerRows(entries);
  _bumpDataVersion();
  return { success: true, bookingId: bookingId };
}

// ─── Manager: soft-delete a booking (the ledger keeps the money — bank records) ──
function deleteBooking(bookingId, token) {
  // Manager, or a supervisor granted supDeleteBookings — AND the master toggle below.
  _requirePower(token, 'supDeleteBookings');
  if (String(getSettingValue('allowDeleteBookings') || 'yes').toLowerCase() !== 'yes') {
    throw new Error('Deleting bookings is turned off in Settings.');
  }
  const sheet = _getBookingsSheet();
  const data  = sheet.getDataRange().getValues();
  const me    = _opName(token) || 'Manager';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][BC.BOOKING_ID]) === bookingId) {
      const st = String(data[i][BC.STATUS]);
      if (st === 'Deleted') throw new Error('This booking is already deleted.');
      const rider = String(data[i][BC.RIDER_NAME] || '');
      if (st === 'Active') _setVehicleStatusById(String(data[i][BC.VEHICLE_ID]), 'Available');
      sheet.getRange(i + 1, BC.STATUS + 1).setValue('Deleted');
      sheet.getRange(i + 1, BC.RETURN_NOTES + 1).setValue('Record deleted by ' + me + ' · ' + rider);
      _bumpDataVersion();
      // No money is reversed — the ledger entries remain, so the books are untouched.
      return { success: true, riderName: rider };
    }
  }
  throw new Error('Booking not found.');
}
