// ─── One-shot bootstrap ─────────────────────────────────────────────────────────
// Returns everything the desk needs in a single round-trip, so the client can
// cache it and render every view instantly afterwards (no per-tab loading).
function getBootstrap(token) {
  requireAdmin(token);
  // Read the two heavy sheets ONCE and thread them through every aggregation, so a
  // desk load reads Bookings/Handovers once instead of ~8×/~5×.
  const bData = _getAllBookingsRaw();
  const hData = _getAllHandoversRaw();
  const dashboard = getDashboardData(token, bData, hData);
  return {
    dashboard:  dashboard,
    bookings:   getBookingsByStatus('All', token, bData),   // all bookings; client filters/searches locally
    vehicles:   getVehicleStatusEnriched(token, bData),
    handovers:  getHandoverHistory(token, hData),
    drawers:    getDrawers(token, dashboard.accounting, bData, hData),
    pendingHandovers: getPendingHandovers(token, hData),
    operatorMoney: _isManager(token) ? null : getOperatorMoney(token, bData, hData),
    operators:  getOperators(token),
    cottages:   getCottages(token),
    settings:   getAdminSettings(token),
    analytics:  { week: getAnalyticsData('week', token, bData) },
    role:       _opRole(token),
    webAppUrl:  getWebAppUrl()
  };
}

// ─── Dashboard Aggregations ────────────────────────────────────────────────────

function getDashboardData(token, bDataIn, hDataIn) {
  requireAdmin(token);

  const bData    = bDataIn || _getAllBookingsRaw();
  const vehicles = _getVehiclesData();
  const today    = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const s        = _getAllSettingsRaw();
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
  const accounting = getAccountingSummary(token, bData, hDataIn);
  const todayAcc   = getTodayAccounting(token, bData);

  // ── Rate change alert ─────────────────────────────────────────────────────
  const logSheet = _getSS().getSheetByName('SettingsLog');
  const logData  = logSheet.getDataRange().getValues();
  let rateChangedRecently = false;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  for (let i = 1; i < logData.length; i++) {
    if (!logData[i][0]) continue;
    if ((logData[i][1] === 'dayRate' || logData[i][1] === 'depositPerWeek') &&
        new Date(logData[i][0]) > sevenDaysAgo) {
      rateChangedRecently = true;
      break;
    }
  }

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
