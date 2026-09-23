# Production Database Backup & Recovery Procedure

This runbook defines the authoritative operational procedure for backing up and restoring the MySQL production database for **CHIPAKK** (Store ID 1) and **THE MARSHANS** (Store ID 2).

---

## 1. Database Specifications

- **Database Engine**: MySQL 8.x
- **Database Name**: `u781826529_chipakk`
- **Database User**: `u781826529_chipakk`
- **Host**: `localhost` / `127.0.0.1` (on Hostinger production server)
- **CharacterSet**: `utf8mb4` / `utf8mb4_unicode_ci`
- **Store Architecture**: Shared database with multi-tenant store isolation:
  - Store 1 (`CHIPAKK`): Standard tables (`products`, `categories`, `orders`, `users`, etc.)
  - Store 2 (`THE MARSHANS`): Marshans tables (`marshans_products`, `marshans_categories`, etc.)
- **Critical Policy**: Zero table deletions, zero schema drift. Media paths stored in database are standard relative paths (`/uploads/<filename>`).

---

## 2. Infrastructure Demarcation: Manual vs. Automated

> [!IMPORTANT]
> **Hostinger Infrastructure Reality**:
> Off-site automated backups cannot be performed by git repo code alone. They require explicit configuration in Hostinger hPanel and/or Hostinger cron jobs with proper credentials.
> Do NOT assume backups are occurring unless you have verified the scheduled cron or downloaded an off-site archive.

| Capability | Provided By Repository Code | Requires Manual Hostinger Setup |
| :--- | :--- | :--- |
| Schema & Reference Verification | `scripts/media-integrity-verify.js` | None |
| Backup Script Template | `scripts/backup-db.sh` | Cron job setup in hPanel |
| Database Dump CLI | Command templates & flags | SSH or terminal execution |
| Remote Off-Site Storage | None | AWS S3 / rsync / SFTP target setup |
| phpMyAdmin / hPanel Snapshot | None | hPanel UI clicks by Administrator |

---

## 3. Backup Method A: Hostinger hPanel (UI / Manual)

This is the recommended baseline procedure prior to any deployment, migration, or critical maintenance.

### Step-by-Step UI Backup:
1. Log into **Hostinger hPanel**: `https://hpanel.hostinger.com`.
2. Navigate to **Databases** → **Management** / **phpMyAdmin**.
3. Select database `u781826529_chipakk`.
4. Click the **Export** tab:
   - **Export Method**: `Custom - display all possible options`
   - **Tables**: Ensure all tables are selected (including `products`, `orders`, `marshans_*`, `settings`, `migrations`).
   - **Output**: Compression: `gzipped` (`.sql.gz`).
   - **Format-specific options**: Check `Add DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER statement` (for clean restores).
5. Click **Export** and save the file locally into a secure, encrypted backup folder with timestamp:
   `u781826529_chipakk_backup_YYYYMMDD_HHMMSS.sql.gz`

---

## 4. Backup Method B: Command Line (SSH / Terminal)

Use this command when connected via SSH to Hostinger or when scripting maintenance.

### Standard Consistent mysqldump Command:
```bash
# Recommended options: single-transaction (no locking), utf8mb4, quick, routines, triggers
mysqldump -u u781826529_chipakk -p \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --hex-blob \
  u781826529_chipakk | gzip > /home/u781826529/backups/db/chipakk_db_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Scripted Hostinger Cron Job Setup:
1. Create backup directory outside web root:
   ```bash
   mkdir -p /home/u781826529/backups/db
   chmod 700 /home/u781826529/backups/db
   ```
2. In Hostinger hPanel → **Advanced** → **Cron Jobs**, configure a daily job (e.g., at 02:00 UTC):
   ```bash
   mysqldump -u u781826529_chipakk -p'DB_PASSWORD_HERE' --default-character-set=utf8mb4 --single-transaction --quick u781826529_chipakk | gzip > /home/u781826529/backups/db/db_$(date +\%Y\%m\%d).sql.gz && find /home/u781826529/backups/db -name "db_*.sql.gz" -mtime +14 -delete
   ```
   *(Note: Retains backups for 14 days and purges older archives)*.

---

## 5. Verification of Database Backup

A backup file must never be assumed valid without verification:
1. **Size check**:
   Verify the archive size is non-zero (typically > 500 KB depending on order and catalog history):
   ```bash
   ls -lh /home/u781826529/backups/db/
   ```
2. **Integrity test (dry-run unzip)**:
   ```bash
   gunzip -t chipakk_db_*.sql.gz
   ```
3. **Inspect SQL completeness**:
   Check for the final `Dump completed on ...` line:
   ```bash
   gzip -dc chipakk_db_*.sql.gz | tail -n 5
   ```
   Expected output:
   `-- Dump completed on YYYY-MM-DD HH:MM:SS`

---

## 6. Restoration Procedure

> [!CAUTION]
> Restoring a database replaces table data. Always create a safety snapshot of the currently running database immediately before initiating a restoration!

### Step 1: Pre-Restoration Snapshot
```bash
mysqldump -u u781826529_chipakk -p --default-character-set=utf8mb4 u781826529_chipakk | gzip > /home/u781826529/backups/db/pre_restore_safety_snapshot.sql.gz
```

### Step 2: Restore from Gzipped Dump
```bash
gzip -dc /home/u781826529/backups/db/chipakk_db_YYYYMMDD_HHMMSS.sql.gz | mysql -u u781826529_chipakk -p --default-character-set=utf8mb4 u781826529_chipakk
```

### Step 3: Post-Restoration Media Integrity Check
Run the media integrity verifier to confirm all DB rows match the media storage:
```bash
node scripts/media-integrity-verify.js --dir /home/u781826529/chipakk-uploads
```
Ensure `missing_files_count` is 0.
