/**
 * Real-browser QA for the storefront (headless Chrome over the DevTools protocol, no dependencies).
 *
 *   node tests/visual/run_visual_qa.js [--transport real|intercept|live] [--uploads exist|mixed|missing]
 *        [--base http://localhost:3000] [--pages checkout,shop] [--widths 320,390] [--flows 0|1]
 *        [--loader 0|1] [--out DIR]
 *
 * Start the storefront first (`npm run dev`, http://localhost:3000). Needs Node 22+ and Chrome
 * (CHROME_PATH overrides the macOS default). Skips with exit 0 when either is unavailable.
 *
 * TRANSPORT (where the page's API + /uploads live)
 *   real       tests/visual/mock_backend.js: genuine HTTP. /uploads is served by the real Express static
 *              handler (real 200 / 404), /api/coupons/validate is the real route, other GETs proxy production.
 *   intercept  API_BASE = https://api.chipakk.shop, only /uploads answers are simulated by the browser's
 *              Fetch domain. Proves the storefront REQUESTS the api.chipakk.shop origin.
 *   live       API_BASE = https://api.chipakk.shop, nothing simulated: records what production really answers.
 *
 * UPLOADS   exist (every image loads) | mixed (~1 in 5 are 404, deterministic) | missing (all 404)
 *
 * Per page x width it fails on: horizontal overflow / content escaping the viewport, clipped or overlapping
 * elements, broken-image icons, requests to the wrong /uploads origin, image request loops, loader that never
 * showed or never hid, JS exceptions, wrong star outline, product-stage image not filling, and (cards) missing
 * name / price / button / link, duplicate ids, overlapping or unclickable controls. Optional flow checks cover
 * the cart drawer, product links, search, category navigation, pagination and the checkout + coupon UI; optional
 * loader scenarios cover slow / failing / hanging API, hanging images and a blocked video.
 * Exit code 1 when anything fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, close, Page, png } = require('./cdp.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:3000');
const TRANSPORT = arg('transport', 'real');
const UPLOADS = arg('uploads', 'mixed');
const PAGES = arg('pages', 'index,shop,categories,product,checkout,custom-stickers,account').split(',');
const WIDTHS = arg('widths', '320,360,375,390,412,430,480,768,1024,1440').split(',').map(Number);
const FLOWS = arg('flows', '1') === '1';
const LOADER = arg('loader', '1') === '1';
const OUT = arg('out', path.join(os.tmpdir(), 'chipakk-visual-qa'));
const PROD_API = 'https://api.chipakk.shop/api';
const FLOW_WIDTHS = [320, 390, 768, 1440];
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PATHS = { index: 'index.html', shop: 'shop.html', categories: 'categories.html', product: 'product.html?id=129', checkout: 'checkout.html', 'custom-stickers': 'custom-stickers.html', account: 'account.html' };
// gross = 18*10 + 2*20 + 3*20 + 1*20 = ₹300 exactly: the free-shipping boundary; SAVE35 then leaves ₹265 net
const CART_QTY = [18, 2, 3, 1];
const SETTINGS = arg('settings', 'rule');
const SUPPLIER = arg('supplier', 'fixture'); // fixture | none  (none: checkout must show the blocked notice)
const CART_IDS = [129, 128, 127, 124];

/* ------------------------------------------------------------------ in-page scripts */
const METRICS = `(() => {
  const W = screen.width;
  const out = { device: W, docW: document.documentElement.scrollWidth, offenders: [], clipped: [], dupIds: [], img: { visible: 0, loaded: 0, broken: 0, placeholders: 0, pending: 0, brokenList: [] } };
  const hiddenEl = (el) => el.closest('#loadingOverlay,.skip-link,[hidden]') || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden';
  // wider than the screen is harmless only when an ancestor that itself fits on screen clips it
  const clippedBy = (el) => { for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n); if (s.overflowX !== 'visible') { const r = n.getBoundingClientRect(); if (r.left >= -1 && r.right <= W + 1) return true; } } return false; };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) { if (hiddenEl(el) || clippedBy(el)) continue; const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    if (r.right > W + 1 || r.left < -1) { const k = el.tagName + '.' + String(typeof el.className === 'string' ? el.className : ''); if (!seen.has(k) && out.offenders.length < 8) { seen.add(k); out.offenders.push(k + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']'); } } }
  for (const el of document.querySelectorAll('button,.btn,.product-price,.product-add,.product-badge,.chip,.filter-chip,.category-chip,label,select,.cart-item-total-price,.checkout-item-price,.rating-tier')) {
    if (hiddenEl(el) || el.matches('.visually-hidden,.sr-only')) continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') out.clipped.push(el.tagName + '.' + String(el.className).slice(0, 40) + ' ' + el.scrollWidth + '>' + el.clientWidth); }
  const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1; out.dupIds = Object.keys(ids).filter((k) => ids[k] > 1);
  for (const im of document.querySelectorAll('img')) { const r = im.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0) || hiddenEl(im)) continue; out.img.visible++;
    if (im.complete && im.naturalWidth === 0 && (im.currentSrc || im.src)) { out.img.broken++; out.img.brokenList.push((im.currentSrc || im.src).slice(-60)); } else if (im.complete && im.naturalWidth > 0) out.img.loaded++; else out.img.pending++; }
  out.distorted = [];
  for (const im of document.querySelectorAll('img')) { if (hiddenEl(im) || !im.complete || !im.naturalWidth) continue; const r = im.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
    const fit = getComputedStyle(im).objectFit; if (fit !== 'fill') continue; const nat = im.naturalWidth / im.naturalHeight, ren = r.width / r.height;
    if (Math.abs(ren - nat) / nat > 0.04) out.distorted.push((im.className || im.getAttribute('src') || '').toString().slice(-40) + ' natural ' + nat.toFixed(2) + ' rendered ' + ren.toFixed(2)); }
  out.img.placeholders = document.querySelectorAll('.img-placeholder').length;
  const star = document.querySelector('.stars svg polygon'); out.starStroke = star ? parseFloat(getComputedStyle(star).strokeWidth) : null;
  const stage = document.querySelector('.product-stage'), simg = stage && stage.querySelector('img');
  if (simg && simg.complete && simg.naturalWidth) { const a = stage.getBoundingClientRect(), b = simg.getBoundingClientRect(); const inner = a.width - 2 * parseFloat(getComputedStyle(stage).borderLeftWidth || 0); out.stageFill = Math.round((Math.max(b.width, b.height) / inner) * 100) / 100; out.stageCentered = Math.abs((b.left + b.width / 2) - (a.left + a.width / 2)) < 2; }
  const hdr = document.querySelector('.header-inner'); out.headerOverlap = [];
  if (hdr) { const kids = Array.from(hdr.children).filter((c) => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0).map((c) => ({ n: (c.className || c.tagName).toString().slice(0, 28), r: c.getBoundingClientRect() }));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].r, b = kids[j].r; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.headerOverlap.push(kids[i].n + ' x ' + kids[j].n); }
    out.headerRight = Math.round(Math.max(...kids.map((k) => k.r.right))); }
  const ov = document.getElementById('loadingOverlay'); out.loader = ov ? { hidden: ov.getAttribute('data-hidden'), display: getComputedStyle(ov).display } : null;
  return out; })()`;

