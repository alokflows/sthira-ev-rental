// ─── Email Engine ───────────────────────────────────────────────────────────────
// Sends a crafted HTML confirmation to the guest when a booking is confirmed
// (scooter allocated). Master switch = setting `emailEnabled` ('yes'|'no').
// The terms below are the SINGLE SOURCE OF TRUTH — the rider form fetches them via
// getTermsSections() so the form and the email always match.

const STHIRA_TERMS = [
  { n: '01', title: 'Eligibility & Fitness', points: [
    { text: 'I am 18+ years old, hold a valid Two-Wheeler / Gearless Driving License, and will provide an original Government-issued ID at the time of pickup.' },
    { text: 'I declare that I am physically and mentally fit to ride, and I am not under the influence of alcohol, intoxicants, or any impairing medication.' },
    { text: 'I will be the sole rider and will not sub-rent, lend, or allow others to drive the vehicle.' }
  ]},
  { n: '02', title: 'Permitted Boundaries & Usage Limits', points: [
    { lead: 'Prohibition & Penalty:', text: 'I will not take the EV on public highways, nearby towns, or anywhere beyond the Malai Vasal Gate. Any unauthorized exit from the permitted area will result in immediate termination of the rental and forfeiture of my full security deposit — as determined by management through staff reports, security observations, or CCTV footage.' },
    { lead: 'Usage Limits:', text: 'I will not use the EV for commercial delivery, racing, or stunts. I will not overload the vehicle or carry more than one pillion rider (max 120 kg).' },
    { lead: 'Right of Repossession:', text: 'In the event of rash driving, reckless operation, or vehicle damage, the facilitator or management reserves the right to immediately repossess the vehicle at any time without prior notice.' }
  ]},
  { n: '03', title: 'Route Restrictions & Timings', strict: true, rows: [
    { zone: 'Adiyogi Access', rule: 'To visit Adiyogi, riders must exclusively use the Neelivasal gate. Exiting through Kshetra Vasal or any other gate is strictly not allowed. Riders may proceed up to the Kalbhairava Temple, but must strictly not cross the Malai Vasal Gate.' },
    { zone: 'Welcome Point', rule: 'EVs are strictly prohibited from passing through the Welcome Point at all times. Riders must not take any rental EV through the Welcome Point under any circumstances.' },
    { zone: 'Return Journey', rule: 'Riders must return using the exact same path: through Adiyogi and re-entering through Neelivasal. All rental EVs must be inside the Isha Yoga Center boundary before 8:00 PM.' },
    { zone: 'Biksha Hall Route', rule: 'To protect sadhakas and pedestrians during meal times, EV movement is restricted during the 1st and 2nd batches. Security will halt vehicles during these windows.', subs: ['Brunch: no entry 9:45–10:00 AM and 10:30–10:45 AM.', 'Dinner: no entry 6:45–7:00 PM and 7:30–7:45 PM.'] }
  ]},
  { n: '04', title: 'Isha Yoga Center Conduct & Safety', points: [
    { lead: 'No Horn:', text: 'The Isha Yoga Center is a space of silence. The use of the horn anywhere inside the Center is strictly prohibited.' },
    { lead: 'Driving Conduct & Parking:', text: 'I will ride at low speeds and yield to pedestrians, sadhakas, and children at all times. I will take extreme care in quiet zones near meditation halls and temples, park only in designated spots, and never block pathways or gates.' }
  ]},
  { n: '05', title: 'Vehicle Condition, Maintenance & Breakdowns', points: [
    { lead: 'Condition Check:', text: 'I agree to verify the physical condition of the EV with the transport team before handover and upon return. I am responsible for any new damage, missing components, or deterioration found during the return inspection.' },
    { lead: 'Battery & Breakdowns:', text: 'I will use only the authorized charger provided and protect the EV and charger from water damage and tampering. In case of mechanical failure or an accident, I will inform the transport team immediately and will not attempt to repair the EV myself.' }
  ]},
  { n: '06', title: 'Financial Responsibility & Liability', points: [
    { lead: 'Payments & Deductions:', text: 'The full rental amount must be paid upfront. Late returns attract late fees calculated on an hourly basis. My refundable deposit may be partially or fully deducted to cover physical damage, battery/charger damage, lost keys/accessories, late fees, or rule violations.' },
    { lead: 'Liability & Indemnity:', text: 'I am fully responsible for repair costs if damages exceed my deposit. I accept all risks of accidents or injury and release the Service Provider from liability. I will indemnify the Service Provider against any third-party claims arising from my use of the vehicle.' }
  ]},
  { n: '07', title: 'Legal & Termination', points: [
    { text: 'Violation of any of these terms allows the Service Provider to terminate the rental immediately without a refund.' },
    { text: 'Any legal disputes are subject to Arbitration in Coimbatore.' }
  ]}
];

