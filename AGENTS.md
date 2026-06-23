# AGENTS.md — Sthira EV Rental Desk

This file is the single, complete brief for any AI agent or developer working on this codebase. Read it
fully before making changes. `README.md` is the human-facing introduction; this file is the working contract.

---

## 1. What this project is

Sthira is a **live, production money app** that runs the electric two-wheeler rental desk at **Isha Yoga
Center, Coimbatore**. It is one Google Apps Script (GAS) web app deployment with two surfaces:

- **Rider Agreement** — `?mode=rider`, public and anonymous. A guest reads the rental terms, accepts the
  undertaking, enters their details, and submits a booking (saved as `Pending`).
- **Admin Desk** — the plain URL, PIN-protected. Operators confirm / return / cancel bookings, manage the
  fleet, handle cash and UPI, transfer cash between staff, run reports, and edit settings.

The datastore is a single Google Sheet the app creates and migrates itself on first run (portable: copy to a
new account, deploy, done — see `PORTABILITY.md`).

**Stack:** Google Apps Script (server `.gs` + HTML-service client `.html`), deployed with `clasp`. No build
step, no external services. GAS has **no server push / WebSockets** — the desk approximates realtime with a
4-second pulse poll (`getPulse`) that only triggers a full re-read when data actually changed.

---

## 2. Prime directives (do not violate)

1. **Be surgical.** Do exactly what was asked — smallest possible diff. No drive-by refactors, renames, or
   reorganizing. If you spot something else, note it; don't fix it uninvited.
2. **Don't break what works.** Understand the code and its dependents before editing. A fix that breaks
   something else is a net loss.
3. **Money correctness is the law.** Keep the invariant (§4) true. When unsure about cash math, stop and
   reason it through — never guess.
4. **Always deploy green and verify HTTP 200** after a change (§5).
5. **No bloat.** In any file you touch, remove dead/duplicate/unreachable code and unused vars you introduce.
   Lint as you go.
6. **Security:** PIN auth only (never Google SSO — the guest form must stay anonymous). PINs are 6-digit
   salted-HMAC hashes; never log, return, or hardcode them. `PIN_SECRET` lives in Script Properties.

---

## 3. Architecture you must preserve

- **One bootstrap.** `getBootstrap(token)` (Dashboard.gs) returns dashboard + all bookings + vehicles +
  handovers + operators + cottages + settings + week analytics in a single round-trip. The client caches it
  in `C` and **every view renders from `C`** — no per-view spinners, no per-navigation server calls. When
  adding read data, extend `getBootstrap` + `C`. Heavy/rare reads (ledger, analytics, audit, quota) load
  lazily.
- **Performance:** heavy read getters accept optional pre-read arrays (e.g.
  `getAccountingSummary(token, bData, hData)`, `getTodayAccounting`, `getDrawers`, `getPendingHandovers`) so
  one bootstrap doesn't re-read a sheet many times. Thread them.
- **Optimistic UI** for light mutations: update `C` + UI immediately, fire the server call in the background,
  self-heal via `silentRefresh`. Bump `A.mutateEpoch` so the seq+epoch guard discards stale reads.
- **Every mutation button** shows an in-button spinner and is disabled until the server responds (the
  `withBtn(t, handler())` helper in AdminJS.html) — no double-clicks, ever.
- **Auth races:** `A.authGen` increments on login/logout/resume; `loadBootstrap` ignores stale-gen responses
  and retries once (covers CacheService token lag). Don't remove these guards.
- **Roles:** `_requireManager(token)` gates manager-only server functions; the client hides manager UI via
  `isMgr()` (cosmetic only — the server is the real gate). Manager powers also respect Settings toggles
  (`allowPastBookings`, `allowDeleteBookings`).
- **Dates:** read every Bookings date cell through `_ymd(value)` before deadline math; times through
  `_hhmm(value)` (Sheets coerces "HH:MM" to a 1899 date serial otherwise).
- **Every mutation MUST call `_bumpDataVersion()`** before returning — it drives the 4-second pulse sync.

---

## 4. The money model (keep this TRUE — it is the law)

- **Total cash on hand = openingCash + Σ cashCollected − Σ cashRefunds − Σ relievedToCompany.**
  Handovers/transfers (operator→operator or operator→manager) are **internal transfers** — they do not change
  the total, only which drawer holds it. **Relieves** give cash to the company — they DO reduce the total.
- **Deposits are a liability, never profit.** `profit = rent + kept late fees + kept deductions − refunds`.
  Late fees and deductions are withheld from the deposit (the smaller refund already reflects them) — never a
  separate cash inflow; they post to a non-cash `income` ledger account.
