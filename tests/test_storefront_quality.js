/**
 * CHIPAKK — Storefront Quality Pass: behavioural test suite
 *
 * These tests EXECUTE the shipped code:
 *   - customer-workspace/js/media.js, catalog.js, app.js, checkout.js  (via a vm harness)
 *   - server/services/*, server/routes/coupons.js and the real Express app (with a fake DB)
 * They do not grep source text for implementation strings. Where a check is about a static file
 * (HTML script order, .htaccess) it asserts on structure the browser/Apache actually consumes.
 *
 * Coverage limits (see the report): this suite cannot prove pixels. Layout is verified separately by
 * tests/visual/run_visual_qa.js (real Chrome).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const { createMedia, installFallback } = require('../customer-workspace/js/media.js');
const { createCatalog } = require('../customer-workspace/js/catalog.js');
const { loadStorefront, envelope } = require('./helpers/storefront_vm');
const { createFakePool, installFakePool, parseInsert } = require('./helpers/fake_db');
const fixture = require('./fixtures/catalog_sample.json');
const gstFixture = require('./helpers/gst_fixture');

const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.message}`); }
}

const API = 'https://api.chipakk.shop/api';
const media = createMedia({ apiBase: API });
const fmt = (n) => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN');
const catalog = createCatalog({ media, formatPrice: fmt, storeId: 1 });

/** Very small well-formedness check: every opened tag is closed in order (void tags ignored). */
function assertBalancedHtml(html, label) {
  const VOID = new Set(['img', 'br', 'input', 'hr', 'meta', 'link', 'path', 'circle', 'line', 'polygon', 'rect']);
  const stack = [];
  const re = /<\/?([a-zA-Z0-9]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [full, tag, , selfClose] = m;
    const t = tag.toLowerCase();
    if (VOID.has(t) || selfClose === '/') continue;
    if (full.startsWith('</')) {
      const open = stack.pop();
      assert.strictEqual(open, t, `${label}: expected </${open}> but found </${t}>`);
    } else stack.push(t);
  }
  assert.strictEqual(stack.length, 0, `${label}: unclosed tags: ${stack.join(',')}`);
}