// Public — the rider form renders its term cards from this.
function getTermsSections() {
  return STHIRA_TERMS;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _inr(n) {
  n = Math.round(Number(n) || 0);
  const neg = n < 0; n = Math.abs(n);
  let s = String(n);
  let last3 = s.length > 3 ? s.slice(-3) : s;
  let rest  = s.length > 3 ? s.slice(0, -3) : '';
  if (rest) rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',';
  return (neg ? '-₹' : '₹') + rest + last3;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _getBookingRaw(bookingId) {
  const data = _getBookingsSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][BC.BOOKING_ID]) === bookingId) return data[i];
  }
  return null;
}

// Drive folder for uploaded assets (the email map image lives here)
function _getAssetsFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ASSETS_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const folder = DriveApp.createFolder('Sthira Rentals — Assets');
  props.setProperty('ASSETS_FOLDER_ID', folder.getId());
  return folder;
}

// ── Settings: upload the map image embedded in emails ──────────────────────────

function uploadMapImage(base64, token) {
  requireAdmin(token);
  if (!base64) throw new Error('No image data received.');
  const folder = _getAssetsFolder();
  const clean  = String(base64).replace(/^data:image\/\w+;base64,/, '');
  const blob   = Utilities.newBlob(Utilities.base64Decode(clean), 'image/png', 'sthira_map_' + Date.now() + '.png');
  const file   = folder.createFile(blob);
  // Make it link-viewable so the public rider form can preview it (the email
  // embeds it inline server-side, but the guest form loads it from Drive).
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  updateSetting('mapEmailFileId', file.getId(), 'Admin', token);
  return { success: true, fileId: file.getId() };
}

// Use an existing Drive image (pasted link or file id) as the map — no re-upload.
function useMapFromDrive(linkOrId, token) {
  requireAdmin(token);
  const id = _extractDriveId(linkOrId);
  if (!id) throw new Error('Paste a valid Google Drive link or file ID.');
  let file;
  try { file = DriveApp.getFileById(id); }
  catch (e) { throw new Error('Could not open that Drive file — check the link and that you have access.'); }
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  updateSetting('mapEmailFileId', id, 'Admin', token);
  return { success: true, fileId: id };
}

function _extractDriveId(s) {
  s = String(s || '').trim();
  if (!s) return '';
  // explicit /d/<id>/ form first, else the first long id-like token
  const m = s.match(/\/d\/([-\w]{20,})/) || s.match(/[?&]id=([-\w]{20,})/) || s.match(/([-\w]{25,})/);
  return m ? (m[1] || m[0]) : '';
}

// ── The crafted confirmation email ─────────────────────────────────────────────

