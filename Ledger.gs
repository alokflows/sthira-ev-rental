// ─── Money Ledger (the immutable "bank/blockchain" spine) ──────────────────────
// Every money event is ONE append-only row here — never edited, never deleted. The
// passbook UI, drawers, and reports all read from this. Drawers/accounting also
// derive from Bookings + Handovers (the canonical money columns), so the ledger
// being display-first keeps the live cash math safe even if a backfill is imperfect.

// Handovers sheet columns
const HC = { ID: 0, TS: 1, AMOUNT: 2, HANDED_BY: 3, RECEIVED_BY: 4, NOTE: 5,
             STATUS: 6, REQUESTED_BY: 7, APPROVED_BY: 8, DECIDED_AT: 9 };
// Ledger sheet columns
const LC = { TXN_ID: 0, TS: 1, TYPE: 2, DIR: 3, AMOUNT: 4, ACCOUNT: 5,
             OPERATOR: 6, BOOKING_ID: 7, NOTE: 8, RUN_BAL: 9 };

function _ensureLedgerSheet() {
  const ss = _getSS();
  let sheet = ss.getSheetByName('Ledger');
  if (!sheet) {
    sheet = ss.insertSheet('Ledger');
    const headers = SHEET_HEADERS.Ledger;
    const r = sheet.getRange(1, 1, 1, headers.length);
    r.setValues([headers]).setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    try {
      sheet.getRange(2, LC.AMOUNT + 1, 4000, 1).setNumberFormat('₹#,##0');
      sheet.getRange(2, LC.RUN_BAL + 1, 4000, 1).setNumberFormat('₹#,##0');
      sheet.getRange(2, LC.TS + 1, 4000, 1).setNumberFormat('dd MMM yyyy, HH:mm');
    } catch (e) {}
  }
  return sheet;
}

// Business cash on hand AFTER the last ledger row (cash rows only change it).
function _lastRunningCash(sheet) {
  const last = sheet.getLastRow();
  if (last <= 1) return Number(getSettingValue('openingCashBalance')) || 0;
  return Number(sheet.getRange(last, LC.RUN_BAL + 1).getValue()) || 0;
}

