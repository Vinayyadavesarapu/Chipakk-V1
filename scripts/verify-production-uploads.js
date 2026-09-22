#!/usr/bin/env node
/**
 * READ-ONLY check that every image path the API publishes is actually served.
 *
 *   node scripts/verify-production-uploads.js [--api https://api.chipakk.shop] [--stores 1,2]
 *                                             [--concurrency 8] [--out missing-uploads.txt] [--timeout 20000]
 *
 * It only performs GET (catalogue) and HEAD (each /uploads/<file>) requests. It writes nothing to the server, and the only
 * thing it writes locally is the optional --out list of missing file names (the manifest to restore from a backup).
 *
 * What it reads (public API, per store, sent as X-Store-ID):
 *   /api/products   -> every product image (product_images / marshans_product_images) and the primary image
 *   /api/categories -> category image_url and category media (hero_light, hero_dark, banner, thumbnail)
 * NOTE: the public API lists ACTIVE catalogue rows only. Inactive rows and private custom artwork are not visible here; use
 * database/ops/list_upload_paths.sql (read-only SQL) for the complete list of file names the database references.
 *
 * Exit code: 0 = every referenced file is served as an image, 1 = at least one is missing / not an image, 2 = could not run.
 */
const fs = require('fs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; };
const API = String(arg('api', 'https://api.chipakk.shop')).replace(/\/+$/, '');
const STORES = String(arg('stores', '1,2')).split(',').map((s) => parseInt(s, 10)).filter((n) => n === 1 || n === 2);
const CONCURRENCY = Math.max(1, Math.min(32, parseInt(arg('concurrency', '8'), 10) || 8));
const TIMEOUT = Math.max(2000, parseInt(arg('timeout', '20000'), 10) || 20000);
const OUT = arg('out', null);
const STORE_NAME = { 1: 'CHIPAKK', 2: 'THE MARSHANS' };

const withTimeout = async (url, opts = {}) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
};
const getJson = async (path, storeId) => {
  const res = await withTimeout(API + path, { headers: { Accept: 'application/json', 'X-Store-ID': String(storeId) } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()).data;
};

/** "/uploads/x.webp", "https://api.chipakk.shop/uploads/x.webp?v=1" -> "/uploads/x.webp"; anything else -> null */
const uploadPath = (value) => {
  if (typeof value !== 'string' || !value) return null;
  let p = value.trim();
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch (_) { return null; }
  p = p.split('?')[0].split('#')[0];
  return /^\/uploads\/[^/]+$/.test(p) ? p : null;
};

async function collect(storeId, refs) {
  const add = (value, kind, id) => { const p = uploadPath(value); if (!p) return; const key = p; if (!refs.has(key)) refs.set(key, []); refs.get(key).push({ store: storeId, kind, id }); };
  // products (paginated: the API caps `limit`, so never assume one page holds everything)
  let offset = 0, total = Infinity, pages = 0, seenProducts = 0;
  while (offset < total && pages < 200) {
    const d = await getJson(`/api/products?limit=100&offset=${offset}`, storeId);
    const list = (d && d.products) || (Array.isArray(d) ? d : []);
    total = typeof (d && d.total) === 'number' ? d.total : list.length;
    for (const p of list) {
      seenProducts++;
      (p.images || []).forEach((img) => add(img && (img.image_url || img.external_url || img.url), 'product', p.id));
      add(p.primary_image_url, 'product', p.id);
    }
    if (!list.length) break;
    offset += list.length; pages++;
  }
  // categories
  const cd = await getJson('/api/categories', storeId);
  const cats = Array.isArray(cd) ? cd : ((cd && cd.categories) || []);
  cats.forEach((c) => {
    add(c.image_url, 'category', c.id);
    const m = c.media || {}; ['hero_light', 'hero_dark', 'banner', 'thumbnail'].forEach((k) => add(m[k], 'category', c.id));
  });
  const storePaths = new Set(); for (const [p, uses] of refs) if (uses.some((u) => u.store === storeId)) storePaths.add(p);
  return { products: seenProducts, productsTotal: Number.isFinite(total) ? total : seenProducts, categories: cats.length, uploadPaths: storePaths.size };
}

async function probe(path) {
  try {
    let res = await withTimeout(API + path, { method: 'HEAD' });
    if (res.status === 405 || res.status === 501) res = await withTimeout(API + path, { headers: { Range: 'bytes=0-0' } });
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (res.status === 200 || res.status === 206) return type.startsWith('image/') ? { ok: true, status: res.status, type } : { ok: false, status: res.status, reason: `served but Content-Type is "${type || 'none'}"` };
    return { ok: false, status: res.status, reason: res.status === 404 ? 'file not found on the server' : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, reason: `network error: ${err.name === 'AbortError' ? 'timeout' : err.message}`, network: true };
  }
}

async function pool(items, worker, size) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await worker(items[i]); } }));
  return out;
}

