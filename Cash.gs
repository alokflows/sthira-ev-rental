// ─── Cash & UPI Accounting ─────────────────────────────────────────────────────

function _getAllBookingsRaw() {
  return _getSS().getSheetByName('Bookings').getDataRange().getValues();
}

function _getAllHandoversRaw() {
  return _getSS().getSheetByName('Handovers').getDataRange().getValues();
}

// ── Core accounting ─────────────────────────────────────────────────────────

// bDataIn/hDataIn let a caller (e.g. getBootstrap) pass sheet data it already read,
// so one desk load doesn't re-read the Bookings/Handovers sheets many times.
function getAccountingSummary(token, bDataIn, hDataIn) {
  requireAdmin(token);
  const bData = bDataIn || _getAllBookingsRaw();
  const hData = hDataIn || _getAllHandoversRaw();
  const openingCash = Number(getSettingValue('openingCashBalance')) || 0;

  let cashIn = 0, upiIn = 0;      // inflows: rent + deposit collections
  // Refunds are sourced from the LEDGER (below), not Bookings, so STANDALONE refunds
  // (recordRefund — ledger-only, no Bookings row) also lower cash on hand. A booking-
  // return refund is in BOTH the ledger and Bookings (equal), so the ledger captures
  // every refund exactly once with no double count.
  const _refunds = _ledgerRefunds();
  const cashRefund = _refunds.cash, upiRefund = _refunds.upi; // outflows: deposit refunds paid out
  let lateFeesCash = 0, lateFeesUPI = 0;
  let deductionsCash = 0, deductionsUPI = 0;

  // Deposits held by active rentals (liability)
  let depositHeldCash = 0, depositHeldUPI = 0;

  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    const status = String(row[BC.STATUS]);
    // Pending = nothing collected; Cancelled = voided. A soft-Deleted booking KEEPS
    // its money in the books (the ledger is immutable) — it still counts below.
    if (status === 'Pending' || status === 'Cancelled') continue;

    cashIn  += Number(row[BC.RENT_CASH])    || 0;
    cashIn  += Number(row[BC.DEPOSIT_CASH]) || 0;
    upiIn   += Number(row[BC.RENT_UPI])     || 0;
    upiIn   += Number(row[BC.DEPOSIT_UPI])  || 0;

    // A return is recorded whenever ACTUAL_RETURN is set — true for Returned bookings
    // AND ones later soft-Deleted (their money stays in the books/ledger, so the refund
    // must keep counting or accounting drifts from the immutable ledger).
    if (row[BC.ACTUAL_RETURN]) {
      // Refunds are tallied from the ledger (see _refunds above), not here — that's what
      // lets standalone refunds count. Late fees/deductions still come from Bookings.

      // Late fees are kept (not refunded), attribute to mode of deposit collection
      const depositMode = (Number(row[BC.DEPOSIT_CASH]) || 0) >= (Number(row[BC.DEPOSIT_UPI]) || 0) ? 'cash' : 'upi';
      if (depositMode === 'cash') {
        lateFeesCash    += Number(row[BC.LATE_FEE])       || 0;
        deductionsCash  += Number(row[BC.DEDUCTION_TOTAL]) || 0;
      } else {
        lateFeesUPI     += Number(row[BC.LATE_FEE])       || 0;
        deductionsUPI   += Number(row[BC.DEDUCTION_TOTAL]) || 0;
      }
    }

    // Deposit is still a held liability while the scooter is out (Active), or for a
    // booking soft-deleted before it was ever returned (deposit not yet refunded).
    if (status === 'Active' || (status === 'Deleted' && !row[BC.ACTUAL_RETURN])) {
      depositHeldCash += Number(row[BC.DEPOSIT_CASH]) || 0;
      depositHeldUPI  += Number(row[BC.DEPOSIT_UPI])  || 0;
    }
  }

  // Handovers are an INTERNAL transfer (operator → manager), NOT money leaving the
  // business. They must NOT reduce total cash on hand — they only move it between
  // drawers. Only Approved handovers count (Pending requests haven't moved anything).
  let totalHandovers = 0;
  for (let i = 1; i < hData.length; i++) {
    if (!hData[i][0]) continue;
    if (String(hData[i][HC.STATUS] || 'Approved') !== 'Approved') continue;
    totalHandovers += Number(hData[i][HC.AMOUNT]) || 0;
  }

  const relieved   = _ledgerRelieveCash();   // cash given to the company (real outflow)
  const cashInHand = openingCash + cashIn - cashRefund - relieved;   // handovers excluded (internal transfer)
  const upiNet     = upiIn - upiRefund;
  // Profit = rent earned + fees/deductions kept − refunds. Late fees & deductions are
  // WITHHELD from the deposit, so (collected − heldDeposit − refund) ALREADY contains
  // them; adding lateFees/deductions again would double-count. Held deposits are a
  // liability (netted out), so an active rental contributes only its rent here.
  const profit     = (cashIn - depositHeldCash - cashRefund) + (upiIn - depositHeldUPI - upiRefund);

  return {
    cashIn:           cashIn,
    upiIn:            upiIn,
    cashRefund:       cashRefund,
    upiRefund:        upiRefund,
    totalHandovers:   totalHandovers,
    cashInHand:       cashInHand,     // = total cash on hand (business), drawers sum to this
    upiNet:           upiNet,
    depositHeldCash:  depositHeldCash,
    depositHeldUPI:   depositHeldUPI,
    depositHeldTotal: depositHeldCash + depositHeldUPI,
    lateFees:         lateFeesCash + lateFeesUPI,
    deductions:       deductionsCash + deductionsUPI,
    relieved:         relieved,
    revenue:          Math.max(0, profit),
    profit:           profit
  };
}