(async () => {
  /* ======================= IMAGE RESOLVER ======================= */
  await test('IMAGE', '/uploads/... resolves to the API origin (never the storefront origin)', () => {
    assert.strictEqual(media.resolve('/uploads/product-1-2.webp'), 'https://api.chipakk.shop/uploads/product-1-2.webp');
    assert.strictEqual(media.resolve('uploads/product-1-2.webp'), 'https://api.chipakk.shop/uploads/product-1-2.webp');
    assert.strictEqual(media.resolve('./uploads/x.webp'), 'https://api.chipakk.shop/uploads/x.webp');
    assert.strictEqual(media.resolve('product-9.webp'), 'https://api.chipakk.shop/uploads/product-9.webp');
  });
  await test('IMAGE', 'absolute API URLs stay correct; http is upgraded to https', () => {
    assert.strictEqual(media.resolve('https://api.chipakk.shop/uploads/a.webp'), 'https://api.chipakk.shop/uploads/a.webp');
    assert.strictEqual(media.resolve('http://api.chipakk.shop/uploads/a.webp'), 'https://api.chipakk.shop/uploads/a.webp');
  });
  await test('IMAGE', 'stale wrong-origin URLs (chipakk.shop/uploads, localhost) are rewritten to the API origin', () => {
    for (const u of ['https://chipakk.shop/uploads/a.webp', 'https://www.chipakk.shop/uploads/a.webp', 'http://localhost:3000/uploads/a.webp', 'https://themarshans.shop/uploads/a.webp']) {
      assert.strictEqual(media.resolve(u), 'https://api.chipakk.shop/uploads/a.webp', u);
    }
  });
  await test('IMAGE', 'external https URLs and Google Drive links remain valid', () => {
    assert.strictEqual(media.resolve('https://cdn.example.com/x.jpg'), 'https://cdn.example.com/x.jpg');
    assert.strictEqual(media.resolve('https://drive.google.com/file/d/ABC123/view'), 'https://drive.google.com/uc?export=view&id=ABC123');
  });
  await test('IMAGE', 'duplicate slashes normalised, filenames preserved, query kept', () => {
    assert.strictEqual(media.resolve('//uploads//x.webp'), 'https://api.chipakk.shop/uploads/x.webp');
    assert.strictEqual(media.resolve('/uploads//a//b.webp'), 'https://api.chipakk.shop/uploads/a/b.webp');
    assert.strictEqual(media.resolve('/uploads/product-1789803969669-697565554.webp?v=2'), 'https://api.chipakk.shop/uploads/product-1789803969669-697565554.webp?v=2');
  });
  await test('IMAGE', 'site assets stay page-relative (hero fallback must not go to the API origin)', () => {
    assert.strictEqual(media.resolve('assets/images/hero-fallback.svg'), 'assets/images/hero-fallback.svg');
    assert.strictEqual(media.resolve('/assets/images/logo.png'), 'assets/images/logo.png');
  });
  await test('IMAGE', 'null / empty / emoji / non-string produce "" (no request, no crash)', () => {
    for (const v of [null, undefined, '', '   ', '⚡', 42, {}, []]) assert.strictEqual(media.resolve(v), '', String(v));
  });
  await test('IMAGE', 'unsafe input is rejected: javascript:, svg/text data URIs, path traversal', () => {
    assert.strictEqual(media.resolve('javascript:alert(1)'), '');
    assert.strictEqual(media.resolve('data:image/svg+xml;base64,PHN2Zz4='), '');
    assert.strictEqual(media.resolve('data:text/html;base64,PGI+'), '');
    assert.strictEqual(media.resolve('/uploads/../../etc/passwd'), '');
    assert.strictEqual(media.resolve('/uploads/%2e%2e/x.webp'), '');
  });
  await test('IMAGE', 'never PRODUCES base64 for a backend-hosted image', () => {
    const p = catalog.normalizeProduct({ id: 1, name: 'x', price: 15, primary_image_url: '/uploads/a.webp' });
    assert.ok(!p.imageUrl.startsWith('data:') && p.images.every((u) => !u.startsWith('data:')));
  });
  await test('IMAGE', 'imgHtml emits one canonical, escaped <img> (dimensions, decoding, lazy/eager)', () => {
    const lazy = media.imgHtml({ src: '/uploads/a.webp', alt: 'A "q" <b>', width: 300, height: 300 });
    assert.ok(/^<img /.test(lazy) && lazy.includes('data-media') && lazy.includes('width="300"') && lazy.includes('height="300"'));
    assert.ok(lazy.includes('decoding="async"') && lazy.includes('loading="lazy"'));
    assert.ok(lazy.includes('alt="A &quot;q&quot; &lt;b&gt;"'), 'alt must be escaped');
    assert.ok(!/onerror=/i.test(lazy), 'no inline onerror handlers');
    const eager = media.imgHtml({ src: '/uploads/a.webp', alt: 'A', priority: true });
    assert.ok(eager.includes('loading="eager"') && eager.includes('fetchpriority="high"'));
  });
  await test('IMAGE', 'a missing image renders the placeholder element, not a broken <img>', () => {
    const html = media.imgHtml({ src: null, alt: 'No pic' });
    assert.ok(html.startsWith('<span class="img-placeholder"') && !html.includes('<img'));
  });

  /* ======================= FALLBACK HANDLER ======================= */
  function fakeDocument() {
    const handlers = [];
    return {
      handlers,
      addEventListener: (type, fn, capture) => handlers.push({ type, fn, capture }),
      createElement: () => { const attrs = {}; return { className: '', attrs, setAttribute: (k, v) => { attrs[k] = v; } }; }
    };
  }
  function fakeImg(attrs) {
    const a = Object.assign({}, attrs);
    const parent = { replaced: null, replaceChild(n, o) { this.replaced = { n, o }; } };
    return { tagName: 'IMG', className: 'x', currentSrc: a.src, parentNode: parent, hasAttribute: (k) => k in a, getAttribute: (k) => (k in a ? a[k] : null), setAttribute: (k, v) => { a[k] = v; }, attrs: a };
  }
  await test('IMAGE', 'fallback: ONE capture-phase listener; a failed image is replaced once, then ignored (no loop)', () => {
    const doc = fakeDocument(); const failed = [];
    installFallback(doc, (src) => failed.push(src)); installFallback(doc); // second call is a no-op
    assert.strictEqual(doc.handlers.length, 1);
    assert.strictEqual(doc.handlers[0].type, 'error'); assert.strictEqual(doc.handlers[0].capture, true);
    const img = fakeImg({ 'data-media': '', src: 'https://api.chipakk.shop/uploads/missing.webp', alt: 'Naruto' });
    doc.handlers[0].fn({ target: img });
    assert.ok(img.parentNode.replaced, 'image replaced by placeholder');
    assert.strictEqual(img.parentNode.replaced.n.attrs['data-media-state'], 'placeholder');
    assert.strictEqual(img.parentNode.replaced.n.attrs['aria-label'], 'Naruto');
    assert.strictEqual(failed.length, 1);
    img.parentNode.replaced = null;
    doc.handlers[0].fn({ target: img }); doc.handlers[0].fn({ target: img });
    assert.strictEqual(img.parentNode.replaced, null, 'never replaced twice');
    assert.strictEqual(failed.length, 1, 'reported once');
  });
  await test('IMAGE', 'fallback: data-fallback-src is tried exactly once, then the placeholder (bounded, no infinite loop)', () => {
    const doc = fakeDocument(); installFallback(doc);
    const img = fakeImg({ 'data-media': '', src: 'https://api.chipakk.shop/uploads/hero.webp', alt: 'Hero', 'data-fallback-src': 'assets/images/hero-fallback.svg' });
    const fire = () => doc.handlers[0].fn({ target: img });
    fire(); assert.strictEqual(img.attrs.src, 'assets/images/hero-fallback.svg'); assert.strictEqual(img.parentNode.replaced, null);
    fire(); assert.ok(img.parentNode.replaced, 'second failure => placeholder');
    img.parentNode.replaced = null; fire(); fire(); assert.strictEqual(img.parentNode.replaced, null);
  });
  await test('IMAGE', 'fallback: ignores images it does not own and non-image elements', () => {
    const doc = fakeDocument(); installFallback(doc);
    const foreign = fakeImg({ src: 'x.png' });
    doc.handlers[0].fn({ target: foreign }); doc.handlers[0].fn({ target: { tagName: 'SCRIPT' } });
    assert.strictEqual(foreign.parentNode.replaced, null);
  });

  /* ======================= PRODUCT MODEL + CARDS ======================= */
  const real = fixture.products;
  await test('CARDS', 'real production products normalise: id, store, sku, resolved image, price rupees', () => {
    const k = catalog.normalizeProduct(real.find((p) => p.id === 129));
    assert.strictEqual(k.name, 'KATANA'); assert.strictEqual(k.price, 10); assert.strictEqual(k.store_id, 1);
    assert.ok(k.sku); assert.strictEqual(k.imageUrl, 'https://api.chipakk.shop/uploads/product-1789803969669-697565554.webp');
    assert.strictEqual(k.url, 'product.html?id=129'); assert.strictEqual(k.inStock, true, 'stock=0 without inventory tracking is NOT sold out');
  });
  await test('CARDS', 'empty array -> empty state markup; non-array / null entries never throw', () => {
    assert.strictEqual(catalog.productGridHtml([], { emptyHtml: '<p>none</p>' }), '<p>none</p>');
    for (const bad of [null, undefined, 'x', 5, {}]) assert.strictEqual(catalog.productGridHtml(bad, { emptyHtml: 'E' }), 'E');
    const html = catalog.productGridHtml([null, undefined, catalog.normalizeProduct(real[0])]);
    assert.strictEqual((html.match(/<article /g) || []).length, 1);
  });
  await test('CARDS', 'one product: valid HTML, link, id, sku, category, image, price, add-to-cart', () => {
    const p = catalog.normalizeProduct(real.find((x) => x.id === 128));
    const html = catalog.productCardHtml(p, { isWishlisted: false });
    assertBalancedHtml(html, 'card');
    assert.ok(html.includes('data-product-id="128"') && html.includes('data-sku="') && html.includes('data-store-id="1"'));
    assert.ok(html.includes('href="product.html?id=128"') && html.includes('data-add-to-cart="128"'));
    assert.ok(html.includes('<img ') && html.includes('api.chipakk.shop/uploads/product-1789800906087-447206127.webp'));
    assert.ok(html.includes('₹20') && html.includes('FRANKY WANTED POSTER'));
  });
  await test('CARDS', 'many products (500): one card each, unique ids, well-formed, fast', () => {
    const many = Array.from({ length: 500 }, (_, i) => catalog.normalizeProduct({ ...real[i % real.length], id: 1000 + i }));
    const t0 = Date.now(); const html = catalog.productGridHtml(many); const ms = Date.now() - t0;
    assert.strictEqual((html.match(/<article /g) || []).length, 500);
    const ids = html.match(/data-product-id="\d+"/g); assert.strictEqual(new Set(ids).size, 500, 'no duplicate ids');
    assertBalancedHtml(html, 'grid'); assert.ok(ms < 1500, `rendered in ${ms}ms`);
    assert.ok((html.match(/loading="eager"/g) || []).length === 4, 'only the first row is eager');
  });
  await test('CARDS', 'null / missing optional fields never break rendering', () => {
    const p = catalog.normalizeProduct({ id: 7, name: null, price: null, primary_image_url: null, images: null, tags: '{bad json', sku: null, category_name: null, compare_at_price: null, description: null, rating: 'abc' });
    const html = catalog.productCardHtml(p);
    assertBalancedHtml(html, 'sparse card');
    assert.ok(html.includes('product-media-art') || html.includes('img-placeholder'), 'no image -> placeholder, never <img src="">');
    assert.ok(!/src=""/.test(html) && !/undefined|null|NaN/.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')), 'no "undefined"/"null"/"NaN" leaks into markup');
  });
  await test('CARDS', 'content-controlled strings are escaped (name, sku, category, id)', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const p = catalog.normalizeProduct({ id: '5', name: evil, sku: evil, category_slug: evil, category_name: evil, price: 15, primary_image_url: '/uploads/a.webp' });
    const html = catalog.productCardHtml(p);
    assert.ok(!html.includes('<img src=x'), 'raw tag must not survive');
    assert.strictEqual((html.match(/<img /g) || []).length, 1, 'only the real image tag exists');
    assert.ok(!/<[^>]*\son\w+=/i.test(html.replace(/"[^"]*"/g, '""')), 'no event-handler ATTRIBUTE in any tag (escaped text inside quoted values is fine)');
    assertBalancedHtml(html, 'escaped card');
  });
  await test('CARDS', 'duplicate ids in one grid render once', () => {
    const p = catalog.normalizeProduct(real[0]);
    assert.strictEqual((catalog.productGridHtml([p, p, p]).match(/<article /g) || []).length, 1);
  });
  await test('CARDS', 'compare-at price shows only when > price; best-seller badge; sold-out disables the button', () => {
    const base = { id: 1, name: 'A', price: 100, primary_image_url: '/uploads/a.webp' };
    assert.ok(catalog.productCardHtml(catalog.normalizeProduct({ ...base, compare_at_price: 150 })).includes('product-price-orig'));
    assert.ok(!catalog.productCardHtml(catalog.normalizeProduct({ ...base, compare_at_price: 100 })).includes('product-price-orig'));
    assert.ok(!catalog.productCardHtml(catalog.normalizeProduct({ ...base, compare_at_price: 50 })).includes('product-price-orig'));
    assert.ok(!catalog.productCardHtml(catalog.normalizeProduct({ ...base, compare_at_price: 0 })).includes('product-price-orig'));
    assert.ok(catalog.productCardHtml(catalog.normalizeProduct({ ...base, is_best_seller: 1 })).includes('data-best-seller="true"'));
    const sold = catalog.productCardHtml(catalog.normalizeProduct({ ...base, in_stock: false }));
    assert.ok(sold.includes('is-sold-out') && /data-add-to-cart="1"[^>]*disabled/.test(sold));
  });
  await test('CARDS', 'compare-at price: the exact required scenarios (₹15/₹25, null, ₹15, ₹10, missing) and never a %/savings label', () => {
    const p15 = { id: 2, name: 'B', price: 15, primary_image_url: '/uploads/a.webp' };
    // price=15, compare_at_price=25 -> "₹25 ₹15", ₹25 struck through (product-price-orig), ₹15 the primary product-price
    const shown = catalog.productCardHtml(catalog.normalizeProduct({ ...p15, compare_at_price: 25 }));
    assert.ok(/<span class="product-price">₹15<\/span><span class="product-price-orig">₹25<\/span>/.test(shown), shown);
    // price=15, compare_at_price=NULL -> only ₹15
    const nullCase = catalog.productCardHtml(catalog.normalizeProduct({ ...p15, compare_at_price: null }));
    assert.ok(nullCase.includes('₹15') && !nullCase.includes('product-price-orig'));
    // price=15, compare_at_price=15 (equal) -> only ₹15
    const equalCase = catalog.productCardHtml(catalog.normalizeProduct({ ...p15, compare_at_price: 15 }));
    assert.ok(equalCase.includes('₹15') && !equalCase.includes('product-price-orig'));
    // price=15, compare_at_price=10 (lower) -> only ₹15
    const lowerCase = catalog.productCardHtml(catalog.normalizeProduct({ ...p15, compare_at_price: 10 }));
    assert.ok(lowerCase.includes('₹15') && !lowerCase.includes('product-price-orig'));
    // compare_at_price key entirely missing from the API payload -> only ₹15
    const missingCase = catalog.productCardHtml(catalog.normalizeProduct({ ...p15 }));
    assert.ok(missingCase.includes('₹15') && !missingCase.includes('product-price-orig'));
    // never a %-off / discount / savings / sale label anywhere near the price
    for (const html of [shown, nullCase, equalCase, lowerCase, missingCase]) {
      assert.ok(!/%\s*off|discount|savings|save\s*₹|\bsale\b/i.test(html), `no discount label: ${html}`);
    }
  });
  await test('CARDS', 'money: CHIPAKK shows whole rupees; MARSHANS uses the server-provided rupee value from paise', () => {
    assert.ok(catalog.productCardHtml(catalog.normalizeProduct({ id: 1, name: 'A', price: 1500, price_rupees: 1500, primary_image_url: '/uploads/a.webp' })).includes('₹1,500'));
    // store 2 API sends paise in `price` and the converted value in price_rupees; the card must never show paise
    const m = catalog.normalizeProduct({ id: 3, store_id: 2, name: 'Lamp', price: 149900, price_rupees: 1499, primary_image_url: '/uploads/a.webp' });
    assert.ok(catalog.productCardHtml(m).includes('₹1,499') && !catalog.productCardHtml(m).includes('149,900'));
    assert.ok(catalog.productCardHtml(m).includes('data-store-id="2"'));
  });
  await test('CARDS', 'filtered / sorted / searched / paginated lists render straight from normalised arrays', () => {
    const all = real.map((p) => catalog.normalizeProduct(p));
    const filtered = all.filter((p) => p.categorySlug === all[0].categorySlug);
    const sorted = [...filtered].sort((a, b) => a.price - b.price);
    const searched = all.filter((p) => /naruto/i.test(p.name));
    const page = all.slice(2, 6);
    for (const [label, list] of [['filtered', filtered], ['sorted', sorted], ['searched', searched], ['page', page]]) {
      const html = catalog.productGridHtml(list); assertBalancedHtml(html, label);
      assert.strictEqual((html.match(/<article /g) || []).length, list.length, label);
    }
    assert.strictEqual(catalog.productGridHtml(all.filter((p) => /zzzz/.test(p.name)), { emptyHtml: 'EMPTY' }), 'EMPTY');
  });
  await test('CARDS', 'wishlist mode renders move-to-cart and remove buttons without inline styles', () => {
    const html = catalog.productCardHtml(catalog.normalizeProduct(real[0]), { mode: 'wishlist' });
    assert.ok(html.includes('data-move-cart=') && html.includes('data-remove-wish=') && !html.includes('data-wishlist-id=') && !/ style="/.test(html));
  });
  await test('CARDS', 'category media goes through the same resolver and fails soft to an icon', () => {
    const c = catalog.normalizeCategory({ id: 1, name: 'Anime', slug: 'anime', image_url: '/uploads/cat.png', product_count: 52 });
    assert.ok(catalog.categoryMediaHtml(c).includes('https://api.chipakk.shop/uploads/cat.png'));
    assert.strictEqual(catalog.normalizeCategory({ id: 2, name: 'Icon' }).image_url, null);
    assert.ok(catalog.categoryMediaHtml(catalog.normalizeCategory({ id: 2, name: 'Icon' })).startsWith('<span>'));
  });

  await test('CARDS', 'star rating: unrated (0 / missing / NaN) renders empty stars, never a fabricated 5; values are clamped', () => {
    const { starsMarkup } = require('../customer-workspace/js/catalog.js');
    const filled = (r) => (starsMarkup(r).match(/<svg viewBox/g) || []).length;
    const empty = (r) => (starsMarkup(r).match(/star-empty/g) || []).length;
    for (const r of [0, undefined, null, NaN, 'abc', -3]) assert.deepStrictEqual([filled(r), empty(r)], [0, 5], `rating ${String(r)}`);
    assert.deepStrictEqual([filled(4.7), empty(4.7)], [5, 0]);
    assert.deepStrictEqual([filled(3.2), empty(3.2)], [3, 2]);
    assert.deepStrictEqual([filled(99), empty(99)], [5, 0]);
  });

  await test('CARDS', 'normalised product contract: id, store_id, name, slug, sku, price, compare_at_price, description, category_id/slug, image(s), is_best_seller, inventory, variants -- nothing invented', () => {
    const n = (o) => catalog.normalizeProduct(o);
    // 1. a real production row (no rating fields, description null, stock 0, compare-at 0)
    const raw = real[0]; const p = n(raw);
    assert.strictEqual(p.id, String(raw.id)); assert.strictEqual(p.store_id, raw.store_id); assert.strictEqual(p.name, raw.name);
    assert.strictEqual(p.sku, raw.sku || ''); assert.ok(p.slug, 'slug is derived from admin_product_id only when the API sends none');
    assert.strictEqual(p.price, raw.price_rupees); assert.ok(!(p.compare_at_price > p.price), 'compare-at 0 must not read as a discount');
    assert.strictEqual(p.description, ''); assert.strictEqual(p.categoryId, String(raw.category_id)); assert.strictEqual(p.categorySlug, raw.category_slug);
    assert.ok(p.imageUrl.startsWith('https://api.chipakk.shop/uploads/') && p.images[0] === p.imageUrl, 'image goes through the resolver');
    assert.strictEqual(typeof p.is_best_seller, 'boolean'); assert.strictEqual(p.stock, 0); assert.strictEqual(p.inStock, true, 'stock 0 without an explicit signal is NOT sold out');
    assert.deepStrictEqual(Array.from(p.variants), []); assert.strictEqual(p.variantId, null);
    // 2. ratings are never invented: the list API sends none
    assert.strictEqual(p.rating, 0); assert.strictEqual(p.ratingCount, 0); assert.strictEqual(p.hasRating, false);
    const card = catalog.productCardHtml(p);
    assert.ok(!/rating-val/.test(card) && /Not rated yet/.test(card) && (card.match(/star-empty/g) || []).length === 5, 'unrated card: empty stars, no fake number');
    assert.ok(!/4\.7/.test(card), 'no invented 4.7');
    const rated = n({ ...raw, average_rating: 4.3, review_count: 12 });
    assert.strictEqual(rated.rating, 4.3); assert.strictEqual(rated.ratingCount, 12); assert.strictEqual(rated.hasRating, true);
    assert.ok(/rating-val">4\.3</.test(catalog.productCardHtml(rated)) && /\(12\)/.test(catalog.productCardHtml(rated)));
    // 3. a sparse row: nothing throws, nothing is fabricated
    const sp = n({ id: 7 });
    assert.strictEqual(sp.sku, ''); assert.strictEqual(sp.description, ''); assert.strictEqual(sp.categoryId, ''); assert.strictEqual(sp.categorySlug, '');
    assert.strictEqual(sp.imageUrl, ''); assert.deepStrictEqual(Array.from(sp.images), []); assert.strictEqual(sp.compare_at_price, null);
    assert.strictEqual(sp.stock, null); assert.strictEqual(sp.variantId, null); assert.strictEqual(sp.store_id, 1, 'falls back to the ACTIVE store only');
    assert.ok(catalog.productCardHtml(sp).includes('img-placeholder'), 'no image -> real placeholder, not a guessed URL');
    for (const bad of [null, undefined, 0, 'x', [], {}, { name: 'no id' }, { id: '' }]) assert.strictEqual(n(bad), null, `bad input ${JSON.stringify(bad)}`);
    // 4. hostile / malformed image data never becomes a URL; valid entries survive; duplicates collapse
    const h = n({ id: 8, images: [null, 5, {}, 'javascript:alert(1)', '/uploads/../../etc/passwd', { image_url: '/uploads/a.webp' }, '/uploads/a.webp'], primary_image_url: 'data:text/html;base64,PHNjcmlwdD4=' });
    assert.deepStrictEqual(Array.from(h.images), ['https://api.chipakk.shop/uploads/a.webp']);
    // 5. Store 2 keeps its own id and the server-provided rupee value (paise-derived), variants pick the default
    const m2 = n({ id: 9, store_id: 2, price: 129900, price_rupees: 1299, variants: [{ variant_id: 5, variant_slug: 'xl' }, { variant_id: 6, variant_slug: 'default' }] });
    assert.strictEqual(m2.store_id, 2); assert.strictEqual(m2.price, 1299); assert.strictEqual(m2.variantId, 6);
    // 6. explicit availability signals only
    assert.strictEqual(n({ id: 1, in_stock: false }).inStock, false); assert.strictEqual(n({ id: 1, track_inventory: true, stock: 0 }).inStock, false); assert.strictEqual(n({ id: 1, track_inventory: true, stock: 3 }).inStock, true);
  });

  /* ======================= REAL app.js: catalog, cart, loader ======================= */
  const productsHandler = (list) => async (url) => {
    if (/\/products/.test(url)) { const u = new URL(url); const off = +u.searchParams.get('offset') || 0; const lim = +u.searchParams.get('limit') || 50; return envelope({ total: list.length, products: list.slice(off, off + lim) }); }
    return envelope({});
  };
  await test('APP', 'getProducts loads the WHOLE catalog (pagination) and dedupes concurrent callers', async () => {
    const big = Array.from({ length: 177 }, (_, i) => ({ ...real[i % real.length], id: 500 + i, store_id: 1 }));
    const sf = loadStorefront({ fetch: productsHandler(big) });
    const [a, b] = await Promise.all([sf.CHIPAKK.getProducts(), sf.CHIPAKK.getProducts()]);
    assert.strictEqual(a.length, 177); assert.strictEqual(a, b, 'concurrent calls share one result');
    assert.strictEqual(sf.record.filter((r) => /\/products\?/.test(r.url)).length, 2, '100 + 77 = 2 requests, not 4');
    await sf.CHIPAKK.getProducts(); assert.strictEqual(sf.record.filter((r) => /\/products\?/.test(r.url)).length, 2, 'cached afterwards');
  });
  await test('APP', 'catalogue paging: page 1 gives `total`, the REST are fetched IN PARALLEL (2 round-trips at any size), order preserved, page ceiling holds', async () => {
    const all = Array.from({ length: 437 }, (_, i) => ({ ...real[i % real.length], id: 9000 + i, store_id: 1 }));
    let inFlight = 0; let maxInFlight = 0; const offsets = [];
    const tracked = async (url) => {
      const u = new URL(url); const off = +u.searchParams.get('offset') || 0; const lim = +u.searchParams.get('limit') || 50; offsets.push(off);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, off === 0 ? 5 : 30 - Math.min(off / 100, 25))); // later pages finish EARLIER than earlier ones
      inFlight--; return envelope({ products: all.slice(off, off + lim), total: all.length, limit: lim, offset: off });
    };
    const sf = loadStorefront({ fetch: async (url) => (/\/products\?/.test(url) ? tracked(url) : envelope({})) });
    const list = await sf.CHIPAKK.getProducts();
    assert.strictEqual(list.length, 437); assert.deepStrictEqual(offsets.sort((a, b) => a - b), [0, 100, 200, 300, 400]);
    assert.ok(maxInFlight >= 4, `pages 2..5 must overlap (max in flight ${maxInFlight})`);
    assert.strictEqual(JSON.stringify(list.map((p) => p.id)), JSON.stringify(all.map((p) => String(p.id))), 'catalogue order equals sequential paging even when pages finish out of order');
    // ceiling: a huge (or lying) `total` can never trigger unbounded requests
    const huge = loadStorefront({ fetch: async (url) => { if (/\/products\?/.test(url)) { const off = +new URL(url).searchParams.get('offset') || 0; return envelope({ products: Array.from({ length: 100 }, (_, i) => ({ ...real[0], id: 1e6 + off + i, store_id: 1 })), total: 10 ** 9 }); } return envelope({}); } });
    await huge.CHIPAKK.getProducts(); assert.ok(huge.record.filter((r) => /\/products\?/.test(r.url)).length <= 20, 'bounded by the page ceiling');
  });
  await test('APP', 'store isolation: a Store 2 product in a Store 1 response is dropped before rendering', async () => {
    const mixed = [{ ...real[0], id: 1, store_id: 1 }, { ...real[1], id: 2, store_id: 2 }, { ...real[2], id: 3, store_id: null }];
    const sf = loadStorefront({ fetch: productsHandler(mixed) });
    const list = await sf.CHIPAKK.getProducts();
    assert.strictEqual(JSON.stringify(list.map((p) => p.id).sort()), JSON.stringify(['1', '3']));

    // On themarshans.shop, hostname resolution routes to Store 2 and isolates Store 2 products
    const sfM = loadStorefront({ location: { hostname: 'themarshans.shop', origin: 'https://themarshans.shop' }, fetch: productsHandler(mixed) });
    const listM = await sfM.CHIPAKK.getProducts();
    assert.strictEqual(JSON.stringify(listM.map((p) => p.id).sort()), JSON.stringify(['2', '3']), 'themarshans.shop selects Store 2 products');
    assert.strictEqual(sfM.record[0].headers['X-Store-ID'], '2', 'themarshans.shop sends X-Store-ID: 2');

    // www.themarshans.shop routes to Store 2
    const sfMwww = loadStorefront({ location: { hostname: 'www.themarshans.shop', origin: 'https://www.themarshans.shop' }, fetch: productsHandler(mixed) });
    assert.strictEqual(sfMwww.window.CHIPAKK.getActiveStoreId(), 2, 'www.themarshans.shop routes to Store 2');

    // chipakk.shop and www.chipakk.shop route to Store 1
    const sfC = loadStorefront({ location: { hostname: 'chipakk.shop', origin: 'https://chipakk.shop' }, fetch: productsHandler(mixed) });
    assert.strictEqual(sfC.window.CHIPAKK.getActiveStoreId(), 1, 'chipakk.shop routes to Store 1');
    const sfCwww = loadStorefront({ location: { hostname: 'www.chipakk.shop', origin: 'https://www.chipakk.shop' }, fetch: productsHandler(mixed) });
    assert.strictEqual(sfCwww.window.CHIPAKK.getActiveStoreId(), 1, 'www.chipakk.shop routes to Store 1');

    // Substring attacks / third-party domains do NOT match either store and default safely to Store 1
    const sfAttacker = loadStorefront({ location: { hostname: 'evil-marshans.com', origin: 'https://evil-marshans.com' }, fetch: productsHandler(mixed) });
    assert.strictEqual(sfAttacker.window.CHIPAKK.getActiveStoreId(), 1, 'evil-marshans.com does NOT match Store 2');

    // Backend storeContext middleware exact hostname allowlisting test
    const { resolveStoreContext } = require('../server/middleware/storeContext');
    const runMiddleware = (headers) => {
      const req = { headers: {}, get: (name) => headers[name.toLowerCase()] || '', query: {} };
      const res = { setHeader: (k, v) => {} };
      resolveStoreContext(req, res, () => {});
      return req.storeId;
    };
    assert.strictEqual(runMiddleware({ host: 'themarshans.shop' }), 2);
    assert.strictEqual(runMiddleware({ host: 'www.themarshans.shop' }), 2);
    assert.strictEqual(runMiddleware({ origin: 'https://themarshans.shop' }), 2);
    assert.strictEqual(runMiddleware({ referer: 'https://www.themarshans.shop/catalog' }), 2);
    assert.strictEqual(runMiddleware({ host: 'chipakk.shop' }), 1);
    assert.strictEqual(runMiddleware({ host: 'www.chipakk.shop' }), 1);
    assert.strictEqual(runMiddleware({ host: 'evil-themarshans.shop' }), 1, 'evil domain rejected');
    assert.strictEqual(runMiddleware({ referer: 'https://attacker.com/themarshans.shop' }), 1, 'referer path substring rejected');
  });
  await test('APP', 'strict mode surfaces API failure (so the shop shows a retry state instead of "no results")', async () => {
    const sf = loadStorefront({ fetch: async () => envelope({ error: 'down' }, 503) });
    await assert.rejects(() => sf.CHIPAKK.getProducts({ strict: true }));
    assert.strictEqual((await sf.CHIPAKK.getProducts()).length, 0, 'non-strict callers still get a safe empty list');
  });
  await test('APP', 'backend errors reach the customer as text, never "[object Object]"', async () => {
    const sf = loadStorefront({ fetch: async () => ({ ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ success: false, error: { message: 'Valid 10-digit mobile phone number is required.', statusCode: 400 } }) }) });
    await assert.rejects(() => sf.CHIPAKK.createOrderApi({ items: [] }), (e) => e.message === 'Valid 10-digit mobile phone number is required.');
  });
  await test('CART', 'stale persisted image URLs are re-resolved on load (old carts had chipakk.shop/uploads)', () => {
    const cart = [{ id: '129', variantKey: '129_glossy_3_', name: 'KATANA', price: 10, qty: 2, image: 'https://chipakk.shop/uploads/product-1789803969669-697565554.webp' },
      { id: '9', variantKey: '9_a', name: 'X', price: 5, qty: 1, image: '/uploads/x.webp' },
      { id: '3', variantKey: '3_a', name: 'Y', price: 5, qty: 1, image: '⚡' },
      { bogus: true }];
    const sf = loadStorefront({ storage: { chipakk_cart_v1: JSON.stringify(cart) } });
    const items = sf.CHIPAKK.cart.items;
    assert.strictEqual(items.length, 3, 'rows without a variantKey are dropped');
    assert.strictEqual(items[0].image, 'https://api.chipakk.shop/uploads/product-1789803969669-697565554.webp');
    assert.strictEqual(items[1].image, 'https://api.chipakk.shop/uploads/x.webp');
    assert.strictEqual(items[2].image, '', 'an emoji is not an image reference');
  });
  await test('CART', 'the SAME normalised product gives the same image in shop card, cart state and checkout row', () => {
    const sf = loadStorefront({});
    const p = sf.CHIPAKK.renderProductGrid ? catalog.normalizeProduct(real.find((x) => x.id === 127)) : null;
    sf.CHIPAKK.cart.clear(); sf.CHIPAKK.cart.addItem(p, 2);
    assert.strictEqual(sf.CHIPAKK.cart.items[0].image, p.imageUrl);
    assert.strictEqual(sf.CHIPAKK.cart.items[0].qty, 2);
    assert.ok(catalog.productCardHtml(p).includes(p.imageUrl));
    // survives a "refresh": a new page load reads the persisted cart
    const sf2 = loadStorefront({ storage: sf.storage });
    assert.strictEqual(sf2.CHIPAKK.cart.items[0].image, p.imageUrl);
  });

  const overlay = () => { const attrs = { 'data-hidden': 'false' }; const listeners = []; return { attrs, style: {}, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] || null, querySelector: () => ({ play: () => Promise.resolve(), pause() {}, setAttribute() {} }), addEventListener: (ev, fn) => listeners.push(fn) }; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await test('LOADER', 'no critical work: overlay hides on the next frame (no fixed 750ms delay)', async () => {
    const el = overlay(); const t0 = Date.now(); loadStorefront({ elements: { loadingOverlay: el } });
    while (el.attrs['data-hidden'] !== 'true' && Date.now() - t0 < 700) await sleep(5);
    assert.strictEqual(el.attrs['data-hidden'], 'true'); assert.ok(Date.now() - t0 < 300, `hid in ${Date.now() - t0}ms`);
    assert.strictEqual(el.attrs['data-hide-reason'], 'ready');
  });
  await test('LOADER', 'stays visible while a hold is pending, hides right after it is released', async () => {
    const el = overlay(); const sf = loadStorefront({ elements: { loadingOverlay: el } });
    const release = sf.CHIPAKK.loader.hold('products');
    await sleep(120); assert.strictEqual(el.attrs['data-hidden'], 'false', 'still loading');
    release(); release(); // idempotent
    await sleep(60); assert.strictEqual(el.attrs['data-hidden'], 'true');
  });
  await test('LOADER', 'a FAILED request still releases the overlay when released in finally', async () => {
    const el = overlay(); const sf = loadStorefront({ elements: { loadingOverlay: el }, fetch: async () => { throw new Error('offline'); } });
    const release = sf.CHIPAKK.loader.hold('catalog');
    try { await sf.CHIPAKK.getProducts({ strict: true }); } catch (_) { /* expected */ } finally { release(); }
    await sleep(80); assert.strictEqual(el.attrs['data-hidden'], 'true');
  });
  await test('LOADER', 'a hold that is never released cannot keep the overlay forever (ceiling)', async () => {
    const el = overlay(); const sf = loadStorefront({ elements: { loadingOverlay: el }, loaderMaxWaitMs: 150 });
    sf.CHIPAKK.loader.hold('hung'); await sleep(300);
    assert.strictEqual(el.attrs['data-hidden'], 'true'); assert.strictEqual(el.attrs['data-hide-reason'], 'ceiling');
  });

  /* ======================= CHECKOUT (real checkout.js) ======================= */
  const seedCart = (items) => ({ chipakk_cart_v1: JSON.stringify(items) });
  const item = (over) => ({ id: '129', variantKey: `k${Math.random()}`, name: 'KATANA', price: 10, qty: 1, image: 'https://api.chipakk.shop/uploads/a.webp', material: 'Glossy', size: '3"', ...over });
  const checkoutEl = () => ({ innerHTML: '', textContent: '', style: {}, disabled: false, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, closest: () => null, focus() {} });
  function loadCheckout(cartItems, extra = {}) {
    const els = { checkoutItemsList: checkoutEl(), checkoutSubtotal: checkoutEl(), checkoutShipping: checkoutEl(), checkoutTax: checkoutEl(), checkoutTotal: checkoutEl(), checkoutGstLabel: checkoutEl(), placeOrderBtn: checkoutEl(), checkoutDiscountRow: checkoutEl(), checkoutDiscountAmount: checkoutEl() };
    const sf = loadStorefront({ storage: seedCart(cartItems), elements: els, extraScripts: ['checkout.js'], ...extra });
    return { sf, els, tools: sf.CHIPAKK.checkoutTools };
  }
  await test('CHECKOUT', 'rows use the media pipeline: API-origin image, no inline onerror, class-based structure', () => {
    const { els } = loadCheckout([item({ image: 'https://chipakk.shop/uploads/wrong-origin.webp' }), item({ id: '2', name: 'B', image: '' })]);
    const html = els.checkoutItemsList.innerHTML;
    assert.ok(html.includes('src="https://api.chipakk.shop/uploads/wrong-origin.webp"'), 'wrong-origin URL was rewritten');
    assert.ok(html.includes('img-placeholder'), 'missing image -> placeholder');
    assert.ok(!/onerror=/i.test(html) && !/ style="/.test(html), 'no inline handlers/styles');
    assert.ok(html.includes('class="checkout-item-name"') && html.includes('class="checkout-item-price"') && html.includes('checkout-item-details'));
    assertBalancedHtml(html, 'checkout rows');
  });
  await test('CHECKOUT', 'a very long / hostile product name is escaped and left to CSS to wrap (no markup break)', () => {
    const long = 'SUPER '.repeat(60) + 'X'.repeat(200) + '<script>alert(1)</script>';
    const { els } = loadCheckout([item({ name: long })]);
    const html = els.checkoutItemsList.innerHTML;
    assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
    assertBalancedHtml(html, 'long name');
  });
  await test('CHECKOUT', 'many items, duplicate quantities and multiple images render one row per line', () => {
    const items = Array.from({ length: 40 }, (_, i) => item({ id: String(i), variantKey: 'v' + i, qty: (i % 5) + 1 }));
    const { els } = loadCheckout(items);
    assert.strictEqual((els.checkoutItemsList.innerHTML.match(/class="checkout-item-row"/g) || []).length, 40);
    assert.ok(els.checkoutItemsList.innerHTML.includes('Qty: 5'));
  });
  await test('CHECKOUT', 'opened directly on checkout with an empty cart: empty state, button disabled, no throw', () => {
    const { els } = loadCheckout([]);
    assert.ok(els.checkoutItemsList.innerHTML.includes('Your cart is empty')); assert.strictEqual(els.placeOrderBtn.disabled, true);
  });

  /* ======================= SHIPPING (client + server) ======================= */
  const setStoreSettings = (sf, s) => { sf.CHIPAKK.DATA.settings = Object.assign({}, sf.CHIPAKK.DATA.settings, s); };
  await test('SHIPPING', 'client: ₹299 -> ₹50, ₹300 -> FREE, ₹315 -> FREE', () => {
    for (const [sub, expect] of [[299, 50], [300, 0], [315, 0], [1, 50], [0, 50]]) {
      const { tools, sf } = loadCheckout([item({ price: sub, qty: 1 })]);
      setStoreSettings(sf, { freeShippingThreshold: 300, shippingFee: 50 });
      assert.strictEqual(tools.calculateTotals().shippingCharge, expect, `subtotal ₹${sub}`);
    }
  });
  await test('SHIPPING', 'client: a coupon that drops ₹315 to ₹280 net STILL ships free (gross subtotal decides)', () => {
    const { tools, sf } = loadCheckout([item({ price: 315, qty: 1 })]);
    setStoreSettings(sf, { freeShippingThreshold: 300, shippingFee: 50 });
    tools.setAppliedCoupon({ discountType: 'fixed', discountValue: 35, discountRupees: 35, minOrderValueRupees: 0, maxDiscountRupees: null });
    const t = tools.calculateTotals();
    assert.strictEqual(t.discount, 35); assert.strictEqual(t.shippingCharge, 0); assert.strictEqual(t.finalTotal, 280);
  });
  await test('SHIPPING', 'client percent coupon honours the server-provided maximum discount', () => {
    const { tools, sf } = loadCheckout([item({ price: 500, qty: 1 })]);
    setStoreSettings(sf, { freeShippingThreshold: 300, shippingFee: 50 });
    tools.setAppliedCoupon({ discountType: 'percent', discountValue: 50, discountRupees: 0, minOrderValueRupees: 0, maxDiscountRupees: 100 });
    assert.strictEqual(tools.calculateTotals().discount, 100);
  });

  // ---- server: real shippingService + real orderService against a fake DB ----
  function storeFakeDb(extra = []) {
    const products = { 1: { id: 1, name: 'A', sku: 'A', price: 105, active: 1, admin_product_id: 'CK-1', store_id: 1 }, 2: { id: 2, name: 'B', sku: 'B', price: 15, active: 1, admin_product_id: 'CK-2', store_id: 1 } };
    const inserts = { orders: null, items: [] };
    const coupons = { FLAT35: { id: 9, code: 'FLAT35', discount_type: 'fixed', discount_value: 35, min_order_value: 0, max_discount_amount: null, usage_limit: null, usage_count: 0, active: 1, store_id: 1, per_customer_limit: 1, start_date: null, end_date: null } };
    const handlers = [
      ...gstFixture.supplierHandlers(), // a configured legal supplier (fixture); checkout fails closed without one
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'orders'$/, () => [[{ COLUMN_NAME: 'customer_phone' }, { COLUMN_NAME: 'store_id' }, { COLUMN_NAME: 'tax_amount' }, { COLUMN_NAME: 'shipping_method' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'orders' AND COLUMN_NAME = 'tax_amount'/, () => [[{ COLUMN_NAME: 'tax_amount' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'order_items'$/, () => [[{ COLUMN_NAME: 'marshans_product_id' }, { COLUMN_NAME: 'tax_amount' }, { COLUMN_NAME: 'hsn_code' }, { COLUMN_NAME: 'tax_rate' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'order_items' AND COLUMN_NAME = 'marshans_product_id'/, () => [[{ COLUMN_NAME: 'marshans_product_id' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupon_usage'/, () => [[{ COLUMN_NAME: 'status' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
      [/INFORMATION_SCHEMA\.TABLES/, () => [[]]],
      [/^SELECT id, firebase_uid, email FROM users/, () => [[{ id: 5 }]]],
      [/FROM products WHERE id = \?/, (s, p) => [products[p[0]] ? [products[p[0]]] : []]],
      [/^SHOW COLUMNS/, () => [[{ Field: 'store_id' }]]],
      [/^SELECT \* FROM shipping_rules/, () => [[]]],
      [/FROM store_settings/, () => [[]]],
      [/^SELECT \* FROM coupons WHERE UPPER\(code\)/, (s, p) => [coupons[p[0]] ? [coupons[p[0]]] : []]],
      [/FROM coupons c WHERE/, (s, p) => [coupons[String(p[0]).toUpperCase()] ? [coupons[String(p[0]).toUpperCase()]] : []]],
      [/FROM coupon_usage/, () => [[{ cnt: 0 }]]],
      [/^INSERT INTO orders/, (s, p) => { inserts.orders = parseInsert(s, p); return [{ insertId: 100 }]; }],
      [/^INSERT INTO order_items/, (s, p) => { inserts.items.push(parseInsert(s, p)); return [{ insertId: 200 + inserts.items.length }]; }],
      [/^INSERT INTO coupon_usage|^UPDATE coupons/, () => [{ affectedRows: 1 }]],
      ...extra
    ];
    return { pool: createFakePool(handlers), inserts, products, coupons };
  }
  const addr = { name: 'Test User', phone: '9876543210', address: '12 Some Street', city: 'Pune', state: 'Delhi', pincode: '411001' };
  const buyer = { uid: 'u1', email: 'u@x.com' };

  let orderService; let shippingService; let taxUtils; let couponService; let dbState;
  await test('SHIPPING', 'server: shipping fee thresholds ₹299 / ₹300 / ₹315 with the built-in CHIPAKK defaults', async () => {
    dbState = storeFakeDb(); installFakePool(dbState.pool);
    shippingService = require('../server/services/shippingService'); orderService = require('../server/services/orderService'); taxUtils = require('../server/utils/taxUtils'); couponService = require('../server/services/couponService');
    for (const [sub, fee] of [[299, 50], [300, 0], [315, 0], [1, 50]]) {
      const r = await shippingService.calculateShippingFee({ subtotal: sub, storeId: 1 });
      assert.strictEqual(r.shipping_fee, fee, `₹${sub}`);
    }
  });
  await test('SHIPPING', 'server policy (used by /api/settings) === the rule orders are charged with', async () => {
    const policy = await shippingService.getShippingPolicy(1);
    assert.strictEqual(policy.standard_fee, 50); assert.strictEqual(policy.free_shipping_threshold, 300); assert.strictEqual(policy.free_shipping_enabled, true);
    const at = await shippingService.calculateShippingFee({ subtotal: policy.free_shipping_threshold, storeId: 1 });
    const below = await shippingService.calculateShippingFee({ subtotal: policy.free_shipping_threshold - 1, storeId: 1 });
    assert.strictEqual(at.shipping_fee, 0); assert.strictEqual(below.shipping_fee, policy.standard_fee);
  });
  await test('SHIPPING', 'MARSHANS never inherits the CHIPAKK ₹300 rule', async () => {
    const p2 = await shippingService.getShippingPolicy(2);
    assert.strictEqual(p2.free_shipping_enabled, false); assert.strictEqual(p2.free_shipping_threshold, 0);
    const r = await shippingService.calculateShippingFee({ subtotal: 30000, storeId: 2 }); // ₹300 in paise
    assert.strictEqual(r.shipping_fee, 8000, 'a ₹300 (30000 paise) basket still pays Marshans shipping');
  });
  await test('SHIPPING', 'server order: ₹315 gross - ₹35 coupon = ₹280 net still ships FREE; total = 280', async () => {
    dbState.inserts.orders = null; dbState.inserts.items.length = 0;
    await orderService.createCustomerOrder({ items: [{ product_id: 1, quantity: 3 }], shipping_address: addr, coupon_code: 'FLAT35', store_id: 1, payment_method: 'COD' }, buyer);
    const o = dbState.inserts.orders;
    assert.strictEqual(o.subtotal, 315); assert.strictEqual(o.discount_total, 35); assert.strictEqual(o.shipping_charge, 0); assert.strictEqual(o.total_price, 280);
  });
  await test('SHIPPING', 'server order: ₹299 -> ₹50 shipping; ₹300 -> free (gross)', async () => {
    dbState.products[1].price = 299; dbState.products[2].price = 300;
    await orderService.createCustomerOrder({ items: [{ product_id: 1, quantity: 1 }], shipping_address: addr, store_id: 1, payment_method: 'COD' }, buyer);
    assert.strictEqual(dbState.inserts.orders.shipping_charge, 50); assert.strictEqual(dbState.inserts.orders.total_price, 349);
    await orderService.createCustomerOrder({ items: [{ product_id: 2, quantity: 1 }], shipping_address: addr, store_id: 1, payment_method: 'COD' }, buyer);
    assert.strictEqual(dbState.inserts.orders.shipping_charge, 0); assert.strictEqual(dbState.inserts.orders.total_price, 300);
    dbState.products[1].price = 105; dbState.products[2].price = 15;
  });
  await test('SHIPPING', 'client and server agree (subtotal x coupon grid): shipping, discount, total, GST', async () => {
    const subtotals = [15, 105, 285, 299, 300, 315, 450, 1500];
    const coupons = [null, { code: 'FLAT35', type: 'fixed', value: 35 }];
    for (const sub of subtotals) for (const cp of coupons) {
      dbState.products[1].price = sub; dbState.inserts.orders = null;
      await orderService.createCustomerOrder({ items: [{ product_id: 1, quantity: 1 }], shipping_address: addr, coupon_code: cp ? cp.code : null, store_id: 1, payment_method: 'COD' }, buyer);
      const o = dbState.inserts.orders;
      const { tools, sf } = loadCheckout([item({ price: sub, qty: 1 })]); setStoreSettings(sf, { freeShippingThreshold: 300, shippingFee: 50, gstRate: 18 });
      if (cp) tools.setAppliedCoupon({ discountType: 'fixed', discountValue: 35, discountRupees: Math.min(35, sub), minOrderValueRupees: 0, maxDiscountRupees: null });
      const t = tools.calculateTotals();
      const tag = `subtotal ₹${sub}${cp ? ' + ₹35 coupon' : ''}`;
      assert.strictEqual(t.shippingCharge, o.shipping_charge, `${tag}: shipping`); assert.strictEqual(t.discount, o.discount_total, `${tag}: discount`);
      assert.strictEqual(t.finalTotal, o.total_price, `${tag}: total`); assert.strictEqual(t.gstPortion, o.tax_amount, `${tag}: GST`);
    }
    dbState.products[1].price = 105;
  });

  /* ======================= GST ======================= */
  await test('GST', 'inclusive 18%: ₹90 / ₹205 / ₹315 / ₹365 (server snapshot) and taxable + tax === total', () => {
    const expected = { 90: [76, 14], 205: [174, 31], 315: [267, 48], 365: [309, 56] };
    for (const [total, [taxable, tax]] of Object.entries(expected)) {
      const r = taxUtils.calculateInclusiveGst({ amount: +total, gstRate: 18, sellerState: 'Delhi', customerState: 'Maharashtra' });
      assert.strictEqual(r.taxable_amount, taxable, `taxable ₹${total}`); assert.strictEqual(r.tax_amount, tax, `tax ₹${total}`);
      assert.strictEqual(r.taxable_amount + r.tax_amount, +total, 'never adds a second 18% on top');
      assert.strictEqual(r.igst_amount, tax); assert.strictEqual(r.cgst_amount + r.sgst_amount, 0);
    }
  });
  await test('GST', 'client displayed GST equals the server snapshot for every ₹1..₹20000 total (no rounding drift)', () => {
    const { tools, sf } = loadCheckout([item({ price: 1, qty: 1 })]); setStoreSettings(sf, { freeShippingThreshold: 1, shippingFee: 0, gstRate: 0, gstEnabled: false });
    let mismatches = 0;
    for (let total = 1; total <= 20000; total++) {
      sf.CHIPAKK.cart.items[0].price = total; sf.CHIPAKK.cart.items[0].qty = 1;
      const client = tools.calculateTotals();
      const server = taxUtils.calculateInclusiveGst({ amount: client.finalTotal, gstRate: 0, sellerState: 'Delhi', customerState: 'Delhi' }).tax_amount;
      if (client.gstPortion !== server) mismatches++;
    }
    assert.strictEqual(mismatches, 0);
  });
  await test('GST', 'order snapshot: GST inactive yields ₹0 tax and order succeeds without supplier requirement', async () => {
    dbState.products[1].price = 355; dbState.inserts.orders = null; // >= ₹300 => free shipping, total == 355
    await orderService.createCustomerOrder({ items: [{ product_id: 1, quantity: 1 }], shipping_address: { ...addr, state: 'Maharashtra' }, store_id: 1, payment_method: 'COD' }, buyer);
    let o = dbState.inserts.orders;
    assert.strictEqual(o.total_price, 355); assert.strictEqual(o.tax_amount, 0); assert.strictEqual(o.cgst_amount + o.sgst_amount, 0); assert.strictEqual(o.igst_amount, 0);
    try {
      await orderService.createCustomerOrder({ items: [{ product_id: 1, quantity: 1 }], shipping_address: { ...addr, state: 'Delhi' }, store_id: 1, payment_method: 'COD' }, buyer);
      o = dbState.inserts.orders; assert.strictEqual(o.tax_amount, 0); assert.strictEqual(o.cgst_amount, 0); assert.strictEqual(o.sgst_amount, 0); assert.strictEqual(o.igst_amount, 0);
    } finally { dbState.products[1].price = 105; }
  });
  await test('GST', 'stored units: CHIPAKK order money is whole rupees; Razorpay boundary is the only x100', async () => {
    dbState.inserts.orders = null;
    await orderService.createCustomerOrder({ items: [{ product_id: 2, quantity: 1 }], shipping_address: addr, store_id: 1, payment_method: 'COD' }, buyer);
    assert.strictEqual(dbState.inserts.orders.total_price, 65); // ₹15 + ₹50 shipping, stored as 65 (not 6500)
    const paymentSrc = fs.readFileSync(path.join(ROOT, 'server/services/paymentService.js'), 'utf8');
    assert.ok(/isStore2 \? rawTotalPrice : \(rawTotalPrice \* 100\)/.test(paymentSrc), 'x100 only for store 1 at the gateway boundary');
  });

  /* ======================= COUPONS ======================= */
  const couponRow = (over = {}) => ({ id: 9, code: 'SAVE10', discount_type: 'percent', discount_value: 10, min_order_value: 0, max_discount_amount: null, usage_limit: null, usage_count: 0, active: 1, store_id: 1, per_customer_limit: 1, start_date: null, end_date: null, ...over });
  function couponPool(row, extra = []) {
    return createFakePool([
      ...extra,
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
      [/FROM coupons c WHERE/, () => [row ? [row] : []]],
      [/FROM coupon_usage cu/, () => [[]]]
    ]);
  }
  const freshCoupon = () => { delete require.cache[require.resolve('../server/services/couponService')]; return require('../server/services/couponService'); };
  await test('COUPON', 'valid percent coupon: server returns discount, minimum and cap in rupees', async () => {
    installFakePool(couponPool(couponRow({ discount_value: 10, max_discount_amount: 25, min_order_value: 100 })));
    const r = await freshCoupon().validateCoupon('save10', 500, 1);
    assert.strictEqual(r.valid, true); assert.strictEqual(r.coupon.discount_rupees, 25); assert.strictEqual(r.coupon.max_discount_amount_rupees, 25); assert.strictEqual(r.coupon.min_order_value_rupees, 100);
  });
  await test('COUPON', 'invalid / inactive code -> friendly message', async () => {
    installFakePool(couponPool(null)); assert.deepStrictEqual(await freshCoupon().validateCoupon('NOPE', 500, 1), { valid: false, message: 'Invalid or inactive coupon code.' });
    installFakePool(couponPool(couponRow({ active: 0 }))); assert.strictEqual((await freshCoupon().validateCoupon('SAVE10', 500, 1)).message, 'Invalid or inactive coupon code.');
  });
  await test('COUPON', 'expired / not yet active -> friendly messages', async () => {
    installFakePool(couponPool(couponRow({ end_date: new Date(Date.now() - 86400000) }))); assert.strictEqual((await freshCoupon().validateCoupon('SAVE10', 500, 1)).message, 'This coupon has expired.');
    installFakePool(couponPool(couponRow({ start_date: new Date(Date.now() + 86400000) }))); assert.strictEqual((await freshCoupon().validateCoupon('SAVE10', 500, 1)).message, 'This coupon is not active yet.');
  });
  await test('COUPON', 'minimum order failure -> "Minimum order value of ₹X required"', async () => {
    installFakePool(couponPool(couponRow({ min_order_value: 500 }))); const r = await freshCoupon().validateCoupon('SAVE10', 499, 1);
    assert.strictEqual(r.valid, false); assert.strictEqual(r.message, 'Minimum order value of ₹500 required for this coupon.');
  });
  await test('COUPON', 'usage limit (incl. active reservations) and per-customer limit -> friendly messages', async () => {
    installFakePool(couponPool(couponRow({ usage_limit: 5, usage_count: 5 }))); assert.strictEqual((await freshCoupon().validateCoupon('SAVE10', 500, 1)).message, 'This coupon usage limit has been reached.');
    installFakePool(couponPool(couponRow({ usage_limit: 5, usage_count: 4 }), [[/status = 'reserved' AND reserved_at/, () => [[{ cnt: 1 }]]]]));
    assert.strictEqual((await freshCoupon().validateCoupon('SAVE10', 500, 1)).message, 'This coupon usage limit has been reached.', 'a live reservation holds the last slot');
    installFakePool(couponPool(couponRow({ per_customer_limit: 1 }), [[/customer_id = \?/, () => [[{ cnt: 1 }]]]]));
    assert.strictEqual((await freshCoupon().validateCoupon('SAVE10', 500, 1, 77)).message, 'You have already reached the redemption limit for this coupon.');
  });
  await test('COUPON', 'ROOT CAUSE: usage lookup selects the users column that exists (full_name / name / none)', async () => {
    for (const [cols, expect] of [[['full_name'], 'u.full_name'], [['name'], 'u.name'], [[], "'' AS customer_name"]]) {
      const pool = couponPool(couponRow(), [[/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'users'/, () => [cols.map((c) => ({ COLUMN_NAME: c }))]]]);
      installFakePool(pool);
      const r = await freshCoupon().getCouponById('SAVE10', 1);
      assert.ok(r && Array.isArray(r.recent_usages));
      const usageSql = pool.calls.find((c) => /FROM coupon_usage cu/.test(c.sql)).sql;
      assert.ok(usageSql.includes(expect), `usage SQL must use ${expect}`);
    }
  });
  await test('COUPON', 'validate does NOT run the usage-history query (that query broke every existing code)', async () => {
    const pool = couponPool(couponRow()); installFakePool(pool); await freshCoupon().validateCoupon('SAVE10', 500, 1);
    assert.ok(!pool.calls.some((c) => /FROM coupon_usage cu/.test(c.sql)));
  });

  // ---- real Express app + real routes (fake DB) ----
  async function withApp(pool, fn) {
    installFakePool(pool);
    for (const k of Object.keys(require.cache)) if (k.includes(path.join('server', 'services')) || k.includes(path.join('server', 'routes')) || k.includes(path.join('server', 'controllers')) || k.endsWith(path.join('server', 'app.js'))) delete require.cache[k];
    const app = require('../server/app.js');
    const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
  }
  const post = (base, body) => fetch(`${base}/api/coupons/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Store-ID': '1' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  await test('COUPON', 'real route: valid coupon -> 200 with rupee fields; invalid/expired/minimum/limit -> 400 + friendly text', async () => {
    await withApp(couponPool(couponRow({ min_order_value: 200, discount_value: 20 })), async (base) => {
      const ok = await post(base, { code: 'save10', subtotal_in_rupees: 500 });
      assert.strictEqual(ok.status, 200); assert.strictEqual(ok.json.data.discount_rupees, 100); assert.strictEqual(ok.json.data.min_order_value_rupees, 200);
      const min = await post(base, { code: 'save10', subtotal_in_rupees: 150 });
      assert.strictEqual(min.status, 400); assert.strictEqual(min.json.error.message, 'Minimum order value of ₹200 required for this coupon.');
      const empty = await post(base, { code: '' }); assert.strictEqual(empty.status, 400); assert.strictEqual(empty.json.error.message, 'Please enter a coupon code.');
      const huge = await post(base, { code: 'X'.repeat(500) }); assert.strictEqual(huge.status, 400);
    });
    await withApp(couponPool(null), async (base) => {
      const r = await post(base, { code: 'nope', subtotal_in_rupees: 500 }); assert.strictEqual(r.status, 400); assert.strictEqual(r.json.error.message, 'Invalid or inactive coupon code.');
    });
    await withApp(couponPool(couponRow({ end_date: new Date(Date.now() - 1000) })), async (base) => {
      const r = await post(base, { code: 'save10', subtotal_in_rupees: 500 }); assert.strictEqual(r.json.error.message, 'This coupon has expired.');
    });
  });
  await test('COUPON', 'real route: an UNEXPECTED server error is a safe generic 500 (no SQL, columns, stack, paths)', async () => {
    const leaky = createFakePool([[/FROM coupons c WHERE/, () => { const e = new Error("Unknown column 'u.name' in 'field list' at /home/u781826529/app/server/services/couponService.js:200"); e.code = 'ER_BAD_FIELD_ERROR'; e.sql = 'SELECT u.name FROM secret_table'; throw e; }],
      [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]]]);
    const origErr = console.error; console.error = () => {};
    try {
      await withApp(leaky, async (base) => {
        const r = await post(base, { code: 'save10', subtotal_in_rupees: 500 });
        assert.strictEqual(r.status, 500);
        const text = JSON.stringify(r.json);
        assert.strictEqual(r.json.error.message, "We couldn't check that code right now. Please try again in a moment.");
        for (const leak of ['Unknown column', 'u.name', 'secret_table', 'ER_BAD_FIELD', '/home/', 'couponService', 'stack', 'SELECT']) assert.ok(!text.includes(leak), `response leaked "${leak}"`);
      });
    } finally { console.error = origErr; }
  });
  await test('COUPON', 'client: 5xx becomes a safe message; business errors keep their text', async () => {
    const mk = (status, body) => loadStorefront({ fetch: async () => ({ ok: status < 400, status, statusText: 'x', json: async () => body }) });
    const s500 = await mk(500, { success: false, error: { message: 'Unknown column u.name' } }).CHIPAKK.validateCouponApi('X', 100);
    assert.strictEqual(s500.valid, false); assert.ok(!/column/i.test(s500.message)); assert.ok(s500.serverError);
    const s400 = await mk(400, { success: false, error: { message: 'This coupon has expired.', statusCode: 400 } }).CHIPAKK.validateCouponApi('X', 100);
    assert.strictEqual(s400.message, 'This coupon has expired.');
  });

  /* ======================= UPLOADS (real Express static) ======================= */
  await test('UPLOADS', 'UPLOADS_DIR moves storage outside the app tree and /uploads serves it (200 image, 404 missing)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chipakk-uploads-'));
    fs.writeFileSync(path.join(dir, 'product-1-2.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]));
    process.env.UPLOADS_DIR = dir;
    for (const k of Object.keys(require.cache)) if (k.includes(path.join('server', 'config', 'uploads'))) delete require.cache[k];
    try {
      const cfg = require('../server/config/uploads');
      assert.strictEqual(cfg.uploadDir, path.resolve(dir));
      const desc = cfg.describeUploads();
      assert.strictEqual(desc.externalDirectory, true);
      assert.strictEqual(desc.configured, true);
      assert.strictEqual(desc.isAbsolute, true);
      assert.strictEqual(desc.outsideAppDirectory, true);
      assert.strictEqual(desc.insideAppDirectory, false);
      assert.strictEqual(desc.exists, true);
      assert.strictEqual(desc.writable, true);
      assert.strictEqual(desc.fileCount, 1);
      assert.strictEqual(desc.serving, true);
      await withApp(createFakePool([]), async (base) => {
        const ok = await fetch(`${base}/uploads/product-1-2.webp`); assert.strictEqual(ok.status, 200);
        assert.ok(/immutable/.test(ok.headers.get('cache-control') || ''), 'unique filenames => immutable caching');
        const miss = await fetch(`${base}/uploads/product-does-not-exist.webp`); assert.strictEqual(miss.status, 404);
        const trav = await fetch(`${base}/uploads/..%2f..%2fpackage.json`); assert.ok([400, 403, 404].includes(trav.status));
        const health = await (await fetch(`${base}/api/health`)).json();
        assert.strictEqual(health.data.uploads.fileCount, 1);
        assert.strictEqual(health.data.uploads.configured, true);
        assert.strictEqual(health.data.uploads.outsideAppDirectory, true);
        assert.strictEqual(health.data.uploads.serving, true);
        assert.ok(!JSON.stringify(health).includes(dir), 'health never reveals the path');
      });
    } finally { delete process.env.UPLOADS_DIR; }
  });

  /* ======================= STATIC STRUCTURE ======================= */
  const html = (f) => fs.readFileSync(path.join(ROOT, 'customer-workspace', f), 'utf8');
  await test('STATIC', 'every page loads media.js -> catalog.js -> app.js in that order, same version', () => {
    for (const f of ['index', 'shop', 'categories', 'product', 'checkout', 'custom-stickers', 'account']) {
      const h = html(`${f}.html`); const i = (n) => h.indexOf(`js/${n}.js?v=`);
      assert.ok(i('media') > 0 && i('media') < i('catalog') && i('catalog') < i('app'), `${f}.html script order`);
      assert.deepStrictEqual([...new Set((h.match(/js\/(media|catalog|app)\.js\?v=([\d.]+)/g) || []).map((s) => s.split('v=')[1]))].length, 1, `${f}.html versions`);
    }
  });
  await test('STATIC', 'the loader video is present on every page (muted, playsinline, loop, autoplay) and no page has an inline onerror', () => {
    for (const f of ['index', 'shop', 'categories', 'product', 'checkout', 'custom-stickers', 'account']) {
      const h = html(`${f}.html`); const v = h.match(/<video[\s\S]*?<\/video>/)[0];
      for (const a of ['loading_01.mp4', 'autoplay', 'muted', 'loop', 'playsinline']) assert.ok(v.includes(a), `${f}: ${a}`);
    }
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of fs.readdirSync(path.join(ROOT, 'customer-workspace/js'))) assert.ok(!/onerror="/.test(stripComments(fs.readFileSync(path.join(ROOT, 'customer-workspace/js', f), 'utf8'))), `${f} has no inline onerror strings`);
  });
  await test('STATIC', '.htaccess routes the new modules and revalidates JS/CSS on every load', () => {
    const ht = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
    assert.ok(/\^js\/\([^)]*\bmedia\b[^)]*\bcatalog\b[^)]*\)\\\.js\$/.test(ht), 'media/catalog rewrite');
    assert.ok(/\(js\|css\)\$">\s*Header set Cache-Control "public, no-cache"/.test(ht), 'js/css must not be served from a 7-day cache');
    assert.ok(/mp4/.test(ht), 'the loader video is cacheable');
  });
  await test('STATIC', 'checkout CSS: no min-content grid blow-out, wrap-safe rows, breakpoints from 1024 down to 340', () => {
    const css = fs.readFileSync(path.join(ROOT, 'customer-workspace/css/style.css'), 'utf8');
    assert.ok(/\.checkout-grid \{ grid-template-columns: minmax\(0, 1\.3fr\) minmax\(0, 1fr\); \}/.test(css));
    assert.ok(/\.checkout-item-row \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto/.test(css));
    assert.ok(/\.checkout-item-name \{[^}]*-webkit-line-clamp: 2[^}]*overflow-wrap: anywhere/s.test(css) || /overflow-wrap: anywhere;[^}]*-webkit-line-clamp: 2/s.test(css));
    for (const bp of [1024, 900, 640, 480, 420, 340]) assert.ok(new RegExp(`@media \\(max-width: ${bp}px\\)`).test(css), `breakpoint ${bp}`);
    assert.ok(/\.site-header \{ top: calc\(-1 \* var\(--header-collapse/.test(css), 'only the main header row is sticky');
  });

  await test('STATIC', 'CSS pitfalls found in the browser: star outline is thin (viewBox is 24 units) and the product-stage image can fill its stage', () => {
    const css = fs.readFileSync(path.join(ROOT, 'customer-workspace/css/style.css'), 'utf8');
    const star = css.match(/\.stars svg \{[^}]*\}/);
    assert.ok(star, '.stars svg rule');
    const sw = Number((star[0].match(/stroke-width:\s*([\d.]+)/) || [])[1]);
    assert.ok(sw > 0 && sw <= 4, `stroke-width ${sw} would paint the whole 24-unit icon black`);
    // `.product-stage img {max-width:85%}` has specificity (0,1,1); the stage image rule must not lose to it.
    assert.ok(/\.product-stage \.product-stage-img \{[^}]*max-width: 100%[^}]*max-height: 100%/.test(css), 'stage image must out-specify .product-stage img');
  });

  await test('COUPON', 'error middleware fails CLOSED: SQL text, column names, stack and server paths never reach the client unless NODE_ENV is explicitly "development"', async () => {
    const express = require('express');
    const { errorHandler } = require('../server/middleware/errorHandler');
    const app = express();
    app.get('/boom', () => { const e = new Error("ER_BAD_FIELD_ERROR: Unknown column 'u.name' in 'field list' at /home/u1/app/server/services/couponService.js:88"); throw e; });
    app.get('/biz', (req, res, next) => { const e = new Error('Coupon has expired'); e.statusCode = 400; next(e); });
    app.use(errorHandler);
    const srv = await new Promise((r) => { const s2 = app.listen(0, '127.0.0.1', () => r(s2)); });
    const get = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: srv.address().port, path: p }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject));
    const saved = process.env.NODE_ENV; const origErr = console.error; console.error = () => {};
    try {
      for (const env of [undefined, 'production', 'staging', 'test']) {
        if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
        const r = await get('/boom');
        assert.strictEqual(r.status, 500, `NODE_ENV=${env}`);
        assert.ok(!/ER_BAD_FIELD|Unknown column|u\.name|couponService|\/home\/|\.js:\d+|stack|"details"/i.test(r.body), `NODE_ENV=${env} leaked: ${r.body}`);
        const biz = await get('/biz'); assert.strictEqual(biz.status, 400); assert.ok(/Coupon has expired/.test(biz.body), 'business errors keep their friendly text');
      }
      process.env.NODE_ENV = 'development';
      assert.ok(/details/.test((await get('/boom')).body), 'explicit development keeps diagnostics for local debugging');
    } finally { console.error = origErr; if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved; srv.close(); }
  });
  await test('STATIC', 'CSS pitfalls (round 2, found in real Chrome): toast is content-sized, gallery thumbs fit their button, height-only logos keep their aspect', () => {
    const css = fs.readFileSync(path.join(ROOT, 'customer-workspace/css/style.css'), 'utf8');
    const last = (re) => { const all = css.match(new RegExp(re.source, 'g')); return all && all[all.length - 1]; };
    // a fixed element at left:50% otherwise shrink-wraps into the right half of the viewport (5-line toast on 320px)
    const toast = last(/\.toast \{\s*width: max-content;[^}]*\}/);
    assert.ok(toast && /max-width: min\(92vw/.test(toast), 'toast must size to content, capped to the viewport');
    // <img width=80 height=80> inside a 72px flex button shrinks horizontally only unless the img is sized to the button
    const thumb = last(/\.gallery-thumb img \{[^}]*\}/);
    assert.ok(thumb && /width: 100%/.test(thumb) && /height: 100%/.test(thumb) && /object-fit: cover/.test(thumb), 'gallery thumb img must fill its button');
    // width/height attributes on logos are kept for layout-shift protection; CSS only sets height, so width must be auto
    const logo = last(/\.footer-brand img,\s*\.drawer-top img,\s*\.logo-link img \{[^}]*\}/);
    assert.ok(logo && /width: auto/.test(logo), 'logo width must follow the aspect ratio');
    // and the attributes themselves carry the TRUE 1062x529 ratio (2:1), never 3:2
    for (const f of fs.readdirSync(path.join(ROOT, 'customer-workspace')).filter((n) => n.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(ROOT, 'customer-workspace', f), 'utf8');
      for (const m of html.matchAll(/<img[^>]*logo\.png[^>]*>/g)) {
        const w = Number((m[0].match(/\swidth="(\d+)"/) || [])[1]), h = Number((m[0].match(/\sheight="(\d+)"/) || [])[1]);
        if (w && h) assert.ok(Math.abs(w / h - 2) < 0.05, `${f}: logo ${w}x${h} is not 2:1`);
      }
    }
  });

  await test('PROOF', 'printed proof: client vs server shipping (gross subtotal) and inclusive GST, from the real shipped code', async () => {
    const rows = [];
    for (const [gross, coupon] of [[299, 0], [300, 0], [315, 0], [315, 35], [1, 0]]) {
      const { tools, sf } = loadCheckout([item({ price: gross, qty: 1 })]);
      setStoreSettings(sf, { freeShippingThreshold: 300, shippingFee: 50, gstRate: 18 });
      if (coupon) tools.setAppliedCoupon({ discountType: 'fixed', discountValue: coupon, discountRupees: coupon, minOrderValueRupees: 0, maxDiscountRupees: null });
      const c = tools.calculateTotals();
      const srv = await shippingService.calculateShippingFee({ subtotal: gross, storeId: 1 });
      assert.strictEqual(c.shippingCharge, srv.shipping_fee, `client/server disagree at gross ₹${gross}`);
      rows.push(`gross ₹${String(gross).padEnd(3)} coupon -₹${String(coupon).padEnd(2)} net ₹${String(gross - coupon).padEnd(3)} -> shipping client ₹${c.shippingCharge} / server ₹${srv.shipping_fee}   total ₹${c.finalTotal}`);
    }
    const gst = [90, 205, 315, 365].map((t) => {
      const { tools, sf } = loadCheckout([item({ price: t, qty: 1 })]);
      setStoreSettings(sf, { freeShippingThreshold: 1, shippingFee: 0, gstRate: 0, gstEnabled: false });
      const c = tools.calculateTotals();
      const srv = taxUtils.calculateInclusiveGst({ amount: c.finalTotal, gstRate: 0, sellerState: 'Delhi', customerState: 'Delhi' });
      assert.strictEqual(c.gstPortion, 0); assert.strictEqual(srv.tax_amount, 0); assert.strictEqual(c.finalTotal, t, 'GST must not be added on top');
      return `total ₹${t}: client GST ₹${c.gstPortion} = server GST ₹${srv.tax_amount} (taxable ₹${srv.taxable_amount}); payable stays ₹${c.finalTotal}`;
    });
    console.log('       ' + rows.concat(gst).join('\n       '));
  });

  await test('ARCH', 'no storefront script other than media.js owns image-URL knowledge, and no page ships inline onerror / base64 fallbacks', () => {
    const dir = path.join(ROOT, 'customer-workspace/js');
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      if (f === 'media.js') continue;
      const src = strip(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.ok(!/['"`]\/uploads\b|uploads\//.test(src), `${f} must not hardcode /uploads (media.js resolves it)`);
      assert.ok(!/drive\.google\.com/.test(src), `${f} must not know Google Drive URLs`);
      assert.ok(!/onerror\s*=|\.onerror\b(?!.*reject)/.test(src.replace(/script\.onerror[^\n]*/g, '')), `${f} must not attach per-image onerror handlers`);
      assert.ok(!/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{40,}/.test(src), `${f} must not embed base64 images`);
    }
    for (const f of fs.readdirSync(path.join(ROOT, 'customer-workspace')).filter((n) => n.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(ROOT, 'customer-workspace', f), 'utf8');
      assert.ok(!/\sonerror\s*=/.test(html), `${f}: inline onerror`);
      assert.ok(!/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{40,}/.test(html), `${f}: base64 image`);
    }
    const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    assert.strictEqual((app.match(/createMedia\(/g) || []).length, 1, 'exactly one media instance is created');
  });

  /* ======================= REPORT ======================= */
  const failed = results.filter((r) => !r.pass);
  console.log(`\nSTOREFRONT QUALITY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
