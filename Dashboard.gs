// ─── Two-phase bootstrap ────────────────────────────────────────────────────────
// Phase 1 (getBootstrapLite):  reads 3 sheets → instant usable desk.
// Phase 2 (getBootstrapFull):  reads remaining sheets → money/reports/settings.
// Yard role only needs Phase 1 — never loads Phase 2.
function getBootstrapLite(token) {
  requireAdmin(token);
  const bData  = _getAllBookingsRaw();
  const vData  = _getVehiclesData();
  const sData  = _getAllSettingsRaw();
  const role   = _opRole(token);
  const isYard = (role === 'Yard');
  // Fleet + booking counts + overdue — no accounting, no ledger, no SettingsLog.
  const dashboard = getDashboardData(token, bData, null, vData, sData);
  return {
    dashboard:  dashboard,
    bookings:   getBookingsByStatus('All', token, bData),
    vehicles:   getVehicleStatusEnriched(token, bData, vData),
    handovers:  [],
    drawers:    isYard ? 0 : null,   // null = "not loaded yet"
    pendingHandovers: [],
    operatorMoney: null,
    operators:  [],
    cottages:   getCottages(token),
    settings:   getAdminSettings(token, sData),
    analytics:  null,
    role:       role,
    webAppUrl:  getWebAppUrl()
  };
}

function getBootstrapFull(token) {
  requireAdmin(token);
  const bData = _getAllBookingsRaw();
  const hData = _getAllHandoversRaw();
  const vData = _getVehiclesData();
  const sData = _getAllSettingsRaw();
  const role  = _opRole(token);
  const dashboard = getDashboardData(token, bData, hData, vData, sData);
  return {
    dashboard:  dashboard,
    bookings:   getBookingsByStatus('All', token, bData),
    vehicles:   getVehicleStatusEnriched(token, bData, vData),
    handovers:  getHandoverHistory(token, hData),
    drawers:    getDrawers(token, dashboard.accounting, bData, hData),
    pendingHandovers: getPendingHandovers(token, hData),
    operatorMoney: _isManager(token) ? null : getOperatorMoney(token, bData, hData),
    operators:  getOperators(token),
    cottages:   getCottages(token),
    settings:   getAdminSettings(token, sData),
    analytics:  { week: getAnalyticsData('week', token, bData) },
    role:       role,
    webAppUrl:  getWebAppUrl()
  };
}

// Backward-compat: getBootstrap now returns the full payload (used by silentRefresh
// which needs everything). The client calls getBootstrapLite first for instant paint.
function getBootstrap(token) {
  return getBootstrapFull(token);
}

// ─── Dashboard Aggregations ────────────────────────────────────────────────────

function getDashboardData(token, bDataIn, hDataIn, vDataIn, sDataIn) {
  requireAdmin(token);

  const bData    = bDataIn || _getAllBookingsRaw();
  const vehicles = vDataIn || _getVehiclesData();
  const today    = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const s        = sDataIn || _getAllSettingsRaw();
  const endTime  = s.rentalEndTime || '21:00';   // configurable return deadline (IST)

  // ── Fleet stats ──────────────────────────────────────────────────────────
  const fleetTotal       = vehicles.length;
  const fleetOut         = vehicles.filter(v => v.status === 'Out').length;
  const fleetAvailable   = vehicles.filter(v => v.status === 'Available').length;
  const fleetMaintenance = vehicles.filter(v => v.status === 'Maintenance').length;
  const fleetCharging    = vehicles.filter(v => v.status === 'Charging').length;

  // ── Booking stats ────────────────────────────────────────────────────────
  let pending = 0, active = 0, returnedToday = 0, newToday = 0, dueToday = 0;
  let overdueBookings = [];

  const now = new Date();

  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    const status     = String(row[BC.STATUS]);
    const createdIST = row[BC.CREATED_AT]
      ? Utilities.formatDate(new Date(row[BC.CREATED_AT]), 'Asia/Kolkata', 'yyyy-MM-dd') : '';
    const returnIST  = row[BC.ACTUAL_RETURN]
      ? Utilities.formatDate(new Date(row[BC.ACTUAL_RETURN]), 'Asia/Kolkata', 'yyyy-MM-dd') : '';

    if (status === 'Pending') pending++;
    if (status === 'Active')  active++;
    if (createdIST === today && (status === 'Active' || status === 'Returned')) newToday++;
    if (returnIST  === today && status === 'Returned') returnedToday++;

    // Due today: Active bookings whose return date (checkIn + days - 1) is today (IST).
    // Build the date from _ymd() (string OR Date cell) the same way the overdue block
    // below does — never new Date(string), which parses "YYYY-MM-DD" as UTC and can
    // slip the due date a day for Date-object cells.
    if (status === 'Active' && row[BC.CHECK_IN]) {
      const ciStr = _ymd(row[BC.CHECK_IN]);
      if (ciStr) {
        const days = Number(row[BC.DAYS]) || 1;
        const [cy, cm, cd] = ciStr.split('-').map(Number);
        const retStr = Utilities.formatDate(new Date(Date.UTC(cy, cm - 1, cd + days - 1)), 'UTC', 'yyyy-MM-dd');
        if (retStr === today) dueToday++;
      }
    }

    // Overdue: Active bookings past their return deadline (checkIn + days - 1) at 21:00 IST
    if (status === 'Active' && row[BC.CHECK_IN]) {
      const checkInStr = _ymd(row[BC.CHECK_IN]); // robust: handles Date or string cells
      if (checkInStr) {
        const days = Number(row[BC.DAYS]) || 1;
        const [cy, cm, cd] = checkInStr.split('-').map(Number);
        // Return date = checkIn + days - 1, at the configured end time (IST).
        const retYmd = Utilities.formatDate(new Date(Date.UTC(cy, cm - 1, cd + days - 1)), 'UTC', 'yyyy-MM-dd');
        const deadlineUTC = _istDeadlineUtc(retYmd, endTime);
        if (deadlineUTC && now > deadlineUTC) {
          const hoursLate = Math.floor((now - deadlineUTC) / 3600000);
          overdueBookings.push({
            bookingId:   String(row[BC.BOOKING_ID]),
            riderName:   String(row[BC.RIDER_NAME]),
            mobile:      String(row[BC.MOBILE]),
            vehicleLabel:String(row[BC.VEHICLE_LABEL] || ''),
            checkOut:    _formatDateIST(deadlineUTC),
            hoursLate:   hoursLate
          });
        }
      }
    }
  }

  // ── Accounting ───────────────────────────────────────────────────────────
  // Skip ledger-heavy accounting in lite mode (hDataIn === null) — the client
  // gets these from getBootstrapFull instead.  Saves2 ledger reads on the fast
  // path.
  const isLite = (hDataIn === null);
  const accounting = isLite ? null : getAccountingSummary(token, bData, hDataIn);
  const todayAcc   = isLite ? null : getTodayAccounting(token, bData);

  // ── Rate change alert (cached property — set by updateSetting, avoids reading
  // the entire SettingsLog sheet on every bootstrap) ──────────────────────────
  const rateChangedRecently =
    (Number(PropertiesService.getScriptProperties().getProperty('RATE_CHANGED_AT') || 0))
    > (Date.now() - 7 * 24 * 3600 * 1000);

  return {
    fleet: { total: fleetTotal, out: fleetOut, available: fleetAvailable, maintenance: fleetMaintenance, charging: fleetCharging },
    bookings: { pending, active, dueToday, newToday, returnedToday },
    overdueBookings: overdueBookings,
    accounting: accounting,
    today: todayAcc,
    managerLabel: s.managerLabel || 'Manager',
    rateChangedRecently: rateChangedRecently
  };
}

