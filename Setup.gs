// ─── Sheet Definitions ─────────────────────────────────────────────────────────

const SHEET_HEADERS = {
  Settings:    ['Key', 'Value'],
  SettingsLog: ['Timestamp', 'Key', 'OldValue', 'NewValue', 'ChangedBy'],
  Vehicles:    ['VehicleId', 'Label', 'Status', 'Type', 'Notes', 'AddedOn'],
  Bookings: [
    'BookingId', 'CreatedAt', 'Status',
    'RiderName', 'DLNumber', 'CottageName', 'Mobile', 'AltMobile',
    'CheckIn', 'CheckOut', 'Days',
    'VehicleId', 'VehicleLabel',
    'DayRateSnap', 'DepositPerWeekSnap',
    'RentAmount', 'DepositAmount', 'TotalAmount',
    'RentCash', 'RentUPI', 'DepositCash', 'DepositUPI',
    'ConsentAccepted', 'ConsentAt', 'SignatureFileId',
    'OperatorBooked',
    'ActualReturn', 'LateHours', 'LateFee', 'DeductionTotal',
    'RefundCash', 'RefundUPI', 'RefundTotal',
    'OperatorReturned', 'ReturnNotes',
    'Email'
  ],
  Deductions: ['DeductionId', 'BookingId', 'Amount', 'Reason', 'AppliedBy', 'Timestamp'],
  Handovers:  ['HandoverId', 'Timestamp', 'AmountCash', 'HandedBy', 'ReceivedBy', 'Note', 'Status', 'RequestedBy', 'ApprovedBy', 'DecidedAt'],
  Operators:  ['OperatorId', 'Name', 'Active', 'Pin', 'Role', 'Email'],
  Cottages:   ['CottageId', 'Name', 'Active'],
  // Append-only, immutable money ledger — the "bank/blockchain" spine. Never edited.
  Ledger:     ['TxnId', 'Timestamp', 'Type', 'Direction', 'Amount', 'Account', 'Operator', 'BookingId', 'Note', 'RunningCashBalance']
};

// Column index map for Bookings sheet (0-based)
const BC = {
  BOOKING_ID:          0,
  CREATED_AT:          1,
  STATUS:              2,
  RIDER_NAME:          3,
  DL_NUMBER:           4,
  COTTAGE_NAME:        5,
  MOBILE:              6,
  ALT_MOBILE:          7,
  CHECK_IN:            8,
  CHECK_OUT:           9,
  DAYS:                10,
  VEHICLE_ID:          11,
  VEHICLE_LABEL:       12,
  DAY_RATE_SNAP:       13,
  DEPOSIT_PER_WEEK_SNAP: 14,
  RENT_AMOUNT:         15,
  DEPOSIT_AMOUNT:      16,
  TOTAL_AMOUNT:        17,
  RENT_CASH:           18,
  RENT_UPI:            19,
  DEPOSIT_CASH:        20,
  DEPOSIT_UPI:         21,
  CONSENT_ACCEPTED:    22,
  CONSENT_AT:          23,
  SIGNATURE_FILE_ID:   24,
  OPERATOR_BOOKED:     25,
  ACTUAL_RETURN:       26,
  LATE_HOURS:          27,
  LATE_FEE:            28,
  DEDUCTION_TOTAL:     29,
  REFUND_CASH:         30,
  REFUND_UPI:          31,
  REFUND_TOTAL:        32,
  OPERATOR_RETURNED:   33,
  RETURN_NOTES:        34,
  EMAIL:               35
};

const VC = { VEHICLE_ID: 0, LABEL: 1, STATUS: 2, TYPE: 3, NOTES: 4, ADDED_ON: 5 };
// Type values: 'Rental' (available to riders) | 'Staff' (internal management use)

// ─── Initialization ────────────────────────────────────────────────────────────

function initializeSheets() {
  const ss = _getSS();
  const headerStyle = { background: '#2F5D50', color: '#FFFFFF', bold: true };

  Object.keys(SHEET_HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    if (sheet.getLastRow() === 0) {
      const headers = SHEET_HEADERS[name];
      const r = sheet.getRange(1, 1, 1, headers.length);
      r.setValues([headers]);
      r.setFontWeight('bold')
       .setBackground(headerStyle.background)
       .setFontColor(headerStyle.color)
       .setVerticalAlignment('middle');
      sheet.setFrozenRows(1);
      sheet.setRowHeight(1, 30);
      // Tidy, readable columns so the sheet looks organized out of the box.
      try { sheet.autoResizeColumns(1, headers.length); } catch (e) {}
    }
  });

  // Remove the stray default "Sheet1" that Sheets creates with a new file.
  try {
    const blank = ss.getSheetByName('Sheet1');
    if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  } catch (e) {}

  // Order the tabs the way the desk thinks about them.
  try {
    ['Bookings','Vehicles','Cottages','Operators','Ledger','Handovers','Deductions','Settings','SettingsLog']
      .forEach((nm, i) => { const sh = ss.getSheetByName(nm); if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); } });
    ss.setActiveSheet(ss.getSheetByName('Bookings'));
  } catch (e) {}

  // Currency + date formatting on the Bookings money/date columns for a clean ledger.
  try {
    const bk = ss.getSheetByName('Bookings');
    const moneyCols = [
      BC.DAY_RATE_SNAP, BC.DEPOSIT_PER_WEEK_SNAP, BC.RENT_AMOUNT, BC.DEPOSIT_AMOUNT, BC.TOTAL_AMOUNT,
      BC.RENT_CASH, BC.RENT_UPI, BC.DEPOSIT_CASH, BC.DEPOSIT_UPI, BC.LATE_FEE, BC.DEDUCTION_TOTAL,
      BC.REFUND_CASH, BC.REFUND_UPI, BC.REFUND_TOTAL
    ];
    moneyCols.forEach(c => bk.getRange(2, c + 1, 998, 1).setNumberFormat('₹#,##0'));
    bk.getRange(2, BC.CREATED_AT + 1, 998, 1).setNumberFormat('dd MMM yyyy, HH:mm');
  } catch (e) {}

  // Seed default Settings rows
  const settingsSheet = ss.getSheetByName('Settings');
  if (settingsSheet.getLastRow() <= 1) {
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      settingsSheet.appendRow([key, DEFAULT_SETTINGS[key]]);
    });
  }

  // No demo operators are seeded — the first-run setup wizard creates the
  // manager (name + PIN). The desk stays a clean slate until then.

  // Starter cottage list (Isha accommodations) — the desk edits these in Settings.
  const ctSheet = ss.getSheetByName('Cottages');
  if (ctSheet.getLastRow() <= 1) {
    ['Day Visitor', 'Shivapadam 1', 'Shivapadam 2', 'Shivapadam 3', 'Shivapadam 4', 'Brahmaputra']
      .forEach((name, i) => {
        ctSheet.appendRow(['CT' + String(i + 1).padStart(3, '0'), name, true]);
      });
  }

  return { success: true, message: 'All sheets initialized.' };
}

// ─── Vehicle status helper ─────────────────────────────────────────────────────

// Internal helper used by confirmBooking / processReturn / cancelBooking to flip
// a scooter's status by its id.
function _setVehicleStatusById(vehicleId, status) {
  const sheet = _getSS().getSheetByName('Vehicles');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][VC.VEHICLE_ID]) === vehicleId) {
      sheet.getRange(i + 1, VC.STATUS + 1).setValue(status);
      return true;
    }
  }
  return false;
}
