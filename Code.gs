// ─── Spreadsheet Helper ────────────────────────────────────────────────────────

// True only while _ensureSetup() is actively building the schema. Lets _getSS()'s
// recovery branch know a rebuild is already running (so it just returns the fresh
// sheet instead of kicking off a second, nested rebuild). Resets each execution.
let _setupBuilding = false;

function _getSS() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch(e) {}
  }
  // Recovery path (only reached when there is no linked sheet, or it was deleted /
  // unshared so openById threw). We create a fresh sheet — but its tabs went with the
  // old file, so a stale SETUP_DONE would otherwise leave this blank sheet un-built.
  // Clear the setup/migration guards and rebuild the schema now, so the in-flight
  // read finds real tabs. The normal fast path never enters this branch, so steady
  // state pays no extra cost. Guarded by _setupBuilding to avoid a nested rebuild.
  const ss = SpreadsheetApp.create('Sthira Rentals — Data');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!_setupBuilding) {
    ['SETUP_DONE', 'COLS_MIGRATED', 'MONEY_MIGRATED', 'CANCEL_MIGRATED', 'VEH_COLS_MIGRATED', 'YARD_COLS_MIGRATED']
      .forEach(k => props.deleteProperty(k));
    try { _ensureSetup(); } catch (e) { Logger.log('_getSS recovery rebuild failed: ' + e.message); }
  }
  return ss;
}

// ─── First-run Bootstrap (portability) ──────────────────────────────────────────
// Makes the app self-install when copied to a fresh account: creates the
// spreadsheet (via _getSS), all tabs, headers, and seeds default settings.
// Idempotent and cheap — guarded by a script property so it runs its full work once.

function _ensureSetup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_DONE') === 'yes') {
    // Column migrations are append-only + idempotent, but they hit the sheet on
    // every request. Run them once, then short-circuit so steady-state stays fast.
    if (props.getProperty('COLS_MIGRATED') !== 'yes') {
      _ensureBookingColumns();
      _ensureOperatorColumns();
      props.setProperty('COLS_MIGRATED', 'yes');
    }
    // Money/ledger schema (v3): Ledger tab, Operators.Email, Handover approval cols,
    // one-time ledger backfill from existing bookings. Guarded by its own flag so it
    // runs exactly once on an already-live sheet.
    if (props.getProperty('MONEY_MIGRATED') !== 'yes') {
      _ensureOperatorColumns();
      _ensureHandoverColumns();
      _ensureLedgerSheet();
      try { _backfillLedger(); } catch (e) { Logger.log('ledger backfill: ' + e.message); }
      props.setProperty('MONEY_MIGRATED', 'yes');
    }
    // Cancel-refund schema: CancelledAt/CancelledBy on Bookings (append-only). Its own
    // flag so it runs exactly once on an already-live sheet (COLS_MIGRATED is already set).
    if (props.getProperty('CANCEL_MIGRATED') !== 'yes') {
      _ensureCancelColumns();
      props.setProperty('CANCEL_MIGRATED', 'yes');
    }
    // Vehicles.Location column (Charging status support). Its own flag so it runs
    // exactly once on an already-live sheet.
    if (props.getProperty('VEH_COLS_MIGRATED') !== 'yes') {
      _ensureVehicleColumns();
      props.setProperty('VEH_COLS_MIGRATED', 'yes');
    }
    // Bookings.YardDoneAt (yard bring-out acknowledgement). Its own flag so it runs
    // exactly once on an already-live sheet.
    if (props.getProperty('YARD_COLS_MIGRATED') !== 'yes') {
      _ensureYardColumns();
      props.setProperty('YARD_COLS_MIGRATED', 'yes');
    }
    return;
  }
  // Full build. Flag it so a _getSS() call made while building (the sheet is created
  // inside initializeSheets) doesn't recursively trigger its own recovery rebuild.
  _setupBuilding = true;
  try {
    initializeSheets(); // creates sheet + tabs + headers + default settings + cottages
    _ensureBookingColumns();
    _ensureCancelColumns();
    _ensureOperatorColumns();
    _ensureHandoverColumns();
    _ensureLedgerSheet();
    _ensureVehicleColumns();
    _ensureYardColumns();
    props.setProperty('SETUP_DONE', 'yes');
    props.setProperty('COLS_MIGRATED', 'yes');
    props.setProperty('MONEY_MIGRATED', 'yes');
    props.setProperty('CANCEL_MIGRATED', 'yes');
    props.setProperty('VEH_COLS_MIGRATED', 'yes');
    props.setProperty('YARD_COLS_MIGRATED', 'yes');
  } finally {
    _setupBuilding = false;
  }
}