// Append one or more ledger rows atomically, threading the running cash balance.
// entry: { type, direction, amount, account, operator, bookingId, note, ts? }
// NOTE: deliberately NO LockService here. The money-critical callers (confirmBooking,
// createBackdatedBooking) already hold the script lock, and re-acquiring it would stall
// every confirm. The ledger is append-only + display-first (accounting derives from
// Bookings, not from here), so a rare interleaved RunningCashBalance is cosmetic only —
// the recorded amounts are always exact.
function _appendLedgerRows(entries) {
  entries = (entries || []).filter(function (e) { return e && Number(e.amount) > 0; });
  if (!entries.length) return;
  const sheet = _ensureLedgerSheet();
  let run = _lastRunningCash(sheet);
  const stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
  const rows = entries.map(function (e, i) {
    const amt = Math.round(Number(e.amount) || 0);
    const acct = e.account || 'cash';
    let cashDelta = 0;
    if (acct === 'cash') cashDelta = e.direction === 'credit' ? amt : (e.direction === 'debit' ? -amt : 0);
    run += cashDelta;
    return ['LX' + stamp + '-' + (i + 1), e.ts || new Date(), e.type, e.direction, amt,
            acct, e.operator || '', e.bookingId || '', e.note || '', run];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 10).setValues(rows);
}

// One-time backfill so the passbook isn't empty on an already-live sheet. Idempotent
// (guarded by MONEY_MIGRATED, plus this self-check). Ledger timestamps use each
// booking's own dates so the history reads chronologically.
function _backfillLedger() {
  const sheet = _ensureLedgerSheet();
  if (sheet.getLastRow() > 1) return;   // already has rows
  const bData = _getAllBookingsRaw();
  const openingCash = Number(getSettingValue('openingCashBalance')) || 0;

  // Collect entries with their dates, then sort chronologically.
  const events = [];
  if (openingCash > 0) events.push({ ts: new Date(2000, 0, 1), type: 'Opening', direction: 'credit', amount: openingCash, account: 'cash', operator: 'Manager', note: 'Opening balance' });

  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    const status = String(row[BC.STATUS]);
    if (status === 'Pending' || status === 'Cancelled') continue;
    const id = String(row[BC.BOOKING_ID]);
    const opB = String(row[BC.OPERATOR_BOOKED] || '');
    const created = row[BC.CREATED_AT] ? new Date(row[BC.CREATED_AT]) : new Date();
    if (Number(row[BC.RENT_CASH]))    events.push({ ts: created, type: 'RentIn',    direction: 'credit', amount: Number(row[BC.RENT_CASH]),    account: 'cash', operator: opB, bookingId: id });
    if (Number(row[BC.RENT_UPI]))     events.push({ ts: created, type: 'RentIn',    direction: 'credit', amount: Number(row[BC.RENT_UPI]),     account: 'upi',  operator: opB, bookingId: id });
    if (Number(row[BC.DEPOSIT_CASH])) events.push({ ts: created, type: 'DepositIn', direction: 'credit', amount: Number(row[BC.DEPOSIT_CASH]), account: 'cash', operator: opB, bookingId: id });
    if (Number(row[BC.DEPOSIT_UPI]))  events.push({ ts: created, type: 'DepositIn', direction: 'credit', amount: Number(row[BC.DEPOSIT_UPI]),  account: 'upi',  operator: opB, bookingId: id });
    if (row[BC.ACTUAL_RETURN]) {
      const opR = String(row[BC.OPERATOR_RETURNED] || '');
      const ret = row[BC.ACTUAL_RETURN] ? new Date(row[BC.ACTUAL_RETURN]) : created;
      // Late fee / deduction are withheld from the deposit (the refund below is already
      // reduced by them) → 'income' account so they never move the running cash balance.
      if (Number(row[BC.LATE_FEE]))        events.push({ ts: ret, type: 'LateFeeIn',   direction: 'credit', amount: Number(row[BC.LATE_FEE]),        account: 'income', operator: opR, bookingId: id });
      if (Number(row[BC.DEDUCTION_TOTAL])) events.push({ ts: ret, type: 'DeductionIn', direction: 'credit', amount: Number(row[BC.DEDUCTION_TOTAL]), account: 'income', operator: opR, bookingId: id });
      if (Number(row[BC.REFUND_CASH]))     events.push({ ts: ret, type: 'Refund',        direction: 'debit',  amount: Number(row[BC.REFUND_CASH]),     account: 'cash', operator: opR, bookingId: id });
      if (Number(row[BC.REFUND_UPI]))      events.push({ ts: ret, type: 'DepositRefund', direction: 'debit',  amount: Number(row[BC.REFUND_UPI]),      account: 'upi',  operator: opR, bookingId: id });
    }
  }

  events.sort(function (a, b) { return a.ts - b.ts; });
  // Write directly (one pass) threading the running cash balance.
  let run = 0;
  const stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
  const rows = events.map(function (e, i) {
    const amt = Math.round(e.amount);
    let cashDelta = 0;
    if (e.account === 'cash') cashDelta = e.direction === 'credit' ? amt : -amt;
    run += cashDelta;
    return ['LB' + stamp + '-' + (i + 1), e.ts, e.type, e.direction, amt, e.account, e.operator || '', e.bookingId || '', e.note || '', run];
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 10).setValues(rows);
}

// ─── Drawers (who physically holds which cash) ─────────────────────────────────
// operator drawer = their cash collected − their cash refunds paid − their approved
// handovers handed out. manager drawer = opening + all approved handovers received +
// managers' own net collections. Invariant: Σ drawers == total cash on hand.
function getDrawers(token, summary, bDataIn, hDataIn) {
  requireAdmin(token);
  // A manager — or a supervisor GRANTED supViewMoney — sees every drawer (server-
  // enforced, not just hidden). Everyone else sees only their own drawer.
  const canViewAll = _isManager(token) || _hasPower(token, 'supViewMoney');
  const me  = _opName(token);
  const bData = bDataIn || _getAllBookingsRaw();
  const hData = hDataIn || _getAllHandoversRaw();
  const ops   = _getOperatorsData();
  const openingCash = Number(getSettingValue('openingCashBalance')) || 0;

  const roleOf = {}; const emailOf = {}; const activeByName = {};
  ops.forEach(function (o) { roleOf[o.name] = o.role; emailOf[o.name] = o.email; activeByName[o.name] = o.active; });
  const isMgrName = function (nm) { return roleOf[nm] === 'Admin' || roleOf[nm] === 'Manager'; };

  const collected = {};   // name → cash collected
  const refunded  = {};   // name → cash refunds paid
  const handedOut = {};   // name → approved cash handed to manager
  const add = function (m, k, v) { if (!k) k = '—'; m[k] = (m[k] || 0) + (Number(v) || 0); };

  // Backdated entries carry "<name> (backdated)" — fold them onto the base name so they
  // don't appear as a phantom operator drawer (managers create them → manager pool).
  const baseName = function (n) { return String(n || '').replace(/\s*\(backdated\)\s*$/i, ''); };
  for (let i = 1; i < bData.length; i++) {
    const row = bData[i];
    if (!row[BC.BOOKING_ID]) continue;
    const st = String(row[BC.STATUS]);
    if (st === 'Pending' || st === 'Cancelled') continue;
    // Cash physically sits with whoever COLLECTED it (OPERATOR_BOOKED).
    add(collected, baseName(row[BC.OPERATOR_BOOKED]), (Number(row[BC.RENT_CASH]) || 0) + (Number(row[BC.DEPOSIT_CASH]) || 0));
  }
  // Cash refunds leave the drawer of whoever ACTUALLY PAID them — sourced from the LEDGER
  // by the row's Operator field, so a standalone refund (recordRefund, ledger-only) and a
  // booking-return refund both reduce the correct drawer. Σ refunds is unchanged, so the
  // global total is untouched; only per-drawer attribution reflects the real payer.
  const _ledRef = _ledgerRefunds();
  Object.keys(_ledRef.byOp).forEach(function (nm) { add(refunded, baseName(nm), _ledRef.byOp[nm].cash || 0); });
  // A transfer always leaves the SENDER's drawer. If it's addressed to the manager it
  // folds into the manager pool (totalApprovedHandovers); if to another OPERATOR it
  // credits that operator's drawer (operator↔operator transfer). Net 0 to total cash
  // either way, so the invariant Σ drawers == cash on hand still holds.
  const managerLabel = getSettingValue('managerLabel') || 'Manager';
  const recipIsMgr = function (raw) { const r = baseName(raw); return r === managerLabel || isMgrName(r); };
  const receivedIn = {};   // operator name → approved transfers they received
  let totalApprovedHandovers = 0;
  for (let i = 1; i < hData.length; i++) {
    if (!hData[i][HC.ID]) continue;
    if (String(hData[i][HC.STATUS] || 'Approved') !== 'Approved') continue;
    const amt = Number(hData[i][HC.AMOUNT]) || 0;
    add(handedOut, baseName(hData[i][HC.HANDED_BY]), amt);
    if (recipIsMgr(hData[i][HC.RECEIVED_BY])) totalApprovedHandovers += amt;
    else add(receivedIn, baseName(hData[i][HC.RECEIVED_BY]), amt);
  }

  const drawerOf = function (nm) { return (collected[nm] || 0) - (refunded[nm] || 0) - (handedOut[nm] || 0) + (receivedIn[nm] || 0); };

  // per-operator (non-manager) drawers
  const names = {};
  Object.keys(collected).forEach(function (n) { names[n] = 1; });
  Object.keys(refunded).forEach(function (n) { names[n] = 1; });
  Object.keys(handedOut).forEach(function (n) { names[n] = 1; });
  Object.keys(receivedIn).forEach(function (n) { names[n] = 1; });
  // Seed only ACTIVE operators (so a current operator shows even at ₹0). A removed
  // operator appears only if their cash history still nets non-zero (handled below).
  ops.forEach(function (o) { if (o.active && !isMgrName(o.name)) names[o.name] = 1; });

  const operators = [];
  let managerCollNet = 0;
  Object.keys(names).forEach(function (nm) {
    if (!nm || nm === '—') { managerCollNet += drawerOf(nm); return; }   // unattributed → manager pool
    if (isMgrName(nm)) { managerCollNet += drawerOf(nm); return; }
    const bal = drawerOf(nm);
    // A removed (deactivated) operator who no longer holds cash must NOT linger as a ₹0
    // drawer in the Money view. Active operators always show; a removed one shows only if
    // cash remains (which would be unsettled money worth surfacing). Any sub-rupee residue
    // of a removed drawer folds into the manager pool so Σ drawers == cash on hand stays exact.
    if (!activeByName[nm] && Math.abs(bal) < 1) { managerCollNet += bal; return; }
    operators.push({ name: nm, email: emailOf[nm] || '', balance: bal });
  });
  const acc = summary || getAccountingSummary(token, bData, hData);
  // The manager holds opening + verified handovers + their own net, MINUS whatever
  // has been relieved to the company. Keeps Σ drawers == total cash on hand.
  const managerBalance = openingCash + totalApprovedHandovers + managerCollNet - (acc.relieved || 0);
  const result = {
    scope: canViewAll ? 'manager' : 'operator',
    totalCashOnHand: acc.cashInHand,
    depositHeld: acc.depositHeldTotal,
    upiNet: acc.upiNet
  };
  if (canViewAll) {
    result.manager = { name: managerLabel, balance: managerBalance };
    result.operators = operators.sort(function (a, b) { return b.balance - a.balance; });
    // A granted supervisor still runs the desk and physically holds their own cash —
    // expose myBalance so they can transfer it (a manager doesn't need this, and the
    // internal callers requestHandover/getOperatorMoney always rely on it being present).
    const selfO = operators.filter(function (o) { return o.name === me; })[0];
    result.myBalance = selfO ? selfO.balance : drawerOf(me);
  } else {
    const self = operators.filter(function (o) { return o.name === me; })[0] || { name: me, email: '', balance: drawerOf(me) };
    result.operators = [self];
    result.myBalance = self.balance;
  }
  return result;
}

// ─── Handover approval (operator requests → manager Verifies) ──────────────────
function requestHandover(amount, note, receivedBy, token) {
  requireAdmin(token);
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) throw new Error('Enter an amount to hand over.');
  const me = _opName(token);
  // Resolve + validate the recipient: the manager pool, or another active operator.
  // Block self-transfers — and since a manager is top of the chain, that also stops a
  // manager handing cash to the manager/themselves (Item 3).
  const managerLabel = getSettingValue('managerLabel') || 'Manager';
  const recipient = String(receivedBy || managerLabel).trim();
  const isMgrDest = (recipient === managerLabel);
  const knownOp = _getOperatorsData().some(function (o) { return o.name === recipient && o.active; });
  if (!isMgrDest && !knownOp) throw new Error('Pick a valid recipient.');
  if (recipient === me || (isMgrDest && _isManager(token))) throw new Error('You can\'t transfer cash to yourself.');
  // An operator can't request more than the cash they actually hold.
  if (!_isManager(token)) {
    const dr = getDrawers(token);
    const mine = dr.myBalance != null ? dr.myBalance : 0;
    if (amt > mine + 1) throw new Error('You only hold ' + _inr(mine) + ' — can\'t hand over ' + _inr(amt) + '.');
  }
  const id = 'HO-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
  const row = new Array(10).fill('');
  row[HC.ID] = id; row[HC.TS] = new Date(); row[HC.AMOUNT] = amt;
  row[HC.HANDED_BY] = me; row[HC.RECEIVED_BY] = recipient;
  row[HC.NOTE] = note || ''; row[HC.STATUS] = 'Pending'; row[HC.REQUESTED_BY] = me;
  _getSS().getSheetByName('Handovers').appendRow(row);
  _bumpDataVersion();
  return { success: true, handoverId: id, status: 'Pending' };
}

