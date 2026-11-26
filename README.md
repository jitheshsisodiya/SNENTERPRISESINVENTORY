# SN Enterprises – Inventory Tracker

Stock tracker for a sportswear wholesale business. A static web app (GitHub Pages) talks to a Google Apps Script web app, which reads and writes your own Google Sheet.

```
Browser (index.html on GitHub Pages)  ──POST──▶  Apps Script Web app (Code.gs)  ──▶  Google Sheet
```

## The Google Sheet (3 tabs)

| Tab | What it holds |
|---|---|
| **Login** | `Login Name`, `Password`, `Type of access`. Access is **Super admin access** or **Edit access** (anything else, or blank, = view only). |
| **Stock Movement** | One row per Item × Colour × Size with **Qty = opening stock**. Columns E–G (In / Out / Closing) are formulas filled by `setup`. Rates, HSN, GST, reorder level, category and Active are in columns H–N. |
| **Inward/ Outward** | The ledger: `Type`, `Date`, `Item`, `Colour`, `Size`, `Qty`, `Entry By`, `Date & Time`, then party, ref, movement type, rate, entry ID and cancel details. The app adds a row for every line entered. |

Closing stock = opening Qty + inward − outward. Entries are never deleted; a cancelled entry stays in the ledger marked `CANCELLED` and stops counting.

## Who can do what

| | Super admin | Edit access | Anyone else |
|---|---|---|---|
| See stock, movements, reports | ✓ | ✓ | ✓ |
| Record inward / outward entries | ✓ | ✓ | – |
| Add / edit items, opening stock, rates | ✓ | – | – |
| Cancel an entry | ✓ | – | – |

Rules are enforced in `Code.gs` on the server, not just by hiding buttons in the app. Every ledger row records who entered it (`Entry By`) and when.

## Public live stock
Anyone who opens the website sees the **Live stock** page without signing in: each item as a register (colours × sizes with totals) of quantities in stock, searchable, refreshed automatically every minute. It shows quantities only. Rates, HSN/GST, valuation, parties, user names and history are never sent to the public page. Staff use **Staff sign in** (top right) to enter stock or see the rest. If you do not want stock levels public, remove the `publicStock` line in `doPost` in `Code.gs` and redeploy.

## Set-up

### 1. Backend
1. Open your Google Sheet → **Extensions → Apps Script**. Replace the code with the whole of `Code.gs` and save.
2. Run **`setup`** once and approve the permissions. It adds any missing headers, the formulas in Stock Movement E–G, and a signing secret.
3. Reload the sheet. In the new **SN Inventory** menu run **Hash all passwords now**. This replaces every plain-text password in the Login tab with a salted hash. (Passwords typed later are also converted automatically the first time that person signs in.) To reset someone's password, type a new plain password in the sheet; it is hashed on their next sign-in.
4. **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.** This keeps the same Web app URL. (A brand-new deployment gives a new URL, which would then have to be changed in `index.html`, constant `BAKED_URL`.) Settings: Execute as **Me**, access **Anyone**.

"Anyone" only makes the URL reachable. Everything except the public Live stock page needs a valid user name and password; sign-ins last 14 days.

### 2. Website
1. Push these files to the GitHub repository.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Open `https://<user>.github.io/<repo>/`, sign in, and (on a phone) use the browser menu → **Add to Home screen**.

## Using it
- **New entry** – pick Sale / Purchase / Returns / Adjustment, choose an item, type quantities into the **size × colour grid** (or search), add party and invoice no., **Save**. Stock cannot go below zero.
- **Register** – the paper stock register on screen: pick an item, see colours down the side and sizes across with row, column and grand totals. Amber = at or below reorder level, red = out of stock. Tap a number for its history; Print or CSV. Colours appear in the order listed in the Stock Movement tab.
- **Stock** – on hand, status (OK / LOW / OUT / NOT STOCKED), weighted-average cost and value. Tap a row for its history.
- **Items** (Super admin) – add an item with all its sizes and colours at once. Short codes (e.g. `DOTKNIT-S-YEL`) are generated automatically. Rates, opening stock, reorder level and Active can be edited.
- **Reports** – HSN-wise summary, category-wise value, reorder list; print or CSV.
- **Account** – who you are, your access level, sign out.

## Product photos
Photos appear as a round picture next to the colour name on the Live stock page and in the Register; tap the colour to see the full photo. Photos live in the `photos` folder and are listed in `config.js` under `photos`, one line per item + colour, for example `'dotknit|yellow': 'photos/dotknit-yellow.jpg'` (as `item|colour`; capitals, spaces and dashes are ignored, so “DOT KNIT” matches `dotknit`). To add one: shrink the picture to about 900 px wide, put it in `photos`, add the line, push to GitHub. Colours without a photo show a plain colour circle.

## Good to know
- **Item, Colour and Size link the ledger to stock by name** (spelling and spacing, not case). If you rename an item in Stock Movement, old ledger rows stop matching. The app shows a red warning to the Super admin when ledger rows match no item. Prefer adding a new row over renaming.
- Don't type into Stock Movement columns E–G; they are formulas.
- You can still type ledger rows by hand in the *Inward/ Outward* tab (Type = Inward or Outward). They count toward stock but are not blocked from going negative.
- Valuation = on-hand × weighted-average cost (opening stock at the item's cost rate plus purchases at their rates).
- `ALLOW_NEGATIVE_STOCK` in `Code.gs` can be set to `true` to allow selling below zero.
- **SN Inventory → Sign out everyone** invalidates all sign-ins at once (use it if a phone is lost).
- Open `index.html?demo` to practise on sample data without touching the real sheet.
- The Web app address lives in `config.js`. It is visible to anyone who looks, as with any website, and cannot be used without a valid sign-in. To keep it out of the site entirely, see **SECURITY.md** (optional free proxy).