// Migration: append the Active-cancel refund columns (CancelledAt, CancelledBy) to a
// Bookings sheet made before they existed. Append-only (never reorders) so the positional
// BC indices stay valid. Idempotent.
function _ensureCancelColumns() {
  try {
    const sheet = _getSS().getSheetByName('Bookings');
    if (!sheet || sheet.getLastColumn() === 0) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    ['CancelledAt', 'CancelledBy'].forEach(h => {
      if (headers.indexOf(h) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1)
          .setValue(h).setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
        headers.push(h);
      }
    });
  } catch (e) {
    Logger.log('_ensureCancelColumns failed: ' + e.message);
  }
}

// Migration: append the handover approval columns to a Handovers sheet made before
// they existed. Append-only, idempotent.
function _ensureHandoverColumns() {
  try {
    const sheet = _getSS().getSheetByName('Handovers');
    if (!sheet || sheet.getLastColumn() === 0) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    ['Status', 'RequestedBy', 'ApprovedBy', 'DecidedAt'].forEach(h => {
      if (headers.indexOf(h) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1)
          .setValue(h).setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
        headers.push(h);
      }
    });
    // Pre-existing handover rows had no status — they were already real cash moves,
    // so mark them Approved (so the corrected cash math keeps counting them).
    const last = sheet.getLastRow();
    const statusCol = headers.indexOf('Status') + 1;
    if (last > 1 && statusCol > 0) {
      const rng = sheet.getRange(2, statusCol, last - 1, 1);
      const vals = rng.getValues();
      let dirty = false;
      for (let i = 0; i < vals.length; i++) {
        if (!String(vals[i][0]).trim() && sheet.getRange(i + 2, 1).getValue()) { vals[i][0] = 'Approved'; dirty = true; }
      }
      if (dirty) rng.setValues(vals);
    }
  } catch (e) {
    Logger.log('_ensureHandoverColumns failed: ' + e.message);
  }
}

// Migration: add Pin/Role columns to an Operators sheet made before per-operator
// PINs existed. Append-only, idempotent.
function _ensureOperatorColumns() {
  try {
    const sheet = _getSS().getSheetByName('Operators');
    if (!sheet || sheet.getLastColumn() === 0) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    ['Pin', 'Role', 'Email'].forEach(h => {
      if (headers.indexOf(h) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1)
          .setValue(h).setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
        headers.push(h);
      }
    });
  } catch (e) {
    Logger.log('_ensureOperatorColumns failed: ' + e.message);
  }
}

// Migration: append any newer Bookings columns to a sheet created before they existed.
// Append-only (never reorders) so the positional BC indices stay valid. Idempotent.
function _ensureBookingColumns() {
  try {
    const sheet = _getSS().getSheetByName('Bookings');
    if (!sheet || sheet.getLastColumn() === 0) return;
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    if (headers.indexOf('Email') === -1) {
      sheet.getRange(1, lastCol + 1)
        .setValue('Email')
        .setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
    }
  } catch (e) {
    Logger.log('_ensureBookingColumns failed: ' + e.message);
  }
}

// True until the first operator (the manager) has been created with a PIN.
// The setup wizard is shown while this is true.
function needsSetupWizard() {
  try {
    _ensureSetup();
    return !_getOperatorsData().some(o => o.active && o.pin);
  } catch (e) {
    return true;
  }
}

// Called by the setup wizard to finish first-run configuration in one shot:
// creates the manager (operator #1 with a PIN) and seeds the pricing settings.
function completeSetupWizard(config) {
  // config: { managerName, managerPin, dayRate, depositPerWeek, lateFeePerHour,
  //           graceMinutes, openingCashBalance, managerLabel }  (all optional but
  //           managerName + managerPin are required for a usable desk)
  _ensureSetup();
  config = config || {};

  const name = String(config.managerName || 'Manager').trim();
  const pin  = _cleanPin(config.managerPin);
  if (pin.length < 6) throw new Error('Set a 6-digit PIN for the manager.');
  // Create the manager operator only if one with this PIN doesn't already exist.
  if (!_getOperatorsData().some(o => o.active && o.pin === _hashPin(pin))) {
    _createOperator(name, pin, 'Admin');
  }

  const settingKeys = ['dayRate','depositPerWeek','lateFeeMode','lateFeePerHour',
                       'graceMinutes','openingCashBalance','managerLabel'];
  const sheet = _getSettingsSheet();
  settingKeys.forEach(key => {
    if (config[key] === undefined || config[key] === '') return;
    const data = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === key) { sheet.getRange(i + 1, 2).setValue(config[key]); found = true; break; }
    }
    if (!found) sheet.appendRow([key, config[key]]);
  });

  // Retire any legacy pin-less operators (e.g. a pre-PIN default) so the list
  // starts clean — they can't sign in anyway.
  try {
    const opSheet = _getSS().getSheetByName('Operators');
    _getOperatorsData().forEach(o => { if (o.active && !o.pin) opSheet.getRange(o.row, OC.ACTIVE + 1).setValue(false); });
  } catch (e) {}

  PropertiesService.getScriptProperties().setProperty('SETUP_DONE', 'yes');
  return { success: true };
}