- **Invariant (must always hold): Σ all drawers == total cash on hand.**
  - operator drawer = cash they collected − refunds of deposits they collected − their approved transfers out.
  - manager drawer = opening + approved transfers received + managers' net − relieved.
  - No drawer should ever be negative on the normal path.
- **Source of truth:** drawers and accounting derive from **Bookings + Handovers** (robust). The **Ledger**
  tab is the append-only passbook / audit spine. They must stay reconcilable.
- **`runSelfAudit`** (manager-only) derives cash three independent ways (Bookings, Ledger, Σ drawers),
  cross-checks them, re-verifies every booking's rent/deposit split, and flags negative drawers. Run it after
  any money change. All three agreeing = the books are provably consistent.
- Transfers are **recipient-verified**: the recipient (operator or manager) approves a pending transfer; only
  Approved transfers move cash between drawers. A manager cannot verify a transfer addressed to an operator.

---

## 5. Deploy & verify

```
clasp push --force
clasp redeploy <deploymentId> --description "what changed"
$u='<exec-url>'
"admin=$((Invoke-WebRequest $u -UseBasicParsing).StatusCode) rider=$((Invoke-WebRequest "$u`?mode=rider" -UseBasicParsing).StatusCode)"   # expect 200 / 200
```

The live account, scriptId, deploymentId, and exec URL are kept out of source control where appropriate
(`.clasp.json` is git-ignored). Ask the owner for the current deployment id if you need to redeploy.

---

## 6. DO NOT TOUCH (you will break production)

- **`appsscript.json` `webapp` block** (`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`) + the
  `Asia/Kolkata` timezone. Missing → the exec URL 404s. `clasp create` clobbers this — never recreate the
  project; restore the block if it's lost.
- **Schema is APPEND-ONLY and positional.** Columns are referenced by position (`BC` in Setup.gs, `OC` in
  Cash.gs, `VC` in Setup.gs, `HC`/`LC` in Ledger.gs). Never reorder, insert, or rename a column. To add one:
  append at the end + an idempotent `_ensureXxxColumns()` migration guarded by a script property.
- **The `Ledger` tab is immutable.** Append only via `_appendLedgerRows`. Never edit or delete a past row.
- Script properties: `DATA_VERSION`, `SETUP_DONE`, `COLS_MIGRATED`, `MONEY_MIGRATED`, `PIN_SECRET`.

---

## 7. File map

```
Code.gs        doGet router, auth, roles, bootstrap entry, migrations, _requireManager, _hashPin
Config.gs      DEFAULT_SETTINGS, settings CRUD, getPublicSettings, calculatePrice, daysInclusive, _ymd, _hhmm
Setup.gs       schema + initializeSheets (positional, append-only columns)
Cottages.gs    cottage CRUD + getPublicCottages
Bookings.gs    booking lifecycle, DDMMYY-N id, confirm→email, backdated + soft-delete
Vehicles.gs    fleet CRUD + getVehicleStatusEnriched
Returns.gs     processReturn (late fee, deductions, refund)
Cash.gs        accounting summary, operators, handover history, getOperatorMoney
Ledger.gs      immutable ledger, getDrawers, handover request/approval, recordRefund, recordRelieve, runSelfAudit
Dashboard.gs   getBootstrap (single round-trip) + dashboard + getAnalyticsData
Email.gs       STHIRA_TERMS (single source) + confirmation email + emailReport + map upload + quota
Styles.html    shared CSS — theme tokens incl. [data-theme="dark"]
RiderForm.html + RiderJS.html   public rider agreement
Admin.html + AdminJS.html       PIN login, setup wizard, 6 views, all modals
SharedCalc.html                 shared price preview (window.Sthira.*) used by both forms
assets/                         ashram map source (uploaded via Settings; not pushed by clasp)
```

---

## 8. Conventions & gotchas

- **Theme:** use CSS tokens (`var(--pine)`, `var(--surface)`, `--toast-bg`, etc.) — they flip for dark mode.
  Never hardcode a light hex for a background/border that holds dark text.
- **Style:** minimal and classy — prefer icon buttons over fat text buttons, right-align card actions, guard
  overflow so fields never spill out of cards.
- **First-run gotchas on a new account:** (1) `clasp create` fails until the account enables the Apps Script
  API at script.google.com/home/usersettings; (2) the new web app returns 403 until the owner authorizes
  scopes once (open the editor, run any function, Allow).
- **Auth:** `loginWithPin(pin)` both authenticates and identifies who is at the desk (returns name + role).
  The setup wizard creates operator #1 (the manager). Managers add operators / set PINs in Settings.

---

## 9. Working checklist for each task

1. Understand the code you're about to touch and what depends on it.
2. Make the smallest correct change.
3. If money was touched, reason through the invariant and plan to run `runSelfAudit`.
4. Deploy + verify admin & rider both return 200.
5. Tell the owner briefly what changed. Don't over-explain.
