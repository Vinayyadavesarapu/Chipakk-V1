/**
 * Operational tooling for the persistent uploads directory. Every test runs the REAL script as a child process
 * against real temp directories (and, for the verifier, a stub HTTP API), exactly as an operator would.
 *
 *   scripts/verify-production-uploads.js   read-only verifier (GET catalogue + HEAD files)
 *   scripts/restore-uploads.js             safe restore helper (dry run by default, never overwrites/deletes)
 *   scripts/uploads-diagnostics.js         facts about the server + persistence probe
 *   server/config/uploads.js               warnings for an unset / relative / inside-the-app UPLOADS_DIR
 *   database/ops/list_upload_paths.sql     read-only list of every path the database references
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = (f) => path.join(ROOT, 'scripts', f);
const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.message}`); }
}
const run = (script, args = [], env = {}, cwd) => new Promise((resolve) => {
  const c = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, cwd: cwd || ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d)); c.on('exit', (code) => resolve({ code, out, err, all: out + err }));
});
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `chipakk-${label}-`));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** A throwaway "deployed app": copies of the scripts + the uploads config under a temp root, so every script computes ITS
 *  application folder from there. "Inside the app" is then a temp directory: a broken safety guard can never write into the real repo. */
function fakeApp() {
  const root = tmp('app'); fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'server', 'config'), { recursive: true });
  for (const f of ['restore-uploads.js', 'uploads-diagnostics.js', 'verify-production-uploads.js']) fs.copyFileSync(S(f), path.join(root, 'scripts', f));
  fs.copyFileSync(path.join(ROOT, 'server/config/uploads.js'), path.join(root, 'server/config/uploads.js'));
  return { root, script: (f) => path.join(root, 'scripts', f), config: path.join(root, 'server/config/uploads.js'), inside: path.join(root, 'server', 'uploads') };
}

/** Stub of the public API + /uploads, recording every request method so read-only can be asserted. */
function stubApi({ files, products1 = 0, products2 = 0, categories2Media = null, nonImage = [], failing = false }) {
  const methods = new Set(); const seenPages = [];
  const productsFor = (store, n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, images: [{ image_url: `/uploads/s${store}-p${i + 1}.webp` }], primary_image_url: `/uploads/s${store}-p${i + 1}.webp` }));
  const server = http.createServer((req, res) => {
    methods.add(req.method); const u = new URL(req.url, 'http://x'); const store = Number(req.headers['x-store-id']) || 1;
    if (failing) { res.statusCode = 500; return res.end('{}'); }
    if (u.pathname === '/api/products') {
      const all = productsFor(store, store === 1 ? products1 : products2); const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 100); const off = Number(u.searchParams.get('offset')) || 0; seenPages.push(`${store}:${off}`);
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ success: true, data: { total: all.length, limit, offset: off, products: all.slice(off, off + limit) } }));
    }
    if (u.pathname === '/api/categories') {
      const cats = store === 1 ? [{ id: 1, image_url: '/uploads/c1.png', media: { hero_light: '/uploads/c1-hero.png', hero_dark: null } }] : [{ id: 9, image_url: null, media: categories2Media || {} }];
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ success: true, data: cats }));
    }
    if (u.pathname.startsWith('/uploads/')) {
      const name = decodeURIComponent(u.pathname.slice('/uploads/'.length));
      if (nonImage.includes(name)) { res.setHeader('content-type', 'application/json'); return res.end('{}'); }
      if (files.has(name)) { res.setHeader('content-type', /\.webp$/.test(name) ? 'image/webp' : 'image/png'); return req.method === 'HEAD' ? res.end() : res.end(files.get(name)); }
      res.statusCode = 404; res.setHeader('content-type', 'application/json'); return res.end('{"error":{"code":"UPLOAD_NOT_FOUND"}}');
    }
    res.statusCode = 404; res.end('{}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, methods, seenPages, close: () => server.close() })));
}

