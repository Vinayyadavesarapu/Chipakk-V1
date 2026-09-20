/**
 * Backend for the real-browser QA (tests/visual/run_visual_qa.js), "real" transport.
 *
 * The browser makes GENUINE HTTP requests to this server:
 *   /uploads/*                 -> the REAL Express app (server/app.js) static handler serving a temp
 *                                 UPLOADS_DIR, so hits are real 200 (image bytes) / 404 responses
 *   POST /api/coupons/validate -> the REAL coupon route + couponService, backed by a fake DB
 *   GET  /api/*                -> read-only proxy of the PRODUCTION api (real catalog/categories/settings),
 *                                 cached per process. Non-GET requests are refused (no orders are ever placed).
 *
 * Which images "exist" is decided per --uploads mode (exist | mixed | missing). Production currently has no
 * product with more than one image, so product 129 gets two extra (synthetic) gallery images.
 * Shipping settings: with settings='rule' (default) the shipping_* / free_shipping_* fields come from the REAL new
 * /api/settings controller (built-in ₹50 / ₹300 rule); settings='production' passes production's own values through
 * (production currently says ₹60 / ₹299 / after_discounts).
 * `state` lets a scenario make the API slow / failing / hanging, or hang image requests, for loader tests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { png } = require('./cdp.js');

const PROD = 'https://api.chipakk.shop';
const MULTI_IMAGE_PRODUCT_ID = 129;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COUPONS = () => {
  const base = { id: 9, discount_type: 'percent', discount_value: 10, min_order_value: 0, max_discount_amount: null, usage_limit: null, usage_count: 0, active: 1, store_id: 1, per_customer_limit: 1, start_date: null, end_date: null };
  return {
    SAVE35: { ...base, code: 'SAVE35', discount_type: 'fixed', discount_value: 35 },
    SAVE10: { ...base, code: 'SAVE10', max_discount_amount: 100 },
    MIN9999: { ...base, code: 'MIN9999', min_order_value: 9999 },
    EXPIRED: { ...base, code: 'EXPIRED', end_date: new Date(Date.now() - 86400000) },
    USEDUP: { ...base, code: 'USEDUP', usage_limit: 5, usage_count: 5 }
  };
};

async function start({ uploads = 'mixed', settings: settingsMode = 'rule', supplier = 'fixture' } = {}) {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chipakk-qa-uploads-'));
  process.env.UPLOADS_DIR = uploadsDir; // must be set BEFORE server/app.js is required

  const { createFakePool, installFakePool } = require('../helpers/fake_db');
  const coupons = COUPONS();
  // GST: 'fixture' = a fictitious, checksum-valid supplier from tests/helpers/gst_fixture.js (NOT a real registration);
  //      'none'    = no supplier configured, so the real settings controller reports checkout_tax_ready=false
  const gstFixture = require('../helpers/gst_fixture');
  installFakePool(createFakePool([
    ...(supplier === 'fixture' ? gstFixture.supplierHandlers() : []),
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
    [/FROM coupons c WHERE/, (sql, params) => {
      const code = String(params[0] || '').toUpperCase();
      if (code === 'BOOM') throw new Error("ER_BAD_FIELD_ERROR: Unknown column 'u.name' in 'field list' at /srv/app/server/services/couponService.js:88");
      return [coupons[code] ? [coupons[code]] : []];
    }],
    [/FROM coupon_usage/, () => [[]]]
  ]));
  const app = require('../../server/app.js');

  // ---- read-only production proxy (cached) with the synthetic gallery patch ----
  const cache = new Map();
  const extra = (n) => `/uploads/qa-extra-${MULTI_IMAGE_PRODUCT_ID}-${n}.webp`;
  const patch = (o) => {
    if (o && typeof o === 'object') {
      if (Number(o.id) === MULTI_IMAGE_PRODUCT_ID && Array.isArray(o.images) && o.images.length && !o.__qa) {
        o.__qa = true;
        o.images.push({ id: 9000001, product_id: MULTI_IMAGE_PRODUCT_ID, image_url: extra('a'), sort_order: 1, is_primary: 0 },
          { id: 9000002, product_id: MULTI_IMAGE_PRODUCT_ID, image_url: extra('b'), sort_order: 2, is_primary: 0 });
      }
      for (const k of Object.keys(o)) patch(o[k]);
    }
    return o;
  };
  async function prod(pathAndQuery, storeId) {
    const key = `${storeId || 1}|${pathAndQuery}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const r = await fetch(PROD + pathAndQuery, { headers: { accept: 'application/json', 'x-store-id': String(storeId || 1) } });
        const text = await r.text();
        let body = text;
        try { body = JSON.stringify(patch(JSON.parse(text))); } catch (_) { /* pass through */ }
        return { status: r.status, body };
      })());
    }
    return cache.get(key);
  }

  // ---- which upload files exist on disk ----
  const products = (JSON.parse((await prod('/api/products?limit=500&offset=0', 1)).body).data || {}).products || [];
  const catData = JSON.parse((await prod('/api/categories', 1)).body).data;
  const categories = Array.isArray(catData) ? catData : ((catData && catData.categories) || []);
  const fileOf = (u) => String(u || '').split('/').pop();
  const primaryFile = (p) => fileOf(p.primary_image_url || (p.images && p.images[0] && p.images[0].image_url));
  const allFiles = new Set();
  products.forEach((p) => (p.images || []).forEach((i) => allFiles.add(fileOf(i.image_url))));
  products.forEach((p) => p.primary_image_url && allFiles.add(fileOf(p.primary_image_url)));
  categories.forEach((c) => c.image_url && allFiles.add(fileOf(c.image_url)));
  [extra('a'), extra('b')].forEach((u) => allFiles.add(fileOf(u)));

  const multi = products.find((p) => Number(p.id) === MULTI_IMAGE_PRODUCT_ID);
  const alwaysExist = new Set([...(multi ? [primaryFile(multi)] : []), fileOf(extra('a')), fileOf(extra('b'))]);
  const catImgs = categories.filter((c) => c.image_url).map((c) => fileOf(c.image_url));
  if (catImgs[0]) alwaysExist.add(catImgs[0]);
  const alwaysMissing = new Set();
  const p124 = products.find((p) => Number(p.id) === 124); if (p124) alwaysMissing.add(primaryFile(p124));
  if (catImgs[1]) alwaysMissing.add(catImgs[1]);

  const hashMissing = (f) => parseInt(String(f).replace(/\D/g, '').slice(-2) || '0', 10) % 5 === 0;
  const exists = (f) => {
    if (uploads === 'exist') return true;
    if (uploads === 'missing') return false;
    if (alwaysExist.has(f)) return true;
    if (alwaysMissing.has(f)) return false;
    return !hashMissing(f);
  };
  const onDisk = [];
  for (const f of allFiles) if (f && exists(f)) { fs.writeFileSync(path.join(uploadsDir, f), png(300, 300, f)); onDisk.push(f); }

  // ---- shipping settings come from the REAL (new) /api/settings controller, overlaid on production data ----
  const internal = http.createServer(app);
  await new Promise((r) => internal.listen(0, '127.0.0.1', r));
  const internalOrigin = `http://127.0.0.1:${internal.address().port}`;
  const meta = { settingsSource: 'production' };
  async function settingsBody(storeId) {
    const prodRes = await prod('/api/settings', storeId);
    if (settingsMode !== 'rule') return prodRes;
    try {
      const real = await (await fetch(internalOrigin + '/api/settings', { headers: { 'x-store-id': String(storeId || 1) } })).json();
      const live = JSON.parse(prodRes.body); const dst = live.data.settings || live.data; const src = real.data.settings || real.data;
      let n = 0; for (const k of Object.keys(src)) if (/^(shipping|free_shipping|gst_|tax_|trade_name|legal_supplier_name|gstin|checkout_tax_ready)/.test(k)) { dst[k] = src[k]; n++; }
      if (!n) throw new Error('no shipping keys');
      meta.settingsSource = `real settingsController (fake DB, supplier=${supplier}, no shipping rule row => built-in shipping defaults) overlaid on production settings`;
      return { status: 200, body: JSON.stringify(live) };
    } catch (e) { meta.settingsSource = 'production (overlay failed: ' + e.message + ')'; return prodRes; }
  }

  // ---- HTTP server ----
  const state = { api: 'ok', apiDelayMs: 0, uploads: 'ok' };
  const log = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://mock');
    const entry = { method: req.method, path: u.pathname + u.search, t: Date.now() };
    log.push(entry);
    res.on('finish', () => { entry.status = res.statusCode; });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Store-ID, Authorization, Accept, Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (u.pathname.startsWith('/uploads/')) { if (state.uploads === 'hang') return; return app(req, res); }
    if (u.pathname === '/api/coupons/validate') return app(req, res);
    if (u.pathname.startsWith('/api/')) {
      if (state.api === 'hang') return;
      if (state.apiDelayMs) await sleep(state.apiDelayMs);
      res.setHeader('content-type', 'application/json');
      if (state.api === 'fail') { res.statusCode = 500; return res.end(JSON.stringify({ success: false, error: { message: 'An internal error occurred. Please try again later.', statusCode: 500 } })); }
      if (req.method !== 'GET') { res.statusCode = 501; return res.end(JSON.stringify({ success: false, error: { message: 'QA backend is read-only' } })); }
      try { const r = u.pathname === '/api/settings' ? await settingsBody(req.headers['x-store-id']) : await prod(u.pathname + u.search, req.headers['x-store-id']); res.statusCode = r.status; return res.end(r.body); }
      catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ success: false, error: { message: 'proxy failure' } })); }
    }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin, apiBase: origin + '/api', state, log, products, categories,
    meta: Object.assign(meta, { settingsMode, uploads, onDiskCount: onDisk.length, totalReferenced: allFiles.size, multiImageProductId: MULTI_IMAGE_PRODUCT_ID, exists, primaryFile, catImgs, alwaysExist, alwaysMissing }),
    async close() { await new Promise((r) => server.close(r)); await new Promise((r) => internal.close(r)); fs.rmSync(uploadsDir, { recursive: true, force: true }); }
  };
}

module.exports = { start, MULTI_IMAGE_PRODUCT_ID };
