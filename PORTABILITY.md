# 📦 Moving Sthira to your real (production) Google account

This dev account is your test bed. When you're ready to go live on the real account, you do **not**
rebuild anything — the code installs itself. Here's exactly how.

## Why it's clean automatically

- The app **creates its own Google Sheet** the first time it runs in an account, with empty tables and
  sensible defaults (PIN, rates, a starter cottage list). **No test bookings, riders, or scooters are
  ever copied or created.**
- The link to this dev account's spreadsheet is stored in the script's private properties, and those
  **do not travel** when the code is copied. So a fresh account starts with a brand-new, empty sheet.
- On first open, the **Setup Wizard** appears (because the PIN is still the default) and walks you
  through setting your real PIN, rates, deposit, late fee, opening cash, and manager label.

So: copy the code → deploy → open it once → set your PIN in the wizard → you have a clean, live system.

---

## ✅ The one-click way (recommended — no tools needed)

1. **On THIS dev account:** open <https://script.google.com> → open the **Sthira** project →
   click the project name (top-left) → **Share** → add your **production Gmail** as **Editor**.
2. **Log in to your production account** → open <https://script.google.com> → open the shared **Sthira**
   project → top-right **⋮ / Overview** → **Make a copy**. (Or `Overview ▸ ⋮ ▸ Make a copy`.)
   You now own an independent copy — nothing links back to the dev account.
3. In the copy: **Deploy ▸ New deployment ▸** gear ▸ **Web app**.
   - *Execute as:* **Me** (your production account)
   - *Who has access:* **Anyone**
   - **Deploy**, then **Authorize access** and allow the permissions (Sheets, Drive, Gmail — needed for
     the data sheet, the map image, and confirmation emails).
4. Copy the **Web app URL** it gives you. That's your live desk.
   - **Admin desk:** the URL itself.
   - **Guest form:** the same URL with `?mode=rider` on the end (also available as a copy/QR link inside
     Settings → "Guest form & data").
5. Open the admin URL once → the **Setup Wizard** appears → set your PIN and rates → done. ✅

> After step 3 you can remove the dev account's access from the copy (it's fully independent now), and
> remove the production account's access to the dev project from step 1.

---

## 🛠️ The developer way (clasp — optional, if you prefer the terminal)

On the production account's machine:

```powershell
clasp logout                       # drop the dev login
clasp login                        # log in as the PRODUCTION account (opens a browser)
# in a fresh empty folder, copy in all the .gs / .html files + appsscript.json + .claspignore
clasp create --type webapp --title "Sthira"
clasp push --force
clasp deploy --description "Sthira production"
```

Then open the project (`clasp open-script`), and under **Deploy ▸ Manage deployments** confirm the web
app is *Execute as: Me*, *Access: Anyone*. Authorize on first run. Same wizard flow as above.

---

## After go-live

- **Settings** is your control panel: pricing, PIN, operators, cottages, the confirmation-email toggle +
  map upload + test send, the shareable guest link, and a button to open the underlying spreadsheet.
- **Upload your map** in Settings → Confirmation email → it shows on the guest form *and* embeds in the
  email. (`assets/ashram_map.png` in this folder is your source image to edit/upload.)
- Updating the live app later = edit files → `clasp push --force` → redeploy to the **same** deployment
  id so the URL never changes (see `HANDOFF.md` for the exact command on the dev account; the production
  copy has its own id under Deploy ▸ Manage deployments).