const CARD_CHECKS = `(() => {
  const out = []; const cards = [...document.querySelectorAll('.product-card')].filter((c) => c.getBoundingClientRect().width > 0);
  const byGrid = new Map(); const ids = [];
  for (const c of cards) {
    const id = c.dataset.productId; ids.push(id);
    const name = ((c.querySelector('.product-name') || {}).textContent || '').trim(); const price = ((c.querySelector('.product-price') || {}).textContent || '').trim();
    const link = c.querySelector('.product-name a'); const href = link ? link.getAttribute('href') || '' : '';
    if (!id) out.push('card without data-product-id'); if (!name) out.push('card ' + id + ': no name'); if (!/₹\\s?[\\d,]+/.test(price)) out.push('card ' + id + ': no price (' + price + ')');
    if (!link || href !== 'product.html?id=' + encodeURIComponent(id)) out.push('card ' + id + ': bad link ' + href);
    if (!c.querySelector('[data-add-to-cart],[data-move-cart]')) out.push('card ' + id + ': no add-to-cart button');
    if (!c.querySelector('.product-media img, .product-media .img-placeholder')) out.push('card ' + id + ': no media element');
    const cr = c.getBoundingClientRect();
    for (const d of c.querySelectorAll('.product-name,.product-price,.product-add,.product-rating,.product-price-orig')) { const r = d.getBoundingClientRect(); if (r.width && (r.right > cr.right + 1 || r.left < cr.left - 1)) out.push('card ' + id + ': ' + d.className + ' escapes the card'); }
    const g = c.parentElement; if (!byGrid.has(g)) byGrid.set(g, []); byGrid.get(g).push(c);
  }
  for (const [g, list] of byGrid) {
    const seen = {}; for (const c of list) { const id = c.dataset.productId; if (seen[id]) out.push('duplicate card ' + id + ' in one grid'); seen[id] = 1; }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i].getBoundingClientRect(), b = list[j].getBoundingClientRect(); const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 2 && h > 2) out.push('cards ' + list[i].dataset.productId + ' and ' + list[j].dataset.productId + ' overlap'); }
  }
  // controls of the first cards must be reachable (not covered by another element)
  for (const c of cards.slice(0, 3)) {
    for (const sel of ['.product-name a', '[data-add-to-cart],[data-move-cart]', '[data-wishlist-id]']) { const el = c.querySelector(sel); if (!el) continue;
      el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); if (!r.width) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!top || !(el === top || el.contains(top) || top.contains(el))) out.push('card ' + c.dataset.productId + ': ' + sel + ' is covered by ' + (top ? top.tagName + '.' + top.className : 'nothing')); }
  }
  window.scrollTo(0, 0);
  return { cards: cards.length, ids: ids.slice(0, 40), problems: out };
})()`;

