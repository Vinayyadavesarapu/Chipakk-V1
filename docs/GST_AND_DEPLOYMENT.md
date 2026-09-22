# GST, legal supplier, invoices and production configuration

This document is the operating manual for the GST model. It says what the system does, exactly what the business
must supply before it can go live, and how to verify it. **Nothing here has been applied to production**; every
production change goes through the approved admin / deployment process.

---

## 1. Business model

* CHIPAKK is a **trade name** of the same GST-registered legal entity as THE MARSHANS. There is **one** registration.
* The registered entity is stored **once**, in `legal_suppliers`, and both stores resolve to it. There is no second
  GSTIN, and no GSTIN, legal name, address or seller state exists anywhere in the code.
* The storefront trade name is per store: `CHIPAKK` (Store 1) and `THE MARSHANS` (Store 2). Invoices print the legal
  supplier name and the trade name together.
* Retail prices are **GST-inclusive**. GST is never added on top of a displayed price. The GST shown is the part of
  the payable amount that *is* GST.

## 2. What must be supplied (nothing is pre-filled)

| Item | Where | Notes |
|---|---|---|
| Registered legal name | Admin → Settings → **Legal supplier & GST registration** | exactly as on the registration certificate |
| GSTIN | same panel | format **and check character** are verified; the state is read from its first two digits |
| Registered address | same panel | printed on invoices |
| PIN code | same panel | optional |
| Trade name, default GST rate, GST on/off, invoice prefix | Admin → Settings → **Business & tax policies** | prefix is 1-3 characters (defaults `CHP` / `MRS`) |
| HSN code per product or category | Admin → Products / Categories | 4, 6 or 8 digits; **never guessed or defaulted** |
| GST rate per product or category (optional) | same | empty = inherit the category, then the store default rate |
| HSN / rate for custom-sticker lines | Business & tax policies | custom stickers have no catalogue record; the HSN is **unset** until an administrator enters one (no default), and without it those orders can be accepted but not invoiced (`HSN_MISSING`); the rate falls back to the store default |

### Where each configuration field is stored

| Field | Stored in | Resolved by |
|---|---|---|
| `legal_supplier_name` | `legal_suppliers.legal_name` (one row, shared) | `taxProfileService.getTaxProfile()` |
| `gstin` | `legal_suppliers.gstin` | same |
| `seller_address` | `legal_suppliers.address` | same |
| `seller_state`, `seller_state_code` | `legal_suppliers.state`, `.state_code` (derived from the GSTIN, verified) | same |
| `trade_name` | `store_settings.trade_name` per store (defaults `CHIPAKK` / `THE MARSHANS`) | same |
| `gst_enabled` | `store_settings.gst_enabled` per store | same |
| `default_gst_rate` | `store_settings.default_gst_rate` (kept identical to `gst_pct` / `gst_rate`) | same |
| `tax_pricing_mode` | `store_settings.tax_pricing_mode`, only `inclusive` is accepted | same |
| `invoice_prefix` | `store_settings.invoice_prefix` | same |

The same resolved profile feeds order creation, invoices, `/api/settings` and `/api/health`, so the copies cannot drift.

The placeholder GSTIN `07AAAAA0000A1Z5` (and a `seller_state` of "Delhi") was seeded by earlier migrations. It is
**rejected as invalid**: if it is still in `store_settings` the system treats the supplier as *not configured*.

## 3. Readiness and failing closed

`GET /api/health` (public) reports, per store and **without any identity data**: `checkout_ready`, `invoice_ready`,
`source` and the *names* of missing fields.

* **checkout_ready** = GST is off, **or** a valid GSTIN and a seller state that agrees with it exist.
  When GST is on and this is false the API **refuses to create orders (HTTP 503)**, logs the reason, and the
  storefront shows *"Checkout is temporarily unavailable while our tax details are being updated"* with Place Order
  disabled. An order written without a supplier identity would carry a wrong tax snapshot that cannot be repaired.
* **invoice_ready** = checkout_ready + legal name + address. Orders are still accepted without them (the GSTIN and
  state are enough to tax the sale); invoices cannot be issued until they are configured.

