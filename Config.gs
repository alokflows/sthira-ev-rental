// ─── Settings Management ───────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  dayRate:            '300',
  depositPerWeek:     '2000',
  lateFeeMode:        'perHour',   // 'perHour' | 'fullExtraDay'
  lateFeePerHour:     '0',
  graceMinutes:       '30',
  rentalStartTime:    '09:00',   // desk opens — shown to guests (IST, 24h HH:MM)
  rentalEndTime:      '21:00',   // return deadline — late fees start after this (IST)
  managerLabel:       'Manager',
  mapDriveFileId:     '',
  openingCashBalance: '0',
  // ── Email-on-allocation feature ──
  emailEnabled:       'no',           // 'yes' | 'no' — master switch for confirmation emails
  emailFromName:      'Sthira Rentals',
  emailReplyTo:       '',             // optional reply-to / desk contact
  mapEmailFileId:     '',             // Drive file id of the map image embedded in emails
  // ── Reports ──
  reportEmail:        '',             // primary recipient for emailed reports
  reportCC:           '',             // optional CC (comma-separated) for reports
  // ── Manager powers (gated by role AND these toggles) ──
  allowPastBookings:  'yes',          // 'yes' lets a manager add backdated bookings
  allowDeleteBookings:'no',           // 'yes' lets a manager soft-delete a booking (ledger stays). Off by default — grant in Settings.
  allowOperatorPastBookings: 'no',    // 'yes' lets the manager grant ordinary operators the "add past booking" ability too
  allowOperatorCancelActive: 'no',    // 'yes' lets ordinary operators cancel a PAID (active) booking with a refund. Off by default — manager-only.
  // ── Supervisor powers (one shared set; a Supervisor gets ONLY what is 'yes' here) ──
  supViewAllBookings: 'no',           // supervisor: see all bookings + Overview/reports analytics
  supViewMoney:       'no',           // supervisor: full Money view + Reports + CSV export (read only, NO relieve/refund)
  supRunBookings:     'no',           // supervisor: add past bookings + edit/extend
  supDeleteBookings:  'no',           // supervisor: soft-delete a booking (ALSO needs the master allowDeleteBookings)
  appVersion:         '3.0'
};

function _getSettingsSheet() {
  return _getSS().getSheetByName('Settings');
}

function _getAllSettingsRaw() {
  const sheet = _getSettingsSheet();
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) out[String(data[i][0])] = String(data[i][1] !== undefined ? data[i][1] : '');
  }
  return out;
}

function getSettingValue(key) {
  return _getAllSettingsRaw()[key] || '';
}

// Public (no auth) — only exposes non-sensitive config needed by the rider form
function getPublicSettings() {
  const s = _getAllSettingsRaw();
  return {
    dayRate:        Number(s.dayRate)        || 300,
    depositPerWeek: Number(s.depositPerWeek) || 2000,
    mapDriveFileId: s.mapDriveFileId         || '',
    mapEmailFileId: s.mapEmailFileId         || '',   // map image the rider form previews
    managerLabel:   s.managerLabel           || 'Manager',
    rentalStartTime: _hhmm(s.rentalStartTime) || '09:00',
    rentalEndTime:   _hhmm(s.rentalEndTime)   || '21:00',
    availableCount:  getPublicAvailableCount()   // scooters free right now (aggregate only)
  };
}

// Normalize a Bookings date cell to 'yyyy-MM-dd' (IST), whether the sheet handed us
// a plain string ('2026-06-28') OR a Date object (Sheets silently coerces date-like
// strings on write). ALL deadline/overdue/late-fee math must read dates through this,
// so a Date cell can never be misread as midnight and inflate the late fee.
function _ymd(value) {
  if (value == null || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}

// Returns the UTC Date for an IST wall-clock time (HH:MM) on a yyyy-mm-dd date.
// The rental deadline is configurable (Settings → rentalEndTime); IST is UTC+5:30,
// so we subtract 5h30m. Date.UTC() normalizes the negative minute/hour overflow.
// e.g. 21:00 IST → Date.UTC(y,m,d,16,-30) → 15:30 UTC.
function _istDeadlineUtc(ymd, hhmm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '').trim());
  if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(_hhmm(hhmm) || '21:00');
  const H = t ? Number(t[1]) : 21;
  const M = t ? Number(t[2]) : 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), H - 5, M - 30));
}