// ── Today's quick accounting ─────────────────────────────────────────────────

function getTodayAccounting(token, bDataIn) {
  requireAdmin(token);
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const bData = bDataIn || _getAllBookingsRaw();

  let todayCashIn = 0, todayUPIIn = 0;
  let todayBookings = 0, todayReturns = 0;
  let todayLateFees = 0, todayDeductions = 0;

  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    const status = String(row[BC.STATUS]);

    const createdDate = row[BC.CREATED_AT]
      ? Utilities.formatDate(new Date(row[BC.CREATED_AT]), 'Asia/Kolkata', 'yyyy-MM-dd')
      : '';
    const returnDate = row[BC.ACTUAL_RETURN]
      ? Utilities.formatDate(new Date(row[BC.ACTUAL_RETURN]), 'Asia/Kolkata', 'yyyy-MM-dd')
      : '';

    if (createdDate === today && (status === 'Active' || status === 'Returned')) {
      todayBookings++;
      todayCashIn += (Number(row[BC.RENT_CASH]) || 0) + (Number(row[BC.DEPOSIT_CASH]) || 0);
      todayUPIIn  += (Number(row[BC.RENT_UPI])  || 0) + (Number(row[BC.DEPOSIT_UPI])  || 0);
    }
    if (returnDate === today && status === 'Returned') {
      todayReturns++;
      todayLateFees   += Number(row[BC.LATE_FEE])        || 0;
      todayDeductions += Number(row[BC.DEDUCTION_TOTAL]) || 0;
    }
  }

  return {
    todayBookings:   todayBookings,
    todayReturns:    todayReturns,
    todayCashIn:     todayCashIn,
    todayUPIIn:      todayUPIIn,
    todayTotal:      todayCashIn + todayUPIIn,
    todayLateFees:   todayLateFees,
    todayDeductions: todayDeductions
  };
}

