// ─── Cottages / Accommodations ─────────────────────────────────────────────────
// The rider form's cottage field is a managed dropdown (never free text).
// Desk staff add/remove cottages from Settings; the public form reads the active list.

function _getCottagesSheet() {
  return _getSS().getSheetByName('Cottages');
}

function _getCottagesData() {
  const sheet = _getCottagesSheet();
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({
      cottageId: String(data[i][0]),
      name:      String(data[i][1]),
      active:    Boolean(data[i][2])
    });
  }
  return rows;
}

// Public (no auth) — active cottage names for the rider form dropdown
function getPublicCottages() {
  return _getCottagesData().filter(c => c.active).map(c => c.name);
}

// Admin — full list (incl. ids) for the Settings manager
function getCottages(token) {
  requireAdmin(token);
  return _getCottagesData().filter(c => c.active);
}

function addCottage(name, token) {
  _requireManager(token);
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Cottage name is required.');
  const sheet = _getCottagesSheet();
  // Reactivate if it already exists (case-insensitive)
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === clean.toLowerCase()) {
      sheet.getRange(i + 1, 3).setValue(true);
      _bumpDataVersion();
      return { success: true, cottageId: String(data[i][0]) };
    }
  }
  const id = 'CT' + String(data.length).padStart(3, '0');
  sheet.appendRow([id, clean, true]);
  _bumpDataVersion();
  return { success: true, cottageId: id };
}

function deactivateCottage(cottageId, token) {
  _requireManager(token);
  const sheet = _getCottagesSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === cottageId) {
      sheet.getRange(i + 1, 3).setValue(false);
      _bumpDataVersion();
      return { success: true };
    }
  }
  throw new Error('Cottage not found.');
}
