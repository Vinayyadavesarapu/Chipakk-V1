# Production Persistent UPLOADS_DIR & Historical Image Restoration Runbook

This runbook provides the verified, end-to-end operational procedure to configure persistent upload storage on the Hostinger production server, restore historical missing image files, and verify delivery via real HTTP requests without modifying any database records.

---

## 1. Zero Database Changes Commitment

- **Database paths remain unaltered**: All product image paths in the database remain exactly in their authoritative relative format: `/uploads/<filename>`.
- The Express application is mounted to serve `/uploads` from the directory configured in `process.env.UPLOADS_DIR`.
- No database tables or records are modified during this restoration.

---

## 2. Production Persistent `UPLOADS_DIR` Configuration

### Why `UPLOADS_DIR` must be external
By default, uploads fall back to `server/uploads/` inside the application tree. Whenever code is deployed (via Git pull, re-cloning, or ZIP upload), the application directory is replaced or cleaned, which deletes `server/uploads/` while MySQL database rows keep pointing to those filenames.

Setting `UPLOADS_DIR` to an absolute path **outside the application tree** (e.g. `/home/u781826529/chipakk-uploads`) ensures that uploaded files survive redeployments, restarts, and codebase upgrades indefinitely.

### Step-by-Step Configuration on Hostinger
1. **Create the external directory**:
   In Hostinger SSH terminal or File Manager:
   ```bash
   mkdir -p /home/u781826529/chipakk-uploads
   chmod 755 /home/u781826529/chipakk-uploads
   ```
2. **Set the Environment Variable**:
   In Hostinger hPanel:
   - Navigate to **Websites** → **Node.js** → **Environment Variables**
   - Add:
     - **Name**: `UPLOADS_DIR`
     - **Value**: `/home/u781826529/chipakk-uploads`
   - Save changes.
3. **Restart the Node.js Application**:
   - In hPanel, click **Restart** on the Node.js dashboard.
4. **Verify Persistent Configuration via Public Health Endpoint**:
   ```bash
   curl -s https://api.chipakk.shop/api/health
   ```
   Confirm the JSON payload returns:
   ```json
   "uploads": {
     "externalDirectory": true,
     "writable": true,
     "fileCount": <number>
   }
   ```
   If `externalDirectory` is `true`, the application is safely serving uploads from the persistent location.

---

## 3. Identification of Missing Historical Files

The complete catalog was probed using `scripts/verify-production-uploads.js`.
- **Total Published Images Probed**: 249 distinct `/uploads/product-...` image paths.
- **Currently Missing on Disk**: 249 files.
- **Full Manifest**: Saved to [`missing-uploads.txt`](file:///Users/vinayyadavesarapu/Documents/Business/Stickers/missing-uploads.txt).

### First 20 Missing Files Sample
```text
product-1789725877561-800810791.png
product-1789726464876-995418619.webp
product-1789727958288-962959691.webp
product-1789728424373-523676462.png
product-1789733328223-498993165.webp
product-1789733452247-256650534.webp
product-1789735478454-242431402.webp
product-1789735798270-719680521.webp
product-1789736188105-113187965.webp
product-1789736495620-295316880.webp
product-1789736731143-589791150.webp
product-1789736830431-171050902.webp
product-1789736903161-782775218.webp
product-1789737049102-227841956.webp
product-1789737194154-67356573.webp
product-1789737295703-208797469.webp
product-1789737425870-753215896.webp
product-1789737676445-138663869.webp
product-1789737864474-637704760.webp
product-1789737925979-283609841.webp
```

---

## 4. Step-by-Step Restoration Procedure

### Option A: Using the Automated Safe Restore Script (`scripts/restore-uploads.js`)
If you have a backup archive extracted on the server (e.g. from Hostinger Automated Backups):

1. **Dry-Run Mode (Verifies without writing)**:
   ```bash
   node scripts/restore-uploads.js --from /home/u781826529/extracted-backup/ --to /home/u781826529/chipakk-uploads --manifest missing-uploads.txt
   ```
   This reports how many matching image files exist in the backup and what will be copied.
2. **Apply Mode (Executes copy safely)**:
   ```bash
   node scripts/restore-uploads.js --from /home/u781826529/extracted-backup/ --to /home/u781826529/chipakk-uploads --manifest missing-uploads.txt --apply
   ```
   *Safety Guarantee*: Existing files are never overwritten (unless `--overwrite` is explicitly specified).

### Option B: Direct Copy via SSH / File Manager
If you have the image files locally or in a zip archive:
1. Extract or copy the images directly into `/home/u781826529/chipakk-uploads/`.
2. Ensure permissions allow the web process to read them:
   ```bash
   chmod 644 /home/u781826529/chipakk-uploads/*
   ```

---

## 5. Verification Protocol with Real HTTP Requests

Once files are restored into `UPLOADS_DIR`:

1. **Verify Serving via CLI tool**:
   ```bash
   node scripts/verify-production-uploads.js
   ```
   - Exit code `0` confirms every published image URL returns HTTP 200 with the correct image MIME type.
2. **Direct HTTP Curl Verification**:
   ```bash
   curl -I https://api.chipakk.shop/uploads/product-1789726464876-995418619.webp
   ```
   Expected response:
   ```http
   HTTP/2 200
   content-type: image/webp
   content-length: <size_in_bytes>
   cache-control: public, max-age=2592000, immutable
   x-content-type-options: nosniff
   ```
3. **Survivability Verification**:
   - Redeploy or restart the application.
   - Run `curl -I https://api.chipakk.shop/uploads/product-1789726464876-995418619.webp` again.
   - Because `/home/u781826529/chipakk-uploads` is outside the application root, the file persists across redeployments and continues returning HTTP 200.