function _termsHtml() {
  const c = { pine: '#2F5D50', ink: '#23211C', muted: '#6F6A5C', card: '#FFFCF6', line: '#EBE4D6', gold: '#A6731E', terra: '#A4452C' };
  let html = '';
  STHIRA_TERMS.forEach(sec => {
    html += '<div style="margin:0 0 14px;">';
    html += '<div style="font-family:Georgia,serif;font-size:16px;color:' + c.ink + ';margin-bottom:6px;">'
          + '<span style="color:' + c.pine + ';">' + sec.n + '</span> &nbsp;' + _esc(sec.title)
          + (sec.strict ? ' <span style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:' + c.terra + ';background:#FBE7DF;padding:2px 7px;border-radius:999px;">Strictly enforced</span>' : '')
          + '</div>';
    (sec.points || []).forEach(p => {
      html += '<div style="font-size:13.5px;line-height:1.55;color:#3A372E;margin:4px 0;">'
            + (p.lead ? '<b style="color:' + c.pine + ';">' + _esc(p.lead) + '</b> ' : '')
            + _esc(p.text) + '</div>';
    });
    (sec.rows || []).forEach(r => {
      html += '<div style="margin:6px 0;padding:10px 12px;background:#F6F2E9;border:1px solid #ECE4D4;border-radius:10px;">'
            + '<div style="font-size:13px;font-weight:700;color:' + c.pine + ';">' + _esc(r.zone) + '</div>'
            + '<div style="font-size:13px;line-height:1.5;color:#5C5648;">' + _esc(r.rule) + '</div>';
      (r.subs || []).forEach(sub => {
        html += '<div style="font-size:12.5px;color:#7C7565;margin-top:3px;">• ' + _esc(sub) + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
  });
  return html;
}

// 24h "HH:MM" → "9:00 PM" (server-side; mirrors SharedCalc.to12h).
function _to12h(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '21:00'));
  if (!m) return String(hhmm || '');
  let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'; h = ((h + 11) % 12) + 1;
  return h + ':' + m[2] + ' ' + ap;
}

function _buildBookingEmailHtml(b, inlineImages) {
  const c = { paper: '#EFEAE0', card: '#FFFCF6', pine: '#2F5D50', ink: '#23211C', muted: '#6F6A5C', line: '#EBE4D6', mono: "'Courier New',monospace" };
  const first = (b.riderName || 'Rider').split(' ')[0];
  const endTime = _to12h(_hhmm(getSettingValue('rentalEndTime')) || '21:00');

  // Map image (inline) if one was uploaded — placed inside the flow, no heavy divider.
  let mapBlock = '';
  const mapId = getSettingValue('mapEmailFileId');
  if (mapId) {
    try {
      inlineImages.ashramMap = DriveApp.getFileById(mapId).getBlob();
      mapBlock =
        '<div style="margin:22px 0 0;">'
        + '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9A9384;font-weight:600;margin-bottom:8px;">Permitted riding area</div>'
        + '<img src="cid:ashramMap" alt="Isha Yoga Center map" style="display:block;width:100%;max-width:560px;border-radius:12px;border:1px solid ' + c.line + ';" />'
        + '<div style="font-size:12.5px;color:' + c.muted + ';margin-top:8px;line-height:1.5;">Stay within the Isha Yoga Center. Do not cross the Malai Vasal Gate.</div>'
        + '</div>';
    } catch (e) { Logger.log('Email map embed failed: ' + e.message); }
  }

  // One aligned two-column table — every row (incl. Booking ID) shares the same grid.
  const row = (label, value, strong) =>
    '<tr>'
    + '<td style="padding:8px 0;font-size:13.5px;color:' + c.muted + ';vertical-align:top;white-space:nowrap;">' + _esc(label) + '</td>'
    + '<td style="padding:8px 0 8px 16px;font-size:13.5px;text-align:right;color:' + c.ink + ';font-weight:' + (strong ? '700' : '600') + ';">' + value + '</td>'
    + '</tr>';

  return ''
  + '<div style="margin:0;padding:0;background:' + c.paper + ';font-family:Helvetica,Arial,sans-serif;color:' + c.ink + ';">'
  + '<div style="max-width:600px;margin:0 auto;padding:0 0 36px;">'

  + '<div style="background:' + c.pine + ';color:#fff;padding:28px;text-align:center;">'
  +   '<div style="font-family:Georgia,serif;font-size:24px;letter-spacing:.5px;">Sthira</div>'
  +   '<div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;margin-top:4px;">Isha Yoga Center · Coimbatore</div>'
  + '</div>'

  + '<div style="padding:28px;">'
  +   '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9A9384;font-weight:600;">Booking confirmation &amp; guidelines</div>'
  +   '<h1 style="font-family:Georgia,serif;font-weight:500;font-size:25px;margin:6px 0 4px;line-height:1.25;">Namaskaram, ' + _esc(first) + '.</h1>'
  +   '<p style="font-size:14.5px;color:' + c.muted + ';line-height:1.6;margin:0 0 22px;">Your electric scooter is reserved. This email is your confirmation and the riding guidelines for the Isha Yoga Center. Please carry a valid ID and licence to the desk.</p>'

  +   '<div style="background:' + c.card + ';border:1px solid ' + c.line + ';border-radius:16px;padding:6px 20px;">'
  +     '<table style="width:100%;border-collapse:collapse;">'
  +       row('Booking ID', '<span style="font-family:' + c.mono + ';color:' + c.pine + ';">' + _esc(b.bookingId) + '</span>', true)
  +       row('Rider', _esc(b.riderName))
  +       row('Scooter', _esc(b.vehicleLabel || '—'))
  +       row('Cottage', _esc(b.cottageName || '—'))
  +       row('From', _esc(b.checkIn))
  +       row('Return by (' + endTime + ')', _esc(b.checkOut))
  +       row('Days', _esc(b.days))
  +       row('Rent', _inr(b.rentAmount))
  +       row('Refundable deposit', _inr(b.depositAmount))
  +       row('Total paid', _inr(b.totalAmount), true)
  +     '</table>'
  +   '</div>'

  +   mapBlock

  +   '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9A9384;font-weight:600;margin:24px 0 10px;">The guidelines you accepted</div>'
  +   _termsHtml()

  +   '<div style="margin-top:18px;background:#F2F5EE;border:1px solid ' + c.line + ';border-radius:12px;padding:14px 16px;font-size:13px;color:#3A372E;line-height:1.55;">You accepted all ' + STHIRA_TERMS.length + ' sections and the rider undertaking at the time of booking. This email is your record.</div>'

  +   '<p style="font-size:12.5px;color:' + c.muted + ';line-height:1.6;margin:20px 0 0;">Please ride slowly and quietly within the ashram. For any change to this booking, reply to this email or visit the travel desk.</p>'
  + '</div>'

  + '<div style="text-align:center;padding:18px;font-size:11px;color:#9A9384;">Sthira · Electric Two-Wheeler Rental · Isha Yoga Center, Coimbatore</div>'
  + '</div>'
  + '</div>';
}

// Sends the confirmation. Returns true if an email actually went out.
function sendBookingConfirmationEmail(bookingId) {
  const raw = _getBookingRaw(bookingId);
  if (!raw) { Logger.log('Email: booking not found ' + bookingId); return false; }
  const b = _rowToBooking(raw);
  if (!b.email || String(b.email).indexOf('@') === -1) {
    Logger.log('Email: no valid address for ' + bookingId);
    return false;
  }

  const inlineImages = {};
  const html = _buildBookingEmailHtml(b, inlineImages);
  const options = {
    htmlBody: html,
    name: getSettingValue('emailFromName') || 'Sthira Rentals',
    inlineImages: inlineImages
  };
  const replyTo = getSettingValue('emailReplyTo');
  if (replyTo && replyTo.indexOf('@') >= 0) options.replyTo = replyTo;

  MailApp.sendEmail(b.email, 'Your booking confirmation & riding guidelines — Sthira ' + b.bookingId, '', options);
  return true;
}

// Settings — "send a test" so the operator can verify the email setup
function sendTestEmail(toEmail, token) {
  requireAdmin(token);
  if (!toEmail || String(toEmail).indexOf('@') === -1) throw new Error('Enter a valid email address.');
  const sample = {
    bookingId: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'ddMMyy') + '-TEST',
    riderName: 'Test Rider', vehicleLabel: 'EV-01', cottageName: 'Shoonya',
    checkIn: _formatDateIST(new Date()), checkOut: _formatDateIST(new Date()),
    days: 1, rentAmount: Number(getSettingValue('dayRate')) || 300,
    depositAmount: Number(getSettingValue('depositPerWeek')) || 2000,
    totalAmount: (Number(getSettingValue('dayRate')) || 300) + (Number(getSettingValue('depositPerWeek')) || 2000),
    email: toEmail
  };
  const inlineImages = {};
  const html = _buildBookingEmailHtml(sample, inlineImages);
  MailApp.sendEmail(toEmail, 'Sthira — test confirmation email', '', {
    htmlBody: html, name: getSettingValue('emailFromName') || 'Sthira Rentals', inlineImages: inlineImages
  });
  return { success: true };
}

// Remaining MailApp quota (Settings can show this)
function getEmailQuota(token) {
  requireAdmin(token);
  return { remaining: MailApp.getRemainingDailyQuota() };
}

// ── Manager: email a business report (summary or detailed) to reportEmail + CC ──
function emailReport(period, detailed, token) {
  _requireManager(token);
  const to = String(getSettingValue('reportEmail') || '').trim();
  if (!to || to.indexOf('@') < 0) throw new Error('Set a reporting email in Reports first.');
  const cc = String(getSettingValue('reportCC') || '').trim();

  const a   = getAnalyticsData(period || 'week', token);
  const acc = getAccountingSummary(token);
  const dr  = getDrawers(token);
  const label = period === 'month' ? 'Last 30 days' : period === 'quarter' ? 'Last 90 days' : period === 'today' ? 'Today' : 'Last 7 days';
  const c = { paper: '#EFEAE0', card: '#FFFCF6', pine: '#2F5D50', ink: '#23211C', muted: '#6F6A5C', line: '#EBE4D6' };

  const stat = function (k, v) {
    return '<tr><td style="padding:7px 0;font-size:13.5px;color:' + c.muted + ';">' + _esc(k) + '</td>'
      + '<td style="padding:7px 0;font-size:13.5px;text-align:right;color:' + c.ink + ';font-weight:700;">' + v + '</td></tr>';
  };
  let summary = '<table style="width:100%;border-collapse:collapse;">'
    + stat('Bookings', a.totalBookings)
    + stat('Revenue (rent)', _inr(a.totalRevenue))
    + stat('Late fees', _inr(a.totalLateFees))
    + stat('Deductions', _inr(a.totalDeductions))
    + stat('Profit (rent + fees − refunds)', _inr(acc.profit))
    + stat('Cash collected (all-time)', _inr(acc.cashIn))
    + stat('UPI collected (all-time)', _inr(acc.upiIn))
    + stat('Refunds paid', _inr(acc.cashRefund + acc.upiRefund))
    + stat('Deposits held (liability)', _inr(acc.depositHeldTotal))
    + stat('Total cash on hand', _inr(acc.cashInHand))
    + '</table>';

  // Drawers breakdown
  let drawers = '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9A9384;font-weight:600;margin:20px 0 8px;">Drawers</div><table style="width:100%;border-collapse:collapse;">';
  if (dr.manager) drawers += stat(dr.manager.name + ' (manager)', _inr(dr.manager.balance));
  (dr.operators || []).forEach(function (o) { drawers += stat(o.name, _inr(o.balance)); });
  drawers += '</table>';

  let detailBlock = '';
  if (detailed) {
    const led = getLedger(period === 'today' ? 'today' : period === 'month' ? '30d' : period === 'quarter' ? 'all' : '7d', 0, 200, token);
    let rows = (led.rows || []).map(function (r) {
      const sign = r.direction === 'debit' ? '−' : (r.direction === 'transfer' ? '⇄' : '+');
      return '<tr><td style="padding:5px 6px;font-size:12px;color:' + c.muted + ';">' + _esc(r.ts) + '</td>'
        + '<td style="padding:5px 6px;font-size:12px;">' + _esc(r.type) + '</td>'
        + '<td style="padding:5px 6px;font-size:12px;color:' + c.muted + ';">' + _esc(r.operator || '—') + '</td>'
        + '<td style="padding:5px 6px;font-size:12px;text-align:right;">' + sign + ' ' + _inr(r.amount) + ' <span style="color:#9A9384;">(' + r.account + ')</span></td></tr>';
    }).join('');
    detailBlock = '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9A9384;font-weight:600;margin:20px 0 8px;">Ledger — ' + (led.rows || []).length + ' transactions</div>'
      + '<table style="width:100%;border-collapse:collapse;border-top:1px solid ' + c.line + ';">' + rows + '</table>';
  }

  const html = '<div style="background:' + c.paper + ';padding:0;font-family:Helvetica,Arial,sans-serif;color:' + c.ink + ';">'
    + '<div style="max-width:600px;margin:0 auto;">'
    + '<div style="background:' + c.pine + ';color:#fff;padding:24px 28px;"><div style="font-family:Georgia,serif;font-size:22px;">Sthira — ' + (detailed ? 'Detailed' : 'Summary') + ' report</div>'
    + '<div style="font-size:12px;opacity:.85;margin-top:3px;">' + label + ' · Isha Yoga Center</div></div>'
    + '<div style="padding:24px 28px;background:' + c.card + ';">' + summary + drawers + detailBlock
    + '<p style="font-size:11.5px;color:' + c.muted + ';margin-top:20px;">Generated by Sthira. Deposits are a held liability, not profit.</p></div></div></div>';

  const options = { htmlBody: html, name: getSettingValue('emailFromName') || 'Sthira Rentals' };
  if (cc) options.cc = cc;
  MailApp.sendEmail(to, 'Sthira ' + (detailed ? 'detailed' : 'summary') + ' report — ' + label, '', options);
  return { success: true, to: to, cc: cc };
}