const DRAWER_FLOW = (expectedRows) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const W = screen.width; const problems = [];
  document.getElementById('cartBtn').click(); await sleep(600);
  const dr = document.getElementById('cartDrawer'); const dl = dr.getBoundingClientRect();
  if (dl.left < -1 || dl.right > W + 1) problems.push('open drawer escapes viewport [' + Math.round(dl.left) + '..' + Math.round(dl.right) + ']');
  const rows = [...dr.querySelectorAll('.cart-item')]; if (rows.length !== ${expectedRows}) problems.push('drawer rows ' + rows.length + ' != ${expectedRows}');
  for (const row of rows) {
    const im = row.querySelector('.cart-item-media img'); const ph = row.querySelector('.cart-item-media .img-placeholder');
    if (im ? !(im.complete && im.naturalWidth > 0) : !ph) problems.push('drawer row without loaded image or placeholder');
    const name = (row.querySelector('.cart-item-name') || {}).textContent; if (!name || !name.trim()) problems.push('drawer row without name');
    if (!/₹/.test((row.querySelector('.cart-item-total-price') || {}).textContent || '')) problems.push('drawer row without price');
    const a = row.querySelector('.cart-qty-stepper').getBoundingClientRect(), b = row.querySelector('.cart-item-prices').getBoundingClientRect();
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) problems.push('qty stepper overlaps price');
    for (const el of row.querySelectorAll('.cart-item-name,.cart-item-total-price,.cart-qty-stepper')) { const r = el.getBoundingClientRect(); if (r.right > dl.right + 1 || r.left < dl.left - 1) problems.push('drawer content escapes drawer: ' + el.className); }
  }
  const sub0 = document.getElementById('cartSubtotal').textContent; const q0 = +rows[0].querySelector('.cart-qty-val').textContent;
  rows[0].querySelector('[data-qty-increase]').click(); await sleep(350);
  const q1 = +dr.querySelector('.cart-item .cart-qty-val').textContent; if (q1 !== q0 + 1) problems.push('qty increase did not work ' + q0 + '->' + q1);
  if (document.getElementById('cartSubtotal').textContent === sub0) problems.push('subtotal did not change after qty increase');
  const n0 = dr.querySelectorAll('.cart-item').length; dr.querySelectorAll('[data-remove-item]')[n0 - 1].click(); await sleep(350);
  if (dr.querySelectorAll('.cart-item').length !== n0 - 1) problems.push('remove item did not remove a row');
  document.getElementById('cartCloseBtn').click(); await sleep(400);
  return { rows: rows.length, subtotalBefore: sub0, problems };
})()`;

const CHECKOUT_FLOW = (expectSubtotal, withCoupons) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const W = screen.width; const problems = []; const num = (t) => Number(String(t || '').replace(/[^0-9.]/g, '')) || 0;
  const st = (window.CHIPAKK && window.CHIPAKK.DATA && window.CHIPAKK.DATA.settings) || {};
  const thr = typeof st.freeShippingThreshold === 'number' ? st.freeShippingThreshold : 300; const fee = typeof st.shippingFee === 'number' ? st.shippingFee : 50;
  const shipFor = (gross) => (thr > 0 && gross >= thr ? 0 : fee);
  const rows = [...document.querySelectorAll('#checkoutItemsList .checkout-item-row')];
  if (rows.length !== 4) problems.push('checkout rows ' + rows.length + ' != 4');
  for (const row of rows) {
    const t = row.querySelector('.checkout-item-thumb'), n = row.querySelector('.checkout-item-name'), p = row.querySelector('.checkout-item-price');
    if (!t || !n || !p) { problems.push('row missing thumb/name/price'); continue; }
    if (!t.querySelector('img,.img-placeholder')) problems.push('row thumb has no image or placeholder');
    const im = t.querySelector('img'); if (im && !(im.complete && im.naturalWidth > 0)) problems.push('row image broken');
    if (!/₹/.test(p.textContent)) problems.push('row without price'); if (!n.textContent.trim()) problems.push('row without name');
    const rs = [t, n, p].map((e) => e.getBoundingClientRect());
    for (let i = 0; i < 3; i++) { if (rs[i].right > W + 1 || rs[i].left < -1) problems.push('row part escapes viewport'); for (let j = i + 1; j < 3; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) problems.push('row parts overlap'); } }
  }
  const money = (id) => num((document.getElementById(id) || {}).textContent);
  const shipOf = () => { const t = (document.getElementById('checkoutShipping') || {}).textContent || ''; return /free/i.test(t) ? 0 : num(t); };
  const subtotal = money('checkoutSubtotal'); if (subtotal !== ${expectSubtotal}) problems.push('subtotal ' + subtotal + ' != expected ${expectSubtotal}');
  const shipping = shipOf(); if (shipping !== shipFor(subtotal)) problems.push('shipping ₹' + shipping + ' for gross ₹' + subtotal + ' (rule: threshold ₹' + thr + ', fee ₹' + fee + ')');
  const total0 = money('checkoutTotal'); if (total0 !== subtotal + shipping) problems.push('total ' + total0 + ' != ' + (subtotal + shipping));
  const gst = money('checkoutTax'); const expGst = total0 - Math.round(total0 * 100 / 118); if (gst !== expGst) problems.push('GST shown ' + gst + ' != inclusive ' + expGst + ' for total ' + total0);
  const place = document.getElementById('placeOrderBtn'); place.scrollIntoView({ block: 'center', behavior: 'instant' }); const pr = place.getBoundingClientRect();
  if (!pr.width || pr.left < -1 || pr.right > W + 1) problems.push('Place Order button not inside the viewport'); const top = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2); if (!top || !(place === top || place.contains(top))) problems.push('Place Order button is covered by ' + (top ? top.tagName + '.' + top.className : 'nothing'));
  // GST presentation: the state picker, the supplier line and the blocked-checkout notice
  const stateInput = document.getElementById('custState'); if (!stateInput || stateInput.getAttribute('list') !== 'gstStateList' || document.querySelectorAll('#gstStateList option').length < 36) problems.push('state field has no GST state list');
  const soldBy = document.getElementById('checkoutSoldBy'), notice = document.getElementById('checkoutTaxNotice');
  const soldVisible = soldBy && getComputedStyle(soldBy).display !== 'none'; const noticeVisible = notice && getComputedStyle(notice).display !== 'none';
  const expectBlocked = ${SUPPLIER === 'none' ? 'true' : 'false'};
  if (expectBlocked) {
    if (!noticeVisible) problems.push('tax notice not shown although the supplier is not configured'); if (!place.disabled) problems.push('Place Order must be disabled while checkout is tax-blocked'); if (soldVisible) problems.push('"Sold by" shown without a supplier');
  } else {
    if (noticeVisible) problems.push('tax notice shown although the supplier is configured'); if (place.disabled) problems.push('Place Order disabled although the supplier is configured');
    if (!soldVisible || !/Sold by .+\\(GSTIN [0-9A-Z]{15}\\), trading as CHIPAKK\\. All prices include GST\\./.test(soldBy.textContent)) problems.push('"Sold by" line missing or wrong: ' + (soldBy && soldBy.textContent));
  }
  for (const el of [soldBy, notice]) { if (el && getComputedStyle(el).display !== 'none') { const r = el.getBoundingClientRect(); if (r.left < -1 || r.right > W + 1) problems.push(el.id + ' escapes the viewport'); } }
  const results = { soldBy: soldVisible ? soldBy.textContent : null, taxNotice: !!noticeVisible }; const settings = { threshold: thr, fee };
  if (${withCoupons ? 'true' : 'false'}) {
    const input = document.getElementById('couponInput'), btn = document.getElementById('applyCouponBtn'), msg = document.getElementById('couponMessage');
    const apply = async (code) => { input.value = code; btn.click(); for (let i = 0; i < 40 && btn.disabled; i++) await sleep(100); await sleep(150); const r = msg.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) problems.push('coupon message escapes viewport'); return (msg.textContent || '').trim(); };
    results.SAVE35 = await apply('SAVE35'); if (!/applied/i.test(results.SAVE35)) problems.push('SAVE35 message: ' + results.SAVE35);
    const net = subtotal - 35; const expShip = shipFor(subtotal); // eligibility is decided by the GROSS subtotal, never the net
    if (money('checkoutTotal') !== net + expShip) problems.push('SAVE35 total ' + money('checkoutTotal') + ' != ' + (net + expShip));
    if (shipOf() !== expShip) problems.push('shipping changed after coupon: ₹' + shipOf() + ' (gross ₹' + subtotal + ', net ₹' + net + ')');
    results.afterCoupon = { gross: subtotal, net, shipping: shipOf(), total: money('checkoutTotal'), gst: money('checkoutTax') };
    const dRow = document.getElementById('checkoutDiscountRow'); if (!dRow || getComputedStyle(dRow).display === 'none' || money('checkoutDiscountAmount') !== 35) problems.push('discount row not showing 35');
    const gst2 = money('checkoutTax'); const expGst2 = money('checkoutTotal') - Math.round(money('checkoutTotal') * 100 / 118); if (gst2 !== expGst2) problems.push('GST after coupon ' + gst2 + ' != ' + expGst2);
    const bad = { NOPE: /invalid or inactive/i, EXPIRED: /expired/i, MIN9999: /minimum order value/i, USEDUP: /usage limit/i, BOOM: /couldn.t check|try again/i };
    for (const [code, re] of Object.entries(bad)) { const t = await apply(code); results[code] = t; if (!re.test(t)) problems.push(code + ' message not friendly: ' + t);
      if (/ER_|SQL|column|u\\.name|stack|\\.js|internal error|exception|undefined|null|\\[object/i.test(t)) problems.push(code + ' leaks internals: ' + t);
      if (money('checkoutTotal') !== subtotal + shipFor(subtotal)) problems.push(code + ': failed coupon still discounts (total ' + money('checkoutTotal') + ')'); }
  }
  const toast = document.getElementById('toast');
  if (toast && toast.classList.contains('is-active')) { const tr = toast.getBoundingClientRect(); const lines = Math.round(tr.height / (parseFloat(getComputedStyle(toast).lineHeight) || 18));
    if (tr.left < -1 || tr.right > W + 1) problems.push('toast escapes the viewport'); if (tr.width < Math.min(W * 0.6, 260)) problems.push('toast is only ' + Math.round(tr.width) + 'px wide on a ' + W + 'px screen (' + lines + ' lines)'); results.toast = { width: Math.round(tr.width), viewport: W }; }
  return { subtotal, shipping, total: total0, gst, settings, results, problems };
})()`;

