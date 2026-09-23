#!/usr/bin/env node
/**
 * Copy image files back into the persistent uploads directory, keeping their EXACT file names.
 *
 *   node scripts/restore-uploads.js --from <extracted-backup-folder> [--to <UPLOADS_DIR>] [--manifest missing-uploads.txt]
 *                                   [--apply] [--overwrite]
 *
 * SAFE BY DEFAULT
 *   - DRY RUN unless --apply is given: it reports what it would do and writes nothing.
 *   - --to defaults to the UPLOADS_DIR environment variable and is REQUIRED: it will not fall back to the default
 *     server/uploads folder (that is the folder that gets wiped) and it refuses a folder inside the application.
 *   - Existing files are never overwritten (unless --overwrite); nothing is ever deleted.
 *   - The backup is searched recursively (a Hostinger backup keeps folder structure). Only regular files (symlinks are
 *     ignored) with a plain file name (letters, digits, . _ -), an image extension and a size above zero are considered.
 *   - The database is not touched: paths stay /uploads/<exact file name>.
 *   - Private custom-artwork files (custom-artwork-*) are restored too; the server never serves them publicly.
 *
 * --manifest takes the file list written by verify-production-uploads.js --out (one file name per line) and reports which
 * of those names the backup contained and which are still missing afterwards.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const FROM = arg('from', null); const TO = arg('to', process.env.UPLOADS_DIR || null); const MANIFEST = arg('manifest', null);
const MANIFEST_JSON = arg('manifest-json', null);
const VERIFY_SHA = has('verify-sha256');
const APPLY = has('apply'); const OVERWRITE = has('overwrite');
const appRoot = path.resolve(__dirname, '..');
const ALLOWED = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg']);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const calculateSha256 = (p) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch (_) {
    return null;
  }
};

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
/** realpath that also works for a path that does not exist yet: resolve the nearest existing ancestor, append the rest.
 *  (Comparing a resolved path with an unresolved one broke "is X inside Y" on symlinked roots such as macOS /var -> /private/var.) */
const real = (p) => {
  const abs = path.resolve(p); const rest = [];
  let cur = abs;
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
  try { return path.join(fs.realpathSync(cur), ...rest); } catch (_) { return abs; }
};
const inside = (child, parent) => { const rel = path.relative(real(parent), real(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

if (!FROM) die('Usage: node scripts/restore-uploads.js --from <extracted-backup-folder> --to <UPLOADS_DIR> [--manifest file] [--apply] [--overwrite]');
if (!TO) die('No destination. Pass --to <absolute UPLOADS_DIR> or set UPLOADS_DIR. (It deliberately will not default to server/uploads.)');
const from = path.resolve(FROM); const to = path.resolve(TO);
if (!path.isAbsolute(TO)) die(`--to must be an ABSOLUTE path (got "${TO}").`);
if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) die(`Backup folder not found: ${from}`);
if (inside(to, appRoot)) die(`Refusing: ${to} is inside the application folder (${appRoot}); a deployment could delete it again. Choose a folder outside it.`);
if (inside(from, to) || inside(to, from)) die('Refusing: the backup folder and the destination overlap.');
if (!fs.existsSync(to)) { if (APPLY) fs.mkdirSync(to, { recursive: true }); else console.log(`(destination ${to} does not exist yet; --apply will create it)`); }
else if (!fs.statSync(to).isDirectory()) die(`${to} exists but is not a directory.`);

// ---- scan the backup ----
const found = new Map(); const skipped = { symlink: 0, badName: 0, badExt: 0, empty: 0 }; const conflicts = [];
const walk = (dir) => {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) { skipped.symlink++; continue; }
    if (e.isDirectory()) { walk(full); continue; }
    if (!e.isFile()) continue;
    if (!SAFE_NAME.test(e.name)) { skipped.badName++; continue; }
    if (!ALLOWED.has(path.extname(e.name).toLowerCase())) { skipped.badExt++; continue; }
    const size = fs.statSync(full).size; if (size === 0) { skipped.empty++; continue; }
    if (found.has(e.name)) { if (found.get(e.name).size !== size) conflicts.push(e.name); continue; } // same name twice: keep the first, flag a size clash
    found.set(e.name, { full, size });
  }
};
walk(from);