function approveHandover(handoverId, token) {
  return _decideHandover(handoverId, 'Approved', token);
}
function rejectHandover(handoverId, token) {
  return _decideHandover(handoverId, 'Rejected', token);
}
// The RECIPIENT verifies a transfer (manager for handovers addressed to the manager
// pool; the operator for an operator→operator transfer) — not just any manager.
function _decideHandover(handoverId, decision, token) {
  requireAdmin(token);
  const sheet = _getSS().getSheetByName('Handovers');
  const data = sheet.getDataRange().getValues();
  const managerLabel = getSettingValue('managerLabel') || 'Manager';
  const ops = _getOperatorsData();
  const roleOf = {}; ops.forEach(function (o) { roleOf[o.name] = o.role; });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][HC.ID]) === handoverId) {
      if (String(data[i][HC.STATUS] || '') !== 'Pending') throw new Error('This transfer was already decided.');
      const me = _opName(token);
      const recipient = String(data[i][HC.RECEIVED_BY] || '');
      const recipIsMgr = (recipient === managerLabel) || roleOf[recipient] === 'Admin' || roleOf[recipient] === 'Manager';
      const allowed = (recipient === me) || (recipIsMgr && _isManager(token));
      if (!allowed) throw new Error('Only the recipient can verify this transfer.');
      const amt = Number(data[i][HC.AMOUNT]) || 0;
      const handedBy = String(data[i][HC.HANDED_BY] || '');
      if (decision === 'Approved') {
        // Re-check the sender still physically holds the cash (they may have refunded or
        // transferred more since requesting) — never let a drawer go negative on approve.
        const sd = getDrawers(token, null, null, data);
        let senderBal = null;
        if (sd.manager && (handedBy === managerLabel || roleOf[handedBy] === 'Admin' || roleOf[handedBy] === 'Manager')) senderBal = sd.manager.balance;
        else (sd.operators || []).forEach(function (o) { if (o.name === handedBy) senderBal = o.balance; });
        if (senderBal != null && amt > senderBal + 1) throw new Error(handedBy + ' no longer holds ' + _inr(amt) + ' (drawer ' + _inr(senderBal) + ').');
      }
      sheet.getRange(i + 1, HC.STATUS + 1).setValue(decision);
      sheet.getRange(i + 1, HC.APPROVED_BY + 1).setValue(me);
      sheet.getRange(i + 1, HC.DECIDED_AT + 1).setValue(new Date());
      if (decision === 'Approved') {
        // One transfer row — net 0 to the business total, moves cash between drawers.
        _appendLedgerRows([{ type: 'Handover', direction: 'transfer', amount: amt, account: 'cash',
          operator: handedBy, note: 'Transfer ' + handedBy + ' → ' + recipient + ' (verified)' }]);
      }
      _bumpDataVersion();
      return { success: true, status: decision };
    }
  }
  throw new Error('Transfer not found.');
}

