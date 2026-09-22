#!/usr/bin/env node
/**
 * Run this ON THE SERVER (Hostinger SSH / hPanel terminal), from the application folder:
 *
 *   node scripts/uploads-diagnostics.js
 *   node scripts/uploads-diagnostics.js --probe /absolute/candidate/dir      # writes ONE small sentinel file there
 *   node scripts/uploads-diagnostics.js --check /absolute/candidate/dir      # after a redeploy: is the sentinel still there?
 *
 * It reports FACTS about this machine so you can pick a persistent uploads directory. It does not create the uploads
 * directory, does not touch the database and never deletes anything. The only write is the sentinel file, and only when
 * you pass --probe. It cannot know which folders your host preserves across deployments: --probe / --check is how you PROVE it.
 *
 * NOTE: a terminal session does not necessarily carry the same environment variables as the Node.js application
 * (variables set in the hosting panel apply to the app process). Compare with GET /api/health, which reports what the
 * running app actually uses.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const flag = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : null; };
const SENTINEL = '.chipakk-persistence-probe';
const appRoot = path.resolve(__dirname, '..');
/** realpath that also works for a path that does not exist yet: resolve the nearest existing ancestor, append the rest.
 *  (Comparing a resolved path with an unresolved one broke "is X inside Y" on symlinked roots such as macOS /var -> /private/var.) */
const real = (p) => {
  const abs = path.resolve(p); const rest = [];
  let cur = abs;
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
  try { return path.join(fs.realpathSync(cur), ...rest); } catch (_) { return abs; }
};
const inside = (child, parent) => { const rel = path.relative(real(parent), real(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const stat = (p) => { try { return fs.statSync(p); } catch (_) { return null; } };
const canWrite = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch (_) { return false; } };
const count = (p) => { try { return fs.readdirSync(p).filter((f) => !f.startsWith('.')).length; } catch (_) { return null; } };
const line = (k, v) => console.log(`  ${k.padEnd(34)} ${v}`);
const free = (p) => { try { const s = fs.statfsSync(p); return `${(s.bavail * s.bsize / 1024 / 1024 / 1024).toFixed(1)} GB free`; } catch (_) { return 'n/a'; } };

const probe = flag('probe'); const check = flag('check');
if (probe && typeof probe === 'string') {
  const dir = path.resolve(probe);
  if (!path.isAbsolute(probe)) { console.error('Give an ABSOLUTE path.'); process.exit(2); }
  if (inside(dir, appRoot)) console.warn(`WARNING: ${dir} is INSIDE the application folder; a deployment may delete it. Pick a folder outside ${appRoot}.`);
  if (!stat(dir)) { console.error(`${dir} does not exist. Create it first (File Manager / mkdir), then run --probe again.`); process.exit(2); }
  if (!canWrite(dir)) { console.error(`${dir} is not writable by this user.`); process.exit(2); }
  fs.writeFileSync(path.join(dir, SENTINEL), `chipakk persistence probe written ${new Date().toISOString()} by ${os.userInfo().username}\n`);
  console.log(`Wrote ${path.join(dir, SENTINEL)}\nNow REDEPLOY (or restart) the application, then run:\n  node scripts/uploads-diagnostics.js --check ${dir}\nIf the file is gone, that directory is NOT persistent: choose another.`);
  process.exit(0);
}
if (check && typeof check === 'string') {
  const f = path.join(path.resolve(check), SENTINEL); const st = stat(f);
  if (!st) { console.log(`MISSING: ${f}\nThe directory (or the file) did NOT survive. It is not a safe uploads location.`); process.exit(1); }
  console.log(`PRESENT: ${f}\n${fs.readFileSync(f, 'utf8').trim()}\nAge: ${Math.round((Date.now() - st.mtimeMs) / 60000)} minutes. If a deployment happened since it was written, this location IS persistent.`);
  process.exit(0);
}

console.log('CHIPAKK uploads diagnostics (read-only)\n');
console.log('Environment');
line('Node.js', process.version); line('user', os.userInfo().username); line('working directory', process.cwd());
line('application folder', appRoot); line('home directory', os.homedir());

const configured = process.env.UPLOADS_DIR && process.env.UPLOADS_DIR.trim();
const effective = configured ? path.resolve(configured) : path.join(appRoot, 'server', 'uploads');
console.log('\nUploads directory the app would use (same rule as server/config/uploads.js)');
line('UPLOADS_DIR in this shell', configured ? configured : '(not set)');
line('effective directory', effective);
const st = stat(effective);
line('exists', st ? (st.isDirectory() ? 'yes' : 'yes, but it is NOT a directory') : 'no');
if (st && st.isDirectory()) { line('writable by this user', canWrite(effective) ? 'yes' : 'NO'); line('files in it', String(count(effective))); line('disk', free(effective)); }
const isIn = inside(effective, appRoot);
line('inside the application folder', isIn ? 'YES  -> a redeploy that replaces the app folder deletes it' : 'no');
if (!configured) console.log('\n  !! UPLOADS_DIR is not set in THIS shell. If it is set in the hosting panel, /api/health will show externalDirectory: true.');
if (configured && !path.isAbsolute(configured)) console.log('\n  !! UPLOADS_DIR is not an absolute path.');
if (configured && isIn) console.log('\n  !! UPLOADS_DIR is INSIDE the application folder; that defeats the purpose.');

console.log('\nCandidate locations OUTSIDE the application folder (facts, not a promise of persistence)');
const seen = new Set();
for (const [label, dir] of [['sibling of the application folder', path.join(path.dirname(appRoot), 'chipakk-uploads')], ['inside your home directory', path.join(os.homedir(), 'chipakk-uploads')]]) {
  if (seen.has(dir)) continue; seen.add(dir);
  const s = stat(dir); const parent = path.dirname(dir);
  line(label, dir);
  console.log(`      ${s ? (s.isDirectory() ? `exists, writable=${canWrite(dir)}, files=${count(dir)}` : 'exists but is not a directory') : `does not exist yet; parent ${canWrite(parent) ? 'is writable, you can create it' : 'is NOT writable by this user'}`}; outside app folder: ${!inside(dir, appRoot)}`);
}
console.log(`
Next steps
  1. Create the folder you choose (File Manager or mkdir), outside ${appRoot}.
  2. Prove it survives a deployment:  node scripts/uploads-diagnostics.js --probe <that folder>   ... redeploy ...   --check <that folder>
  3. Set UPLOADS_DIR to that ABSOLUTE path in the hosting panel's environment variables for the Node.js app, restart it.
  4. Restore the images:  node scripts/restore-uploads.js --from <extracted backup> --to <that folder>   (dry run first)
  5. Verify from anywhere:  node scripts/verify-production-uploads.js
`);