const LOADER_PROBE_INIT = `
  window.__loader = { seen: false, dcl: null, video: null, hiddenAt: null, t0: performance.now() };
  const L = window.__loader;
  const snap = () => { const o = document.getElementById('loadingOverlay'); if (!o) return null; return { hidden: o.getAttribute('data-hidden'), display: getComputedStyle(o).display, opacity: getComputedStyle(o).opacity }; };
  const tick = () => {
    const o = document.getElementById('loadingOverlay'); const s = o && snap();
    if (o && s.hidden === 'false' && s.display !== 'none') L.seen = true;
    const v = o && o.querySelector('video');
    if (v) { if (!L.video) L.video = { muted: v.muted, loop: v.loop, playsInline: v.playsInline, autoplay: v.autoplay, attrPlaysinline: v.hasAttribute('playsinline'), attrMuted: v.hasAttribute('muted'), src: (v.currentSrc || v.getAttribute('src') || (v.querySelector('source') || {}).src || ''), paused: v.paused, readyState: v.readyState, maxTime: 0, playing: false };
      L.video.paused = v.paused; L.video.readyState = v.readyState; L.video.maxTime = Math.max(L.video.maxTime, v.currentTime); if (!v.paused && v.currentTime > 0) L.video.playing = true; }
    if (o && s.hidden === 'true' && L.hiddenAt === null) L.hiddenAt = Math.round(performance.now() - L.t0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.addEventListener('DOMContentLoaded', () => { L.dcl = snap(); const o = document.getElementById('loadingOverlay'); if (o && o.getAttribute('data-hidden') === 'false') L.seen = true; });
`;

/* ------------------------------------------------------------------ helpers */
function expectedSubtotal(products, qtys = CART_QTY) {
  return CART_IDS.reduce((sum, id, i) => { const p = products.find((x) => Number(x.id) === id); return sum + (p ? (p.price_rupees ?? p.price) * qtys[i] : 0); }, 0);
}
function cartSeed(products, qtys = CART_QTY) {
  return JSON.stringify(CART_IDS.map((id, i) => {
    const p = products.find((x) => Number(x.id) === id) || {};
    const file = String(p.primary_image_url || '');
    // Stale form written by the old storefront: WRONG origin (chipakk.shop instead of the API host).
    return { id: String(id), variantKey: `${id}_glossy_3_`, name: p.name || 'Sticker', price: p.price_rupees ?? p.price ?? 0, image: 'https://chipakk.shop' + file, material: 'Glossy', size: '3"', materials: ['Glossy'], sizes: ['3"'], is_custom: false, custom_design_data: null, qty: qtys[i] };
  }));
}