// ---- plan / apply ----
let copied = 0, existing = 0, overwritten = 0, failed = 0; const wouldCopy = [];
for (const [name, info] of [...found.entries()].sort()) {
  const dest = path.join(to, name); const exists = fs.existsSync(dest);
  if (exists && !OVERWRITE) { existing++; continue; }
  if (!APPLY) { wouldCopy.push(name); continue; }
  try {
    fs.copyFileSync(info.full, dest, OVERWRITE ? 0 : fs.constants.COPYFILE_EXCL);
    if (fs.statSync(dest).size !== info.size) throw new Error('size mismatch after copy');
    exists ? overwritten++ : copied++;
  } catch (err) { failed++; console.error(`  FAILED ${name}: ${err.message}`); }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN (nothing written; add --apply)'}: ${from}  ->  ${to}`);
console.log(`  image files found in the backup : ${found.size}`);
console.log(`  ${APPLY ? 'copied' : 'would copy'}                        : ${APPLY ? copied : wouldCopy.length}`);
console.log(`  already present (left alone)    : ${existing}`);
if (OVERWRITE) console.log(`  overwritten                     : ${overwritten}`);
console.log(`  skipped in backup               : ${skipped.symlink} symlinks, ${skipped.badName} unsafe names, ${skipped.badExt} non-image files, ${skipped.empty} empty files`);
if (conflicts.length) console.log(`  !! same name with DIFFERENT sizes in the backup (first copy kept): ${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? ' …' : ''}`);
if (failed) console.log(`  FAILED                          : ${failed}`);

if (MANIFEST) {
  if (!fs.existsSync(MANIFEST)) die(`Manifest not found: ${MANIFEST}`);
  const wanted = fs.readFileSync(MANIFEST, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const stillMissing = wanted.filter((n) => !found.has(n) && !fs.existsSync(path.join(to, n)));
  console.log(`\nManifest: ${wanted.length} file names wanted`);
  console.log(`  in the backup or already in place : ${wanted.length - stillMissing.length}`);
  console.log(`  NOT in the backup and NOT in place: ${stillMissing.length}${stillMissing.length ? '  (these need another backup or a re-upload in Admin)' : ''}`);
  stillMissing.slice(0, 15).forEach((n) => console.log(`    ${n}`));
  if (stillMissing.length > 15) console.log(`    … and ${stillMissing.length - 15} more`);
  if (stillMissing.length) process.exitCode = 1;
}

if (MANIFEST_JSON) {
  if (!fs.existsSync(MANIFEST_JSON)) die(`JSON manifest not found: ${MANIFEST_JSON}`);
  let jsonManifest;
  try {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf8'));
    jsonManifest = Array.isArray(raw) ? raw : (raw.recovery_manifest || []);
  } catch (e) {
    die(`Invalid JSON manifest: ${e.message}`);
  }
  let verifiedCount = 0;
  let hashMismatches = 0;
  for (const entry of jsonManifest) {
    const filename = entry.stored_filename || entry.original_filename || path.basename(entry.database_reference || '');
    if (!filename) continue;
    const destFile = path.join(to, filename);
    if (fs.existsSync(destFile)) {
      if (entry.sha256 && VERIFY_SHA) {
        const destHash = calculateSha256(destFile);
        if (destHash !== entry.sha256) {
          hashMismatches++;
          console.error(`  [SHA-256 MISMATCH] ${filename}: expected ${entry.sha256}, got ${destHash}`);
        } else {
          verifiedCount++;
        }
      } else {
        verifiedCount++;
      }
    }
  }
  console.log(`\nRecovery JSON Manifest: ${jsonManifest.length} entries`);
  console.log(`  verified in destination: ${verifiedCount}`);
  if (hashMismatches) {
    console.error(`  SHA-256 MISMATCHES: ${hashMismatches}`);
    process.exitCode = 1;
  }
}
if (failed) process.exitCode = 1;
