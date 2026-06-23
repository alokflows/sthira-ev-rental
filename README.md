# Sthira — EV Rental Desk

Sthira is the software that runs the electric two-wheeler rental desk at **Isha Yoga Center, Coimbatore**.
It is one small web app that does two jobs.

## What it does, in plain words

There are two doors into the same app:

1. **The guest door** (`?mode=rider`) — open to anyone, no login.
   A visitor reads the rental rules, agrees to them, types in their details, and asks to book a scooter.
   Their request lands on the desk as **Pending**.

2. **The staff door** (the plain web address) — locked with a PIN.
   The people at the desk sign in and run the day: confirm a booking and hand over a scooter, take the
   return, handle cash and UPI, move cash between staff, run reports, and change settings.

That's it. Guests ask; staff approve and manage. Everything is saved in a Google Sheet that the app sets
up for itself the first time it runs.

## The money is the important part

This app handles real cash, so the money math is built to always add up. Three simple rules keep it honest:

- **Cash in hand = the cash you started with, plus all the cash you took in, minus all the cash you gave
  back, minus any cash handed to the company.** Passing cash between two staff members doesn't change the
  total — it just changes whose pocket it's in.
- **A deposit is money you're holding for the guest, not money you earned.** Profit is only the rent and
  any fees you actually kept.
- **Every drawer added together must equal the total cash in hand.** If it ever doesn't, something is
  wrong.

A built-in **audit** checks all of this three different ways and shouts if the numbers ever disagree.
Every money move is also written into a permanent **ledger** (like a bank passbook) that is never edited or
erased — only added to. So you can always see exactly what happened and when.

## Who can do what

- **Everyone** signs in with their own **6-digit PIN**. The PIN tells the app who is standing at the desk.
  PINs are stored scrambled (hashed), never as plain numbers.
- **Operators** run bookings, the fleet, and their own cash.
- **Managers** can do everything operators can, plus the powerful things: change prices, manage staff,
  give cash to the company, refund, run the audit, send reports, and make past-dated or deleted bookings.

## How to run it

You need [Node.js](https://nodejs.org) and Google's [clasp](https://github.com/google/clasp) tool.

1. Install clasp: `npm install -g @google/clasp`
2. Sign in as the Google account that owns the app: `clasp login`
3. Make your own config: copy `.clasp.json.example` to `.clasp.json` and paste in your Apps Script
   `scriptId`.
4. Send the code up: `clasp push --force`
5. Publish it: `clasp redeploy <deploymentId> --description "what changed"`
6. Check both doors are alive — opening each web address should return **200 OK** (the plain address is the
   staff desk; add `?mode=rider` for the guest form).

The very first time it runs, the app builds its own Google Sheet and then shows a short **setup wizard** to
create the first staff member (the manager). To move it to a brand-new Google account, follow
`PORTABILITY.md`.

## Where things live in the code

```
Code.gs        the front gate: routing, login, roles, first-run setup
Config.gs      settings, prices, dates and times
Setup.gs       builds the spreadsheet and its columns
Cottages.gs    the list of cottages a guest can pick
Bookings.gs    the life of a booking: create, confirm, return, cancel
Vehicles.gs    the scooter fleet
Returns.gs     handling a return: late fees, damage, refunds
Cash.gs        accounting, staff, and each operator's own money view
Ledger.gs      the permanent passbook, drawers, transfers, refunds, and the audit
Dashboard.gs   one big "load everything" call + the overview and reports
Email.gs       the rental terms (one source of truth) + confirmation and report emails
Styles.html    the look (colours, fonts, light and dark mode)
RiderForm.html + RiderJS.html   the guest form
Admin.html + AdminJS.html       the staff desk
SharedCalc.html                 price preview shared by both forms
assets/                         the ashram map (uploaded through Settings)
```

## Three things you must never change

If you break any of these, the app stops working:

1. The `webapp` block in `appsscript.json` (and the `Asia/Kolkata` time zone) — this is what keeps the
   public web address open.
2. The spreadsheet columns are **add-only**. Never move, rename, or insert one in the middle — only add new
   ones at the end.
3. The `Ledger` sheet is **add-only** too. Never edit or delete a past row.

`CLAUDE.md` holds the full house rules for anyone (or any AI) working on the code.