async function newPage(width, ctx) {
  const p = await Page.open();
  await p.viewport(width, 800, width < 900);
  await p.init(`window.API_BASE_URL=${JSON.stringify(ctx.apiBase)}; ${ctx.loaderMaxWait ? `window.CHIPAKK_LOADER_MAX_WAIT_MS=${ctx.loaderMaxWait};` : ''} try{localStorage.setItem('chipakk_cart_v1', ${JSON.stringify(ctx.cart)});}catch(e){}`);
  await p.init(LOADER_PROBE_INIT);
  if (TRANSPORT === 'intercept') {
    await p.intercept(['*://api.chipakk.shop/uploads/*'], (req) => { const f = req.url.split('/').pop();
      const missing = UPLOADS === 'missing' || (UPLOADS === 'mixed' && parseInt(f.replace(/\D/g, '').slice(-2) || '0', 10) % 5 === 0);
      if (missing) return { status: 404, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{"success":false}' };
      return { status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, body: png(300, 300, f) }; });
  }
  return p;
}

/** Scroll the whole page once (so lazy images load), then let it go idle. */
async function settle(p) {
  await sleep(1000);
  await p.eval(`(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<=h;y+=Math.max(240,innerHeight/2)){scrollTo(0,y);await new Promise(r=>setTimeout(r,110));}await new Promise(r=>setTimeout(r,500));scrollTo(0,0);})()`).catch(() => {});
}

async function waitLoaderHidden(p, maxMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { const h = await p.eval(`(window.__loader||{}).hiddenAt`).catch(() => null); if (h !== null && h !== undefined) return h; await sleep(40); }
  return null;
}

/** Every /uploads request of this page load, the origin it went to, and the HTTP status the browser saw. */
function uploadEvidence(p, ctx) {
  const seen = new Map();
  for (const r of p.requests) {
    if (!/\/uploads\//.test(r.url)) continue; const e = seen.get(r.url) || { url: r.url, count: 0, status: null, note: '' }; e.count++;
    if (r.status !== undefined) e.status = r.status;
    // Chrome blocks a cross-origin JSON 404 on an <img> (ORB) and never reports its status: use the server's own log.
    else if (r.failed) { const srv = ctx.mock && ctx.mock.log.filter((l) => r.url.endsWith(l.path)).map((l) => l.status).filter(Boolean).pop(); e.status = srv || null; e.note = r.failed + (srv ? ' (status from server log)' : ''); }
    seen.set(r.url, e); }
  const list = [...seen.values()];
  const wrongOrigin = list.filter((e) => !e.url.startsWith(ctx.uploadsOrigin + '/uploads/'));
  return { list, wrongOrigin, max: list.reduce((m, e) => Math.max(m, e.count), 0) };
}

/* ------------------------------------------------------------------ one page x width */
async function checkPage(page, w, ctx, summary) {
  const p = await newPage(w, ctx);
  const t0 = Date.now();
  await p.send('Page.navigate', { url: `${BASE}/${PATHS[page]}` });
  const hiddenAt = await waitLoaderHidden(p);
  await settle(p);
  const m = await p.eval(METRICS);
  const cards = await p.eval(CARD_CHECKS).catch((e) => ({ cards: 0, problems: ['card check crashed: ' + e.message] }));
  const canScroll = await p.eval(`document.documentElement.scrollHeight - innerHeight`).catch(() => 0);
  let stickyBottom = null;
  if (canScroll > 350) { await p.eval('scrollTo(0, 600)'); await sleep(450); stickyBottom = await p.eval(`Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom)`).catch(() => null); }
  const lp = await p.eval('window.__loader').catch(() => null);
  const ev1 = uploadEvidence(p, ctx); const n1 = p.requests.length; await sleep(1500); const growth = p.requests.length - n1; // an image error loop would keep requesting
  const exc = p.log.filter((l) => /EXCEPTION/.test(l));

  const problems = [];
  if (m.docW > m.device) problems.push(`horizontal overflow ${m.docW}>${m.device}`);
  if (m.offenders.length) problems.push('content outside viewport: ' + m.offenders.join(', '));
  if (m.clipped.length) problems.push('clipped text: ' + m.clipped.slice(0, 4).join(', '));
  if (m.dupIds.length) problems.push('duplicate ids (duplicate rendering): ' + m.dupIds.join(','));
  if (m.img.broken) problems.push(`${m.img.broken} broken image icon(s): ${m.img.brokenList.join(' | ')}`);
  if (m.distorted.length) problems.push('distorted (stretched) images: ' + m.distorted.slice(0, 3).join(' | '));
  if (m.img.pending) problems.push(`${m.img.pending} image(s) never finished`);
  if (m.headerOverlap.length) problems.push('header overlap: ' + m.headerOverlap.join('; '));
  if (m.headerRight && m.headerRight > m.device) problems.push(`header content clipped (${m.headerRight}>${m.device})`);
  if (m.starStroke !== null && m.starStroke > 4) problems.push(`star stroke ${m.starStroke} paints the icon solid`);
  if (m.stageFill !== undefined && (m.stageFill < 0.95 || !m.stageCentered)) problems.push(`product stage image fills ${Math.round(m.stageFill * 100)}% / centered=${m.stageCentered}`);
  if (stickyBottom !== null && stickyBottom > 100) problems.push(`sticky header occupies ${stickyBottom}px after scrolling`);
  if (!m.loader || m.loader.hidden !== 'true') problems.push('loader still visible after load');
  if (!lp || !lp.seen) problems.push('loader was never visible at startup');
  if (hiddenAt === null) problems.push('loader never hid');
  if (ev1.wrongOrigin.length) problems.push('/uploads requested from the wrong origin: ' + ev1.wrongOrigin.slice(0, 3).map((e) => e.url).join(' | '));
  if (growth > 0 && ev1.list.length) problems.push(`requests kept growing (${growth} in 1.5s idle): fallback loop?`);
  if (ev1.max > 8) problems.push(`one upload URL requested ${ev1.max} times`);
  if (['shop', 'index', 'product'].includes(page) && !cards.cards && page !== 'product') problems.push('no product cards rendered');
  for (const c of cards.problems) problems.push(c);
  if (exc.length) problems.push('JS exception: ' + exc[0].slice(0, 160));

  const flow = {};
  if (FLOWS && FLOW_WIDTHS.includes(w)) await runFlows(page, w, p, ctx, problems, flow);

  const row = { page, width: w, docW: m.docW, device: m.device, imgs: `${m.img.loaded}/${m.img.visible} loaded, ${m.img.placeholders} placeholder`, cards: cards.cards, loaderMs: hiddenAt, uploads: ev1.list.length, uploads404: ev1.list.filter((e) => e.status === 404).length, maxReq: ev1.max, problems };
  summary.rows.push(row);
  if (w === 390) summary.evidence[page] = ev1.list.slice(0, 60).map((e) => ({ url: e.url, status: e.status, count: e.count, note: e.note }));
  if (Object.keys(flow).length) summary.flows[`${page}@${w}`] = flow;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${(page + '@' + w).padEnd(22)} doc=${m.docW}/${m.device} imgs=${m.img.loaded}/${m.img.visible}(+${m.img.placeholders}ph) cards=${cards.cards} up=${ev1.list.length}(404:${row.uploads404}) loader=${hiddenAt}ms${problems.length ? '\n       <- ' + problems.join('\n       <- ') : ''}`);
  if (process.env.QA_SHOTS !== '0') { await p.eval('scrollTo(0,0)').catch(() => {}); await sleep(350); await p.shot(path.join(OUT, `${page}_${w}.png`), false).catch(() => {}); }
  if (['shop', 'index', 'categories', 'product'].includes(page) && process.env.QA_SHOTS !== '0') {
    const sel = page === 'categories' ? '.category-full-card' : (page === 'product' ? '#relatedProductsGrid .product-card' : '.product-card');
    await p.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){ e.scrollIntoView({block:'start',behavior:'instant'}); window.scrollBy(0,-110);} })()`).catch(() => {});
    await sleep(450); await p.shot(path.join(OUT, `${page}_${w}_cards.png`), false).catch(() => {});
  }
  if (page === 'checkout' && process.env.QA_SHOTS !== '0') {
    const regions = { items: `(()=>{const e=document.getElementById('checkoutItemsList'); e.scrollIntoView({block:'start',behavior:'instant'}); window.scrollBy(0,-90);})()`,
      totals: `(()=>{const e=document.getElementById('checkoutSubtotal'); e.scrollIntoView({block:'start',behavior:'instant'}); window.scrollBy(0,-140);})()`,
      place: `(()=>{const e=document.getElementById('placeOrderBtn'); e.scrollIntoView({block:'end',behavior:'instant'}); window.scrollBy(0,40);})()`,
      soldby: `(()=>{const e=document.getElementById('checkoutSoldBy'); e.scrollIntoView({block:'end',behavior:'instant'}); window.scrollBy(0,60);})()` };
    for (const [name, js] of Object.entries(regions)) { await p.eval(js).catch(() => {}); await sleep(450); await p.shot(path.join(OUT, `${page}_${w}_${name}.png`), false).catch(() => {}); }
  }
  await p.close();
  return problems.map((x) => `${page}@${w}: ${x}`);
}