// ── Per-operator money view ──────────────────────────────────────────────────
// ONLY this operator's own numbers (their today, deposits held, profit, cash in hand,
// and what they've handed to the manager). Managers use getAccountingSummary (global);
// this keeps an operator's Money view free of any business-wide totals.
function getOperatorMoney(token, bDataIn, hDataIn) {
  requireAdmin(token);
  const me = _opName(token);
  const bData = bDataIn || _getAllBookingsRaw();
  const hData = hDataIn || _getAllHandoversRaw();
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const baseName = function (n) { return String(n || '').replace(/\s*\(backdated\)\s*$/i, ''); };

  // Refunds this operator actually PAID — from the ledger by Operator (so a standalone
  // refund counts and attribution matches getDrawers/getAccountingSummary).
  const _myRef = _ledgerRefunds().byOp[me] || { cash: 0, upi: 0 };
  let cashIn = 0, upiIn = 0;
  const cashRefund = _myRef.cash, upiRefund = _myRef.upi;
  let depHeldCash = 0, depHeldUPI = 0, todayCash = 0, todayUPI = 0;
  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    if (baseName(row[BC.OPERATOR_BOOKED]) !== me) continue;
    const status = String(row[BC.STATUS]);
    if (status === 'Pending' || status === 'Cancelled') continue;
    const rc = Number(row[BC.RENT_CASH]) || 0, ru = Number(row[BC.RENT_UPI]) || 0;
    const dc = Number(row[BC.DEPOSIT_CASH]) || 0, du = Number(row[BC.DEPOSIT_UPI]) || 0;
    cashIn += rc + dc; upiIn += ru + du;
    if (status === 'Active' || (status === 'Deleted' && !row[BC.ACTUAL_RETURN])) { depHeldCash += dc; depHeldUPI += du; }
    const created = row[BC.CREATED_AT] ? Utilities.formatDate(new Date(row[BC.CREATED_AT]), 'Asia/Kolkata', 'yyyy-MM-dd') : '';
    if (created === today && (status === 'Active' || status === 'Returned')) { todayCash += rc + dc; todayUPI += ru + du; }
  }
  // Cash physically held = their drawer (collected − refunds − handed out + received).
  const myBalance = getDrawers(token, null, bData, hData).myBalance || 0;
  // What they've handed to the manager (approved transfers addressed to the manager pool).
  const managerLabel = getSettingValue('managerLabel') || 'Manager';
  const roleOf = {}; _getOperatorsData().forEach(function (o) { roleOf[o.name] = o.role; });
  const recipIsMgr = function (r) { return r === managerLabel || roleOf[r] === 'Admin' || roleOf[r] === 'Manager'; };
  let givenToManager = 0;
  for (let i = 1; i < hData.length; i++) {
    if (!hData[i][HC.ID]) continue;
    if (String(hData[i][HC.STATUS] || '') !== 'Approved') continue;
    if (baseName(hData[i][HC.HANDED_BY]) !== me) continue;
    if (recipIsMgr(String(hData[i][HC.RECEIVED_BY] || ''))) givenToManager += Number(hData[i][HC.AMOUNT]) || 0;
  }
  const profitCash = cashIn - depHeldCash - cashRefund, profitUPI = upiIn - depHeldUPI - upiRefund;
  return {
    todayCash: todayCash, todayUPI: todayUPI, todayTotal: todayCash + todayUPI,
    cashInHand: myBalance,
    depositHeldCash: depHeldCash, depositHeldUPI: depHeldUPI, depositHeldTotal: depHeldCash + depHeldUPI,
    profitCash: profitCash, profitUPI: profitUPI, profit: profitCash + profitUPI,
    givenToManager: givenToManager
  };
}

// ── Handover to manager ──────────────────────────────────────────────────────

function getHandoverHistory(token, hDataIn) {
  requireAdmin(token);
  const data = hDataIn || _getAllHandoversRaw();
  const mgr  = _isManager(token);
  const me   = _opName(token);
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const handedBy = String(data[i][HC.HANDED_BY] || '');
    // Operators see only their own handovers; managers see all.
    if (!mgr && handedBy !== me) continue;
    out.push({
      handoverId:  String(data[i][HC.ID]),
      timestamp:   data[i][HC.TS] ? _formatIST(data[i][HC.TS]) : '',
      amountCash:  Number(data[i][HC.AMOUNT]) || 0,
      handedBy:    handedBy,
      receivedBy:  String(data[i][HC.RECEIVED_BY] || ''),
      note:        String(data[i][HC.NOTE] || ''),
      status:      String(data[i][HC.STATUS] || 'Approved'),
      approvedBy:  String(data[i][HC.APPROVED_BY] || '')
    });
  }
  return out.reverse();
}

// ── Operators ─────────────────────────────────────────────────────────────────

// Operators sheet columns: OperatorId(0) Name(1) Active(2) Pin(3) Role(4) Email(5)
const OC = { ID: 0, NAME: 1, ACTIVE: 2, PIN: 3, ROLE: 4, EMAIL: 5 };