> **Deploy order (avoids a checkout outage):**
> 1. Review and apply migration 017 through the approved process (it creates `legal_suppliers`, which the Admin screen saves into).
> 2. Deploy the API. From this moment orders are refused with 503 until step 3 is done.
> 3. Enter the legal supplier in Admin (§2). Confirm `checkout_ready: true` on `/api/health`.
> 4. Deploy the storefront (it adds `tax.js`; an older storefront still works with the new API, and vice versa).
> 5. Set HSN on the catalogue (§2) and correct the shipping settings (§8).

## 4. Calculation rules (server is authoritative; the storefront runs the identical code)

`server/utils/taxCore.js` is the single implementation. `customer-workspace/js/tax.js` is a **byte-identical copy**
(the API and the storefront deploy separately); a test fails if the two differ. **Edit `taxCore.js`, then copy it.**

* Inclusive tax for an amount V at rate R: `tax = V − round(V × 100 / (100 + R))`.
  ₹90 → 14, ₹180 → 27, ₹205 → 31, ₹315 → 48, ₹365 → 56 (at 18%).
* A coupon discount reduces the taxable value; it is allocated across lines in proportion to line value.
* Tax is computed per **rate group** on the amount actually payable, then allocated back to lines and shipping with the
  largest-remainder method, so line taxes always sum **exactly** to the order tax.
* **Shipping** charged with the goods is a composite supply and takes the principal supply's rate; in a mixed-rate order
  the **highest** rate applies. *This is a legal interpretation: confirm it with your tax adviser.*
* Same state (supplier state code = place of supply) → **CGST + SGST** (SGST takes the odd unit). Different state →
  **IGST**. Place of supply is the delivery state; states are matched by GST state code, so `DL`, `Delhi`, `07`,
  `Orissa`/`Odisha` all resolve. An unrecognisable delivery state is refused (400); it is never guessed.
* **Shipping rule (unchanged):** gross merchandise subtotal < ₹300 → ₹50; ≥ ₹300 → free. Coupons never affect it.
* Only `tax_pricing_mode = inclusive` exists. An exclusive mode is deliberately not implemented; the API refuses it.
* Money units are unchanged: Store 1 whole rupees, Store 2 integer paise; Razorpay ×100 only at the gateway (Store 1).

## 5. Order snapshot (immutable, written at purchase)

`orders`: supplier legal name / trade name / GSTIN / address / state + code, place of supply (+ code), `tax_supply_type`
(`INTRA` / `INTER` / `NONE`), pricing mode, buyer GSTIN (optional `recipient_gstin` in the order payload), CGST / SGST /
IGST, and the shipping line's taxable value, rate and taxes.
`order_items`: `hsn_code`, `tax_rate`, `discount_allocated`, `taxable_value`, `tax_amount`, CGST / SGST / IGST.
Later edits to a product, a setting or the supplier record never change an existing order.

## 6. Invoices

* Number: `<PREFIX>/<YY-YY>/<6 digits>`, e.g. `CHP/26-27/000001` (16 characters, the GST Rule 46 limit). Sequential and
  gap-free per **series prefix and financial year** (1 April – 31 March, India time); a new financial year restarts at 1.
  The counter row is locked and incremented in the same transaction that inserts the invoice.
* `invoice_number`, `(series, year, sequence)` and `order_id` are unique: one invoice per order.
* Issue: `POST /api/admin/orders/:id/invoice` (admin, idempotent) · read: `GET /api/admin/orders/:id/invoice` ·
  customer: `GET /api/orders/:id/invoice` (own orders only).
* Issuing **refuses**, with a message naming what to configure: no supplier identity, cancelled / returned / refunded
  order, a line with no HSN (product names are listed), an order placed before the snapshot columns existed. If an HSN
  is configured *after* the sale, it is filled from configuration and recorded; otherwise the invoice is refused.
* An issued invoice is a snapshot; it is not regenerated from current settings.

## 7. Database

