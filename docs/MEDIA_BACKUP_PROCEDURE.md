# Production Media & Uploads Backup & Recovery Procedure

This runbook defines the authoritative operational procedure for backing up, verifying, and restoring uploaded media for **CHIPAKK** (Store ID 1) and **THE MARSHANS** (Store ID 2).

---

## 1. Media Architecture Specifications

- **Canonical Production Upload Directory**:
  `/home/u781826529/chipakk-uploads/`
- **Application Tree Policy**:
  Uploads must **NEVER** live inside the deployment directory (`/home/u781826529/domains/api.chipakk.shop/public_html/...` or similar). Any deployment wipe must not touch `/home/u781826529/chipakk-uploads/`.
- **Environment Variable**:
  `UPLOADS_DIR=/home/u781826529/chipakk-uploads` (configured in Hostinger Node.js app environment).
- **Public URL Mapping**:
  Requests to `https://api.chipakk.shop/uploads/<filename>` are served by Express directly from `process.env.UPLOADS_DIR`.
- **Storefront Isolation**:
  Store 1 and Store 2 share the canonical directory and `/uploads/` URL space, ensuring seamless multi-store asset delivery while database records maintain strict store tenancy.

---

## 2. Infrastructure Demarcation: Manual vs. Automated

> [!IMPORTANT]
> **Hostinger Infrastructure Reality**:
> Automated off-site replication to external cloud storage (e.g. AWS S3, Google Cloud Storage, or an external SFTP server) cannot be performed purely within git repository code without server-level credentials and scheduler configuration.
> Repository tools provide integrity audit, manifest extraction, and safe restore execution, but regular archive replication requires Hostinger cron/SSH configuration.

| Capability | Repository Tooling | Requires Manual Hostinger Setup |
| :--- | :--- | :--- |
| Media Audit (Missing/Orphan/0-byte/Collisions) | `node scripts/media-integrity-verify.js` | None |
| Recovery Manifest Generation (JSON/CSV) | `node scripts/media-integrity-verify.js` | None |
| Safe Restoration (Dry-run / SHA-256 checks) | `node scripts/restore-uploads.js` | None |
| Persistence Health Diagnostic | `curl https://api.chipakk.shop/api/health` | None |
| Periodic Tarball Creation | Shell command template | Hostinger cron job |
| Remote Off-Site Transfer (SFTP/rsync) | Command templates | SSH keys & remote destination credentials |

---

## 3. Media Integrity Verification & Recovery Manifest

Before creating a backup or after performing a restore, run the integrity verification script.

### Command:
```bash
node scripts/media-integrity-verify.js \
  --dir /home/u781826529/chipakk-uploads \
  --out-json /home/u781826529/backups/media/manifest_$(date +%Y%m%d).json \
  --out-csv /home/u781826529/backups/media/manifest_$(date +%Y%m%d).csv \
  --out-missing /home/u781826529/backups/media/missing_$(date +%Y%m%d).txt
```

### Audited Integrity Criteria:
1. **DB-Referenced Files**: Gathers every image reference across all tables (`products`, `categories`, `marshans_products`, `marshans_categories`, `banners`, `campaigns`, `order_item_custom_designs`).
2. **Missing Files**: Catalog references whose physical files do not exist in the upload directory.
3. **Orphan Files**: Physical files residing on disk that have no active references in the database.
4. **Zero-Byte Files**: Corrupted or empty 0-byte files that fail image decoding.
5. **Duplicate Hashes**: SHA-256 collisions identifying identical content stored under multiple filenames.
6. **Extension Validation**: Verifies filenames only have approved extensions (`.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`).
7. **Recovery Manifest Schema**: Every entry contains:
   - `database_reference` (e.g. `/uploads/product-1789726464876-995418619.webp`)
   - `original_filename`
   - `stored_filename`
   - `path`
   - `size`
   - `sha256`
   - `entity_type` (`product`, `category`, `custom_artwork`, etc.)
   - `entity_id`
   - `store_id` (1 or 2)

