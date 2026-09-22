/**
 * Upload delivery: admin upload -> physical file -> DB path -> GET /uploads/<file> -> image bytes.
 *
 * Everything runs for real: the shipped Express app (server/app.js), the real multer middleware, the real
 * /api/admin/* routes (only Firebase auth is stubbed), a real on-disk UPLOADS_DIR, real HTTP requests and a real
 * child-process restart. The fake database only CAPTURES what the code writes so the stored image path can be checked.
 *
 * Production finding this guards (2026-09-21): api.chipakk.shop answered
 *   {"error":{"message":"Route not found: GET /uploads/product-....webp"}}
 * because the file was not on the server's disk (health showed uploads.fileCount = 0 with externalDirectory = false),
 * and a missing upload fell through express.static into the API's generic 404.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { createFakePool, installFakePool, parseInsert } = require('./helpers/fake_db');

// ---- real image bytes (magic numbers matter, decoding does not) ----
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>');
const GIF = Buffer.from('R0lGODlhAQABAAAAACwAAAAAAQABAAA=', 'base64');

// ---- environment: an EXTERNAL uploads dir (the recommended production setup) with a secret next to it ----
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chipakk-upload-delivery-'));
const UPLOADS = path.join(work, 'persistent-uploads');
fs.mkdirSync(UPLOADS);
fs.writeFileSync(path.join(work, 'secret-outside-uploads.txt'), 'SECRET-OUTSIDE-THE-UPLOAD-DIRECTORY');
fs.writeFileSync(path.join(UPLOADS, '.hidden-dotfile'), 'DOTFILE-SECRET'); // a dotfile INSIDE the upload dir must still never be served
process.env.UPLOADS_DIR = UPLOADS;

// Only Firebase auth is stubbed (test-only): the routes, multer, controllers and services are the real ones.
const authPath = require.resolve('../server/middleware/auth.js');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  verifyFirebaseToken: (req, res, next) => { req.user = { uid: 'admin-test', email: 'admin@test.local' }; next(); },
  requireAdmin: (req, res, next) => next()
} };

// ---- fake DB: captures the paths the real services write ----
const captured = { productImages: [], categories: [], marshansCategories: [], marshansProductImages: [] };
const handlers = [
  [/^SHOW COLUMNS FROM categories LIKE 'image_url'/, () => [[{ Field: 'image_url' }]]],
  [/^SHOW COLUMNS FROM categories LIKE 'store_id'/, () => [[{ Field: 'store_id' }]]],
  [/^SHOW COLUMNS FROM (marshans_)?categories LIKE 'hsn_code'/, () => [[]]],
  [/^INSERT INTO categories \(name, slug, active\)/, () => [{ insertId: 70 }]],
  [/^INSERT INTO categories/, (s, p) => { captured.categories.push(parseInsert(s, p)); return [{ insertId: 88 }]; }],
  [/^SELECT c\.\* FROM categories c/, () => [[{ id: 88, name: 'Uploaded Category', slug: 'uploaded-category', image_url: captured.categories.length ? captured.categories[captured.categories.length - 1].image_url : null, active: 1, store_id: 1 }]]],
  [/^INSERT INTO marshans_categories/, (s, p) => { captured.marshansCategories.push(parseInsert(s, p)); return [{ insertId: 99 }]; }],
  [/FROM marshans_categories c\s+LEFT JOIN category_experiences/, () => [[{ id: 99, store_id: 2, name: 'Uploaded MRSH Category', slug: 'uploaded-mrsh-category', image_url: captured.marshansCategories.length ? captured.marshansCategories[captured.marshansCategories.length - 1].image_url : null, active: 1 }]]],
  [/^INSERT INTO products /, () => [{ insertId: 901 }]],
  [/^INSERT INTO product_images/, (s, p) => { captured.productImages.push(parseInsert(s, p)); return [{ insertId: 1 }]; }],
  [/^INSERT INTO product_variants/, () => [{ insertId: 5 }]],
  [/^SELECT id FROM categories WHERE/, () => [[{ id: 70 }]]],
  [/FROM products p\s+LEFT JOIN categories c ON p\.category_id = c\.id\s+WHERE/, () => [[{ id: 901, store_id: 1, name: 'Uploaded Sticker', price: 25, active: 1, category_id: 70 }]]],
  [/FROM product_images\s+WHERE product_id/, () => [captured.productImages.map((r, i) => ({ id: i + 1, image_url: r.image_url, is_primary: r.is_primary }))]]
];
installFakePool(createFakePool(handlers));
const app = require('../server/app.js');

// ---- helpers ----
const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.message}`); }
}
const listen = (a) => new Promise((res) => { const s = a.listen(0, '127.0.0.1', () => res(s)); });
const request = (port, { method = 'GET', p, headers = {}, body }) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const multipart = (fields, file) => {
  const boundary = '----chipakk' + Math.random().toString(16).slice(2); const parts = [];
  for (const [k, v] of Object.entries(fields || {})) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) { parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`)); parts.push(file.bytes); parts.push(Buffer.from('\r\n')); }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
};
const diskFiles = () => fs.readdirSync(UPLOADS).filter((f) => !f.startsWith('.'));
const json = (r) => JSON.parse(r.body.toString('utf8'));

(async () => {
  const server = await listen(app); const port = server.address().port;
  const GET = (p, headers = {}) => request(port, { p, headers });

  /* ------------------------------------------------------------------ TEST 1 & 2: existing files */
  // The very file names from the production report / production database.
  const PRODUCT_FILE = 'product-1789920844722-880658550.webp';        // from the failing request
  const CATEGORY_FILE = 'product-1789728424373-523676462.png';        // a real production category image path
  fs.writeFileSync(path.join(UPLOADS, PRODUCT_FILE), WEBP); fs.writeFileSync(path.join(UPLOADS, CATEGORY_FILE), PNG);

  await test('TEST 1', 'existing PRODUCT image: 200, image/webp, the exact bytes, cacheable, physically on disk', async () => {
    assert.ok(fs.existsSync(path.join(UPLOADS, PRODUCT_FILE)), 'the physical file exists');
    const r = await GET(`/uploads/${PRODUCT_FILE}`);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers['content-type'], 'image/webp'); assert.ok(r.body.equals(WEBP), 'actual image bytes');
    assert.strictEqual(Number(r.headers['content-length']), WEBP.length); assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(/max-age=2592000/.test(r.headers['cache-control']) && /immutable/.test(r.headers['cache-control']), 'files that exist stay long-cacheable');
    const head = await request(port, { method: 'HEAD', p: `/uploads/${PRODUCT_FILE}` }); assert.strictEqual(head.status, 200);
  });
  await test('TEST 2', 'existing CATEGORY image: 200, image/png, the exact bytes', async () => {
    const r = await GET(`/uploads/${CATEGORY_FILE}`);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.headers['content-type'], 'image/png'); assert.ok(r.body.equals(PNG));
  });
  await test('MIME', 'WebP, PNG, JPEG, GIF and SVG are served with the right Content-Type; SVG is sandboxed by CSP', async () => {
    for (const [name, bytes, type] of [['product-1-1.webp', WEBP, 'image/webp'], ['product-2-2.png', PNG, 'image/png'], ['product-3-3.jpg', JPEG, 'image/jpeg'], ['product-4-4.jpeg', JPEG, 'image/jpeg'], ['product-5-5.gif', GIF, 'image/gif'], ['legacy-6-6.svg', SVG, 'image/svg+xml']]) {
      fs.writeFileSync(path.join(UPLOADS, name), bytes); const r = await GET(`/uploads/${name}`);
      assert.strictEqual(r.status, 200, name); assert.ok(r.headers['content-type'].startsWith(type), `${name}: ${r.headers['content-type']}`); assert.ok(r.body.equals(bytes), name);
      if (type === 'image/svg+xml') assert.ok(/sandbox/.test(r.headers['content-security-policy']) && /default-src 'none'/.test(r.headers['content-security-policy']), 'SVG must be sandboxed');
    }
  });

  /* ------------------------------------------------------------------ TEST 3: new PRODUCT image from Admin */
  let newProductUrl;
  await test('TEST 3', 'NEW product image via Admin: upload 200 -> file on disk -> DB path stored -> GET 200 with the uploaded bytes', async () => {
    const before = diskFiles().length; const m = multipart({}, { field: 'image', filename: 'sticker.webp', type: 'image/webp', bytes: WEBP });
    const up = await request(port, { method: 'POST', p: '/api/admin/upload', headers: m.headers, body: m.body });
    assert.strictEqual(up.status, 200, up.body.toString()); const u = json(up).data; newProductUrl = u.url;
    assert.ok(/^\/uploads\/product-\d+-\d+\.webp$/.test(u.url), `relative path in the documented format: ${u.url}`); assert.strictEqual(u.filename, path.basename(u.url));
    assert.strictEqual(diskFiles().length, before + 1); assert.ok(fs.readFileSync(path.join(UPLOADS, u.filename)).equals(WEBP), 'the file on disk is exactly what was uploaded');
    // the admin UI now saves the product with that path: the real route + service write it verbatim
    const create = await request(port, { method: 'POST', p: '/api/admin/products', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Uploaded Sticker', price: 25, category_name: 'Anime', images: [{ image_url: u.url, is_primary: true }] }) });
    assert.ok(create.status === 201 || create.status === 200, `create product: ${create.status} ${create.body.toString().slice(0, 160)}`);
    assert.strictEqual(captured.productImages.length, 1); assert.strictEqual(captured.productImages[0].image_url, u.url, 'DB path === the /uploads path returned by the upload');
    const get = await GET(newProductUrl); assert.strictEqual(get.status, 200); assert.strictEqual(get.headers['content-type'], 'image/webp'); assert.ok(get.body.equals(WEBP));
  });
  await test('TEST 3b', 'the upload endpoint refuses non-images and oversize files, and writes nothing', async () => {
    const before = diskFiles().length;
    const bad = multipart({}, { field: 'image', filename: 'evil.html', type: 'text/html', bytes: Buffer.from('<script>alert(1)</script>') });
    const r1 = await request(port, { method: 'POST', p: '/api/admin/upload', headers: bad.headers, body: bad.body }); assert.ok(r1.status >= 400 && r1.status < 500, `html refused: ${r1.status}`);
    const svg = multipart({}, { field: 'image', filename: 'x.svg', type: 'image/svg+xml', bytes: SVG });
    const r2 = await request(port, { method: 'POST', p: '/api/admin/upload', headers: svg.headers, body: svg.body }); assert.ok(r2.status >= 400 && r2.status < 500, `svg upload refused: ${r2.status}`);
    const big = multipart({}, { field: 'image', filename: 'big.png', type: 'image/png', bytes: Buffer.alloc(5 * 1024 * 1024 + 10, 1) });
    const r3 = await request(port, { method: 'POST', p: '/api/admin/upload', headers: big.headers, body: big.body }); assert.ok(r3.status >= 400 && r3.status < 600 && r3.status !== 200, `oversize refused: ${r3.status}`);
    assert.strictEqual(diskFiles().length, before, 'nothing was written');
  });

  /* ------------------------------------------------------------------ TEST 4 & 9: new CATEGORY image, both stores */
  await test('TEST 4', 'NEW category image via Admin (CHIPAKK): multipart create -> file on disk -> categories.image_url = /uploads/<file> -> GET 200', async () => {
    const m = multipart({ name: 'Uploaded Category' }, { field: 'image', filename: 'cat.png', type: 'image/png', bytes: PNG });
    const r = await request(port, { method: 'POST', p: '/api/admin/categories', headers: { ...m.headers, 'X-Store-ID': '1' }, body: m.body });
    assert.ok(r.status === 201 || r.status === 200, `${r.status} ${r.body.toString().slice(0, 200)}`);
    const stored = captured.categories[captured.categories.length - 1]; assert.ok(/^\/uploads\/product-\d+-\d+\.png$/.test(stored.image_url), `stored path: ${stored.image_url}`);
    assert.ok(fs.existsSync(path.join(UPLOADS, path.basename(stored.image_url))), 'physical file exists');
    const g = await GET(stored.image_url); assert.strictEqual(g.status, 200); assert.strictEqual(g.headers['content-type'], 'image/png'); assert.ok(g.body.equals(PNG));
  });
  await test('TEST 9', 'NEW category image via Admin (THE MARSHANS): same directory, same path format, served the same way', async () => {
    const m = multipart({ name: 'Uploaded MRSH Category' }, { field: 'image', filename: 'mcat.png', type: 'image/png', bytes: PNG });
    const r = await request(port, { method: 'POST', p: '/api/admin/categories', headers: { ...m.headers, 'X-Store-ID': '2' }, body: m.body });
    assert.ok(r.status === 201 || r.status === 200, `${r.status} ${r.body.toString().slice(0, 200)}`);
    const stored = captured.marshansCategories[captured.marshansCategories.length - 1]; assert.ok(/^\/uploads\/product-\d+-\d+\.png$/.test(stored.image_url), `stored path: ${stored.image_url}`);
    assert.ok(fs.existsSync(path.join(UPLOADS, path.basename(stored.image_url)))); const g = await GET(stored.image_url); assert.strictEqual(g.status, 200); assert.ok(g.body.equals(PNG));
  });
  await test('TEST 9b', 'both stores share ONE upload directory and one URL space: a file uploaded while acting as either store is readable by both storefronts', async () => {
    for (const store of ['1', '2']) {
      const m = multipart({}, { field: 'image', filename: 'shared.jpg', type: 'image/jpeg', bytes: JPEG });
      const up = await request(port, { method: 'POST', p: '/api/admin/upload', headers: { ...m.headers, 'X-Store-ID': store }, body: m.body }); assert.strictEqual(up.status, 200);
      for (const asStore of ['1', '2']) { const g = await GET(json(up).data.url, { 'X-Store-ID': asStore }); assert.strictEqual(g.status, 200, `uploaded as store ${store}, read as store ${asStore}`); assert.ok(g.body.equals(JPEG)); }
    }
    const names = diskFiles().filter((f) => /^product-\d+-\d+\.(jpg|png|webp)$/.test(f)); assert.ok(names.length >= 5, 'files from both stores live side by side in the one directory');
  });

  /* ------------------------------------------------------------------ TEST 5: missing upload */
  await test('TEST 5', 'a MISSING upload is a clean upload-404: JSON, UPLOAD_NOT_FOUND, not "Route not found", never cacheable; normal API 404s are unchanged', async () => {
    const r = await GET('/uploads/product-1789920844722-000000000.webp'); assert.strictEqual(r.status, 404);
    const b = json(r); assert.strictEqual(b.success, false); assert.strictEqual(b.error.code, 'UPLOAD_NOT_FOUND'); assert.strictEqual(b.error.message, 'Upload file not found'); assert.ok(!/Route not found/i.test(r.body.toString()), 'must not read like a routing failure');
    assert.strictEqual(r.headers['cache-control'], 'no-store', 'a CDN must not keep the 404 after the file is restored'); assert.ok(!r.body.toString().includes(UPLOADS), 'no server path in the body');
    const head = await request(port, { method: 'HEAD', p: '/uploads/nope.webp' }); assert.strictEqual(head.status, 404);
    const post = await request(port, { method: 'POST', p: '/uploads/nope.webp' }); assert.strictEqual(post.status, 404);
    const dir = await GET('/uploads/'); assert.strictEqual(dir.status, 404, 'no directory listing'); const root = await GET('/uploads'); assert.ok(root.status === 404 || root.status === 301 || root.status === 302);
    const api = await GET('/api/this-route-does-not-exist'); assert.strictEqual(api.status, 404); assert.ok(/Route not found: GET \/api\/this-route-does-not-exist/.test(json(api).error.message), 'the API JSON 404 is unchanged');
  });

  /* ------------------------------------------------------------------ TEST 6: security */
  await test('TEST 6', 'path traversal is blocked in every encoding: nothing outside the upload directory is ever returned', async () => {
    const attempts = ['/uploads/../secret-outside-uploads.txt', '/uploads/../../package.json', '/uploads/%2e%2e/secret-outside-uploads.txt', '/uploads/%2e%2e%2fsecret-outside-uploads.txt', '/uploads/..%2fsecret-outside-uploads.txt',
      '/uploads/..%5csecret-outside-uploads.txt', '/uploads/%2e%2e%5c%2e%2e%5csecret-outside-uploads.txt', '/uploads/%252e%252e%252fsecret-outside-uploads.txt', '/uploads/....//secret-outside-uploads.txt', '/uploads//etc/passwd', '/uploads/%00.png',
      '/uploads/product-1-1.png%00.txt', '/uploads/.gitkeep', '/uploads/.hidden-dotfile', '/uploads/%2ehidden-dotfile', '/uploads/.env', '/uploads/%2e%2e/%2e%2e/server/app.js', '/uploads/..;/secret-outside-uploads.txt'];
    for (const a of attempts) {
      const r = await request(port, { p: a }); const text = r.body.toString('utf8');
      assert.ok([400, 403, 404].includes(r.status), `${a} -> ${r.status}`); assert.ok(!/SECRET-OUTSIDE|DOTFILE-SECRET|"name": "chipakk|root:x:|require\('express'\)/.test(text), `${a} leaked content`);
    }
  });
  await test('TEST 6b', 'PRIVATE custom artwork is never served unauthenticated, in any encoding or case (regression: percent-encoded names used to bypass the guard)', async () => {
    fs.writeFileSync(path.join(UPLOADS, 'custom-artwork-1789000000000-1.png'), 'PRIVATE-CUSTOMER-ARTWORK');
    for (const a of ['/uploads/custom-artwork-1789000000000-1.png', '/uploads/custom%2Dartwork-1789000000000-1.png', '/uploads/%63ustom-artwork-1789000000000-1.png', '/uploads/custom-artwork%2D1789000000000-1.png', '/uploads/CUSTOM-ARTWORK-1789000000000-1.png', '/uploads/%43%75stom-artwork-1789000000000-1.png', '/uploads/./custom-artwork-1789000000000-1.png']) {
      const r = await request(port, { p: a }); assert.ok(r.status === 403 || r.status === 404 || r.status === 400, `${a} -> ${r.status}`); assert.ok(!r.body.toString().includes('PRIVATE-CUSTOMER-ARTWORK'), `${a} leaked the private artwork`);
    }
    const bad = await request(port, { p: '/uploads/%E0%A4%A' }); assert.strictEqual(bad.status, 400, 'malformed escapes are a clean 400');
  });
  await test('TEST 6c', 'only the upload directory is public: app source, .env and other folders are not reachable through /uploads', async () => {
    for (const a of ['/uploads/app.js', '/uploads/server/app.js', '/uploads/package.json', '/uploads/../.env']) { const r = await request(port, { p: a }); assert.ok([400, 403, 404].includes(r.status), `${a} -> ${r.status}`); assert.ok(!/express|dotenv/i.test(r.body.toString().replace(/"message":"[^"]*"/g, '')), a); }
  });

  /* ------------------------------------------------------------------ TEST 8: regression */
  await test('TEST 8', 'normal API routes still work: health, settings, JSON 404, CORS preflight, static storefront assets, root', async () => {
    const h = await GET('/api/health'); assert.strictEqual(h.status, 200); const hb = json(h); assert.strictEqual(hb.success, true); assert.strictEqual(hb.data.uploads.externalDirectory, true); assert.strictEqual(hb.data.uploads.writable, true);
    assert.ok(hb.data.uploads.fileCount >= 10, `health reports the real file count (${hb.data.uploads.fileCount})`); assert.ok(!JSON.stringify(hb).includes(work), 'health never reveals the directory');
    const s = await GET('/api/settings', { 'X-Store-ID': '1' }); assert.ok(s.status === 200 && json(s).success === true, `settings ${s.status}`);
    const pre = await request(port, { method: 'OPTIONS', p: '/api/health', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' } }); assert.ok(pre.status === 204 || pre.status === 200);
    const root = await GET('/'); assert.ok(root.status === 200 || root.status === 304); const unknown = await request(port, { method: 'POST', p: '/api/nope' }); assert.strictEqual(unknown.status, 404);
  });
  await test('TEST 8b', 'an ordinary API error still uses the shared error handler (generic, no stack, no paths)', async () => {
    const r = await request(port, { method: 'POST', p: '/api/admin/categories', headers: { 'Content-Type': 'application/json' }, body: '{"name": ""}' }); assert.strictEqual(r.status, 400); assert.ok(!/at .*\.js:\d+/.test(r.body.toString()));
  });

  /* ------------------------------------------------------------------ TEST 7: restart persistence (real process restart) */
  await test('TEST 7', 'RESTART: a brand-new backend process with the same UPLOADS_DIR serves every earlier file (existing and newly uploaded)', async () => {
    const files = [PRODUCT_FILE, CATEGORY_FILE, path.basename(newProductUrl)];
    const child = spawn(process.execPath, ['-e', `
      const fs=require('fs'); const {createFakePool,installFakePool}=require(${JSON.stringify(path.join(ROOT, 'tests/helpers/fake_db'))}); installFakePool(createFakePool([]));
      const app=require(${JSON.stringify(path.join(ROOT, 'server/app.js'))}); const s=app.listen(0,'127.0.0.1',()=>console.log('PORT='+s.address().port));`],
      { env: { ...process.env, UPLOADS_DIR: UPLOADS, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const childPort = await new Promise((resolve, reject) => { let buf = ''; const t = setTimeout(() => reject(new Error('restarted backend did not start')), 20000); child.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT=(\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } }); child.on('exit', (c) => reject(new Error('backend exited ' + c))); });
      for (const f of files) { const r = await request(childPort, { p: `/uploads/${f}` }); assert.strictEqual(r.status, 200, `${f} after restart`); assert.ok(r.body.equals(fs.readFileSync(path.join(UPLOADS, f)))); }
      const missing = await request(childPort, { p: '/uploads/product-1-does-not-exist.webp' }); assert.strictEqual(missing.status, 404); assert.strictEqual(json(missing).error.code, 'UPLOAD_NOT_FOUND');
    } finally { child.kill('SIGKILL'); }
  });

  /* ------------------------------------------------------------------ the production failure mode itself */
  await test('PROD', 'reproduces the production symptom: an EMPTY default-style directory answers 404 for every DB path; restoring the files fixes it with no code or DB change', async () => {
    const emptyDir = fs.mkdtempSync(path.join(work, 'fresh-deploy-')); // what a redeploy leaves behind: writable, but empty
    const child = spawn(process.execPath, ['-e', `
      const {createFakePool,installFakePool}=require(${JSON.stringify(path.join(ROOT, 'tests/helpers/fake_db'))}); installFakePool(createFakePool([]));
      const app=require(${JSON.stringify(path.join(ROOT, 'server/app.js'))}); const s=app.listen(0,'127.0.0.1',()=>console.log('PORT='+s.address().port));`],
      { env: { ...process.env, UPLOADS_DIR: emptyDir, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const p2 = await new Promise((resolve, reject) => { let buf = ''; const t = setTimeout(() => reject(new Error('no start')), 20000); child.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT=(\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } }); });
      const health = json(await request(p2, { p: '/api/health' })).data.uploads; assert.deepStrictEqual([health.writable, health.fileCount], [true, 0], 'writable but empty: exactly what production reported');
      for (const f of [PRODUCT_FILE, CATEGORY_FILE]) assert.strictEqual((await request(p2, { p: `/uploads/${f}` })).status, 404, 'empty directory -> 404 for every path the database holds');
      fs.copyFileSync(path.join(UPLOADS, PRODUCT_FILE), path.join(emptyDir, PRODUCT_FILE)); // restore from backup: same file name, no DB change
      const ok = await request(p2, { p: `/uploads/${PRODUCT_FILE}` }); assert.strictEqual(ok.status, 200); assert.ok(ok.body.equals(WEBP), 'restoring the file is the whole fix; the URL and DB path are untouched');
    } finally { child.kill('SIGKILL'); }
  });
  await test('PROD', 'production without UPLOADS_DIR is flagged: health carries a warning and startup logs it (no path is revealed)', async () => {
    const run = (env) => new Promise((resolve) => { const c = spawn(process.execPath, ['-e', `const u=require(${JSON.stringify(path.join(ROOT, 'server/config/uploads.js'))}); console.log('HEALTH='+JSON.stringify(u.describeUploads()));`], { env: env, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d)); c.on('exit', () => resolve({ out, err })); });
    const base = { ...process.env }; delete base.UPLOADS_DIR;
    const bad = await run({ ...base, NODE_ENV: 'production' }); const h = JSON.parse(bad.out.match(/HEALTH=(.*)/)[1]);
    assert.strictEqual(h.externalDirectory, false); assert.ok(/UPLOADS_DIR is not set/.test(h.warning) && !h.warning.includes(ROOT)); assert.ok(/UPLOADS_DIR is not set/.test(bad.out + bad.err), 'logged at startup');
    const good = await run({ ...base, NODE_ENV: 'production', UPLOADS_DIR: UPLOADS }); assert.ok(!('warning' in JSON.parse(good.out.match(/HEALTH=(.*)/)[1])), 'no warning once UPLOADS_DIR is set');
    const dev = await run({ ...base, NODE_ENV: 'development' }); assert.ok(!('warning' in JSON.parse(dev.out.match(/HEALTH=(.*)/)[1])), 'no noise in local development');
  });

  /* ------------------------------------------------------------------ static architecture guarantees */
  await test('ARCH', 'one directory for writers and readers: multer, imageUtils, the static mount and the health check all use config/uploads.js; the mount precedes every API route and the 404 handler', () => {
    const cfg = require('../server/config/uploads'); assert.strictEqual(cfg.uploadDir, path.resolve(UPLOADS));
    assert.strictEqual(require('../server/middleware/upload').uploadDir, cfg.uploadDir);
    const appSrc = fs.readFileSync(path.join(ROOT, 'server/app.js'), 'utf8'); const at = (s) => appSrc.indexOf(s);
    assert.ok(at("express.static(require('./config/uploads').uploadDir") > -1 && at("express.static(require('./config/uploads').uploadDir") < at("app.use('/api', resolveStoreContext)"), 'static mount before the API');
    assert.ok(at("code: 'UPLOAD_NOT_FOUND'") > at("express.static(require('./config/uploads').uploadDir") && at("code: 'UPLOAD_NOT_FOUND'") < at('app.use(notFoundHandler)'), 'upload 404 sits between the static mount and the generic 404');
    for (const f of ['server/middleware/upload.js', 'server/utils/imageUtils.js']) assert.ok(/require\('\.\.\/config\/uploads'\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} uses the shared directory`);
    assert.ok(!/path\.join\(__dirname, '\.\.', 'uploads'\)/.test(fs.readFileSync(path.join(ROOT, 'server/middleware/upload.js'), 'utf8')), 'no second, hard-coded upload directory');
  });

  server.close();
  fs.rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => !r.pass);
  console.log(`\nUPLOAD DELIVERY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* ignore */ } process.exit(1); });