// ── Analytics (weekly/monthly) ───────────────────────────────────────────────

function getAnalyticsData(period, token, bDataIn) {
  requireAdmin(token);
  // period: 'week' | 'month' | 'quarter'
  const bData = bDataIn || _getAllBookingsRaw();
  const now   = new Date();
  let startDate;

  if (period === 'week')    startDate = new Date(now.getTime() - 7  * 86400000);
  else if (period === 'month')  startDate = new Date(now.getTime() - 30 * 86400000);
  else                          startDate = new Date(now.getTime() - 90 * 86400000);

  const dailyData = {};

  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    const status = String(row[BC.STATUS]);
    if (status === 'Pending' || status === 'Cancelled') continue;

    const createdAt = row[BC.CREATED_AT] ? new Date(row[BC.CREATED_AT]) : null;
    if (!createdAt || createdAt < startDate) continue;

    const day = Utilities.formatDate(createdAt, 'Asia/Kolkata', 'dd MMM');
    if (!dailyData[day]) {
      dailyData[day] = { date: day, bookings: 0, revenue: 0, cashIn: 0, upiIn: 0 };
    }
    dailyData[day].bookings++;
    dailyData[day].cashIn += (Number(row[BC.RENT_CASH]) || 0);
    dailyData[day].upiIn  += (Number(row[BC.RENT_UPI])  || 0);
    dailyData[day].revenue += (Number(row[BC.RENT_AMOUNT]) || 0);
  }

  // Returns/late fees in period
  let totalLateFees = 0, totalDeductions = 0;
  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID] || String(row[BC.STATUS]) !== 'Returned') continue;
    const returnAt = row[BC.ACTUAL_RETURN] ? new Date(row[BC.ACTUAL_RETURN]) : null;
    if (!returnAt || returnAt < startDate) continue;
    totalLateFees   += Number(row[BC.LATE_FEE])        || 0;
    totalDeductions += Number(row[BC.DEDUCTION_TOTAL]) || 0;
  }

  // Sort days chronologically (handles cross-year periods correctly)
  const series = Object.values(dailyData).sort((a, b) => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const nowYear = new Date().getFullYear();
    const nowMon  = new Date().getMonth(); // 0-based
    const toDate = (dateStr) => {
      const [day, mon] = dateStr.split(' ');
      const mi = months.indexOf(mon);
      // If month is far ahead of current month it belongs to the previous year
      const yr = (mi > nowMon && mi - nowMon > 6) ? nowYear - 1 : nowYear;
      return new Date(yr, mi, parseInt(day));
    };
    return toDate(a.date) - toDate(b.date);
  });

  return {
    series,
    totalLateFees,
    totalDeductions,
    totalBookings: series.reduce((s, d) => s + d.bookings, 0),
    totalRevenue:  series.reduce((s, d) => s + d.revenue, 0)
  };
}