(async () => {
  /* ------------------------------------------------------------------ verifier */
  await test('VERIFY', 'all files served -> exit 0; it paginates past 100 products and reads category media; both stores; strictly read-only (GET/HEAD only)', async () => {
    const files = new Map(); for (let i = 1; i <= 230; i++) files.set(`s1-p${i}.webp`, WEBP); for (let i = 1; i <= 5; i++) files.set(`s2-p${i}.webp`, WEBP);
    files.set('c1.png', PNG); files.set('c1-hero.png', PNG); files.set('m-hero.png', PNG);
    const api = await stubApi({ files, products1: 230, products2: 5, categories2Media: { hero_light: '/uploads/m-hero.png' } });
    try {
      const r = await run(S('verify-production-uploads.js'), ['--api', api.url]);
      assert.strictEqual(r.code, 0, r.all); assert.ok(/Store 1 CHIPAKK: 230 products \(API total 230\)/.test(r.out) && /Store 2 THE MARSHANS: 5 products/.test(r.out), r.out);
      assert.ok(/RESULT: 238\/238 files are served as images/.test(r.out), r.out);
      assert.ok(api.seenPages.includes('1:0') && api.seenPages.includes('1:100') && api.seenPages.includes('1:200'), `pages requested: ${api.seenPages}`);
      assert.deepStrictEqual([...api.methods].sort(), ['GET', 'HEAD'], 'the verifier must never send anything but GET and HEAD');
      assert.ok(/THE MARSHANS category\s+served:\s+1/.test(r.out), 'MARSHANS category media is checked too');
    } finally { api.close(); }
  });
  await test('VERIFY', 'missing files -> exit 1, exact file names written to --out (incl. a product on page 3 and category media); a 200 that is not an image is bad', async () => {
    const files = new Map(); for (let i = 1; i <= 230; i++) files.set(`s1-p${i}.webp`, WEBP); files.set('c1.png', PNG);
    files.delete('s1-p7.webp'); files.delete('s1-p225.webp'); // c1-hero.png was never created either
    const api = await stubApi({ files, products1: 230, nonImage: ['s1-p9.webp'] }); const out = path.join(tmp('verify'), 'missing.txt');
    try {
      const r = await run(S('verify-production-uploads.js'), ['--api', api.url, '--stores', '1', '--out', out]);
      assert.strictEqual(r.code, 1, r.all); assert.ok(/RESULT: 228\/232 files are served as images, 4 are NOT/.test(r.out), r.out); // 230 products + 1 category image + 1 category media
      assert.deepStrictEqual(fs.readFileSync(out, 'utf8').trim().split('\n').sort(), ['c1-hero.png', 's1-p225.webp', 's1-p7.webp', 's1-p9.webp'], 'the exact file names to restore, one per line');
      assert.ok(/Content-Type is "application\/json"/.test(r.out), 'served-but-not-an-image is reported');
    } finally { api.close(); }
  });
  await test('VERIFY', 'an empty MARSHANS catalogue is reported as such (check the database) instead of a false "all good"; unreachable API -> exit 2', async () => {
    const files = new Map([['s1-p1.webp', WEBP], ['c1.png', PNG], ['c1-hero.png', PNG]]); const api = await stubApi({ files, products1: 1, products2: 0 });
    try { const r = await run(S('verify-production-uploads.js'), ['--api', api.url]); assert.strictEqual(r.code, 0); assert.ok(/THE MARSHANS: the public API published NO \/uploads images \(0 products, 1 categories\)/.test(r.out) && /list_upload_paths\.sql/.test(r.out), r.out); assert.ok(!/CHIPAKK: the public API published NO/.test(r.out), 'no false alarm for the store that has images'); } finally { api.close(); }
    const dead = await run(S('verify-production-uploads.js'), ['--api', 'http://127.0.0.1:1', '--timeout', '3000']); assert.strictEqual(dead.code, 2, dead.all);
    const bad = await stubApi({ files: new Map(), failing: true }); try { assert.strictEqual((await run(S('verify-production-uploads.js'), ['--api', bad.url])).code, 2); } finally { bad.close(); }
  });

  /* ------------------------------------------------------------------ restore */
  const makeBackup = () => {
    const b = tmp('backup'); fs.mkdirSync(path.join(b, 'home/u1/app/server/uploads'), { recursive: true }); fs.mkdirSync(path.join(b, 'other'), { recursive: true });
    const w = (rel, bytes) => fs.writeFileSync(path.join(b, rel), bytes);
    w('home/u1/app/server/uploads/product-1789726464876-995418619.webp', WEBP); w('home/u1/app/server/uploads/product-1789728424373-523676462.png', PNG);
    w('home/u1/app/server/uploads/custom-artwork-1789000000000-1.png', PNG); w('other/product-1789733328223-498993165.webp', WEBP);
    w('home/u1/app/server/uploads/.env', 'SECRET=1'); w('home/u1/app/server/uploads/shell.php', '<?php'); w('home/u1/app/server/uploads/has space.png', PNG); w('home/u1/app/server/uploads/empty.png', Buffer.alloc(0)); w('home/u1/app/server/uploads/notes.txt', 'x');
    fs.writeFileSync(path.join(b, 'outside-target.png'), PNG); fs.symlinkSync(path.join(b, 'outside-target.png'), path.join(b, 'home/u1/app/server/uploads/linked.png'));
    w('other/product-dup-1.png', PNG); w('home/u1/app/server/uploads/product-dup-1.png', Buffer.concat([PNG, Buffer.from('x')]));
    return b;
  };
  await test('RESTORE', 'refuses unsafe destinations: none given, relative, INSIDE the app folder (the wiped default), overlapping the backup', async () => {
    const b = makeBackup(); const d = tmp('dest'); const app = fakeApp(); const R = app.script('restore-uploads.js');
    const none = await run(R, ['--from', b], { UPLOADS_DIR: '' }); assert.strictEqual(none.code, 2); assert.ok(/No destination/.test(none.all));
    const rel = await run(R, ['--from', b, '--to', 'relative/dir']); assert.strictEqual(rel.code, 2); assert.ok(/ABSOLUTE/.test(rel.all));
    const inApp = await run(R, ['--from', b, '--to', app.inside, '--apply']); assert.strictEqual(inApp.code, 2); assert.ok(/inside the application folder/.test(inApp.all));
    assert.ok(!fs.existsSync(app.inside), 'nothing was created or written inside the app folder');
    const inAppNested = await run(R, ['--from', b, '--to', path.join(app.root, 'a', 'b', 'not-yet-created'), '--apply']); assert.strictEqual(inAppNested.code, 2, 'a not-yet-existing folder inside the app is caught too');
    const overlap = await run(R, ['--from', b, '--to', path.join(b, 'restored'), '--apply']); assert.strictEqual(overlap.code, 2); assert.ok(/overlap/.test(overlap.all)); assert.ok(!fs.existsSync(path.join(b, 'restored')));
    const envDest = await run(R, ['--from', b], { UPLOADS_DIR: d }); assert.strictEqual(envDest.code, 0, 'UPLOADS_DIR is honoured as the default destination');
  });
  await test('RESTORE', 'DRY RUN writes nothing (not even the destination); --apply copies EXACT names byte-for-byte; unsafe/non-image/empty/symlink files are skipped', async () => {
    const b = makeBackup(); const d = path.join(tmp('parent'), 'uploads-to-create');
    const dry = await run(S('restore-uploads.js'), ['--from', b, '--to', d]); assert.strictEqual(dry.code, 0, dry.all); assert.ok(/DRY RUN/.test(dry.out) && /would copy\s*:\s*6/.test(dry.out), dry.out); assert.ok(!fs.existsSync(d), 'dry run must not create the destination');
    const go = await run(S('restore-uploads.js'), ['--from', b, '--to', d, '--apply']); assert.strictEqual(go.code, 0, go.all);
    const got = fs.readdirSync(d).sort(); assert.deepStrictEqual(got, ['custom-artwork-1789000000000-1.png', 'outside-target.png', 'product-1789726464876-995418619.webp', 'product-1789728424373-523676462.png', 'product-1789733328223-498993165.webp', 'product-dup-1.png'].sort());
    assert.ok(fs.readFileSync(path.join(d, 'product-1789726464876-995418619.webp')).equals(WEBP), 'byte-identical'); assert.ok(!got.some((n) => /\.env|\.php|\.txt|space|empty|linked/.test(n)));
    assert.ok(/1 symlinks, 2 unsafe names, 2 non-image files, 1 empty files|symlinks/.test(go.out) && /DIFFERENT sizes/.test(go.out), go.out);
  });
  await test('RESTORE', 'never overwrites an existing file (unless --overwrite) and never deletes anything already in the destination', async () => {
    const b = makeBackup(); const d = tmp('dest'); const name = 'product-1789726464876-995418619.webp';
    fs.writeFileSync(path.join(d, name), 'NEWER-FILE-UPLOADED-AFTER-THE-BACKUP'); fs.writeFileSync(path.join(d, 'product-9999999999999-1.webp'), 'ONLY-IN-DEST');
    const r = await run(S('restore-uploads.js'), ['--from', b, '--to', d, '--apply']); assert.strictEqual(r.code, 0, r.all);
    assert.strictEqual(fs.readFileSync(path.join(d, name), 'utf8'), 'NEWER-FILE-UPLOADED-AFTER-THE-BACKUP', 'existing file untouched'); assert.strictEqual(fs.readFileSync(path.join(d, 'product-9999999999999-1.webp'), 'utf8'), 'ONLY-IN-DEST', 'nothing deleted');
    assert.ok(/already present \(left alone\)\s*:\s*1/.test(r.out), r.out);
    const o = await run(S('restore-uploads.js'), ['--from', b, '--to', d, '--apply', '--overwrite']); assert.strictEqual(o.code, 0); assert.ok(fs.readFileSync(path.join(d, name)).equals(WEBP), '--overwrite replaces it');
  });
  await test('RESTORE', '--manifest reports what the backup could NOT provide (exit 1) so nothing is silently left missing', async () => {
    const b = makeBackup(); const d = tmp('dest'); const mf = path.join(tmp('mf'), 'missing.txt');
    fs.writeFileSync(mf, ['product-1789726464876-995418619.webp', 'product-1789733328223-498993165.webp', 'product-1789999999999-1.webp', 'product-1789999999999-2.png'].join('\n') + '\n');
    const r = await run(S('restore-uploads.js'), ['--from', b, '--to', d, '--apply', '--manifest', mf]);
    assert.strictEqual(r.code, 1, r.all); assert.ok(/4 file names wanted/.test(r.out) && /in the backup or already in place : 2/.test(r.out) && /NOT in the backup and NOT in place: 2/.test(r.out), r.out); assert.ok(/product-1789999999999-1\.webp/.test(r.out));
    const ok = path.join(tmp('mf'), 'ok.txt'); fs.writeFileSync(ok, 'product-1789726464876-995418619.webp\n'); assert.strictEqual((await run(S('restore-uploads.js'), ['--from', b, '--to', d, '--manifest', ok])).code, 0);
  });

  /* ------------------------------------------------------------------ diagnostics */
  await test('DIAG', 'diagnostics are read-only: they never create the uploads directory and they flag an in-app / unset location', async () => {
    const ghost = path.join(tmp('diag'), 'does-not-exist-yet'); const r = await run(S('uploads-diagnostics.js'), [], { UPLOADS_DIR: ghost });
    assert.strictEqual(r.code, 0, r.all); assert.ok(!fs.existsSync(ghost), 'the diagnostics must not create the directory'); assert.ok(/exists\s+no/.test(r.out) && /inside the application folder\s+no/.test(r.out));
    const app = fakeApp(); const inApp = await run(app.script('uploads-diagnostics.js'), [], { UPLOADS_DIR: app.inside }); assert.ok(!fs.existsSync(app.inside), 'and it did not create the in-app directory either'); assert.ok(/inside the application folder\s+YES/.test(inApp.out) && /INSIDE the application folder/.test(inApp.out));
    const unset = await run(S('uploads-diagnostics.js'), [], { UPLOADS_DIR: '' }); assert.ok(/not set in THIS shell/.test(unset.out) && /Candidate locations OUTSIDE/.test(unset.out));
  });
  await test('DIAG', '--probe / --check prove persistence: writes ONE sentinel (only to an existing, writable, absolute, outside-app dir); --check exits 1 when it is gone', async () => {
    const d = tmp('probe'); const before = fs.readdirSync(d);
    assert.strictEqual((await run(S('uploads-diagnostics.js'), ['--probe', 'relative'])).code, 2); assert.strictEqual((await run(S('uploads-diagnostics.js'), ['--probe', path.join(d, 'nope')])).code, 2);
    const w = await run(S('uploads-diagnostics.js'), ['--probe', d]); assert.strictEqual(w.code, 0, w.all); assert.deepStrictEqual(fs.readdirSync(d).filter((f) => !before.includes(f)), ['.chipakk-persistence-probe'], 'exactly one file written');
    const present = await run(S('uploads-diagnostics.js'), ['--check', d]); assert.strictEqual(present.code, 0); assert.ok(/PRESENT/.test(present.out));
    fs.rmSync(path.join(d, '.chipakk-persistence-probe')); const gone = await run(S('uploads-diagnostics.js'), ['--check', d]); assert.strictEqual(gone.code, 1); assert.ok(/MISSING/.test(gone.out) && /not a safe uploads location/i.test(gone.out));
    const app = fakeApp(); const warn = await run(app.script('uploads-diagnostics.js'), ['--probe', path.join(app.root, 'server')]); assert.ok(/INSIDE the application folder/.test(warn.all), 'probing a folder inside the app is warned about');
  });

  /* ------------------------------------------------------------------ config warnings */
  await test('CONFIG', 'production warns for an UNSET, RELATIVE or INSIDE-THE-APP UPLOADS_DIR and is silent for a good external one; no path is ever revealed', async () => {
    const app = fakeApp(); const probe = (env, cwd) => run('-e', [`const u=require(${JSON.stringify(app.config)}); console.log('H='+JSON.stringify(u.describeUploads()));`], env, cwd);
    const base = { NODE_ENV: 'production' }; const external = tmp('ext'); const cwd = tmp('cwd'); const inside = path.join(app.root, 'server', 'uploads-inside');
    const good = await probe({ ...base, UPLOADS_DIR: external }, cwd); const g = JSON.parse(good.out.match(/H=(.*)/)[1]); assert.deepStrictEqual([g.externalDirectory, g.insideAppDirectory, 'warning' in g], [true, false, false]); assert.ok(!/WARNING/.test(good.all));
    const unset = await probe({ ...base, UPLOADS_DIR: '' }, cwd); const u = JSON.parse(unset.out.match(/H=(.*)/)[1]); assert.ok(/UPLOADS_DIR is not set/.test(u.warning) && u.insideAppDirectory === true);
    const rel = await probe({ ...base, UPLOADS_DIR: 'uploads-rel' }, cwd); const r = JSON.parse(rel.out.match(/H=(.*)/)[1]); assert.ok(/relative path/.test(r.warning), r.warning);
    const ins = await probe({ ...base, UPLOADS_DIR: inside }, cwd); const i = JSON.parse(ins.out.match(/H=(.*)/)[1]); assert.ok(/INSIDE the deployed application folder/.test(i.warning) && i.insideAppDirectory === true, JSON.stringify(i)); assert.ok(/WARNING/.test(ins.all), 'also logged at startup');
    for (const x of [u, r, i]) assert.ok(!x.warning.includes(app.root) && !x.warning.includes(os.tmpdir()), 'a warning never contains a path');
    const dev = await probe({ NODE_ENV: 'development', UPLOADS_DIR: '' }, cwd); assert.ok(!('warning' in JSON.parse(dev.out.match(/H=(.*)/)[1])), 'quiet in development');
    // the real config file is the one that is copied: keep the copy honest
    assert.strictEqual(fs.readFileSync(app.config, 'utf8'), fs.readFileSync(path.join(ROOT, 'server/config/uploads.js'), 'utf8'));
  });

  /* ------------------------------------------------------------------ SQL */
  await test('SQL', 'list_upload_paths.sql is SELECT-only and covers BOTH stores, category media, LUMO, banners, hero settings and private artwork', () => {
    const raw = fs.readFileSync(path.join(ROOT, 'database/ops/list_upload_paths.sql'), 'utf8'); const code = raw.replace(/--.*$/gm, '');
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT)\b/i.test(code), 'read-only');
    for (const t of ['product_images', 'marshans_product_images', 'categories', 'marshans_categories', 'category_media', 'marshans_category_media', 'lumo_light_image', 'banners', 'campaigns', 'store_settings', 'order_item_custom_designs']) assert.ok(code.includes(t), `covers ${t}`);
    assert.ok(!/image_path/.test(code), 'the real column is image_url');
  });
  await test('SQL', 'the verifier and helpers contain no write to the server: no POST/PUT/DELETE, no SQL, no database access', () => {
    for (const f of ['verify-production-uploads.js', 'restore-uploads.js', 'uploads-diagnostics.js']) { const src = fs.readFileSync(S(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); assert.ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src) && !/mysql|pool\.execute|require\(['"]\.\.\/server/.test(src), f); }
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\nUPLOAD OPS TOOLING: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
