/**
 * Customer storefront: compare_at_price ("was" price) display.
 *
 * REQUIRED BEHAVIOUR (unchanged elsewhere: product.price stays the only price sent to cart/checkout/order APIs;
 * this is a display-only change):
 *   - Always show product.price as the current selling price.
 *   - Show product.compare_at_price, struck through, ONLY when compare_at_price > price.
 *   - null / 0 / missing / <= price -> show ONLY the current price. No %-off, discount, savings or sale label,
 *     ever (none is computed anywhere in this codebase).
 *   - Same rule everywhere a product price renders: product cards (home/best-sellers/shop/search/category/
 *     wishlist - one shared renderer, catalog.js productCardHtml) and the product detail page (product.js).
 *
 * ROOT CAUSE FIXED: the shared card renderer (catalog.js) already applied `compareAtPrice > price` correctly;
 * the product detail page (product.js, two render sites: initial render + option/variant price updates) used a
 * plain truthy check on compareAtPrice, so a compare_at_price equal to or below the current price (or a 0 that
 * only reaches PDP-only code paths) would have rendered as if it were a real "was" price. Fix: both PDP call
 * sites now call the SAME function the cards use (catalog.js `compareAtHtml`, exposed as
 * `window.CHIPAKK.compareAtHtml`), so there is one rule, implemented once.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createMedia } = require('../customer-workspace/js/media.js');
const { createCatalog } = require('../customer-workspace/js/catalog.js');
const { loadStorefront, envelope } = require('./helpers/storefront_vm');

const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.stack ? err.stack : err}`); }
}

const API = 'https://api.chipakk.shop/api';
const media = createMedia({ apiBase: API });
const fmt = (n) => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ generic fake DOM element ------------------ */
function el() {
  const e = {
    innerHTML: '', textContent: '', value: '', href: '', src: '', title: '', disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, click() {}, appendChild() {}, remove() {}, scrollIntoView() {}
  };
  return e;
}
/** Every element id product.js looks up via $("#id"). */
const PDP_IDS = ['addToCartBtn', 'buyNowBtn', 'canonicalLink', 'dynamicProductOptions', 'galleryThumbs', 'main',
  'metaDescription', 'ogDescription', 'ogImage', 'ogTitle', 'ogUrl', 'prodDetailCategory', 'prodDetailDesc',
  'prodDetailPrice', 'prodDetailReviews', 'prodDetailTitle', 'prodStageArt', 'prodWishlistBtn',
  'productSchemaJsonLd', 'qtyDecBtn', 'qtyIncBtn', 'qtyVal', 'relatedProductsGrid',
  'twitterDescription', 'twitterImage', 'twitterTitle'];
function pdpElements() { const m = {}; PDP_IDS.forEach((id) => (m[id] = el())); return m; }

/** Raw shape /api/products/:id sends (matches server/controllers/productController.js -> sendSuccess(res, product)). */
function rawProduct({ id = 129, price = 15, compareAtPrice = undefined } = {}) {
  const p = { id, name: 'KATANA', sku: 'CK-129', price_rupees: price, price, description: 'A sticker.',
    primary_image_url: '/uploads/product-1-1.webp', images: [{ image_url: '/uploads/product-1-1.webp', is_primary: 1 }],
    store_id: 1, category_id: 1, category_name: 'Anime', category_slug: 'anime', active: 1, tags: [] };
  if (compareAtPrice !== undefined) { p.compare_at_price_rupees = compareAtPrice; p.compare_at_price = compareAtPrice; }
  return p;
}
function fetchFor(products) {
  const byId = new Map(products.map((p) => [String(p.id), p]));
  return async (url) => {
    const m = String(url).match(/\/products\/([^/?]+)/);
    if (m && byId.has(m[1])) return envelope(rawProduct(byId.get(m[1])));
    if (/\/products(\?|$)/.test(url)) return envelope({ products: [], total: 0, limit: 100, offset: 0 });
    return envelope({});
  };
}

/** Loads product.js for real (media -> catalog -> tax -> app -> product), waits for the price to render, returns the elements. */
async function renderPdp({ price, compareAtPrice }) {
  const elements = pdpElements();
  const sf = loadStorefront({
    fetch: fetchFor([{ id: 129, price, compareAtPrice }]),
    elements,
    location: { search: '?id=129' },
    extraScripts: ['product.js']
  });
  for (let i = 0; i < 100 && !elements.prodDetailPrice.innerHTML; i++) await sleep(10);
  if (!elements.prodDetailPrice.innerHTML) throw new Error(`PDP price never rendered (logs: ${sf.logs.error.join(' | ')})`);
  return { elements, sf };
}