/* ------------------------------------------------------------------ flows */
async function runFlows(page, w, p, ctx, problems, flow) {
  const add = (arr, prefix) => (arr || []).forEach((x) => problems.push(`${prefix}: ${x}`));
  try {
    if (['index', 'shop', 'product', 'account', 'categories', 'custom-stickers'].includes(page) && await p.eval(`!!document.getElementById('cartBtn')`)) {
      const d = await p.eval(DRAWER_FLOW(CART_QTY.length)); flow.drawer = { rows: d.rows }; add(d.problems, 'cart drawer');
    }
    if (page === 'shop') {
      const before = await p.eval(`+document.getElementById('cartCount').textContent || 0`);
      const clicked = await p.eval(`(()=>{const b=document.querySelector('.product-card [data-add-to-cart]:not([disabled])'); if(!b) return false; b.scrollIntoView({block:'center',behavior:'instant'}); b.click(); return true;})()`);
      await sleep(700);
      const after = await p.eval(`+document.getElementById('cartCount').textContent || 0`);
      flow.addToCart = { clicked, before, after };
      if (!clicked || after !== before + 1) problems.push(`add to cart: count ${before} -> ${after}`);
      // product link: real navigation to the card's link, product page must show the same product
      const first = await p.eval(`(()=>{const c=document.querySelector('.product-card'); const a=c.querySelector('.product-name a'); return {id:c.dataset.productId, name:a.textContent.trim(), href:a.href};})()`);
      await p.send('Page.navigate', { url: first.href }); await waitLoaderHidden(p); await sleep(700);
      const pp = await p.eval(`({url: location.search, title: (document.getElementById('prodDetailTitle')||{}).textContent, stageImg: !!document.querySelector('#prodStageArt img, #prodStageArt .img-placeholder')})`);
      flow.productLink = { card: first, product: pp };
      if (!pp.url.includes('id=' + first.id)) problems.push('product link lost the id: ' + pp.url);
      if (String(pp.title).trim().toLowerCase() !== first.name.toLowerCase()) problems.push(`product page title "${pp.title}" != card name "${first.name}"`);
      if (!pp.stageImg) problems.push('product page has no stage image/placeholder');
      // search + empty search
      await p.send('Page.navigate', { url: `${BASE}/shop.html?search=${encodeURIComponent((first.name.split(' ')[0] || 'a'))}` }); await waitLoaderHidden(p); await sleep(900);
      const s1 = await p.eval(`document.querySelectorAll('.product-card').length`); flow.search = { term: first.name.split(' ')[0], cards: s1 };
      if (!s1) problems.push('search for an existing product name returned no cards');
      await p.send('Page.navigate', { url: `${BASE}/shop.html?search=zzzqqxx` }); await waitLoaderHidden(p); await sleep(900);
      const s2 = await p.eval(`({cards: document.querySelectorAll('.product-card').length, text: document.body.innerText.length})`);
      if (s2.cards) problems.push('nonsense search still shows cards'); flow.search.empty = s2;
      // pagination / load more
      await p.send('Page.navigate', { url: `${BASE}/shop.html` }); await waitLoaderHidden(p); await sleep(900);
      const pg = await p.eval(`(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const n0=document.querySelectorAll('.product-card').length; const b=[...document.querySelectorAll('button,a')].find(x=>/load more|show more|next/i.test(x.textContent)&&x.getBoundingClientRect().width>0); if(!b) return {n0,btn:false}; b.scrollIntoView({block:'center',behavior:'instant'}); b.click(); await sleep(900); const ids=[...document.querySelectorAll('.product-card')].map(c=>c.dataset.productId); return {n0,btn:true,n1:ids.length,dupes:ids.length-new Set(ids).size};})()`);
      flow.pagination = pg; if (pg.btn && (pg.n1 <= pg.n0 || pg.dupes)) problems.push(`pagination: ${pg.n0} -> ${pg.n1}, dupes ${pg.dupes}`);
    }
    if (page === 'categories') {
      const link = await p.eval(`(()=>{const a=document.querySelector('.category-full-card a[href*="shop.html"], .category-full-card a'); return a? a.href : null;})()`);
      flow.categoryLink = link;
      if (!link) problems.push('categories page: no category link');
      else { await p.send('Page.navigate', { url: link }); await waitLoaderHidden(p); await sleep(900);
        const r = await p.eval(`(()=>{const cards=[...document.querySelectorAll('.product-card')]; const slug=new URLSearchParams(location.search).get('category'); return {slug, cards:cards.length, mismatched:cards.filter(c=>c.dataset.category && c.dataset.category!==slug).length};})()`);
        flow.categoryShop = r; if (!r.cards) problems.push('category link shows no products'); if (r.mismatched) problems.push(`${r.mismatched} cards from another category`); }
    }
    if (page === 'product') {
      const g = await p.eval(`(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const th=[...document.querySelectorAll('#galleryThumbs .gallery-thumb')]; const r={thumbs:th.length}; if(th.length>1){ th[1].click(); await sleep(400); const stage=document.querySelector('#prodStageArt img'); const ph=document.querySelector('#prodStageArt .img-placeholder'); const tsrc=(th[1].querySelector('img')||{}).currentSrc; r.stage=stage?stage.currentSrc:null; r.thumbSrc=tsrc||null; r.placeholder=!!ph; r.stageOk = stage ? (stage.complete&&stage.naturalWidth>0) : !!ph; r.matches = stage ? stage.currentSrc===tsrc : true; } return r;})()`);
      flow.gallery = g;
      if (g.thumbs < 3) problems.push(`multi-image product shows ${g.thumbs} thumbs, expected 3`);
      else { if (!g.stageOk) problems.push('gallery: stage image broken after clicking thumb'); if (!g.matches) problems.push('gallery: stage does not show the clicked thumb'); }
    }
    if (page === 'checkout') { const c = await p.eval(CHECKOUT_FLOW(expectedSubtotal(ctx.products), true)); flow.checkout = { settings: c.settings, subtotal: c.subtotal, shipping: c.shipping, total: c.total, gst: c.gst, coupon: c.results }; add(c.problems, 'checkout'); }
  } catch (e) { problems.push('flow crashed: ' + e.message); }
}