function _getOperatorsData() {
  const sheet = _getSS().getSheetByName('Operators');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][OC.ID]) continue;
    out.push({
      row:        i + 1,
      operatorId: String(data[i][OC.ID]),
      name:       String(data[i][OC.NAME]),
      active:     Boolean(data[i][OC.ACTIVE]),
      pin:        String(data[i][OC.PIN] || ''),
      role:       String(data[i][OC.ROLE] || 'Operator'),
      email:      String(data[i][OC.EMAIL] || '')
    });
  }
  return out;
}

// Used by login — find the active operator who owns this PIN.
// o.pin holds the stored HMAC hash, so we hash the candidate and compare.
function _findOperatorByPin(pin) {
  const clean = _cleanPin(pin);
  if (clean.length < 6) return null;
  const hash = _hashPin(clean);
  return _getOperatorsData().find(o => o.active && o.pin === hash) || null;
}

function _cleanPin(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 6);
}

// Internal (no token) — used by the setup wizard to create operator #1.
// The PIN is hashed before it ever touches the sheet.
function _createOperator(name, pin, role) {
  const sheet = _getSS().getSheetByName('Operators');
  const id = 'OP' + String(Math.max(1, sheet.getLastRow())).padStart(3, '0');
  sheet.appendRow([id, String(name || '').trim(), true, _hashPin(_cleanPin(pin)), role || 'Operator']);
  return id;
}

function getOperators(token) {
  requireAdmin(token);
  // Never expose PIN hashes to the client — the manager resets a PIN by typing a
  // new one, they never need to see the existing value.
  return _getOperatorsData().filter(o => o.active).map(o => ({
    row:        o.row,
    operatorId: o.operatorId,
    name:       o.name,
    active:     o.active,
    role:       o.role,
    email:      o.email
  }));
}

// Manager sets/updates an operator's email (used for report delivery + attribution).
function setOperatorEmail(operatorId, email, token) {
  _requireManager(token);
  const clean = String(email || '').trim();
  if (clean && clean.indexOf('@') < 0) throw new Error('Enter a valid email address.');
  const sheet = _getSS().getSheetByName('Operators');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][OC.ID]) === operatorId) {
      sheet.getRange(i + 1, OC.EMAIL + 1).setValue(clean);
      _bumpDataVersion();
      return { success: true };
    }
  }
  throw new Error('Operator not found.');
}

function addOperator(name, pin, role, token) {
  _requireManager(token);
  const clean = _cleanPin(pin);
  if (!String(name || '').trim()) throw new Error('Operator name is required.');
  if (clean.length < 6) throw new Error('Set a 6-digit PIN for this operator.');
  // The client may mint only Operator or Supervisor — never an Admin/Manager (the
  // first manager from the setup wizard is the sole full-power account).
  const safeRole = (role === 'Supervisor') ? 'Supervisor' : 'Operator';
  // Cash/drawers are attributed by operator NAME, so two active people with the same
  // name would silently merge into one drawer. Reject a duplicate active name.
  const nm = String(name).trim();
  if (_getOperatorsData().some(o => o.active && o.name.toLowerCase() === nm.toLowerCase())) {
    throw new Error('An operator named "' + nm + '" already exists — pick a distinct name (cash is tracked per name).');
  }
  const hash = _hashPin(clean);
  if (_getOperatorsData().some(o => o.active && o.pin === hash)) throw new Error('That PIN is already in use. Choose another.');
  const id = _createOperator(nm, clean, safeRole);
  _bumpDataVersion();
  return { success: true, operatorId: id };
}

// Manager changes an existing user between Operator and Supervisor only. Never touches
// an Admin/Manager row (can't demote the manager) and never mints a second manager.
function setOperatorRole(operatorId, role, token) {
  _requireManager(token);
  const safeRole = (role === 'Supervisor') ? 'Supervisor' : 'Operator';
  const target = _getOperatorsData().find(o => o.operatorId === operatorId);
  if (!target) throw new Error('Operator not found.');
  if (target.role === 'Admin' || target.role === 'Manager') throw new Error('The manager\'s role cannot be changed.');
  const sheet = _getSS().getSheetByName('Operators');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][OC.ID]) === operatorId) {
      sheet.getRange(i + 1, OC.ROLE + 1).setValue(safeRole);
      _bumpDataVersion();
      return { success: true, role: safeRole };
    }
  }
  throw new Error('Operator not found.');
}