// Transfers waiting for ME to verify — the RECIPIENT's queue. A manager sees handovers
// addressed to the manager pool; an operator sees transfers addressed to them.
function getPendingHandovers(token, hDataIn) {
  requireAdmin(token);
  const me = _opName(token);
  const mgr = _isManager(token);
  const managerLabel = getSettingValue('managerLabel') || 'Manager';
  const roleOf = {}; _getOperatorsData().forEach(function (o) { roleOf[o.name] = o.role; });
  const recipIsMgr = function (r) { return r === managerLabel || roleOf[r] === 'Admin' || roleOf[r] === 'Manager'; };
  const data = hDataIn || _getAllHandoversRaw();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][HC.ID]) continue;
    if (String(data[i][HC.STATUS] || '') !== 'Pending') continue;
    const recipient = String(data[i][HC.RECEIVED_BY] || '');
    if (!((recipient === me) || (mgr && recipIsMgr(recipient)))) continue;
    out.push({ handoverId: String(data[i][HC.ID]), timestamp: data[i][HC.TS] ? _formatIST(data[i][HC.TS]) : '',
      amountCash: Number(data[i][HC.AMOUNT]) || 0, handedBy: String(data[i][HC.HANDED_BY] || ''), note: String(data[i][HC.NOTE] || '') });
  }
  return out.reverse();
}

