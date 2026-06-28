# HANDOFF — booking visibility + instant session revocation

> **For the agent starting fresh:** Read **`AGENTS.md` in full first** — it is the operating contract
> (architecture, the money law, the do-not-touch list, deploy steps). This is a **LIVE cash desk at a real
> ashram**; be surgical, keep the money invariant true, **do not change the desktop look**, and deploy +
> verify 200 + re-zip at the end (see AGENTS.md §5 and the deploy block below).
>
> The previous batch (Supervisor role, drawer settlement on remove, monogram + mobile fixes, money-safety
> hardening, 1-second pulse) is **already shipped and live** (deployment @46). The two items below were
> surfaced by sub-agent reviews and deferred by the owner. Both need an **owner decision** noted inline.

---

## Background: the three-tier role model (already built)

Roles live in the `Operators` sheet `Role` column: **Operator**, **Supervisor**, **Admin/Manager**. A
Supervisor runs the desk like an operator and gets only globally-granted powers via four Settings toggles
(`supViewMoney`, `supViewAllBookings`, `supRunBookings`, `supDeleteBookings`). Server helpers in `Code.gs`:
`_isManager`, `_isSupervisor`, `_hasPower(token, key)`, `_requirePower(token, key)`, `_requireManager`.
The server is the real gate; client `isMgr()` / `can(key)` is cosmetic.

---

## Task 1 — Make `supViewAllBookings` actually gate booking visibility (server-enforced)

**The problem (review finding H2).** Today **every** signed-in user — operator, ungranted supervisor, or
manager — receives the **entire** booking history (with rider PII: name, DL number, mobile). The
`supViewAllBookings` toggle (default `'no'`) is presented as a privacy control but **gates nothing**:

- `getBootstrap` (`Dashboard.gs`) calls `getBookingsByStatus('All', token, bData)` for everyone.
- `getBookingsByStatus` (`Bookings.gs`) is guarded only by `requireAdmin` — no role/own-only scoping.
- `getAnalyticsData` / `getDashboardData` (`Dashboard.gs`) likewise return business-wide stats to everyone.

**⚠️ OWNER DECISION REQUIRED before coding.** AGENTS.md prime directive #2 is *"don't break operators'
current behaviour."* Restricting what operators see **is** a behaviour change, so confirm the intended policy:

- **Option A (recommended if privacy matters):** an operator / ungranted supervisor sees only the bookings
  they need to run the desk — **today's worklist + active rentals + their own bookings**. Full history +
  analytics unlock with `supViewAllBookings` (or manager). This makes the toggle real.
- **Option B:** keep all-bookings visible to everyone (status quo) and **remove the `supViewAllBookings`
  toggle** so the UI doesn't imply a control that does nothing.

If Option A is chosen, implement:

1. **Server (the real gate).** Add a helper, e.g. `_canViewAllBookings(token) = _hasPower(token,
   'supViewAllBookings')` (manager passes automatically). Then:
   - In `getBootstrap`, send the full list only when `_canViewAllBookings(token)`; otherwise send a **scoped**
     set. Add a scoped query (e.g. `getDeskBookings(token, bData)`) returning Pending + Active + Returned-today
     + rows where `baseName(OPERATOR_BOOKED) === _opName(token)`. Keep threading the pre-read `bData` (perf).
   - Gate `getAnalyticsData` with `_requirePower(token, 'supViewAllBookings')`, and in `getBootstrap` compute
     `analytics.week` only when allowed (operators already get a Reports chart today — see the behaviour note).
   - Leave `getBookingsByStatus` callable but ensure no client path lets an ungranted user pull 'All'.
2. **Client (`AdminJS.html`).** The bookings list renders from `C.bookings`. With a scoped bootstrap the
   "All" tab/search simply has less to show for an ungranted user. Gate the Reports analytics view and the
   Overview week/analytics affordances behind `can('supViewAllBookings')`. Do **not** alter desktop styling.