1. Read `database/migration_017_gst_legal_supplier_invoices.sql`. It is additive and idempotent, and **seeds nothing**.
2. Run `database/ops/verify_gst_configuration.sql` (SELECT only) before and after: it shows the placeholder GSTIN, any
   "Delhi" seller state, the shipping rules, and how many active products still have no HSN.
3. Migrations 005 and 016 no longer seed a GSTIN or a seller state. **If they were already executed in production those
   rows are in the database**; correct them through the Admin screens (the system already ignores the placeholder).
4. The API tolerates a database that has not run 017 (no snapshot columns are written; those orders cannot be invoiced),
   **but the supplier identity is still required**: without the `legal_suppliers` table the only source left is a valid
   legacy `gstin` in `store_settings`, and the Admin can no longer write one. Apply 017 first (see the deploy order in §3).

## 8. Shipping settings to correct in production

Production still returns: `shipping_fee = 60`, `free_shipping_threshold = 299`, `free_shipping_calculation = after_discounts`.
Approved values: fee **₹50**, threshold **₹300**, calculation **gross_subtotal**. No SQL is needed:

1. Deploy this code, sign in to the Admin.
2. Admin → **Shipping Rules** tab → *Standard Flat Delivery Fee (₹)* = **50** and *Free Delivery Order Threshold (₹)* = **300**,
   then save the store shipping settings. The save also updates the shipping rule that orders are actually charged with
   (check the rule list on the same tab afterwards).
3. The API now refuses any `free_shipping_calculation` other than `gross_subtotal`, and the public settings always report it.
4. Verify: `GET /api/settings` → `shipping_fee_rupees: 50`, `free_shipping_threshold_rupees: 300`,
   `free_shipping_calculation: "gross_subtotal"`; place a test order at ₹299 (₹50 shipping) and ₹300 (free).

## 9. Product / category images (persistent storage)

### What was observed in production (2026-09-21)

* `GET https://api.chipakk.shop/uploads/product-1789920844722-880658550.webp` answered
  `{"error":{"message":"Route not found: GET /uploads/..."}}`.
* `GET /api/health` reported `uploads: { externalDirectory: false, writable: true, fileCount: 0 }`: the server serves the
  default `server/uploads` folder **inside the deployed app**, it can write there, and it holds **no files**.
* The database references 210 upload files (200 product images, 10 category images); every one sampled returned 404,
  including the newest (uploaded 20 Sep, ~16:00-16:14 UTC).

### Root cause

The route is correct (`/uploads` is mounted before the API routes and the 404 handler, and uploads are written to the
same directory they are served from). The **files are not on the server's disk**. Uploaded files are git-ignored and, by
default, live inside the application folder, so any deployment that replaces that folder deletes them while the database
keeps pointing at `/uploads/<file>`. A missing file falls through `express.static`; before this fix that produced the
API's generic "Route not found", which looks like a routing bug but is not.

### What the code now does

* A missing upload answers `404 {"error":{"code":"UPLOAD_NOT_FOUND","message":"Upload file not found"}}` with
  `Cache-Control: no-store`, so a CDN cannot keep the 404 after the file is restored. Normal API 404s are unchanged.
* Private custom-artwork files can no longer be fetched with a percent-encoded name (`custom%2Dartwork-...` used to
  bypass the guard); uploads are served with `X-Content-Type-Options: nosniff` and SVG with a sandboxing CSP.
* With `NODE_ENV=production`, startup logs a warning and `/api/health` carries an `uploads.warning` (never a path)
  when `UPLOADS_DIR` is unset, is a relative path, or points **inside** the application folder (all of which a
  deployment can still wipe). `/api/health` reports full diagnostic indicators (`configured`, `isAbsolute`, `outsideAppDirectory`,
  `insideAppDirectory`, `exists`, `writable`, `fileCount`, `serving: true`) without exposing sensitive server paths.

### Restoring production (needs your Hostinger account; nothing here changes the database)