/* ------------------------------------------------------------------ checkout gross-subtotal variants */
async function checkoutVariants(ctx, summary) {
  for (const w of [320, 390]) for (const [label, qtys] of [['gross ₹290 (below threshold)', [17, 2, 3, 1]], ['gross ₹310 (above threshold)', [19, 2, 3, 1]]]) {
    const p = await newPage(w, { ...ctx, cart: cartSeed(ctx.products, qtys) });
    await p.send('Page.navigate', { url: `${BASE}/checkout.html` }); await waitLoaderHidden(p); await settle(p);
    const r = await p.eval(CHECKOUT_FLOW(expectedSubtotal(ctx.products, qtys), false)).catch((e) => ({ problems: ['crashed: ' + e.message] }));
    console.log(`${r.problems.length ? 'FAIL' : 'ok  '} checkout variant @${w} ${label}: subtotal ₹${r.subtotal} shipping ₹${r.shipping} total ₹${r.total} GST ₹${r.gst}${r.problems.length ? '\n       <- ' + r.problems.join('\n       <- ') : ''}`);
    summary.flows[`checkout-variant@${w} ${label}`] = { subtotal: r.subtotal, shipping: r.shipping, total: r.total, gst: r.gst };
    r.problems.forEach((x) => summary.failures.push(`checkout variant @${w} ${label}: ${x}`));
    await p.close();
  }
}