(async () => {
  console.log(`Verifying uploads served by ${API}  (read-only: GET catalogue + HEAD files)\n`);
  const refs = new Map(); const perStore = {};
  for (const s of STORES) {
    try { perStore[s] = await collect(s, refs); }
    catch (err) { console.error(`Could not read the catalogue for store ${s} (${STORE_NAME[s]}): ${err.message}`); process.exit(2); }
    const c = perStore[s];
    console.log(`Store ${s} ${STORE_NAME[s]}: ${c.products} products (API total ${c.productsTotal}), ${c.categories} categories`);
  }
  const paths = [...refs.keys()].sort();
  console.log(`\n${paths.length} distinct /uploads files are referenced by the published catalogue. Checking each...\n`);
  const results = await pool(paths, probe, CONCURRENCY);

  const byGroup = {}; const bad = []; let networkErrors = 0;
  paths.forEach((p, i) => {
    const r = results[i]; if (r.network) networkErrors++;
    for (const use of refs.get(p)) { const g = `${STORE_NAME[use.store]} ${use.kind}`; byGroup[g] = byGroup[g] || { ok: 0, bad: 0 }; r.ok ? byGroup[g].ok++ : byGroup[g].bad++; }
    if (!r.ok) bad.push({ path: p, ...r, uses: refs.get(p) });
  });
  console.log('Per store / kind (a file used twice counts twice):');
  Object.keys(byGroup).sort().forEach((g) => console.log(`  ${g.padEnd(24)} served: ${String(byGroup[g].ok).padStart(4)}   missing/bad: ${String(byGroup[g].bad).padStart(4)}`));
  for (const s of STORES) if (!perStore[s].uploadPaths) console.log(`  !! ${STORE_NAME[s]}: the public API published NO /uploads images (${perStore[s].products} products, ${perStore[s].categories} categories). That does not prove the database has none: list what it really references with database/ops/list_upload_paths.sql.`);

  const okCount = paths.length - bad.length;
  console.log(`\nRESULT: ${okCount}/${paths.length} files are served as images${bad.length ? `, ${bad.length} are NOT` : ''}.`);
  if (bad.length) {
    console.log('\nFirst problems:');
    bad.slice(0, 12).forEach((b) => console.log(`  HTTP ${String(b.status).padEnd(3)} ${b.path.replace('/uploads/', '')}   (${b.reason}; used by ${b.uses.slice(0, 2).map((u) => `${STORE_NAME[u.store]} ${u.kind} #${u.id}`).join(', ')}${b.uses.length > 2 ? ', …' : ''})`));
    if (bad.length > 12) console.log(`  … and ${bad.length - 12} more`);
    if (OUT) { fs.writeFileSync(OUT, bad.map((b) => b.path.replace('/uploads/', '')).join('\n') + '\n'); console.log(`\nFile names to restore (exact names) written to ${OUT}`); }
  } else if (OUT) { fs.writeFileSync(OUT, ''); }
  process.exit(networkErrors && networkErrors === bad.length && bad.length ? 2 : (bad.length ? 1 : 0));
})().catch((err) => { console.error('Verifier failed:', err.message); process.exit(2); });