// Normalize a Settings time cell to 'HH:MM' (IST, zero-padded). Google Sheets silently
// coerces a "HH:MM" string written to a cell into a 1899-epoch time serial, so on read
// getValues() hands back a Date (or _getAllSettingsRaw String()-ifies it to a long 1899
// date string). This turns either form — or an already-clean "H:MM" string — back into
// "HH:MM" so <input type=time> and the rider line never see a 1899 Date. (Storing the
// cell as TEXT in updateSetting prevents the coercion going forward; this heals legacy.)
function _hhmm(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m && !/\d{4}/.test(s)) return ('0' + m[1]).slice(-2) + ':' + m[2];
  const d = (Object.prototype.toString.call(value) === '[object Date]') ? value : new Date(s);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Kolkata', 'HH:mm');
}

// Admin (auth required) — returns everything
function getAdminSettings(token) {
  requireAdmin(token);
  const s = _getAllSettingsRaw();
  s.rentalStartTime = _hhmm(s.rentalStartTime) || '09:00';
  s.rentalEndTime   = _hhmm(s.rentalEndTime)   || '21:00';
  return s;
}

// Settings only a manager may change (rates, timings, opening cash, manager powers,
// report config). Everything else (e.g. email/map) any signed-in operator may set.
const MANAGER_ONLY_SETTINGS = {
  dayRate: 1, depositPerWeek: 1, lateFeeMode: 1, lateFeePerHour: 1, graceMinutes: 1,
  rentalStartTime: 1, rentalEndTime: 1, openingCashBalance: 1, managerLabel: 1,
  allowPastBookings: 1, allowDeleteBookings: 1, allowOperatorPastBookings: 1, allowOperatorCancelActive: 1, reportEmail: 1, reportCC: 1,
  supViewAllBookings: 1, supViewMoney: 1, supRunBookings: 1, supDeleteBookings: 1
};

function updateSetting(key, value, operatorName, token) {
  if (MANAGER_ONLY_SETTINGS[key]) {
    // The reporting recipients are part of the read-only money/reports surface a
    // supViewMoney supervisor may manage; every other manager-only setting (pricing,
    // opening cash, the power toggles themselves, …) stays strictly manager-only.
    if (key === 'reportEmail' || key === 'reportCC') _requirePower(token, 'supViewMoney');
    else _requireManager(token);
  } else requireAdmin(token);
  const sheet = _getSettingsSheet();
  const data = sheet.getDataRange().getValues();
  let oldValue = '';
  let found = false;

  // Time settings must be stored as TEXT, else Sheets coerces "HH:MM" into an 1899
  // time serial (read back as a Date → corrupts the input + rider line). See _hhmm.
  const asText = (key === 'rentalStartTime' || key === 'rentalEndTime');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      oldValue = String(data[i][1]);
      const cell = sheet.getRange(i + 1, 2);
      if (asText) cell.setNumberFormat('@');
      cell.setValue(value);
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([key, value]);
    if (asText) sheet.getRange(sheet.getLastRow(), 2).setNumberFormat('@').setValue(value);
  }

  const logSheet = _getSS().getSheetByName('SettingsLog');
  logSheet.appendRow([new Date(), key, oldValue, value, operatorName || 'Admin']);
  _bumpDataVersion();
  return { success: true };
}

function updateMultipleSettings(updates, operatorName, token) {
  requireAdmin(token);
  // updates = { key: value, ... }
  Object.keys(updates).forEach(key => {
    updateSetting(key, updates[key], operatorName, token);
  });
  return { success: true };
}

// Snapshot of current rates — embedded in each booking at creation time.
// Use the saved value whenever one exists — a deliberate 0 (e.g. "no late fee",
// "no grace") must STICK; only fall back to the default when the setting is blank
// or non-numeric. (`Number(x) || default` wrongly turns a saved 0 into the default.)
function _settingNum(v, def) {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}
function resolveRatesForBooking() {
  const s = _getAllSettingsRaw();
  return {
    dayRate:        _settingNum(s.dayRate,        300),
    depositPerWeek: _settingNum(s.depositPerWeek, 2000),
    lateFeeMode:    s.lateFeeMode               || 'perHour',
    lateFeePerHour: _settingNum(s.lateFeePerHour, 0),
    graceMinutes:   _settingNum(s.graceMinutes,   30)
  };
}

// SINGLE SOURCE OF TRUTH for "how many rental days". A day is a calendar day held
// (the 9am–9pm window). Same calendar day = 1 day; returning on a later date adds a
// day for each date crossed. checkIn/checkOut are 'YYYY-MM-DD' (IST). The server
// computes this for every booking — the client previews only mirror it.
function daysInclusive(checkInYmd, checkOutYmd) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(checkInYmd || '').trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(checkOutYmd || '').trim());
  if (!a) return 1;
  if (!b) return 1;
  const d1 = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const d2 = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  const diff = Math.round((d2 - d1) / 86400000);
  return diff >= 0 ? diff + 1 : 1;
}