// ─── Refund (operator/manager pays from a drawer; recorded immutably) ──────────
// Used by a standalone "Refund" action (the return flow records its own refund rows).
function recordRefund(amount, account, note, bookingId, token) {
  _requireManager(token);   // standalone refund is a manager-only action (matches the UI)
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) throw new Error('Enter a refund amount.');
  const acct = account === 'upi' ? 'upi' : 'cash';
  // You can't pay out more cash than is on hand — a cap stops a typo'd refund (an extra
  // zero) driving cash on hand / the manager drawer negative.
  if (acct === 'cash') {
    const acc = getAccountingSummary(token);
    if (amt > acc.cashInHand + 1) throw new Error('Cannot refund more than the cash on hand (' + _inr(acc.cashInHand) + ').');
  }
  const me = _opName(token);
  _appendLedgerRows([{ type: 'Refund', direction: 'debit', amount: amt, account: acct,
    operator: me, bookingId: bookingId || '', note: note || ('Refund by ' + me) }]);
  _bumpDataVersion();
  return { success: true };
}

// ─── Relieve / remit to the company (a REAL outflow, not an internal transfer) ──
// Once cash is given to the company it leaves the business — it reduces total cash
// on hand AND the manager drawer. (Handovers stay inside; relieves leave.)
function recordRelieve(amount, note, token) {
  _requireManager(token);
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) throw new Error('Enter an amount to relieve.');
  const me = _opName(token) || 'Manager';
  const acc = getAccountingSummary(token);
  if (amt > acc.cashInHand + 1) throw new Error('Cannot relieve more than the cash on hand (' + _inr(acc.cashInHand) + ').');
  _appendLedgerRows([{ type: 'Relieve', direction: 'debit', amount: amt, account: 'cash', operator: me,
    note: note || ('Given to company by ' + me) }]);
  _bumpDataVersion();
  return { success: true };
}

