# Sthira EV — Test Checklist (for the testing agent)

You are testing a Google Apps Script rental app after a batch of changes. Your job is simple:
run **Part A** (copy-paste commands), do **Part B** (click a few things in the browser), then send back the
**short report** in Part C. Do NOT edit any code. Do NOT deploy. Just test and report.

**Where to run:** the repo folder `sthira-ev-rental` (the folder that has `Code.gs`, `AdminJS.html`, etc.).
Open a terminal there first.

---

## PART A — Automated checks (copy this WHOLE block, paste into the terminal, press Enter)

Every line prints `PASS` or `FAIL`. You do not need to understand them — just copy the output.

```bash
echo "== A1 backend syntax =="
# Node won't --check a ".gs" file (unknown extension), so copy each to a temp ".js" first.
ok=1; tmp=$(mktemp -d); for f in *.gs; do cp "$f" "$tmp/${f%.gs}.js"; node --check "$tmp/${f%.gs}.js" 2>/dev/null || { echo "FAIL syntax: $f"; ok=0; }; done; rm -rf "$tmp"; [ $ok -eq 1 ] && echo "A1 PASS (all .gs valid)" || echo "A1 FAIL"

echo "== A2 charging-points setting exists =="
grep -qF "chargingPoints: 1" Config.gs && grep -q "chargingPoints" Config.gs && echo "A2 PASS" || echo "A2 FAIL"

echo "== A3 charging-points UI wired =="
grep -q "function openChargePicker" AdminJS.html && grep -q "function submitChargePoint" AdminJS.html && grep -q "function chargingPointsList" AdminJS.html && grep -q "function settingsAddChargingPoint" AdminJS.html && echo "A3 PASS" || echo "A3 FAIL"

echo "== A4 charging pick is REQUIRED (empty-state block) =="
grep -q "No charging points set up yet" AdminJS.html && echo "A4 PASS" || echo "A4 FAIL"

echo "== A5 toggle routes to picker when Charging =="
grep -qF "openChargePicker('yard'" AdminJS.html && grep -qF "openChargePicker('fleet'" AdminJS.html && echo "A5 PASS" || echo "A5 FAIL"

echo "== A6 card animation gating preserved =="
grep -qF "A._settleId=id; renderYard()" AdminJS.html && grep -qF "A._settleId=id; renderFleet()" AdminJS.html && echo "A6 PASS" || echo "A6 FAIL"

echo "== A7 desk PWA manifest link =="
grep -qF 'rel="manifest" href="?mode=manifest&app=admin"' Admin.html && echo "A7 PASS" || echo "A7 FAIL"

echo "== A8 desk PWA manifest served + install button =="
grep -qF "app === 'admin'" Code.gs && grep -q "Sthira Desk" Code.gs && grep -q "beforeinstallprompt" Admin.html && echo "A8 PASS" || echo "A8 FAIL"

echo "== A9 profit = booker-attributed (per-booking refund) =="
grep -q "refundByBooking" Cash.gs && grep -qF "Math.max(0, rc + dc" Cash.gs && echo "A9 PASS" || echo "A9 FAIL"

echo "== A10 no leftover profit bug (old lumped line gone) =="
grep -q "cashIn - depHeldCash - cashRefund" Cash.gs && echo "A10 FAIL (old buggy line still present)" || echo "A10 PASS"
```

**Expected:** every line ends in `PASS`. Write down any that say `FAIL`.

---

## PART B — Browser checks (open the live desk and click)

Open the desk URL and sign in with a manager PIN. Do these **in order**. For each, write PASS or FAIL.

1. **Empty-state (do this FIRST, before adding any point):** Go to the **Yard** (or **Fleet**), tap a scooter's
   **Charge / Charging** button. → You should see a message like *"No charging points set up yet — ask a
   manager to add them in Settings."* and nothing changes. **(If a picker with points already appears, skip to
   step 3 — it just means points already exist.)**

2. **Add a charging point:** Go to **Settings** → find **Charging points** → type a name like `Test Point` →
   Add. → It should appear in the list.

3. **Charge with a point (required):** Go back to Yard/Fleet, tap **Charge** on a scooter. → A popup
   *"Where is it charging?"* appears listing `Test Point`. Tap it. → The scooter's card now shows it is
   **Charging** and names the point (e.g. *"Charging · Test Point"* / *"Charging at Test Point"*).

4. **Unplug clears it:** Tap the same scooter to set it back to **Available**. → The "Charging at …" text
   disappears.

5. **Card motion (the main UX ask):** Toggle Charge on a scooter and watch the card. → It should **gently
   fade/settle** into place — NOT instantly jump or vanish. Also try **deleting a spare scooter** → the card
   should **fade out**, not disappear instantly. (Say if it feels too fast, too slow, or still jumpy.)

6. **Install as app:** On **Android Chrome or desktop Chrome**, look at the **login screen** for an
   **"Install app"** button → tap it → an install prompt should appear. *(On an iPhone there is no button —
   instead tap Share → "Add to Home Screen"; if the app icon adds and opens fullscreen, that's PASS.)*

7. **Money looks sane:** Open the **Money** view for one operator → check the **Profit** number is not
   obviously wrong (not a weird huge number, not negative for a normal operator).

---

## PART C — Send this report back (keep it to a few sentences)

Fill in and send exactly this:

```
Part A (automated): __/10 PASS. Failing ones: __________ (or "none").
Part B (browser): steps that FAILED: __________ (or "all passed").
Card motion feels: (smooth / too fast / too slow / still jumpy).
Overall verdict: (PERFECT — ship as is)  OR  (ISSUES — list them in one line).
```

That's it. Do not change any files. Just run, click, and report.