// Manager removes a user — CASH-SAFE. If the user still holds cash, settle their
// drawer to ₹0 first: always consolidate it into the manager pool as an already-
// approved internal transfer (the exact handover shape getDrawers understands), and
// if settleMode is 'relieve' additionally remit that cash from the manager to the
// company. The Ledger is append-only: this writes NEW rows recording WHO did it
// (acting manager) and WHOSE drawer was settled (the removed user) — it never edits
// or deletes a past row, and the removed user's own RentIn/DepositIn/Refund history
// stays forever (mirrors a booking soft-delete). Deactivation only flips Active=false.
function removeOperator(operatorId, settleMode, token) {
  _requireManager(token);
  const ops = _getOperatorsData();
  if (ops.filter(o => o.active).length <= 1) throw new Error('At least one operator must remain.');
  const target = ops.find(o => o.operatorId === operatorId && o.active);
  if (!target) throw new Error('Operator not found.');
  if (target.role === 'Admin' || target.role === 'Manager') throw new Error('The manager cannot be removed.');
  const me = _opName(token) || 'Manager';

  // Serialize the read-settle-write so the balance can't shift under us (a refund or
  // approved transfer landing mid-removal) and over/under-settle the drawer.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('The desk is busy right now. Please try again in a moment.'); }
  try {
  // Authoritative drawer balance for this user — never trust a client-sent number.
  const dr = getDrawers(token);
  let bal = 0;
  (dr.operators || []).forEach(o => { if (o.name === target.name) bal = Math.round(o.balance || 0); });

  if (bal > 0) {
    if (settleMode !== 'absorb' && settleMode !== 'relieve') {
      throw new Error('Choose how to settle ' + target.name + '\'s drawer (' + _inr(bal) + ') before removing.');
    }
    const managerLabel = getSettingValue('managerLabel') || 'Manager';
    const note = 'Drawer settled on removal of ' + target.name + ' by ' + me;
    // 1) Consolidate the user's cash into the manager pool — an APPROVED Handover row
    //    (user → manager) so getDrawers moves it (user drawer → 0, manager += bal).
    const hid = 'HO-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
    const hrow = new Array(10).fill('');
    hrow[HC.ID] = hid; hrow[HC.TS] = new Date(); hrow[HC.AMOUNT] = bal;
    hrow[HC.HANDED_BY] = target.name; hrow[HC.RECEIVED_BY] = managerLabel;
    hrow[HC.NOTE] = note; hrow[HC.STATUS] = 'Approved';
    hrow[HC.REQUESTED_BY] = me; hrow[HC.APPROVED_BY] = me; hrow[HC.DECIDED_AT] = new Date();
    _getSS().getSheetByName('Handovers').appendRow(hrow);
    _appendLedgerRows([{ type: 'Handover', direction: 'transfer', amount: bal, account: 'cash',
      operator: target.name, note: 'Transfer ' + target.name + ' → ' + managerLabel + ' · ' + note }]);
    // 2) If relieving, remit that same cash from the manager to the company (total drops).
    if (settleMode === 'relieve') {
      _appendLedgerRows([{ type: 'Relieve', direction: 'debit', amount: bal, account: 'cash',
        operator: me, note: note }]);
    }
  }

  // Deactivate — Operators row only; the immutable Ledger is never touched.
  const sheet = _getSS().getSheetByName('Operators');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][OC.ID]) === operatorId) { sheet.getRange(i + 1, OC.ACTIVE + 1).setValue(false); break; }
  }
  _bumpDataVersion();
  return { success: true, settled: bal };
  } finally {
    lock.releaseLock();
  }
}

function setOperatorPin(operatorId, pin, token) {
  _requireManager(token);
  const clean = _cleanPin(pin);
  if (clean.length < 6) throw new Error('PIN must be 6 digits.');
  const hash = _hashPin(clean);
  if (_getOperatorsData().some(o => o.active && o.pin === hash && o.operatorId !== operatorId)) {
    throw new Error('That PIN is already in use. Choose another.');
  }
  const sheet = _getSS().getSheetByName('Operators');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][OC.ID]) === operatorId) {
      sheet.getRange(i + 1, OC.PIN + 1).setValue(hash);
      _bumpDataVersion();
      return { success: true };
    }
  }
  throw new Error('Operator not found.');
}