// Total cash relieved to the company (read from the ledger — its only home).
function _ledgerRelieveCash(ledDataIn) {
  const data = ledDataIn || _ensureLedgerSheet().getDataRange().getValues();
  let sum = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][LC.TYPE]) === 'Relieve' && String(data[i][LC.ACCOUNT]) === 'cash') sum += Number(data[i][LC.AMOUNT]) || 0;
  }
  return sum;
}

// Refunds, sourced from the LEDGER (its single home for BOTH booking-return refunds and
// standalone refunds — each is exactly one debit row, so no double count). A cash refund
// is type 'Refund' on account 'cash'; a UPI deposit refund is type 'DepositRefund' on
// account 'upi'. Returns { cash, upi, byOp } where byOp[name] = { cash, upi } per the
// row's Operator field (the operator who actually paid the refund out of their drawer).
function _ledgerRefunds(ledDataIn) {
  const data = ledDataIn || _ensureLedgerSheet().getDataRange().getValues();
  const baseName = function (n) { return String(n || '').replace(/\s*\(backdated\)\s*$/i, ''); };
  let cash = 0, upi = 0; const byOp = {};
  const bump = function (op, k, v) { const nm = baseName(op); if (!byOp[nm]) byOp[nm] = { cash: 0, upi: 0 }; byOp[nm][k] += v; };
  for (let i = 1; i < data.length; i++) {
    if (!data[i][LC.TXN_ID]) continue;
    if (String(data[i][LC.DIR]) !== 'debit') continue;
    const type = String(data[i][LC.TYPE]), acct = String(data[i][LC.ACCOUNT]), amt = Number(data[i][LC.AMOUNT]) || 0;
    // Match by refund-type + account (NOT a fixed type→account pairing): processReturn
    // posts 'Refund'/cash + 'DepositRefund'/upi, while a standalone recordRefund posts
    // 'Refund' on EITHER account. Counting both refund types on each account catches a
    // standalone UPI refund too, and never counts a 'Relieve' (excluded by type).
    const isRefund = (type === 'Refund' || type === 'DepositRefund');
    if (isRefund && acct === 'cash') { cash += amt; bump(data[i][LC.OPERATOR], 'cash', amt); }
    else if (isRefund && acct === 'upi') { upi += amt; bump(data[i][LC.OPERATOR], 'upi', amt); }
  }
  return { cash: cash, upi: upi, byOp: byOp };
}

