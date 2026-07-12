// ─── Sheet Definitions ─────────────────────────────────────────────────────────

const SHEET_HEADERS = {
  Settings:    ['Key', 'Value'],
  SettingsLog: ['Timestamp', 'Key', 'OldValue', 'NewValue', 'ChangedBy'],
  Vehicles:    ['VehicleId', 'Label', 'Status', 'Type', 'Notes', 'AddedOn', 'Location'],
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
    'Email',
    'CancelledAt', 'CancelledBy',
    'YardDoneAt'
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
  EMAIL:               35,
  // Appended (append-only, positional) for the Active-cancel refund flow.
  CANCELLED_AT:        36,
  CANCELLED_BY:        37,
  // Appended (append-only, positional): stamped when the yard physically brings the
  // scooter out for a newly-Active booking. Empty = still an open "bring out" task.
  YARD_DONE_AT:        38
};

const VC = { VEHICLE_ID: 0, LABEL: 1, STATUS: 2, TYPE: 3, NOTES: 4, ADDED_ON: 5, LOCATION: 6 };
// Type values: 'Rental' (available to riders) | 'Staff' (internal management use)
// Status values: 'Available' | 'Out' | 'Maintenance' | 'Charging' | 'Staff'.
// Charging (unlike Maintenance) still counts as available/bookable — the desk can
// allocate a Charging scooter and have the yard unplug it.
// Location: free short text, e.g. Yard / Charging point / Pickup point.

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
    bk.getRange(2, BC.CANCELLED_AT + 1, 998, 1).setNumberFormat('dd MMM yyyy, HH:mm');
    bk.getRange(2, BC.YARD_DONE_AT + 1, 998, 1).setNumberFormat('dd MMM yyyy, HH:mm');
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

// ─── Manual reset (editor only) ─────────────────────────────────────────────────
// Run by hand from the Apps Script editor to wipe the app back to a clean first-run
// state and rebuild a fresh data sheet — e.g. after the data sheet was deleted or
// must be reset. It is deliberately NOT callable from the web UI.
//
// GUARDED: if the linked sheet still opens AND holds real data (any bookings or
// operators), resetAndSetup() REFUSES and tells you to run YES_ERASE_EVERYTHING()
// instead. When the linked sheet is already gone/unopenable, it proceeds directly.
// PIN_SECRET is always kept so existing PIN hashes stay valid.
function resetAndSetup() {
  return _resetAndSetup(false);
}

// Same reset, but erases even when the linked sheet still holds live bookings /
// operators. Use only when you truly mean to destroy the current data.
function YES_ERASE_EVERYTHING() {
  return _resetAndSetup(true);
}

function _resetAndSetup(force) {
  const props = PropertiesService.getScriptProperties();
  const oldId = props.getProperty('SPREADSHEET_ID');

  // Refusal guard: only when the linked sheet still opens AND holds real data.
  if (oldId && !force) {
    let existing = null;
    try { existing = SpreadsheetApp.openById(oldId); } catch (e) { existing = null; }
    if (existing) {
      const bookings  = _countDataRows(existing, 'Bookings');
      const operators = _countDataRows(existing, 'Operators');
      if (bookings > 0 || operators > 0) {
        Logger.log('resetAndSetup REFUSED — the linked sheet still holds real data: '
          + bookings + ' booking(s), ' + operators + ' operator(s).');
        Logger.log('run YES_ERASE_EVERYTHING to confirm');
        return;
      }
    }
  }

  // Trash the old spreadsheet best-effort so we don't orphan it in Drive.
  if (oldId) {
    try { DriveApp.getFileById(oldId).setTrashed(true); }
    catch (e) { Logger.log('resetAndSetup: could not trash old sheet: ' + e.message); }
  }

  // Clear the install/migration guards so _ensureSetup rebuilds from scratch and every
  // append-only migration re-runs on the fresh sheet. KEEP PIN_SECRET (PIN hashes).
  ['SPREADSHEET_ID', 'SETUP_DONE', 'COLS_MIGRATED', 'MONEY_MIGRATED', 'CANCEL_MIGRATED', 'VEH_COLS_MIGRATED', 'YARD_COLS_MIGRATED']
    .forEach(k => props.deleteProperty(k));
  props.setProperty('DATA_VERSION', '0');

  _ensureSetup(); // builds a new sheet + all tabs + headers + default settings (no schema duped here)

  // The editor can't open tabs, so log tappable URLs for the phone.
  let sheetUrl = '';
  try { sheetUrl = _getSS().getUrl() || ''; } catch (e) {}
  let execUrl = '';
  try { execUrl = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  Logger.log('Reset complete. New data sheet: ' + sheetUrl);
  Logger.log('Open the desk here: ' + execUrl);
  return { success: true, sheetUrl: sheetUrl, execUrl: execUrl };
}

// Count non-header data rows in a tab (0 if the tab is missing). Used by the reset
// refusal guard to decide whether the linked sheet still holds real data.
function _countDataRows(ss, tabName) {
  try {
    const sh = ss.getSheetByName(tabName);
    if (!sh) return 0;
    return Math.max(0, sh.getLastRow() - 1);
  } catch (e) { return 0; }
}

// Migration: append the Location column to a Vehicles sheet made before it existed.
// Append-only (never reorders) so the positional VC indices stay valid. Idempotent.
function _ensureVehicleColumns() {
  try {
    const sheet = _getSS().getSheetByName('Vehicles');
    if (!sheet || sheet.getLastColumn() === 0) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (headers.indexOf('Location') === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1)
        .setValue('Location').setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
    }
  } catch (e) {
    Logger.log('_ensureVehicleColumns failed: ' + e.message);
  }
}

// Migration: append the YardDoneAt column (yard bring-out acknowledgement) to a
// Bookings sheet made before it existed. Append-only, idempotent. Back-fills the
// current timestamp into every EXISTING Active booking's YardDoneAt so the yard
// task queue starts empty — otherwise every already-out rental would appear as a
// brand-new "bring out" task the first time the Yard view loads.
function _ensureYardColumns() {
  try {
    const sheet = _getSS().getSheetByName('Bookings');
    if (!sheet || sheet.getLastColumn() === 0) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    if (headers.indexOf('YardDoneAt') === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1)
        .setValue('YardDoneAt').setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
      headers.push('YardDoneAt');
    }
    const yardCol = headers.indexOf('YardDoneAt') + 1;
    const last = sheet.getLastRow();
    if (last > 1 && yardCol > 0) {
      const statusVals = sheet.getRange(2, BC.STATUS + 1, last - 1, 1).getValues();
      const yardRng    = sheet.getRange(2, yardCol, last - 1, 1);
      const yardVals   = yardRng.getValues();
      let dirty = false;
      const now = new Date();
      for (let i = 0; i < yardVals.length; i++) {
        if (String(statusVals[i][0]) === 'Active' && !yardVals[i][0]) { yardVals[i][0] = now; dirty = true; }
      }
      if (dirty) yardRng.setValues(yardVals);
    }
  } catch (e) {
    Logger.log('_ensureYardColumns failed: ' + e.message);
  }
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