3. **Money note:** none of this touches cash math — it's a read-visibility scope only. Still run `node
   --check` and a quick UI pass.

**Acceptance:** an ungranted operator/supervisor sees only desk-relevant bookings + no business-wide
analytics; granting `supViewAllBookings` (or manager) unlocks full history + analytics; verified
**server-side** (not just hidden). Manager unchanged.

---

## Task 2 — Instant session revocation on remove / demote (review finding M2)

**The problem.** Roles and validity are cached **at login** (`Code.gs` `loginWithPin` writes
`adminToken_<token>`, `adminOp_<token>`, `adminRole_<token>` with an 8h TTL). `requireAdmin` only checks that
`adminToken_<token>` is `'valid'`, and `_opRole` reads the **cached** role. So:

- After `removeOperator` (sets `Active=false`), the removed user's existing session **keeps working** until
  the token expires (≤8h) — a removed staffer still has desk access.
- After `setOperatorRole` demotes Supervisor→Operator, their session still reports `Supervisor` (and keeps
  any `sup*` powers) until they log out / expire.

Current workaround told to the owner: have the affected person log out. Task 2 makes revocation immediate.

**The core difficulty:** the cache is keyed by **token**, and there is no token→operator reverse index, so we
can't directly find and delete a specific user's tokens. Two viable approaches — **pick one**:

- **Approach A (recommended — a per-operator session epoch).** Add a Script Property bump per operator, e.g.
  `SESS_EPOCH_<operatorId>` (or store an epoch in an Operators column — remember schema is **append-only**, so
  prefer a Script Property to avoid a migration). On login, stamp the token with the operator's current epoch
  (`adminEpoch_<token>`). In `requireAdmin` (or a lightweight check inside the already-1s `getPulse`), compare
  the token's epoch to the operator's current epoch; if they differ, treat the session as expired (return the
  "session expired" error the client already handles → it logs out). `removeOperator` and `setOperatorRole`
  bump that operator's epoch → their live sessions die within ≤1s via the pulse. **Cost:** one extra Script
  Property read on the gated call. Keep it cheap — read once per `getPulse`, not on every getter.
- **Approach B (re-derive from the sheet).** Make `requireAdmin`/`_opRole` re-read the operator's `Active` +
  `Role` from the `Operators` sheet instead of trusting the login cache. **Simpler but pricier** — adds an
  Operators-sheet read to the hot path (AGENTS.md §3 stresses minimizing reads), so only do this if you can
  fold it into an existing read. Approach A is preferred for the live desk.

**Also:** when a session is rejected this way, the client should drop cleanly to the PIN screen (the existing
`loadBootstrap` / `requireAdmin` "Session expired" path already does this — verify it fires, no console spam).

**Acceptance:** removing a user kills their open session within ~1–2s (they land on the PIN screen and can't
act); demoting a Supervisor drops their `sup*` powers immediately (server-verified, e.g. a delete/past-booking
attempt now fails); a normal operator's session is unaffected; no extra sheet read added to every getter.

---

## Deploy + verify + re-zip (do this last — AGENTS.md §5)

```
clasp push --force
clasp redeploy AKfycbymG-qx4J8R74GjlN_NZ5q1ukhMgJwFZM2L-d86NRWDlFicdfhV214QNtAShfS63KRd -d "what changed"
$u='https://script.google.com/macros/s/AKfycbymG-qx4J8R74GjlN_NZ5q1ukhMgJwFZM2L-d86NRWDlFicdfhV214QNtAShfS63KRd/exec'
"admin=$((Invoke-WebRequest $u -UseBasicParsing).StatusCode) rider=$((Invoke-WebRequest "$u`?mode=rider" -UseBasicParsing).StatusCode)"   # expect 200 / 200
```
Then refresh the portable zip (whole folder incl. `.clasp.json`, into `Documents\`, excluding itself) — see
the `[System.IO.Compression.ZipFile]::CreateFromDirectory(...)` block used in prior batches. The live
deployment id / exec URL are also in project memory (`prod-deployment`).

> `HANDOFF.md` is git/clasp-ignored (`*.md`) so it never deploys. Run a sub-agent review (money / roles / UI)
> before deploying, as the owner likes.