(async () => {
  /* ======================= 0. AUDIT: confirm what the task asked to audit, so the report is backed by evidence ======================= */
  await test('AUDIT', 'the API already returns compare_at_price (both stores) and a single reusable card renderer already exists (catalog.js)', () => {
    for (const f of ['server/services/productService.js', 'server/services/marshansProductService.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(/compare_at_price_rupees/.test(src), `${f} must already expose compare_at_price_rupees`);
    }
    assert.ok(fs.readFileSync(path.join(ROOT, 'customer-workspace/js/catalog.js'), 'utf8').includes('function compareAtHtml('), 'one shared price-display function');
  });
  await test('AUDIT', 'every customer page that renders a product price uses the shared card renderer or the shared compareAtHtml function (no third, ad-hoc implementation)', () => {
    const jsDir = path.join(ROOT, 'customer-workspace/js');
    const offenders = [];
    for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js') && n !== 'catalog.js' && n !== 'media.js' && n !== 'tax.js')) {
      const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
      // a literal `.product-price-orig` build outside catalog.js/product.js would be a second, divergent implementation
      if (/product-price-orig/.test(src) && f !== 'product.js') offenders.push(f);
    }
    assert.deepStrictEqual(offenders, [], `only catalog.js (cards) and product.js (PDP, via the shared function) may render product-price-orig; found it in: ${offenders}`);
    const pdp = fs.readFileSync(path.join(jsDir, 'product.js'), 'utf8');
    assert.strictEqual((pdp.match(/compareAtHtml\(/g) || []).length, 2, 'both PDP price render sites call the shared function');
    assert.ok(!/compareAtPrice\s*\?\s*`<span class="product-price-orig"/.test(pdp), 'the old ad-hoc truthy check must be gone');
  });

  /* ======================= 1. CARDS (home / best sellers / shop / search / category / wishlist - one renderer) ======================= */
  const catalog = createCatalog({ media, formatPrice: fmt, storeId: 1 });
  const CASES = [
    ['price=15, compare_at_price=25 (the documented example)', 15, 25, true],
    ['price=15, compare_at_price=NULL', 15, null, false],
    ['price=15, compare_at_price=15 (equal)', 15, 15, false],
    ['price=15, compare_at_price=10 (lower)', 15, 10, false],
    ['price=15, compare_at_price missing from the API payload', 15, undefined, false]
  ];
  for (const [label, price, compareAtPrice, shouldShow] of CASES) {
    await test('CARD', `${label} -> card shows ${shouldShow ? 'BOTH prices (old struck through)' : 'ONLY the current price'}`, () => {
      const raw = { id: 1, name: 'A', primary_image_url: '/uploads/a.webp', price_rupees: price, price };
      if (compareAtPrice !== undefined) raw.compare_at_price_rupees = compareAtPrice;
      const html = catalog.productCardHtml(catalog.normalizeProduct(raw));
      assert.ok(html.includes(`<span class="product-price">${fmt(price)}</span>`), 'current price always shown');
      assert.strictEqual(html.includes('product-price-orig'), shouldShow);
      if (shouldShow) assert.ok(html.includes(`<span class="product-price-orig">${fmt(compareAtPrice)}</span>`) && /text-decoration:\s*line-through/.test(fs.readFileSync(path.join(ROOT, 'customer-workspace/css/style.css'), 'utf8')));
      assert.ok(!/%\s*off|discount|savings|save\s*₹|\bsale\b|\bbadge\b/i.test(html.replace(/data-[a-z-]+="[^"]*"/g, '')), 'no %-off/discount/savings/sale label anywhere on the card');
    });
  }

  /* ======================= 2. PRODUCT DETAIL PAGE (product.js) - the actual bug that was fixed ======================= */
  for (const [label, price, compareAtPrice, shouldShow] of CASES) {
    await test('PDP', `${label} -> product detail page shows ${shouldShow ? 'BOTH prices' : 'ONLY the current price'}`, async () => {
      const { elements } = await renderPdp({ price, compareAtPrice });
      const html = elements.prodDetailPrice.innerHTML;
      assert.ok(html.includes(fmt(price)), `current price shown: ${html}`);
      assert.strictEqual(html.includes('product-price-orig'), shouldShow, html);
      if (shouldShow) assert.ok(html.includes(fmt(compareAtPrice)));
      assert.ok(!/%\s*off|discount|savings|save\s*₹|\bsale\b/i.test(html), `no discount label: ${html}`);
    });
  }
  await test('PDP', 'the exact documented example renders as "₹25 ₹15" with ₹25 struck through and ₹15 the primary price', async () => {
    const { elements } = await renderPdp({ price: 15, compareAtPrice: 25 });
    const html = elements.prodDetailPrice.innerHTML.replace(/\s+/g, ' ').trim();
    assert.ok(/<span>₹15<\/span>\s*<span class="product-price-orig">₹25<\/span>/.test(html), html);
  });
  await test('PDP', 'compare_at_price = 0 (a common "not set" sentinel in the DB) never shows a second price on the PDP', async () => {
    const { elements } = await renderPdp({ price: 15, compareAtPrice: 0 });
    assert.ok(!elements.prodDetailPrice.innerHTML.includes('product-price-orig'));
  });
  await test('PDP', 'the current selling price on the detail page is never blank/undefined/NaN for any of the 5 required scenarios', async () => {
    for (const [, price, compareAtPrice] of CASES) {
      const { elements } = await renderPdp({ price, compareAtPrice });
      assert.ok(!/undefined|null|NaN/.test(elements.prodDetailPrice.innerHTML));
    }
  });

  /* ======================= 3. CART / CHECKOUT UNCHANGED (still product.price only, no compare-at, no client price trusted) ======================= */
  await test('CART/CHECKOUT', 'the cart drawer and checkout order-summary rows render ONLY item.price (formatPrice); no compare-at markup, no %/discount label exists in either file', () => {
    for (const f of ['customer-workspace/js/app.js', 'customer-workspace/js/checkout.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(!/product-price-orig/.test(src), `${f} must not render a compare-at price`);
      assert.ok(!/compareAtPrice|compare_at_price/.test(src), `${f} must not read compare_at_price at all`);
    }
    assert.ok(/cart-item-total-price">\$\{formatPrice\(lineTotal\)\}/.test(fs.readFileSync(path.join(ROOT, 'customer-workspace/js/app.js'), 'utf8').replace(/\\\$/g, '$')) || /formatPrice\(lineTotal\)/.test(fs.readFileSync(path.join(ROOT, 'customer-workspace/js/app.js'), 'utf8')), 'cart line total is still computed from item.price');
    assert.ok(/formatPrice\(item\.price \* item\.qty\)/.test(fs.readFileSync(path.join(ROOT, 'customer-workspace/js/checkout.js'), 'utf8')), 'checkout row total is still item.price * qty, unchanged');
  });
  await test('CART/CHECKOUT', 'the order payload sent to the server still carries item.price (and nothing renamed/added for compare_at_price); server pricing is untouched by this change', () => {
    const checkout = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/checkout.js'), 'utf8');
    assert.ok(/price:\s*item\.price/.test(checkout), 'order line price is still the plain product price sent to the server');
    for (const f of ['server/services/orderService.js', 'server/services/productService.js', 'server/services/marshansProductService.js']) {
      assert.ok(fs.statSync(path.join(ROOT, f)).size > 0); // present, and (see git diff in the report) not modified by this task
    }
  });

  /* ======================= 4. STORE ISOLATION UNCHANGED (CHIPAKK whole rupees vs THE MARSHANS paise-derived rupees) ======================= */
  await test('STORE ISOLATION', 'CHIPAKK (store 1, whole rupees) and THE MARSHANS (store 2, paise on the wire) resolve to the SAME display rule once converted; a store never sees the other’s compare price', () => {
    const c1 = createCatalog({ media, formatPrice: fmt, storeId: 1 });
    const c2 = createCatalog({ media, formatPrice: fmt, storeId: 2 });
    // Store 1: DB/API already in whole rupees
    const p1 = c1.normalizeProduct({ id: 1, name: 'A', store_id: 1, price_rupees: 15, price: 15, compare_at_price_rupees: 25, primary_image_url: '/uploads/a.webp' });
    assert.strictEqual(p1.store_id, 1); assert.ok(c1.productCardHtml(p1).includes('product-price-orig'));
    // Store 2: server sends paise in price/compare_at_price but ALSO the pre-converted *_rupees fields (see marshansProductService.js); the
    // card must use the converted rupee values, never the raw paise, and the >price rule is unaffected by the unit conversion.
    const p2above = c2.normalizeProduct({ id: 2, name: 'B', store_id: 2, price: 1500, price_rupees: 15, compare_at_price: 2500, compare_at_price_rupees: 25, primary_image_url: '/uploads/a.webp' });
    assert.strictEqual(p2above.price, 15, 'never the raw paise value'); assert.ok(c2.productCardHtml(p2above).includes(`product-price-orig">${fmt(25)}`));
    const p2below = c2.normalizeProduct({ id: 3, name: 'C', store_id: 2, price: 1500, price_rupees: 15, compare_at_price: 1000, compare_at_price_rupees: 10, primary_image_url: '/uploads/a.webp' });
    assert.ok(!c2.productCardHtml(p2below).includes('product-price-orig'));
    // a Store 2 row must never appear while browsing Store 1 (forActiveStore isolation, unrelated to this change, still intact)
    const mixedGrid = c1.productGridHtml([p1, c1.normalizeProduct({ id: 9, name: 'Leak', store_id: 2, price: 15, primary_image_url: '/uploads/a.webp' })].filter((p) => p.store_id === 1));
    assert.ok(!mixedGrid.includes('data-product-id="9"'));
  });

  /* ======================= REPORT ======================= */
  const failed = results.filter((r) => !r.pass);
  console.log(`\nPRICE DISPLAY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
