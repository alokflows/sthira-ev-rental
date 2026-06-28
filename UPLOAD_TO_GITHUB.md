# Uploading Sthira to GitHub (do this from your home machine)

This folder is already laid out as a clean repository — it just needs `git` to be
**initialised** (the org computer didn't have git installed, so this wasn't run there).

## What is already taken care of
- **`.gitignore`** already excludes the things that should NOT go public:
  - `.clasp.json` — holds your Apps Script `scriptId` (keep it private). A template,
    `.clasp.json.example`, is committed so the project stays portable.
  - `_design/` — reference design files (PDFs etc.), not part of the product.
  - `node_modules/`, `*.zip`, `*.bak`, `*.log`, OS cruft.
- So when you run `git` below, those are skipped automatically.

## Steps at home
1. Install **git** (https://git-scm.com) or **GitHub Desktop**, then open a terminal in this folder.
2. Run:
   ```
   git init -b main
   git add .
   git commit -m "Sthira EV rental desk — initial import"
   ```
3. Create a new **empty** repo on GitHub (recommend **Private** — it's a live money app).
   Do NOT let GitHub add a README/.gitignore (this folder already has them).
4. Connect and push (replace the URL with your new repo's):
   ```
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

## Notes
- If you ever use GitHub's web "upload files" (drag-drop) instead of `git`, it will NOT
  respect `.gitignore` — so first delete `.clasp.json` (you can recreate it from
  `.clasp.json.example`) and skip the `_design/` folder. Using `git` (above) handles this for you.
- The app's secrets (PIN salt, etc.) live in Apps Script **Script Properties**, not in any
  file here — nothing sensitive is in the code.
- To redeploy after editing later: `clasp push --force` then
  `clasp redeploy <deploymentId> --description "..."` (your deployment id is in `.clasp.json`
  / your notes), then check both the admin and `?mode=rider` URLs return 200.

## Tip if dragging the folder into Google Drive
Browsers sometimes skip hidden dot-files (like `.gitignore`) on folder upload. If you want a
guaranteed-complete copy, **zip the folder first** and upload the single `.zip`, then unzip at home.
