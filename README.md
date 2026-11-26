# SN Enterprises – Inventory Tracker

Stock tracker for a sportswear wholesale business. A static web app (GitHub Pages) talks to a Google Apps Script web app, which stores everything in a Google Sheet you own.

```
Browser (index.html on GitHub Pages)  ──POST──▶  Apps Script Web app (Code.gs)  ──▶  Google Sheet
```

## What it does

- **Items** – one SKU per item × size × colour; a generator creates all variants at once (e.g. Polo T-Shirt × S–XXL × Navy/Black). Stores HSN, GST %, cost rate, sale rate, reorder level.
- **New entry** – pick the type (sale, purchase, returns, opening, adjustments), choose an item and type quantities straight into a **size × colour grid**, or search a SKU. Many lines per invoice; rates pre-fill from the item master; stepper buttons and a sticky Save bar for one-handed phone use.
- **Stock** – on-hand per SKU, weighted-average cost, value, status (OK / LOW / OUT / NOT STOCKED). Search, filter chips, CSV export. Tap any SKU for its history with Sell / Receive shortcuts.
- **Movements** – full ledger. Entries are never deleted: *Cancel* keeps the row, marks it CANCELLED with the reason and time, and removes it from stock.
- **Reports** – HSN-wise stock summary, category-wise value, reorder list; print or CSV.
- **Safety** – whole-number quantities, no negative stock (set `ALLOW_NEGATIVE_STOCK = true` in `Code.gs` to relax), writes are locked so several people can enter at once, and a retried save can never double-post (every entry has a unique ID).

**Works on phone, tablet and computer:** bottom tab bar and card-style lists on phones, full tables on larger screens, large touch targets, light/dark mode, and it can be installed to the home screen (manifest + icons included).

Without a connection the app runs on **demo data** stored only in your browser, so you can try it first.

## Set-up (about 10 minutes)

### 1. Google Sheet + backend
1. Create a new Google Sheet (e.g. "SN Inventory").
2. **Extensions → Apps Script**. Delete the sample code and paste the whole of `Code.gs`. Save.
3. Select the function **`setup`** and click **Run**. Approve the permission prompt. This creates the `Items`, `Movements` and `Stock` tabs and an access key. (Reload the sheet; a menu **SN Inventory → Show access key** appears.)
4. **Deploy → New deployment → type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy the **Web app URL** (ends in `/exec`).

   "Anyone" only means the URL is reachable; every request is rejected unless it carries the access key.
5. After any later change to `Code.gs`, use **Deploy → Manage deployments → Edit → New version**, otherwise the live URL keeps running the old code.

### 2. Host the web app on GitHub Pages
1. Push this folder (all files, including the icons and `manifest.webmanifest`) to a GitHub repository.
2. Repo **Settings → Pages → Deploy from a branch → `main` / root**.
3. Open `https://<your-user>.github.io/<repo>/`.

### 3. Sign in on each device
The Web app URL is already built into `index.html` (the `BAKED_URL` constant near the top of the script), so nobody has to paste it. The first time the app opens on a phone or computer it asks for the **access key** only (**SN Inventory → Show access key** in the Google Sheet). The key is stored only on that device; **Settings → Sign out** removes it.

If you ever redeploy as a *new* deployment, the URL changes: update `BAKED_URL` in `index.html`. A new *version* of the same deployment keeps the URL.

Open `index.html?demo` to practise on sample data without touching the real sheet.

> The URL is visible to anyone who views the page source, as with any static site. It cannot be used without the access key, so keep the key out of the repository and share it only with your staff.

## Notes
- The `Stock` tab in the Sheet is live formulas (on-hand and reorder status); the app computes the same numbers itself.
- Valuation = on-hand × weighted-average rate of inward entries (opening, purchase, adjustment +), falling back to the item's cost rate.
- HSN suggestions in the form are hints only; confirm HSN and GST rates for your products.
- Rotate the key: delete the `ACCESS_KEY` Script Property, run `setup` again, and update the key in Settings.
- Don't edit the `Movements` sheet by hand; use *Cancel* in the app so the audit trail stays intact.
