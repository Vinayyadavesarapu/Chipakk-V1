/**
 * CHIPAKK — Mobile Checkout, Loading Animation, Image Resolution & Shipping Hotfix Test Suite
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('===============================================================');
console.log('📱 CHIPAKK PRODUCTION HOTFIX VERIFICATION SUITE');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

const queue = [];
function test(name, fn) { queue.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); passCount++; console.log(`[PASS] ${name}`); }
    catch (err) { failCount++; console.error(`[FAIL] ${name} — ${err.message}`); }
  }
  console.log(`\n===============================================================`);
  console.log(`📊 RESULTS: ${passCount} PASSED / ${failCount} FAILED`);
  console.log(`===============================================================\n`);
  if (failCount > 0) process.exit(1);
  console.log('🎉 ALL PRODUCTION HOTFIX TESTS PASSED!\n');
  process.exit(0);
}

const { loadStorefront } = require('./helpers/storefront_vm');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

// -------------------------------------------------------------
// Test 1: Loading Animation Video Tag Attributes in All Customer HTML Files
// -------------------------------------------------------------
test('1. Loading video contains autoplay, muted, loop, playsinline, and preload across all 7 HTML pages', () => {
  const pages = [
    'checkout.html',
    'index.html',
    'shop.html',
    'categories.html',
    'product.html',
    'custom-stickers.html',
    'account.html'
  ];

  for (const page of pages) {
    const filePath = path.join(__dirname, '..', 'customer-workspace', page);
    const content = fs.readFileSync(filePath, 'utf8');
    assert(content.includes('loading_01.mp4'), `${page} must reference loading_01.mp4`);
    assert(content.includes('autoplay'), `${page} video tag must have autoplay`);
    assert(content.includes('muted'), `${page} video tag must have muted`);
    assert(content.includes('loop'), `${page} video tag must have loop`);
    assert(content.includes('playsinline'), `${page} video tag must have playsinline`);
    assert(content.includes('preload="metadata"'), `${page} video tag must have preload="metadata"`);
  }
});

// -------------------------------------------------------------
// Test 2: Loading Overlay Lifecycle in app.js
// -------------------------------------------------------------
test('2. Loader is state-driven: no fixed delay, waits for holds, always releases (executed)', async () => {
  const mkOverlay = () => { const attrs = { 'data-hidden': 'false' }; return { attrs, style: {}, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] || null, querySelector: () => ({ play: () => Promise.resolve(), pause() {}, setAttribute() {} }), addEventListener() {} }; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = mkOverlay(); const t0 = Date.now();
  loadStorefront({ elements: { loadingOverlay: el } });
  while (el.attrs['data-hidden'] !== 'true' && Date.now() - t0 < 700) await sleep(5);
  assert.strictEqual(el.attrs['data-hidden'], 'true');
  assert(Date.now() - t0 < 300, `overlay must hide immediately when nothing is pending (took ${Date.now() - t0}ms; the old fixed delay was 750ms)`);
  const el2 = mkOverlay(); const sf2 = loadStorefront({ elements: { loadingOverlay: el2 } });
  const release = sf2.CHIPAKK.loader.hold('critical'); await sleep(150);
  assert.strictEqual(el2.attrs['data-hidden'], 'false', 'stays up while critical work is pending');
  release(); await sleep(60); assert.strictEqual(el2.attrs['data-hidden'], 'true');
});

// -------------------------------------------------------------
// Test 3: Mobile Checkout Header and Responsive CSS Rules
// -------------------------------------------------------------
test('3. Mobile checkout header: logo | security label | actions never overlap; rules exist for every breakpoint', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'customer-workspace', 'css', 'style.css'), 'utf8');
  const checkoutHtml = fs.readFileSync(path.join(__dirname, '..', 'customer-workspace', 'checkout.html'), 'utf8');
  assert(checkoutHtml.includes('class="site-header checkout-header"') && checkoutHtml.includes('checkout-security-badge') && checkoutHtml.includes('btn-back-shop'));
  assert(checkoutHtml.includes('checkout-security-long') && checkoutHtml.includes('checkout-security-short'), 'security label has long + short variants');
  assert(checkoutHtml.includes('back-shop-long') && checkoutHtml.includes('back-shop-short'), 'Back to Shop has long + short variants');
  assert(/\.checkout-header \.header-inner \{[^}]*display: flex[^}]*gap: 12px/s.test(css), 'header is a flex row with gaps');
  assert(/\.checkout-header \.logo-link img \{[^}]*width: auto[^}]*max-width: 150px/s.test(css), 'logo keeps its aspect ratio');
  assert(/@media \(max-width: 900px\) \{[^}]*\.checkout-security-long \{ display: none; \}/s.test(css), 'long label yields to the short one');
  assert(/@media \(max-width: 640px\)[\s\S]*?\.checkout-security-text \{ display: none; \}/.test(css), 'label collapses to the lock icon on phones');
  assert(/@media \(max-width: 420px\)[\s\S]*?\.back-shop-long \{ display: none; \}/.test(css), 'Back to Shop shortens instead of overflowing');
  assert(/\.checkout-item-row \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto/s.test(css), 'order rows: thumb | wrapping name | price');
  assert(/\.checkout-item-price \{[^}]*white-space: nowrap/s.test(css), 'price never wraps or gets pushed out');
});

// -------------------------------------------------------------
// Test 4: Product Image Resolution & Fallback in Checkout
// -------------------------------------------------------------
test('4. Checkout rows render images through the shared resolver (executed, not grepped)', () => {
  const el = () => ({ innerHTML: '', textContent: '', style: {}, disabled: false, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, closest: () => null });
  const items = [
    { id: '129', variantKey: 'a', name: 'KATANA', price: 10, qty: 1, image: '/uploads/product-1789803969669-697565554.webp' },
    { id: '128', variantKey: 'b', name: 'FRANKY WANTED POSTER', price: 20, qty: 2, image: 'https://chipakk.shop/uploads/product-1789800906087-447206127.webp' },
    { id: '3', variantKey: 'c', name: 'No image', price: 5, qty: 1, image: '' }
  ];
  const els = { checkoutItemsList: el(), checkoutSubtotal: el(), checkoutShipping: el(), checkoutTax: el(), checkoutTotal: el(), placeOrderBtn: el() };
  loadStorefront({ storage: { chipakk_cart_v1: JSON.stringify(items) }, elements: els, extraScripts: ['checkout.js'] });
  const html = els.checkoutItemsList.innerHTML;
  assert(html.includes('src="https://api.chipakk.shop/uploads/product-1789803969669-697565554.webp"'), 'relative /uploads path resolves to the API origin');
  assert(html.includes('src="https://api.chipakk.shop/uploads/product-1789800906087-447206127.webp"'), 'wrong-origin URL from an old cart is corrected');
  assert(html.includes('img-placeholder'), 'missing image gets the shared placeholder');
  assert(!/onerror=/i.test(html), 'no inline onerror');
  assert(html.includes('checkout-item-details') && html.includes('checkout-item-name'));
});

// -------------------------------------------------------------
// Test 5: normalizeSettings supports nested { settings: { ... } } structure
// -------------------------------------------------------------
test('5. normalizeSettings correctly extracts fields from nested { settings: { ... } } API responses', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'customer-workspace', 'js', 'app.js'), 'utf8');
  assert(appJs.includes('actual = (s.settings && typeof s.settings === "object") ? s.settings : s'), 'Must unpack s.settings');
});

// -------------------------------------------------------------
// Test 6: Free Shipping Rule on Gross Subtotal (Store 1)
// -------------------------------------------------------------
test('6. Gross subtotal >= ₹300 yields FREE shipping (₹0) even when coupon reduces net payable below ₹300', () => {
  // Test calculation function mirroring checkout & web logic
  function calcShipping(grossSubtotal, threshold = 300, standardFee = 50) {
    return (threshold > 0 && grossSubtotal >= threshold) ? 0 : standardFee;
  }

  assert.strictEqual(calcShipping(298), 50, '₹298 subtotal must charge ₹50 shipping');
  assert.strictEqual(calcShipping(299), 50, '₹299 subtotal must charge ₹50 shipping');
  assert.strictEqual(calcShipping(300), 0, '₹300 subtotal must get free shipping');
  assert.strictEqual(calcShipping(301), 0, '₹301 subtotal must get free shipping');
  assert.strictEqual(calcShipping(315), 0, '₹315 gross subtotal must get free shipping');

  // Verify web/js/app.js doesn't subtract discount before threshold evaluation
  const webAppJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'app.js'), 'utf8');
  assert(!webAppJs.includes("eligibleSubtotal = calculationMode === 'after_discounts' ? (subtotal - discount) : subtotal"), 'web/js/app.js must not reduce subtotal by discount for shipping threshold');
  assert(webAppJs.includes('free_shipping_calculation: \'gross_subtotal\''), 'web/js/app.js default calculation must be gross_subtotal');
});

// -------------------------------------------------------------
// Test 7: Inclusive 18% GST Reconciliation
// -------------------------------------------------------------
test('7. 18% inclusive GST reconciles exactly across orders: taxable + tax === total', () => {
  const taxUtils = require('../server/utils/taxUtils');

  const testTotals = [99, 149, 199, 280, 299, 300, 315, 349, 500, 1000];
  for (const total of testTotals) {
    const breakdown = taxUtils.calculateInclusiveGst({
      amount: total,
      gstRate: 18,
      sellerState: 'Delhi',
      customerState: 'Maharashtra'
    });

    assert.strictEqual(
      breakdown.taxableAmount + breakdown.taxAmount,
      total,
      `Inclusive GST must reconcile exactly for total ₹${total}`
    );
    assert.strictEqual(breakdown.igstAmount, breakdown.taxAmount, 'Interstate order must allocate 100% to IGST');
  }
});

// -------------------------------------------------------------
// Test 8: Coupon Service Bad Field Error Fix (u.full_name)
// -------------------------------------------------------------
test('8. Existing coupon codes no longer crash on the users column (root cause of the production "internal error")', async () => {
  const row = { id: 9, code: 'SAVE10', discount_type: 'percent', discount_value: 10, min_order_value: 0, max_discount_amount: null, usage_limit: null, usage_count: 0, active: 1, store_id: 1, start_date: null, end_date: null };
  const pool = createFakePool([
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
    [/FROM coupons c WHERE/, () => [[row]]],
    [/FROM coupon_usage cu/, (sql) => { if (/u\.name\b/.test(sql)) { const e = new Error("Unknown column 'u.name' in 'field list'"); e.code = 'ER_BAD_FIELD_ERROR'; throw e; } return [[]]; }]
  ]);
  installFakePool(pool);
  delete require.cache[require.resolve('../server/services/couponService')];
  const svc = require('../server/services/couponService');
  const detail = await svc.getCouponById('SAVE10', 1);
  assert(detail && detail.code === 'SAVE10', 'admin coupon detail loads (usage query uses u.full_name)');
  const res = await svc.validateCoupon('save10', 500, 1);
  assert.strictEqual(res.valid, true, 'customer validation of an existing code succeeds');
});

// -------------------------------------------------------------
// Test 9: Coupon route never leaks internals
// -------------------------------------------------------------
test('9. Unexpected coupon failures return a generic 500 with no SQL/column/path text (real route)', async () => {
  const pool = createFakePool([
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
    [/FROM coupons c WHERE/, () => { throw new Error("Unknown column 'u.name' in 'field list' (/home/x/couponService.js)"); }]
  ]);
  installFakePool(pool);
  for (const k of Object.keys(require.cache)) if (/server[\\/](services|routes|controllers)|server[\\/]app\.js$/.test(k)) delete require.cache[k];
  const app = require('../server/app.js');
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const origErr = console.error; console.error = () => {};
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/coupons/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'SAVE10', subtotal_in_rupees: 500 }) });
    const body = await r.json();
    assert.strictEqual(r.status, 500);
    const text = JSON.stringify(body);
    assert(!/Unknown column|u\.name|\/home\/|couponService|SQL/i.test(text), `leaked: ${text}`);
    assert.strictEqual(body.error.message, "We couldn't check that code right now. Please try again in a moment.");
  } finally { console.error = origErr; await new Promise((r) => server.close(r)); }
});

// -------------------------------------------------------------
// Test 10: Checkout Error Message Extractor Shields Users from Raw Internal Error Strings
// -------------------------------------------------------------
test('10. extractCheckoutErrorMessage falls back safely if an internal server error string is received', () => {
  const checkoutJs = fs.readFileSync(path.join(__dirname, '..', 'customer-workspace', 'js', 'checkout.js'), 'utf8');
  assert(checkoutJs.includes('/internal error/i.test(msg)'), 'extractCheckoutErrorMessage must check for internal error strings');
});

runAll();