// ─── Passbook (paginated, newest first; operators see only their own rows) ─────
function getLedger(period, offset, limit, token) {
  requireAdmin(token);
  // Full passbook for a manager or a supViewMoney supervisor; everyone else sees
  // only the rows attributed to them (server-enforced).
  const mgr = _hasPower(token, 'supViewMoney');
  const me  = _opName(token);
  const sheet = _ensureLedgerSheet();
  const data = sheet.getDataRange().getValues();
  offset = Number(offset) || 0;
  limit  = Number(limit) || 20;

  let cutoff = null;
  const now = Date.now();
  if (period === 'today') cutoff = new Date(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy/MM/dd') + ' 00:00:00');
  else if (period === '7d') cutoff = new Date(now - 7 * 86400000);
  else if (period === '30d') cutoff = new Date(now - 30 * 86400000);

  // Per-account running balance so EVERY row's "bal" reflects the pot it actually moved:
  // cash rows show running cash on hand, UPI rows show running UPI, and rows that moved
  // neither (late fee / deduction withheld from a deposit) show no balance (null → "—").
  // A forward pass (oldest→newest) over the whole sheet feeds the newest-first page below.
  const openingCash = Number(getSettingValue('openingCashBalance')) || 0;
  let cashRun = openingCash, upiRun = 0;
  const balByRow = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][LC.TXN_ID]) continue;
    const acct = String(data[i][LC.ACCOUNT] || ''), dir = String(data[i][LC.DIR]), amt = Number(data[i][LC.AMOUNT]) || 0;
    // A transfer moves cash between drawers but doesn't change TOTAL cash on hand, so it
    // carries no running balance (shown as "—"). The passbook shows a balance only on rows
    // that actually move the pot — like a bank statement, every shown balance really changed.
    if (dir === 'transfer') { balByRow[i] = null; }
    else if (acct === 'cash') { cashRun += dir === 'credit' ? amt : -amt; balByRow[i] = cashRun; }
    else if (acct === 'upi') { upiRun += dir === 'credit' ? amt : -amt; balByRow[i] = upiRun; }
    else balByRow[i] = null;   // income / other — no holding changed
  }

  const all = [];
  for (let i = data.length - 1; i >= 1; i--) {
    if (!data[i][LC.TXN_ID]) continue;
    const op = String(data[i][LC.OPERATOR] || '');
    if (!mgr && op !== me) continue;
    const ts = data[i][LC.TS] ? new Date(data[i][LC.TS]) : null;
    if (cutoff && ts && ts < cutoff) continue;
    all.push({
      ts: ts ? _formatIST(ts) : '', type: String(data[i][LC.TYPE]), direction: String(data[i][LC.DIR]),
      amount: Number(data[i][LC.AMOUNT]) || 0, account: String(data[i][LC.ACCOUNT] || 'cash'),
      operator: op, bookingId: String(data[i][LC.BOOKING_ID] || ''), note: String(data[i][LC.NOTE] || ''),
      balanceAfter: balByRow[i]
    });
  }
  const page = all.slice(offset, offset + limit);
  return { rows: page, total: all.length, hasMore: offset + limit < all.length };
}