The database is correct and stays untouched: `products -> product_images` (CHIPAKK) and `marshans_products ->
marshans_product_images` (THE MARSHANS) keep their `/uploads/<file>` paths. Only the physical files are missing.
Helper scripts (all in `scripts/`, plain Node, no dependencies) make each step checkable:

| Script | Where it runs | What it does |
|---|---|---|
| `verify-production-uploads.js` | anywhere | **Read-only.** Reads the published catalogue for both stores and HEADs every `/uploads/<file>`; `--out missing.txt` writes the exact file names still missing. Exit 0 only when every file is served as an image. |
| `uploads-diagnostics.js` | **on the server** (SSH / hPanel terminal) | **Read-only.** Prints the app folder, home directory, the effective uploads folder (exists? writable? file count? inside the app?) and candidate folders outside the app. `--probe <dir>` / `--check <dir>` prove a folder survives a deployment. |
| `restore-uploads.js` | **on the server** | Copies image files from an extracted backup into `UPLOADS_DIR` under their **exact names**. **Dry run unless `--apply`**, never overwrites (unless `--overwrite`), never deletes, refuses a destination inside the app or a relative one, skips symlinks/unsafe names/non-images. `--manifest missing.txt` reports what the backup could not provide. |

`database/ops/list_upload_paths.sql` (**SELECT only**) lists every path the database references, including inactive
products, category media, LUMO images, banners, hero settings and private custom artwork, for **both** stores. The public
API cannot see those (and currently publishes no THE MARSHANS product images), so use it as the authoritative list.

1. **Baseline (from your computer, safe):** `node scripts/verify-production-uploads.js --out missing.txt`
   (on 2026-09-21 this reported **0 of 249 files served**).
2. **Find a persistent location (on the server):** `node scripts/uploads-diagnostics.js`. Create a folder **outside** the
   application folder, then prove it survives a deployment:
   `node scripts/uploads-diagnostics.js --probe /that/absolute/folder`, redeploy, then
   `node scripts/uploads-diagnostics.js --check /that/absolute/folder` (it must say PRESENT).
   **Only your host can tell you which folders it preserves; the probe is how you prove it. Do not guess.**
3. **Set `UPLOADS_DIR`** to that absolute path in the Node.js application's environment-variable settings in the
   Hostinger control panel (not in a committed file), and restart the app. If it is relative, unset, or inside the app
   folder, `/api/health` shows an `uploads.warning`.
4. **Restore from a Hostinger backup/snapshot:** extract the backup somewhere on the server, then
   `node scripts/restore-uploads.js --from /extracted/backup --to /that/absolute/folder --manifest missing.txt`
   (dry run), review, and repeat with `--apply`. File names are never changed. Anything reported as "NOT in the backup"
   needs an older backup or a re-upload in Admin.
5. **Verify (from anywhere):** `node scripts/verify-production-uploads.js` must exit 0, and `/api/health` must show
   `externalDirectory: true`, `insideAppDirectory: false`, `writable: true`, the right `fileCount` and no `warning`.
   Then upload a new product image and a new category image in the Admin (both stores) and confirm they load.
6. **Persistence proof:** after the next deployment or restart, `fileCount` must not drop.

Uploaded files must never be committed to Git; `server/uploads/*` stays ignored, and the fallback `server/uploads` is for
local development only.

## 10. Remaining decisions / limits

* Confirm the shipping-as-composite-supply treatment (§4) with your tax adviser.
* Set HSN on the catalogue: until then orders are accepted with an empty HSN and cannot be invoiced.
* **HSN is never defaulted, in code or in the database.** The precedence is product HSN, then category HSN, then *unset*; there is no store-level default HSN. Only the GST *rate* has a store default. If an HSN value appears anywhere in the Admin that you did not enter, it is stored data: `database/ops/verify_gst_configuration.sql` (read-only, §1b) shows exactly what is stored.
* Not implemented: credit / debit notes for returns, e-invoicing (IRN), GSTR exports, and a buyer-GSTIN field on the
  checkout form (the API accepts `recipient_gstin`; no UI collects it yet).
* The storefront checkout submits as Store 1 (whole rupees); its client-side GST preview is exact for that store.