---

## 4. Media Backup Procedure

### Step 1: Create Backup Directory
```bash
mkdir -p /home/u781826529/backups/media
chmod 700 /home/u781826529/backups/media
```

### Step 2: Generate Tarball Archive with Checksums
```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cd /home/u781826529/chipakk-uploads

# 1. Generate SHA-256 checksums of all existing files
sha256sum * > /home/u781826529/backups/media/checksums_${TIMESTAMP}.sha256 2>/dev/null || true

# 2. Create compressed tarball
tar -czf /home/u781826529/backups/media/chipakk_uploads_${TIMESTAMP}.tar.gz .

# 3. Generate SHA-256 of the backup archive itself
sha256sum /home/u781826529/backups/media/chipakk_uploads_${TIMESTAMP}.tar.gz > /home/u781826529/backups/media/chipakk_uploads_${TIMESTAMP}.tar.gz.sha256
```

### Step 3: Off-Site Copy (Manual Hostinger Setup)
Copy the archive off Hostinger to an external storage server via `rsync` or `scp`:
```bash
rsync -avz -e "ssh -p 22" /home/u781826529/backups/media/chipakk_uploads_${TIMESTAMP}.tar.gz backupuser@remote-storage.example.com:/backups/chipakk/media/
```

### Hostinger Cron Job Setup:
In Hostinger hPanel → **Cron Jobs**, configure a weekly job:
```bash
cd /home/u781826529/chipakk-uploads && tar -czf /home/u781826529/backups/media/uploads_$(date +\%Y\%m\%d).tar.gz . && find /home/u781826529/backups/media -name "uploads_*.tar.gz" -mtime +30 -delete
```

---

## 5. Safe Restoration Procedure

Use the hardened restoration utility `scripts/restore-uploads.js`.

### Key Safety Guarantees:
- **Never writes inside application tree**: Destination must be external (e.g. `/home/u781826529/chipakk-uploads`).
- **Never deletes existing destination files**: Adding/restoring files never deletes existing media.
- **Dry-run by default**: Without `--apply`, it only inspects and reports what would be copied.
- **SHA-256 Verification**: When combined with `--verify-sha256` and `--manifest-json`, it validates byte-for-byte integrity.

### Step-by-Step Restoration:

#### Step 1: Unpack Backup Archive to a Temporary Staging Directory
```bash
mkdir -p /home/u781826529/staging/uploads_restore
tar -xzf /home/u781826529/backups/media/chipakk_uploads_YYYYMMDD_HHMMSS.tar.gz -C /home/u781826529/staging/uploads_restore
```

#### Step 2: Perform Dry-Run
```bash
node scripts/restore-uploads.js \
  --from /home/u781826529/staging/uploads_restore \
  --to /home/u781826529/chipakk-uploads
```
Review output. Confirm files found, files to copy, and zero destructive warnings.

#### Step 3: Apply Restoration
```bash
node scripts/restore-uploads.js \
  --from /home/u781826529/staging/uploads_restore \
  --to /home/u781826529/chipakk-uploads \
  --apply
```

#### Step 4: Validate with Manifest and Checksums
```bash
node scripts/restore-uploads.js \
  --from /home/u781826529/staging/uploads_restore \
  --to /home/u781826529/chipakk-uploads \
  --manifest-json /home/u781826529/backups/media/manifest_YYYYMMDD.json \
  --verify-sha256
```

#### Step 5: Clean Up Staging
```bash
rm -rf /home/u781826529/staging/uploads_restore
```

#### Step 6: Post-Restore Verification via Public HTTP
Test image delivery over HTTPS:
```bash
node scripts/verify-production-uploads.js --api https://api.chipakk.shop/api
```
All returned image assets must return HTTP 200 with matching Content-Type headers (`image/webp`, `image/png`, etc.).
