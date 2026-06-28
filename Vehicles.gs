// ─── Vehicles / Fleet Management ───────────────────────────────────────────────

function _getVehiclesSheet() {
  return _getSS().getSheetByName('Vehicles');
}

function _getVehiclesData() {
  const sheet = _getVehiclesSheet();
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][VC.VEHICLE_ID]) continue;
    rows.push({
      row:       i + 1,
      vehicleId: String(data[i][VC.VEHICLE_ID]),
      label:     String(data[i][VC.LABEL]),
      status:    String(data[i][VC.STATUS]),
      type:      String(data[i][VC.TYPE] || 'Rental'), // 'Rental' | 'Staff'
      notes:     String(data[i][VC.NOTES] || ''),
      addedOn:   data[i][VC.ADDED_ON]
        ? Utilities.formatDate(new Date(data[i][VC.ADDED_ON]), 'Asia/Kolkata', 'dd MMM yyyy')
        : ''
    });
  }
  return rows;
}

function addVehicle(label, vehicleType, notes, token) {
  requireAdmin(token);
  const sheet = _getVehiclesSheet();
  const existing = _getVehiclesData();
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel) throw new Error('Enter a scooter number / label.');
  // A scooter number must be unique — reject duplicates (case-insensitive).
  // This is the server-side guard; the desk also checks before sending.
  if (existing.some(v => String(v.label).trim().toLowerCase() === cleanLabel.toLowerCase())) {
    throw new Error('A scooter labelled “' + cleanLabel + '” already exists.');
  }
  // High-water mark, not a row count: scan EV<number> ids and take max suffix + 1,
  // so a hard deleteVehicle can never make the next id reuse an existing one.
  let maxNum = 0;
  existing.forEach(function (v) {
    const m = /^EV(\d+)$/.exec(String(v.vehicleId));
    if (m) { const n = parseInt(m[1], 10); if (!isNaN(n) && n > maxNum) maxNum = n; }
  });
  const nextNum = maxNum + 1;
  const id = 'EV' + String(nextNum).padStart(3, '0');
  const type = vehicleType === 'Staff' ? 'Staff' : 'Rental';
  const initialStatus = type === 'Staff' ? 'Staff' : 'Available';
  sheet.appendRow([id, cleanLabel, initialStatus, type, notes || '', new Date()]);
  _bumpDataVersion();
  return { success: true, vehicleId: id };
}

function updateVehicle(vehicleId, updates, token) {
  requireAdmin(token);
  const sheet = _getVehiclesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][VC.VEHICLE_ID]) === vehicleId) {
      if (updates.label  !== undefined) sheet.getRange(i + 1, VC.LABEL  + 1).setValue(updates.label);
      if (updates.status !== undefined) sheet.getRange(i + 1, VC.STATUS + 1).setValue(updates.status);
      if (updates.type   !== undefined) sheet.getRange(i + 1, VC.TYPE   + 1).setValue(updates.type);
      if (updates.notes  !== undefined) sheet.getRange(i + 1, VC.NOTES  + 1).setValue(updates.notes);
      _bumpDataVersion();
      return { success: true };
    }
  }
  throw new Error('Vehicle not found: ' + vehicleId);
}

function setVehicleStatus(vehicleId, status, token) {
  requireAdmin(token);
  const ok = _setVehicleStatusById(vehicleId, status);
  if (ok) _bumpDataVersion();
  return ok ? { success: true } : { success: false, message: 'Vehicle not found.' };
}

// Returns current vehicle status enriched with the active rider (if Out)
function getVehicleStatusEnriched(token, bDataIn) {
  requireAdmin(token);
  const vehicles = _getVehiclesData();
  const bData  = bDataIn || _getSS().getSheetByName('Bookings').getDataRange().getValues();

  // Build a map: vehicleId → active booking
  const activeMap = {};
  for (let i = 1; i < bData.length; i++) {
    if (bData[i][BC.STATUS] === 'Active') {
      activeMap[String(bData[i][BC.VEHICLE_ID])] = {
        bookingId:  String(bData[i][BC.BOOKING_ID]),
        riderName:  String(bData[i][BC.RIDER_NAME]),
        mobile:     String(bData[i][BC.MOBILE]),
        checkOut:   bData[i][BC.CHECK_OUT]
          ? Utilities.formatDate(new Date(bData[i][BC.CHECK_OUT]), 'Asia/Kolkata', 'dd MMM yyyy')
          : ''
      };
    }
  }

  return vehicles.map(v => ({
    ...v,
    activeBooking: activeMap[v.vehicleId] || null
  }));
}

function deleteVehicle(vehicleId, token) {
  requireAdmin(token);
  // Only allow deletion if vehicle is Available (not currently rented)
  const vehicles = _getVehiclesData();
  const v = vehicles.find(x => x.vehicleId === vehicleId);
  if (!v) throw new Error('Vehicle not found.');
  if (v.status === 'Out') throw new Error('Cannot delete a vehicle that is currently rented out.');
  const sheet = _getVehiclesSheet();
  sheet.deleteRow(v.row);
  _bumpDataVersion();
  return { success: true };
}
