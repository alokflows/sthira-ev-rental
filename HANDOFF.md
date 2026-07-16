# HANDOFF — mobile + yard-staff batch (branch `claude/mobile-booking-features-541hxy`)

> **For the agent starting fresh:** Read **`AGENTS.md` in full first** — it is the operating contract.
> This is a **LIVE cash desk at a real ashram**. Owner: alokflows@gmail.com, non-technical, prefers short
> plain-language updates, often on phone.
>
> Updated 2026-07-16 by the coordinating session after building the whole batch on the branch above.
> (Previous batch's handoff — money fixes, resetAndSetup, guest polish, deployed @48 on 2026-07-10 —
> lives in this file's git history.)

## Current state — batch BUILT & PUSHED to the branch, **NOT yet deployed** ⚠️

All work is committed and pushed to `claude/mobile-booking-features-541hxy`. The cloud session cannot
run `clasp` (no access to the owner's Google account). **Owner's deploy steps are at the bottom.**
Nothing here touches money flows except one defensive date-validation fix; the money model is unchanged.

## What shipped in this batch

### 1. Rider form — map gestures no longer trap page scrolling (`RiderForm.html`, `RiderJS.html`)
- The ashram map used `touch-action:none` and captured every touch — guests scrolling the page got stuck
  on the map. Now: **one finger scrolls the page** (`touch-action:pan-y` at rest), **two-finger pinch
  zooms the map** (our handler; the browser never page-zooms over it), one-finger pan only **while
  zoomed** (JS flips `touch-action` to `none` above scale 1.01 and restores it on every reset path,
  including the existing ~3s idle ease-back). Desktop: plain wheel scrolls the page; ctrl+wheel (trackpad
  pinch) or wheel-while-zoomed zooms; dblclick zoom unchanged. Hint text updated.

### 2. Welcome Point rule is now time-boxed (`Email.gs` → `STHIRA_TERMS` section 03)
- Old: prohibited at all times. New: **"Between 7:30 AM and 7:30 PM, EVs must not pass through the
  Welcome Point under any circumstances. Outside these hours, riders may use the Welcome Point route to
  exit or return."**
- `STHIRA_TERMS` is the single source — the rider form's term cards AND the confirmation email both
  render from it, so one edit covers both. The map legend chip now reads
  "Welcome Point — closed 7:30 AM–7:30 PM" (still terra/red, `RiderForm.html`).

### 3. Vehicle status "Charging" + "Location" field (fleet-wide)
- Staff were marking charging scooters as **Maintenance**, which wrongly hid them from the guest form's
  availability count. `Charging` is now a first-class status that **still counts as bookable**:
  - `getPublicAvailableCount()` (rider form banner) counts Available + Charging.
  - The confirm-booking scooter picker lists Charging vehicles suffixed "· ⚡ charging".
  - `confirmBooking` / `swapBookingVehicle` accept Available or Charging.
- Fleet cards got a **lightning quick-toggle** (Charging ⇄ Available) beside the maintenance toggle; the
  edit-vehicle modal offers Available/Charging/Maintenance/Staff plus a **Location** text field; the
  counts strip and dashboard `fleet` stats include `charging`.
- **Schema (append-only, positional):** `Vehicles` gained `Location` at the end (`VC.LOCATION = 6`).
  Migration `_ensureVehicleColumns()` guarded by script property `VEH_COLS_MIGRATED`, registered in
  `_ensureSetup()` exactly like the earlier migrations. `setVehicleLocation(vehicleId, location, token)`
  added in `Vehicles.gs`; `updateVehicle` accepts `updates.location`.

### 4. Vehicle swap on an ACTIVE booking (`Bookings.gs`, `AdminJS.html`)
- Breakdown case: `swapBookingVehicle(bookingId, newVehicleId, oldStatus, token)` — script-locked,
  Active-only, new vehicle must be Rental + Available/Charging. Sets booking `VehicleId`/`VehicleLabel`,
  new scooter → Out, old scooter → Available/Maintenance/Charging (desk's choice). **Money-neutral by
  design: no ledger rows, no rent/deposit columns touched.**
- The Edit-booking modal (Active bookings) gained a Scooter select + "current scooter becomes…" select
  (hidden until a new scooter is picked). Submit chains swap → editBooking; a partial failure is surfaced
  honestly and the UI re-syncs.
- **Deliberately NOT added:** date edits on Active bookings. Money was already collected — lengthening
  goes through **Extend** (collects the difference), shortening through **Process return** (computes the
  refund). That is the money law (AGENTS.md §4), not a missing feature. Pending bookings: all details AND
  dates remain freely editable (nothing collected yet). **Booking ID is never editable** — it is the join
  key for Bookings ↔ Ledger ↔ Deductions; editing it in the sheet by hand breaks lookups (this is why the
  owner's manual Excel edit attempt failed, and it must stay that way).

### 5. Yard (on-ground staff) page + allocation alerts (`Admin.html`, `AdminJS.html`, `Bookings.gs`, `Setup.gs`, `Code.gs`, `Cash.gs`)
- New **Yard** view (sidebar + bottom nav, badge = open task count), phone-first:
  1. **Bring out** queue — every Active booking not yet acknowledged: big mono scooter label, rider first
     name + cottage, booking id, one full-width ≥48px "Scooter handed over" button.
  2. **Fleet chips** — Available / Charging / Maintenance / Out counters; tap to filter.
  3. **Vehicle grid** — status pill + location, 44px quick actions: charge toggle, maintenance toggle,
     location (modal with Yard / Charging point / Pickup point quick-picks + free text).
  4. **Due back today** strip. **No money appears anywhere on this view.**
- **Alerts without WebSockets:** rides on the existing 1s pulse. `syncYardSeen()` (hooked in
  `updateChrome()`, the single choke point after every bootstrap/silentRefresh/optimistic mutation) diffs
  open tasks per device; new ones → WebAudio double-beep + `navigator.vibrate` + browser `Notification`
  (if granted) + toast floor. First load seeds silently (no login storm). An "Enable alerts" banner on
  the Yard view requests Notification permission and unlocks the AudioContext in the same tap.
- **Schema:** `Bookings` gained `YardDoneAt` at the end (`BC.YARD_DONE_AT = 38`). Migration
  `_ensureYardColumns()` (guard `YARD_COLS_MIGRATED`) also **back-fills now() into existing Active
  bookings** so the yard queue starts empty on first deploy. `markYardDone(bookingId, token)` is
  idempotent (two staff tapping at once are both fine).
- **Yard role:** Settings → Operators can now create role **Yard** (`Cash.gs` `addOperator` /
  `setOperatorRole` accept it). A Yard login lands on the Yard view; Money/Reports/Settings nav is hidden
  client-side (cosmetic, same convention as `isMgr()` — money reads were already manager/power-gated
  server-side).

### 6. How yard staff get "their link" (owner asked)
- **There is no separate yard URL — the desk link IS the yard link.** The routing is done by the PIN:
  an operator with role Yard signs in and lands straight on the Yard page.
- Settings → **Operators** tab now has a **"Yard staff access"** card that explains this and shows the
  desk URL with a Copy button (mirrors the guest-form-link card). Setup for a yard phone:
  1. Settings → Operators → add person with role **Yard** + their 6-digit PIN.
  2. Copy the link from the "Yard staff access" card, send it to their phone (WhatsApp).
  3. On the phone: open in Chrome → menu → **Add to Home screen** → sign in → tap **Enable alerts**.
- Browser reality (GAS has no server push): alerts fire while the tab/PWA is open (foreground, and
  usually backgrounded-but-alive on Android Chrome). iOS Safari: no vibration API, notifications only for
  installed-to-home-screen PWAs on newer iOS. The toast + badge + 1s pulse are the always-works floor.

### 7. Mobile audit, both surfaces (`Admin.html`, `RiderForm.html`, `Styles.html`, minor `AdminJS.html`)
- Bottom nav now fits 6 items at 360px (nowrap labels, tightened ≤400px). Topbar "New booking" collapses
  to an icon-only 42px target ≤480px. Stat cells can no longer overflow the page on big ₹ figures
  (`min-width:0` + `overflow-wrap`; Money/Reports hero numbers now share the `.val` class). Fleet icon
  buttons are 40px on phones (34px desktop kept); action rows wrap instead of shrinking. Rider sticky
  footer stacks the submit full-width ≤480px. `viewport-fit=cover` added on both surfaces so the existing
  `env(safe-area-inset-bottom)` paddings actually work on iPhones. `.field` is 16px on phones so iOS
  stops auto-zooming into inputs.

### 8. Money-math verification (independent test pass, 117 assertions — all core math passes)
- days/rent/deposit formulas byte-identical across all 4 server sites + client preview; split validation,
  late fees (both modes, grace, caps), refund floors/caps, invariant sign conventions — all verified.
- **Fixed from its findings:** date inputs previously validated shape only — `"2026-13-01"` passed the
  regex and `Date.UTC` rolled it into next January, inflating billed days (crafted-request-only; the date
  picker can't produce it). New `_isRealYmd()` in `Config.gs` (real calendar dates only) now guards all
  five client-supplied date sites in `Bookings.gs`.
- **Flagged, not changed (owner should know):**
  - The ±₹1 split tolerance in confirm/extend/backdate matches `runSelfAudit`'s own ±₹1 reconciliation
    threshold — a systematic ₹1-off pattern would never be flagged by the audit. Small surface
    (PIN-authenticated staff only, every rupee still hits the ledger), but it is the audit's blind spot.
  - RiderJS `inr()` drops a minus sign (only ever formats non-negative values today); SharedCalc `to12h`
    vs Email `_to12h` differ on empty input (both call sites pre-default, so unreachable). Both benign.

## Schema/property changes in this batch (all append-only, all auto-migrating)

| Sheet | New column | Index | Migration guard |
|---|---|---|---|
| Vehicles | `Location` | `VC.LOCATION = 6` | `VEH_COLS_MIGRATED` |
| Bookings | `YardDoneAt` | `BC.YARD_DONE_AT = 38` | `YARD_COLS_MIGRATED` (back-fills Active rows) |

New server functions: `setVehicleLocation`, `swapBookingVehicle`, `markYardDone`, `_isRealYmd`,
`_ensureVehicleColumns`, `_ensureYardColumns`. New vehicle status value: `Charging`. New operator role:
`Yard`. No settings keys added; no ledger/accounting code touched.

## Owner's next steps (deploy)

1. Merge the branch (or work directly from it), then from the project folder:
   `clasp push --force` → `clasp redeploy <deploymentId> --description "mobile + yard batch"`.
2. Open the desk once — migrations run themselves on first load (Location + YardDoneAt appear at the far
   right of the sheet; existing Active bookings get YardDoneAt stamped so the yard queue starts empty).
3. Verify admin AND rider URLs return 200 (AGENTS.md §5).
4. Settings → Operators: add the on-ground staff with role **Yard**; use the new "Yard staff access" card
   to send them the link; on their phone Add to Home screen + Enable alerts.
5. Fleet: plug-in scooters via the ⚡ toggle instead of Maintenance from now on.
6. No money paths changed, but running `runSelfAudit` once after a day of activity never hurts.

## Known follow-ups (non-blocking)

- Existing operator rows can be toggled Operator ⇄ Supervisor in Settings; switching an existing person
  to/from **Yard** currently means re-adding them (the role toggle button only cycles two roles). One-line
  UI follow-up if it annoys.
- The desk operator's own device may also beep when a silentRefresh lands after their confirm (the
  in-flight suppression covers the common path, not every timing). Harmless — the toast is informative.
- iOS lock-screen alerts require the PWA install path; if yard staff use iPhones and miss alerts, consider
  a cheap escalation later (e.g. optional email-to-phone on allocation) — deliberately not built now.
- **Carried from previous batch (owner decisions pending — do not implement uninvited):**
  server-enforced booking visibility for `supViewAllBookings`; instant session revocation on
  remove/demote (session-epoch approach); `getTodayAccounting` per-bootstrap ledger read (perf, `ledDataIn`
  param already exists).