// ─── Self-audit (intelligent reconciliation) ───────────────────────────────────
// Derives cash THREE independent ways and cross-checks them, so a direct sheet edit
// (someone editing the Excel) shows up as a precise delta + the offending rows.
// Logs every run to an Audit sheet so the owner can review any timeframe.
function _ensureAuditSheet() {
  const ss = _getSS();
  let sh = ss.getSheetByName('Audit');
  if (!sh) {
    sh = ss.insertSheet('Audit');
    sh.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Result', 'CashExpected', 'CashFromLedger', 'Delta', 'Issues', 'Detail']])
      .setFontWeight('bold').setBackground('#2F5D50').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function runSelfAudit(token) {
  _requireManager(token);
  const bData = _getAllBookingsRaw(), hData = _getAllHandoversRaw();
  const ledData = _ensureLedgerSheet().getDataRange().getValues();
  const acc = getAccountingSummary(token, bData, hData);
  const dr  = getDrawers(token, acc, bData, hData);
  const issues = [];

  // 1) Ledger cash (credits − debits, cash only) vs accounting cash on hand.
  // The running balance baselines at openingCash; a fresh sheet has no 'Opening' ledger
  // row, so add openingCash to the sum unless such a row already carries it (backfill).
  let ledgerCash = 0, hasOpeningRow = false;
  for (let i = 1; i < ledData.length; i++) {
    if (!ledData[i][LC.TXN_ID]) continue;
    if (String(ledData[i][LC.TYPE]) === 'Opening') hasOpeningRow = true;
    if (String(ledData[i][LC.ACCOUNT]) !== 'cash') continue;
    const a = Number(ledData[i][LC.AMOUNT]) || 0, d = String(ledData[i][LC.DIR]);
    if (d === 'credit') ledgerCash += a; else if (d === 'debit') ledgerCash -= a;   // transfers net 0
  }
  if (!hasOpeningRow) ledgerCash += Number(getSettingValue('openingCashBalance')) || 0;
  const cashDelta = Math.round(acc.cashInHand - ledgerCash);
  if (Math.abs(cashDelta) > 1) issues.push({ severity: 'high', where: 'Cash vs ledger',
    detail: 'Cash on hand (' + _inr(acc.cashInHand) + ') ≠ ledger cash (' + _inr(ledgerCash) + '). A booking was likely edited directly in the sheet, or a ledger row is missing.' });

  // 2) Drawer invariant: Σ drawers must equal cash on hand.
  const drawerSum = (dr.manager ? dr.manager.balance : 0) + (dr.operators || []).reduce(function (s, o) { return s + o.balance; }, 0);
  if (Math.abs(Math.round(acc.cashInHand - drawerSum)) > 1) issues.push({ severity: 'high', where: 'Drawers',
    detail: 'Sum of drawers (' + _inr(drawerSum) + ') ≠ cash on hand (' + _inr(acc.cashInHand) + ').' });

  // 3) Per-booking consistency (catches manual amount/split edits).
  let bad = 0;
  for (let j = 1; j < bData.length; j++) {
    const r = bData[j]; if (!r[BC.BOOKING_ID]) continue;
    const st = String(r[BC.STATUS]); if (st === 'Pending' || st === 'Cancelled') continue;
    const rent = Number(r[BC.RENT_AMOUNT]) || 0, dep = Number(r[BC.DEPOSIT_AMOUNT]) || 0, tot = Number(r[BC.TOTAL_AMOUNT]) || 0;
    const rc = Number(r[BC.RENT_CASH]) || 0, ru = Number(r[BC.RENT_UPI]) || 0, dc = Number(r[BC.DEPOSIT_CASH]) || 0, du = Number(r[BC.DEPOSIT_UPI]) || 0;
    if (Math.abs((rc + ru) - rent) > 1 || Math.abs((dc + du) - dep) > 1 || Math.abs(rent + dep - tot) > 1) {
      bad++;
      if (bad <= 8) issues.push({ severity: 'medium', where: 'Booking ' + String(r[BC.BOOKING_ID]),
        detail: 'Amounts don\'t reconcile (rent ' + _inr(rent) + ' vs paid ' + _inr(rc + ru) + '; deposit ' + _inr(dep) + ' vs paid ' + _inr(dc + du) + '). Likely a manual sheet edit.' });
    }
  }
  if (bad > 8) issues.push({ severity: 'medium', where: 'Bookings', detail: (bad - 8) + ' more bookings have mismatched amounts.' });

  // 4) No drawer should be negative — including the manager's.
  if (dr.manager && dr.manager.balance < -1) issues.push({ severity: 'high', where: 'Drawer · ' + dr.manager.name + ' (manager)', detail: 'Negative balance ' + _inr(dr.manager.balance) + ' — more relieved/refunded than held.' });
  (dr.operators || []).forEach(function (o) {
    if (o.balance < -1) issues.push({ severity: 'medium', where: 'Drawer · ' + o.name, detail: 'Negative balance ' + _inr(o.balance) + ' — more handed over/refunded than collected.' });
  });

  const ok = issues.length === 0;
  try { _ensureAuditSheet().appendRow([new Date(), ok ? 'PASS' : 'FAIL', acc.cashInHand, ledgerCash, cashDelta, issues.length, JSON.stringify(issues).slice(0, 4000)]); } catch (e) {}
  return { ok: ok, checkedAt: _formatIST(new Date()), cashOnHand: acc.cashInHand, ledgerCash: ledgerCash, cashDelta: cashDelta, drawerSum: drawerSum, issues: issues };
}