/* ------------------------------------------------------------------ loader scenarios */
async function loaderScenarios(mock, ctx, summary) {
  const results = [];
  const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} loader :: ${name} ${detail}`); if (!ok) summary.failures.push(`loader :: ${name} ${detail}`); };
  const run = async (name, w, page, setup, check, opts = {}) => {
    mock.state.api = 'ok'; mock.state.apiDelayMs = 0; mock.state.uploads = 'ok'; setup && setup(mock.state);
    const p = await newPage(w, { ...ctx, loaderMaxWait: opts.maxWait });
    if (opts.blockVideo) await p.intercept(['*://*/assets/video/*'], () => ({ status: 404, headers: { 'content-type': 'text/plain' }, body: 'x' }));
    await p.send('Page.navigate', { url: `${BASE}/${PATHS[page]}` });
    const samples = {}; const t0 = Date.now();
    for (const at of (opts.sampleAt || [])) { await sleep(Math.max(0, at - (Date.now() - t0))); samples[at] = await p.eval(`(()=>{const o=document.getElementById('loadingOverlay'); const v=o&&o.querySelector('video'); return {hidden:o&&o.getAttribute('data-hidden'), display:o&&getComputedStyle(o).display, vpaused:v&&v.paused, vtime:v&&v.currentTime, vready:v&&v.readyState, videoError:v&&!!v.error};})()`).catch(() => null); }
    const hiddenAt = await waitLoaderHidden(p, opts.waitMs || 14000);
    const lp = await p.eval('window.__loader').catch(() => null);
    const body = await p.eval(`document.body.innerText.length`).catch(() => 0);
    let out; try { out = check({ hiddenAt, lp, samples, body }); } catch (e) { out = [false, e.message]; }
    record(name, out[0], `(${out[1]}; hid at ${hiddenAt}ms)`);
    await p.close(); mock.state.api = 'ok'; mock.state.apiDelayMs = 0; mock.state.uploads = 'ok';
  };
  const w = 390;
  await run('shown immediately (before DOMContentLoaded) with muted / playsinline / looping / autoplaying video', w, 'shop', (s) => { s.apiDelayMs = 2200; },
    ({ lp }) => { const v = lp && lp.video; const dcl = lp && lp.dcl; const ok = !!(lp && lp.seen && dcl && dcl.hidden === 'false' && dcl.display !== 'none' && v && v.muted && v.loop && v.playsInline && v.autoplay && v.attrPlaysinline && /loading_01\.mp4/.test(v.src)); return [ok, `dcl=${JSON.stringify(dcl)} video=${JSON.stringify(v && { muted: v.muted, loop: v.loop, playsInline: v.playsInline, autoplay: v.autoplay, src: v.src.split('/').slice(-3).join('/') })}`]; });
  await run('video really plays while the loader is up (paused=false, currentTime advancing)', w, 'shop', (s) => { s.apiDelayMs = 2500; },
    ({ lp, samples }) => { const s = samples[1500]; const ok = !!(lp && lp.video && lp.video.playing && s && s.hidden === 'false' && s.vpaused === false && s.vtime > 0); return [ok, `at 1.5s ${JSON.stringify(s)}`]; }, { sampleAt: [1500] });
  await run('waits for critical data, then fades (slow API 2.2s = two round-trips: still up at 1s, gone < 5.5s; a third sequential round-trip would fail)', w, 'shop', (s) => { s.apiDelayMs = 2200; },
    ({ hiddenAt, samples }) => [samples[1000] && samples[1000].hidden === 'false' && hiddenAt !== null && hiddenAt >= 2000 && hiddenAt < 5500, `at 1s ${JSON.stringify(samples[1000] && samples[1000].hidden)}`], { sampleAt: [1000] });
  await run('API failure (500) cannot trap the loader; page shows content/error state', w, 'shop', (s) => { s.api = 'fail'; },
    ({ hiddenAt, body }) => [hiddenAt !== null && hiddenAt < 3500 && body > 200, `body text ${body} chars`]);
  await run('API hang is bounded by the ceiling (override 3s)', w, 'shop', (s) => { s.api = 'hang'; },
    ({ hiddenAt }) => [hiddenAt !== null && hiddenAt >= 2800 && hiddenAt < 5000, 'ceiling 3000ms'], { maxWait: 3000 });
  await run('images that never answer do not hold the loader (uploads hang, API fast)', w, 'shop', (s) => { s.uploads = 'hang'; },
    ({ hiddenAt }) => [hiddenAt !== null && hiddenAt < 2500, 'not waiting for /uploads']);
  await run('a blocked / failing loader video does not hold the loader', w, 'index', null,
    ({ hiddenAt }) => [hiddenAt !== null && hiddenAt < 2500, 'video 404'], { blockVideo: true });
  const fast = []; for (let i = 0; i < 3; i++) { const p = await newPage(w, ctx); await p.send('Page.navigate', { url: `${BASE}/shop.html` }); fast.push(await waitLoaderHidden(p)); await p.close(); }
  record('no artificial fixed delay: fastest of 3 warm loads well under 750ms', Math.min(...fast) < 700, `(${fast.join('/')}ms)`);
  await run('DEFAULT ceiling: API hang ends the loader by ~8s', w, 'shop', (s) => { s.api = 'hang'; },
    ({ hiddenAt }) => [hiddenAt !== null && hiddenAt >= 7500 && hiddenAt < 9500, 'expected ≈8000ms'], { waitMs: 12000 });
  summary.loader = results;
}

/* ------------------------------------------------------------------ main */
(async () => {
  try { await launch(); } catch (e) { console.log('SKIP: Chrome unavailable (' + e.message + ')'); process.exit(0); }
  try { const r = await fetch(BASE + '/index.html'); if (!r.ok) throw new Error('HTTP ' + r.status); } catch (e) { console.log('SKIP: dev server not reachable at ' + BASE + ' (' + e.message + ')'); close(); process.exit(0); }

  let mock = null; let products; let apiBase = PROD_API; let uploadsOrigin = 'https://api.chipakk.shop';
  if (TRANSPORT === 'real') { mock = await require('./mock_backend.js').start({ uploads: UPLOADS, settings: SETTINGS, supplier: SUPPLIER }); products = mock.products; apiBase = mock.apiBase; uploadsOrigin = mock.origin; }
  else { const d = await (await fetch(PROD_API + '/products?limit=500&offset=0', { headers: { 'x-store-id': '1' } })).json(); products = d.data.products; }
  const ctx = { apiBase, uploadsOrigin, products, mock, cart: cartSeed(products) };
  console.log(`transport=${TRANSPORT} uploads=${UPLOADS} api=${apiBase} pages=${PAGES.length} widths=${WIDTHS.length}` + (mock ? ` files-on-disk=${mock.meta.onDiskCount}/${mock.meta.totalReferenced}` : ''));

  const summary = { transport: TRANSPORT, uploads: UPLOADS, rows: [], flows: {}, evidence: {}, loader: [], failures: [] };
  // server-level: the BOOM coupon must not leak anything over the wire
  if (mock) { const r = await fetch(mock.origin + '/api/coupons/validate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-store-id': '1' }, body: JSON.stringify({ code: 'BOOM', subtotal_in_rupees: 500 }) }); const t = await r.text();
    const leak = /ER_|Unknown column|u\.name|couponService|\/srv\/|stack/i.test(t); console.log(`${r.status === 500 && !leak ? 'ok  ' : 'FAIL'} server :: unexpected coupon error is a generic ${r.status} with no SQL/column/path/stack in the body`); if (r.status !== 500 || leak) summary.failures.push('server :: coupon 500 leaks: ' + t.slice(0, 200)); }

  for (const page of PAGES) for (const w of WIDTHS) summary.failures.push(...await checkPage(page, w, ctx, summary));
  if (FLOWS && PAGES.includes('checkout')) await checkoutVariants(ctx, summary);
  if (mock && LOADER) await loaderScenarios(mock, ctx, summary);

  fs.writeFileSync(path.join(OUT, `summary_${TRANSPORT}_${UPLOADS}.json`), JSON.stringify(summary, null, 1));
  const total = summary.rows.length; const bad = summary.rows.filter((r) => r.problems.length).length;
  if (mock) { summary.settingsSource = mock.meta.settingsSource; console.log('\nshipping settings served to the page: ' + mock.meta.settingsSource); }
  console.log(`\nVISUAL QA (transport=${TRANSPORT}, uploads=${UPLOADS}): ${total - bad}/${total} page×width combinations clean; ${summary.loader.filter((l) => !l.ok).length} loader scenario failure(s). Output: ${OUT}`);
  if (mock) await mock.close();
  close();
  if (summary.failures.length) { console.error('\nFAILURES (' + summary.failures.length + '):\n' + summary.failures.join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('QA runner error:', e); close(); process.exit(1); });