// ─── Entry Point ───────────────────────────────────────────────────────────────

function doGet(e) {
  const mode = e && e.parameter && e.parameter.mode;

  // First-run: ensure the spreadsheet + tabs + defaults exist (silent, idempotent).
  // This is what makes the project portable — copy to a new account, deploy, done.
  try { _ensureSetup(); } catch (err) { Logger.log('ensureSetup failed: ' + err.message); }

  // Serve PWA manifest as JSON for ?mode=manifest
  if (mode === 'manifest') {
    // Admin/Yard desk gets its own manifest (?mode=manifest&app=admin) so it installs
    // as a separate home-screen app that launches straight into the desk, not the guest form.
    const isAdminApp = e && e.parameter && e.parameter.app === 'admin';
    const manifest = isAdminApp ? {
      name: 'Sthira Desk',
      short_name: 'Sthira',
      description: 'Admin & Yard desk for the Sthira electric two-wheeler rental at Isha Yoga Center',
      start_url: ScriptApp.getService().getUrl(),
      display: 'standalone',
      background_color: '#EFEAE0',
      theme_color: '#2F5D50',
      icons: [
        { src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="%2322332C"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="%23F4F0E8" stroke-width="1.4"/><path d="M12 4.8a7.2 7.2 0 0 0 0 14.4" fill="none" stroke="%23F4F0E8" stroke-width="1.4"/><circle cx="12" cy="12" r="1.8" fill="%23F4F0E8"/></svg>', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="%2322332C"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="%23F4F0E8" stroke-width="1.4"/><path d="M12 4.8a7.2 7.2 0 0 0 0 14.4" fill="none" stroke="%23F4F0E8" stroke-width="1.4"/><circle cx="12" cy="12" r="1.8" fill="%23F4F0E8"/></svg>', sizes: '512x512', type: 'image/svg+xml' }
      ]
    } : {
      name: 'Sthira',
      short_name: 'Sthira',
      description: 'Electric two-wheeler rental at Isha Yoga Center',
      start_url: ScriptApp.getService().getUrl() + '?mode=rider',
      display: 'standalone',
      background_color: '#EFEAE0',
      theme_color: '#2F5D50',
      icons: [{ src: 'https://raw.githubusercontent.com/google/material-design-icons/master/png/action/ev_station/materialicons/48dp/1x/baseline_ev_station_black_48dp.png', sizes: '48x48', type: 'image/png' }]
    };
    return ContentService.createTextOutput(JSON.stringify(manifest))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const page = mode === 'rider' ? 'RiderForm' : 'Admin';
  const title = mode === 'rider'
    ? 'Sthira – Isha Yoga Center'
    : 'Sthira – Desk';
  try {
    return HtmlService.createTemplateFromFile(page)
      .evaluate()
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
  } catch (err) {
    // Frontend not installed yet (HTML swept, awaiting the new design) — serve a
    // clean placeholder so the deployment never 404s. The engine is already live.
    Logger.log('Template "' + page + '" missing: ' + err.message);
    return HtmlService.createHtmlOutput(_placeholderPage())
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }
}

// Minimal branded standby page shown until the new design HTML is added.
function _placeholderPage() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
    + 'background:#EFEAE0;color:#23211C;display:flex;min-height:100vh;align-items:center;justify-content:center}'
    + '.box{text-align:center;padding:2rem;max-width:420px}'
    + '.icon{font-size:3rem;color:#2F5D50}.h{font-size:1.4rem;margin:.75rem 0 .25rem}'
    + '.p{color:#6F6A5C;font-size:.9rem;line-height:1.6}</style></head>'
    + '<body><div class="box"><div class="icon">⚡</div>'
    + '<div class="h">Sthira — engine ready</div>'
    + '<div class="p">The backend is installed and your data sheet is live. '
    + 'The interface is being set up. Please check back shortly.</div></div></body></html>';
}

// Returns the deployed web-app URL (used by Admin to build the guest-form link)
function getWebAppUrl() {
  try { return ScriptApp.getService().getUrl() || ''; }
  catch (e) { return ''; }
}

// Returns the data spreadsheet URL (Settings → "Open data spreadsheet")
function getSpreadsheetUrl(token) {
  requireAdmin(token);
  try { return _getSS().getUrl() || ''; }
  catch (e) { return ''; }
}

