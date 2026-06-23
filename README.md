<div align="center">

# 🛵 Sthira

### The rental desk for electric two-wheelers at Isha Yoga Center, Coimbatore

*One small, self-contained web app that takes a guest from "I'd like a scooter" to a signed
agreement and a tracked, accounted-for rental — with money that always adds up.*

**Google Apps Script · zero servers to run · self-installing · light & dark mode**

</div>

---

## What Sthira is

Sthira runs a real rental desk. A visitor opens a link, reads and accepts the rental terms, and asks for a
scooter. A staff member at the desk confirms the booking, hands over a vehicle, takes the return, and
settles the cash — and at any moment the books are provably correct down to the rupee.

It is **one Google Apps Script deployment** with two faces:

| Surface | Who | What they do |
|---|---|---|
| **Rider Agreement** — `?mode=rider` | Any guest, no login | Read the terms, accept the undertaking, enter details, request a booking |
| **Admin Desk** — the plain URL | Staff, PIN-protected | Confirm / return / cancel bookings, manage the fleet, handle cash & UPI, transfer cash, run reports, change settings |

There is no server to maintain and no database to provision. The app **builds its own Google Sheet** the
first time it runs and walks you through a short setup wizard. Copy it to a fresh Google account, deploy,
and it installs itself again — see [`PORTABILITY.md`](PORTABILITY.md).

---

## Highlights

**For guests**
- A calm, single-page rental agreement with seven clear term sections and an explicit undertaking.
- An interactive map of the permitted riding area — pinch / scroll / double-tap to zoom, drag to explore,
  eases back on its own.
- Works on a phone, respects light and dark mode, and stays completely anonymous (no Google login).

**For the desk**
- **One fast load.** The whole desk hydrates from a single bootstrap call and then renders every screen
  from cache — navigation, search, and tab switches are instant, with no per-click spinners.
- **Six views** — Overview, Bookings, Fleet, Money, Reports, Settings — each rendered from the same cache.
- **Optimistic actions** with honest in-button feedback: a button spins and disables until the server
  replies, so nothing is ever double-clicked.
- **Near-real-time sync** without any server push: a lightweight 4-second pulse re-reads only when the data
  actually changed, so a guest's booking pops onto the desk within seconds.

**For the owner**
- A bank-grade money model with an immutable ledger and a built-in three-way audit (below).
- Per-operator accounts and cash drawers, with recipient-verified cash transfers between staff.
- Confirmation emails on allocation and period reports (with CSV) to a configurable address.
- Role-aware: managers hold the powerful controls; operators get a clean, scoped view of their own day.

---

## The part we're proud of: money that always adds up

Sthira handles real cash, so the accounting is built like a bank and is **provably consistent**, governed by
three rules:

- **Total cash on hand = opening cash + all cash collected − all cash refunded − any cash given to the
  company.** Passing cash between two staff members is an *internal transfer* — it never changes the total,
  only which drawer holds it.
- **A deposit is a liability, never profit.** Profit is only the rent plus any fees actually kept.
- **The invariant: every drawer added together equals the total cash on hand.** It holds by construction.

Every money movement is written to an **append-only `Ledger`** (a passbook that is never edited or erased),
and a manager-only **self-audit** derives the cash position three independent ways — from the bookings, from
the ledger, and from the sum of all drawers — then cross-checks them, re-verifies every booking's split, and
flags any negative drawer. When all three agree, the books are correct, and the app says so.

This model was hardened against a rigorous, scripted test that pushed 120 bookings, mixed cash/UPI/split
payments, on-time and late returns, deductions, refunds, staff-to-staff transfers, and soft-deletes through
the real server functions — and it reconciles to the rupee.

---

## Tech & architecture

- **Google Apps Script** — server logic in `.gs`, the UI via HTML Service in `.html`, and a single Google
  Sheet as the datastore. No build step.
- **[clasp](https://github.com/google/clasp)** for local development and deploys.
- **One bootstrap, cached client.** `getBootstrap()` returns everything the desk needs in a single
  round-trip; the client caches it and renders all views from that cache. Heavy or rare data (analytics,
  the full ledger, audits) loads lazily in the background.
- **No WebSockets.** Apps Script can't push to the browser, so realtime is approximated by a 4-second pulse
  that only triggers a full re-read when a version counter changes.
- **Auth by PIN, not Google SSO** — the desk is a shared, guest-facing tablet and the rider form must stay
  anonymous. Each operator has their own **6-digit PIN, stored as a salted HMAC hash** (the secret lives in
  Script Properties), never sent to the client. Roles split **manager** from **operator**, enforced on the
  server (the client only hides UI cosmetically).

### Project structure

```
Code.gs        the front gate: routing, login, roles, first-run setup
Config.gs      settings, prices, dates & times
Setup.gs       builds the spreadsheet and its columns
Cottages.gs    the list of cottages a guest can pick
Bookings.gs    the life of a booking: create, confirm, return, cancel
Vehicles.gs    the scooter fleet
Returns.gs     handling a return: late fees, damage, refunds
Cash.gs        accounting, staff, and each operator's own money view
Ledger.gs      the permanent passbook, drawers, transfers, refunds, and the audit
Dashboard.gs   one "load everything" call + the overview and reports
Email.gs       the rental terms (one source of truth) + confirmation & report emails
Styles.html    the look — colour tokens, fonts, light & dark mode
RiderForm.html + RiderJS.html   the guest agreement
Admin.html + AdminJS.html       the staff desk
SharedCalc.html                 price preview shared by both forms
assets/                         the ashram map (uploaded through Settings)
```

---

## Getting started

You'll need [Node.js](https://nodejs.org) and Google's [clasp](https://github.com/google/clasp).

```bash
npm install -g @google/clasp     # install clasp
clasp login                      # sign in as the Google account that owns the app
cp .clasp.json.example .clasp.json   # then paste your Apps Script scriptId into it
clasp push --force               # send the code up
clasp redeploy <deploymentId> --description "what changed"
```

Then open both surfaces and confirm each returns **200 OK** — the plain web address is the staff desk, and
adding `?mode=rider` opens the guest form. On the very first run the app creates its Google Sheet and shows a
**setup wizard** to create the first staff member (the manager).

---

## Three things you must never change

1. The `webapp` block in `appsscript.json` (and the `Asia/Kolkata` time zone) — this keeps the public web
   address alive.
2. The spreadsheet columns are **add-only**: never move, rename, or insert one in the middle; only append new
   ones at the end.
3. The `Ledger` sheet is **add-only** too: never edit or delete a past row.

---

## Documentation

- **[AGENTS.md](AGENTS.md)** — the complete operating contract for anyone (or any AI) working on the code:
  architecture, the money model in full, conventions, the do-not-touch list, and a per-task checklist.
- **[CLAUDE.md](CLAUDE.md)** — house rules pointer for AI assistants.
- **[PORTABILITY.md](PORTABILITY.md)** — moving the app to a fresh Google account.

---

<div align="center">
<sub>Built for a real desk at Isha Yoga Center · made to feel instant, stay honest about money, and look calm.</sub>
</div>
