# HANDOFF — state after the bug-fix batch (money fixes, reset function, guest polish)

> **For the agent starting fresh:** Read **`AGENTS.md` in full first** — it is the operating contract.
> This is a **LIVE cash desk at a real ashram**. Owner: alokflows@gmail.com, non-technical, prefers short
> plain-language updates, often on phone.
>
> Updated 2026-07-10 (evening) by the coordinating session after SHIPPING the whole batch.

## Current state — batch SHIPPED ✅

- All five pipeline steps completed and deployed on 2026-07-10:
  1. **Money fixes** — all 9 audited bugs fixed (cancel-with-refund for Active bookings with per-channel
     caps + reason + server-resolved actor; today's cash keyed to ledger timestamps; late fee uses `*_SNAP`
     snapshots; `fullExtraDay` charges actual days late; backdated split validation; getLedger opening-cash
     de-dupe; income capped to withheld; ₹0 late-fee hint; live return preview).
     New: `CancelledAt`/`CancelledBy` columns (BC 36/37, appended) + `CANCEL_MIGRATED` guard;
     `allowOperatorCancelActive` setting (default OFF, manager-only).
  2. **`resetAndSetup()` / `YES_ERASE_EVERYTHING()`** in Setup.gs (guarded reset; keeps `PIN_SECRET`);
     `_getSS()` recovery now clears migration guards and rebuilds via `_ensureSetup()` when the sheet is
     gone (`_setupBuilding` reentrancy guard; zero cost on hot path). `SPREADSHEET_ID` added to AGENTS §6.
  3. **Guest polish** — boot pre-fills today's dates + instant price; success-screen WhatsApp share
     (`wa.me/?text=`, guest's own) + copy button; honest email copy; "X scooters free" banner via new
     public `getPublicAvailableCount()` (count only, folded into `getPublicSettings`).
  4. **Cross-verification** — independent Opus review: SAFE TO SHIP, zero correctness bugs; ponytail pass:
     lean, nothing to cut. Node harness: **124/124 assertions pass** (was 83; harness lives at the old
     scratchpad path in git history — rebuild from pure functions if gone).
  5. **Ship** — live-vs-repo diff verified identical to HEAD before push; `clasp push --force`;
     redeployed **@48** on `AKfycbymG-qx4J8R74GjlN_NZ5q1ukhMgJwFZM2L-d86NRWDlFicdfhV214QNtAShfS63KRd`;
     admin=200 rider=200; committed + pushed to `alokflows/sthira-ev-rental` main.

## Owner's next step (pending)

- The Google Sheet is still deleted. Owner must open the Apps Script editor (sthira.ev@gmail.com), run
  **`resetAndSetup()`** once (Run → Execution log → tap the logged URL), then do the Setup Wizard.
- After real data exists and any money activity: run **`runSelfAudit`** once. Note: historical
  Active-cancels from the old buggy flow (if old data is ever restored from Drive Trash) will now correctly
  count in accounting — cash totals may look higher; that's the fix, not new money.

## Known follow-ups (non-blocking)

- **LOW/perf:** `getTodayAccounting` reads the Ledger per bootstrap; `ledDataIn` param exists to thread a
  single ledger read from `getBootstrap` later.
- Not-fixing (by design): cross-operator refund drawer attribution; `_createOperator` id quirk; default
  late fee stays ₹0.

## Still deferred from the PREVIOUS batch (owner decisions pending — do not implement uninvited)

- Server-enforced booking visibility for `supViewAllBookings` (options A/B in git history of this file).
- Instant session revocation on remove/demote (session-epoch approach recommended there).
