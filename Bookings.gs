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

// Booking id = DDMMYY-N (e.g. 220626-1), N resets each day.
function _generateBookingId() {
  const ddmmyy = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'ddMMyy');
  const data = _getBookingsSheet().getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][BC.BOOKING_ID] || '').indexOf(ddmmyy + '-') === 0) count++;
  }
  return ddmmyy + '-' + (count + 1);
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
    checkOut:        _formatDateIST(row[BC.CHECK_OUT]),
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
    email:           String(row[BC.EMAIL] || '')
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
  if (data.checkIn && /^\d{4}-\d{2}-\d{2}$/.test(String(data.checkIn).trim())) {
    checkInIST = String(data.checkIn).trim();
  }
  let checkOutIST = checkInIST;
  if (data.checkOut && /^\d{4}-\d{2}-\d{2}$/.test(String(data.checkOut).trim())) {
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
    if (vehicle.status !== 'Available') throw new Error('Vehicle ' + vehicle.label + ' is not available.');

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
      if (Math.abs((rentCash + rentUPI) - rentAmount) > 1) {
        throw new Error('Rent split (₹' + (rentCash + rentUPI) + ') must equal the rent due (₹' + rentAmount + ').');
      }
      if (Math.abs((depositCash + depositUPI) - depositAmount) > 1) {
        throw new Error('Deposit split (₹' + (depositCash + depositUPI) + ') must equal the deposit due (₹' + depositAmount + ').');
      }
    }

    // Update booking row
    sheet.getRange(targetRow, BC.STATUS          + 1).setValue('Active');
  sheet.getRange(targetRow, BC.VEHICLE_ID      + 1).setValue(vehicleId);
  sheet.getRange(targetRow, BC.VEHICLE_LABEL   + 1).setValue(vehicle.label);
  sheet.getRange(targetRow, BC.RENT_CASH       + 1).setValue(rentCash);
  sheet.getRange(targetRow, BC.RENT_UPI        + 1).setValue(rentUPI);
  sheet.getRange(targetRow, BC.DEPOSIT_CASH    + 1).setValue(depositCash);
  sheet.getRange(targetRow, BC.DEPOSIT_UPI     + 1).setValue(depositUPI);
  // Server-resolved operator — never trust the client name (drawer integrity).
  const opName = _opName(token) || operatorName || '';
  sheet.getRange(targetRow, BC.OPERATOR_BOOKED + 1).setValue(opName);

    // Mark vehicle as Out
    _setVehicleStatusById(vehicleId, 'Out');

    // Immutable ledger rows — rent + deposit collected, split by cash/UPI.
    _appendLedgerRows([
      { type: 'RentIn',    direction: 'credit', amount: rentCash,    account: 'cash', operator: opName, bookingId: bookingId },
      { type: 'RentIn',    direction: 'credit', amount: rentUPI,     account: 'upi',  operator: opName, bookingId: bookingId },
      { type: 'DepositIn', direction: 'credit', amount: depositCash, account: 'cash', operator: opName, bookingId: bookingId },
      { type: 'DepositIn', direction: 'credit', amount: depositUPI,  account: 'upi',  operator: opName, bookingId: bookingId }
    ]);

    // Fire the confirmation email (best-effort — never let it break the booking)
    let emailSent = false;
    try {
      if (String(getSettingValue('emailEnabled')).toLowerCase() === 'yes') {
        emailSent = sendBookingConfirmationEmail(bookingId);
      }
    } catch (e) {
      Logger.log('Confirmation email failed for ' + bookingId + ': ' + e.message);
    }

    _bumpDataVersion();
    return { success: true, vehicleLabel: vehicle.label, emailSent: emailSent };
  } finally {
    lock.releaseLock();
  }
}

function cancelBooking(bookingId, reason, operatorName, token) {
  requireAdmin(token);
  const sheet = _getBookingsSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][BC.BOOKING_ID]) === bookingId) {
      if (String(data[i][BC.STATUS]) === 'Active') {
        // Free up the vehicle
        _setVehicleStatusById(String(data[i][BC.VEHICLE_ID]), 'Available');
      }
      sheet.getRange(i + 1, BC.STATUS         + 1).setValue('Cancelled');
      sheet.getRange(i + 1, BC.RETURN_NOTES   + 1).setValue(reason || 'Cancelled');
      sheet.getRange(i + 1, BC.OPERATOR_RETURNED + 1).setValue(operatorName || '');
      _bumpDataVersion();
      return { success: true };
    }
  }
  throw new Error('Booking not found.');
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
  _requireManager(token);
  if (String(getSettingValue('allowPastBookings') || 'yes').toLowerCase() !== 'yes') {
    throw new Error('Adding past bookings is turned off in Settings.');
  }
  if (!data.riderName) throw new Error('Rider name is required.');

  const rates = resolveRatesForBooking();
  const ymd = function (s, def) { return (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim())) ? String(s).trim() : def; };
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

  const status = (String(data.status) === 'Active') ? 'Active' : 'Returned';
  const createdAt = ymd(data.createdAt, checkIn);   // historical creation date
  const createdDate = new Date(createdAt + 'T12:00:00');
  const me = _opName(token) || 'Manager';

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('The desk is busy — try again.'); }
  let bookingId;
  try {
    // Booking id keyed to the historical date (DDMMYY-N) so it sorts in place.
    const ddmmyy = Utilities.formatDate(createdDate, 'Asia/Kolkata', 'ddMMyy');
    const all = _getBookingsSheet().getDataRange().getValues();
    let count = 0;
    for (let i = 1; i < all.length; i++) { if (String(all[i][BC.BOOKING_ID] || '').indexOf(ddmmyy + '-') === 0) count++; }
    bookingId = ddmmyy + '-' + (count + 1);

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
      row[BC.REFUND_CASH] = depCash; row[BC.REFUND_UPI] = depUPI; row[BC.REFUND_TOTAL] = depositAmt;
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
  _requireManager(token);
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

function searchBookings(query, token) {
  requireAdmin(token);
  const q    = String(query).toLowerCase();
  const data = _getBookingsSheet().getDataRange().getValues();
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][BC.BOOKING_ID]) continue;
    const r = data[i];
    if (
      String(r[BC.RIDER_NAME]).toLowerCase().includes(q) ||
      String(r[BC.MOBILE]).includes(q) ||
      String(r[BC.BOOKING_ID]).toLowerCase().includes(q) ||
      String(r[BC.VEHICLE_LABEL]).toLowerCase().includes(q) ||
      String(r[BC.COTTAGE_NAME]).toLowerCase().includes(q) ||
      String(r[BC.DL_NUMBER]).toLowerCase().includes(q)
    ) {
      out.push(_rowToBooking(r));
    }
  }
  return out.reverse();
}