// Include HTML partial files (CSS, JS) using server-side templating
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    Logger.log('include() failed for "' + filename + '": ' + e.message);
    return '<!-- include:' + filename + ' not found -->';
  }
}

// ─── Admin Authentication ──────────────────────────────────────────────────────

// PINs are never stored or transmitted in clear: we keep only a salted HMAC.
// The salt is a per-deployment secret generated once and held in script
// properties (it never leaves the server), so the stored hashes are useless
// without it.
function _pinSecret() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('PIN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('PIN_SECRET', s); }
  return s;
}

function _hashPin(pin) {
  const clean = String(pin || '').replace(/\D/g, '');
  if (!clean) return '';
  const raw = Utilities.computeHmacSha256Signature(clean, _pinSecret());
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// Per-operator PIN login: the PIN both authenticates AND identifies who is at
// the desk. Returns a token + the operator's name/role.
// The desk URL is public, so this is the one gate that matters — it is rate
// limited with a growing delay to make brute-forcing a 6-digit PIN infeasible.
function loginWithPin(pin) {
  try { _ensureSetup(); } catch (e) {}
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('loginFails') || 0);
  if (fails > 0) Utilities.sleep(Math.min(fails * 400, 4000)); // throttle attempts
  const op = _findOperatorByPin(pin);
  if (!op) {
    cache.put('loginFails', String(fails + 1), 300); // 5-min sliding window
    return { success: false, message: 'Incorrect PIN. Please try again.' };
  }
  cache.remove('loginFails');
  const token = Utilities.getUuid();
  cache.put('adminToken_' + token, 'valid', 28800); // 8h shift
  cache.put('adminOp_' + token, op.name, 28800);
  cache.put('adminRole_' + token, op.role || 'Operator', 28800);
  return { success: true, token: token, operatorName: op.name, role: op.role };
}

// The server-resolved name of whoever holds this token (never trust a client-sent
// name for money attribution). Falls back to the Operators sheet by re-deriving
// nothing — if the cache lost it, '' is returned and callers degrade gracefully.
function _opName(token) {
  return CacheService.getScriptCache().get('adminOp_' + token) || '';
}

// The cached role for this token. '' if unknown.
function _opRole(token) {
  return CacheService.getScriptCache().get('adminRole_' + token) || '';
}

// True when the current token belongs to a manager (role Admin/Manager).
function _isManager(token) {
  const r = _opRole(token);
  return r === 'Admin' || r === 'Manager';
}

// Gate for manager-only server actions (rate/timing/opening-cash, operator mgmt,
// handover approval, reports, backdated/deleted bookings). Client hiding is cosmetic;
// THIS is the real enforcement.
function _requireManager(token) {
  requireAdmin(token);
  if (!_isManager(token)) throw new Error('Manager access required for this action.');
}

// True when the current token belongs to a Supervisor — a trusted deputy who gets
// ONLY the powers the manager has granted globally (the sup* Settings toggles).
function _isSupervisor(token) {
  return _opRole(token) === 'Supervisor';
}

// Does this token hold a delegable power? A manager always does. A supervisor does
// only when the named global power (a sup* Setting) is turned on. Operators never do.
// The grant set is shared across all supervisors (one toggle set in Settings).
function _hasPower(token, settingKey) {
  if (_isManager(token)) return true;
  return _isSupervisor(token) &&
         String(getSettingValue(settingKey) || 'no').toLowerCase() === 'yes';
}

// Gate for an action that the manager MAY delegate to a granted supervisor. The
// never-delegable money/role actions stay on _requireManager — never on this.
function _requirePower(token, settingKey) {
  requireAdmin(token);
  if (!_hasPower(token, settingKey)) throw new Error('You do not have permission for this action.');
}

function verifyAdminToken(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('adminToken_' + token) === 'valid';
}

function requireAdmin(token) {
  if (!verifyAdminToken(token)) {
    throw new Error('Session expired. Please log in again.');
  }
}

function adminLogout(token) {
  if (token) CacheService.getScriptCache().remove('adminToken_' + token);
  return { success: true };
}

// ─── Live sync (near-instant, no WebSockets on GAS) ─────────────────────────────
// GAS web apps can't push to the browser, so the desk polls this cheap version
// stamp every few seconds and only does a full reload when something actually
// changed. _bumpDataVersion() is called by every mutation (incl. a guest submit
// on the kiosk), so changes appear on every open desk within seconds.
function _bumpDataVersion() {
  try {
    const p = PropertiesService.getScriptProperties();
    const v = Number(p.getProperty('DATA_VERSION') || 0) + 1;
    p.setProperty('DATA_VERSION', String(v));
    return v;
  } catch (e) { return 0; }
}

function getPulse(token) {
  requireAdmin(token);
  return { v: Number(PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || 0) };
}
