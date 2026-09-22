/**
 * Customer account page — "My Orders" tab contract, driven through the REAL shipped account.js.
 *
 * PRODUCTION BUG THIS GUARDS (found 2026-09-22 via a real sign-up/sign-in through the live account.html on
 * chipakk.shop, using a disposable Firebase test account, and confirmed against the real API):
 *
 *   GET /api/orders resolves to { total, limit, offset, orders: [...] } (see server/services/orderService.js
 *   getCustomerOrders / server/controllers/orderController.js getCustomerOrdersHandler -> sendSuccess(res, result)).
 *   customer-workspace/js/account.js renderOrdersTab() treated that ENVELOPE as if it were the order array itself
 *   and called `.map()` on it directly, throwing "TypeError: orders.map is not a function" in the browser console
 *   on EVERY successful customer login. This left the Orders tab stuck on "Loading your orders…" forever. Sign-in
 *   itself (Firebase auth -> token -> /customer/me -> dashboard) completed correctly; this bug was one tab deeper.
 *
 * Login otherwise DOES complete correctly (verified live against production for both a fresh sign-up and a
 * sign-in with existing credentials): auth state flips, the dashboard replaces the auth forms, and
 * /api/customer/me / /api/customer/addresses already return the shapes the frontend expects (this file exists
 * because /api/orders did not).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadStorefront, envelope } = require('./helpers/storefront_vm');

const ROOT = path.join(__dirname, '..');
const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.stack ? err.stack : err}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// account.js calls renderOrdersTab()/renderAddressesTab() WITHOUT awaiting them (fire-and-forget, by design, so
// one slow tab never blocks the other) -- so a throw inside them (like the real "orders.map is not a function"
// bug) surfaces as an unhandled promise rejection, not a normal exception the caller's try/catch can see. Capture
// it here (this also stops Node from hard-crashing the whole test process on it) so a test can assert on it.
let lastUnhandledRejection = null;
process.on('unhandledRejection', (err) => { lastUnhandledRejection = err; });

function el() {
  return {
    innerHTML: '', textContent: '', value: '', href: '', src: '', disabled: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, click() {}, appendChild() {}, remove() {}
  };
}
/** Every id account.js looks up via $("#id") during initAccount() / applyAuthState() / its render* calls. */
const ACCOUNT_IDS = ['accountAddressContainer', 'accountAvatar', 'accountDashboardContainer', 'accountOrdersList',
  'accountUserDisplayName', 'accountUserEmail', 'accountWishlistGrid', 'addNewAddressBtn', 'addressFormCity',
  'addressFormDefault', 'addressFormError', 'addressFormId', 'addressFormLine1', 'addressFormLine2', 'addressFormName',
  'addressFormPhone', 'addressFormPin', 'addressFormState', 'addressFormType', 'addressModalTitle',
  'authFormsContainer', 'cancelAddressModalBtn', 'closeAddressModalBtn', 'closeTrackModalBtn',
  'customerAddressForm', 'customerAddressModal', 'defaultAddressName', 'forgotPasswordBtn', 'logoutBtn',
  'orderTrackingModal', 'panelSignIn', 'panelSignUp', 'profileDisplayName', 'profileEmail', 'profilePhone',
  'profileUpdateBtn', 'saveAddressModalBtn', 'signInEmail', 'signInError', 'signInForm', 'signInGoogleBtn',
  'signInPassword', 'signInSubmitBtn', 'signUpConfirmPassword', 'signUpEmail', 'signUpError', 'signUpForm',
  'signUpGoogleBtn', 'signUpName', 'signUpPassword', 'signUpSubmitBtn', 'tabBtnSignIn', 'tabBtnSignUp',
  'trackModalAddress', 'trackModalCourier', 'trackModalItems', 'trackModalOrderId', 'trackModalPayment',
  'trackModalStatus', 'trackModalStatusMessage', 'trackModalTotal', 'trackModalTrackingNo'];
function accountElements() { const m = {}; ACCOUNT_IDS.forEach((id) => (m[id] = el())); return m; }

/** Real API shape: GET /api/orders -> { total, limit, offset, orders: [...] } (or, for the back-compat case, a bare array). */
function ordersResponse(kind) {
  const rows = [{ id: 501, order_number: 'CHP-100501', created_at: '2026-09-20T10:00:00.000Z', fulfillment_status: 'PROCESSING', payment_status: 'paid', payment_method: 'UPI', total_price_rupees: 349, items: [{ name: 'Katana Sticker', qty: 1 }] }];
  if (kind === 'envelope') return { total: 1, limit: 20, offset: 0, orders: rows };
  if (kind === 'bare-array') return rows;
  if (kind === 'empty-envelope') return { total: 0, limit: 20, offset: 0, orders: [] };
  return rows;
}

/** Loads account.js for real, fires the same "customer just signed in" event applyAuthState listens for, and
 *  waits for the orders list to settle (no longer showing the initial "Loading your orders…" placeholder). */
async function renderAccountFor(ordersKind) {
  const elements = accountElements();
  const sf = loadStorefront({
    elements,
    fetch: async (url) => {
      if (/\/customer\/me/.test(url)) return envelope({ is_admin: false, is_customer: true, customer: { id: 1, email: 'qa@chipakk.shop', full_name: 'QA Bot' } });
      if (/\/orders\?/.test(url)) return envelope(ordersResponse(ordersKind));
      if (/\/customer\/addresses/.test(url)) return envelope([]);
      return envelope({});
    },
    extraScripts: ['account.js']
  });
  // account.js's initAccount() ran synchronously while loading (document.readyState === 'complete' in the
  // harness) and registered its listener through window.CHIPAKK.auth.onAuthStateChanged(applyAuthState) -- the
  // SAME registration real auth.js's wrapper receives in production. The harness records that callback in
  // sf.authListeners; invoking it here fires the exact function account.js registered, exactly as a real Firebase
  // auth-state change would, through the actual production code path (not a re-implementation of it).
  assert.ok(sf.authListeners.length >= 1, 'account.js must register an auth-state listener');
  sf.authListeners.forEach((fn) => fn({ uid: 'qa-test-uid', email: 'qa@chipakk.shop', getIdToken: async () => 'fake' }));
  lastUnhandledRejection = null;
  for (let i = 0; i < 400; i++) { const html = elements.accountOrdersList.innerHTML; if ((html && !html.includes('Loading your orders')) || lastUnhandledRejection) break; await sleep(10); }
  await sleep(20); // let a same-tick rejection be reported before we read it
  return { elements, sf };
}

(async () => {
  await test('AUDIT', 'confirms the real shape mismatch that caused the bug: /api/orders wraps in an envelope, /api/customer/addresses does not', () => {
    const orderSvc = fs.readFileSync(path.join(ROOT, 'server/services/orderService.js'), 'utf8');
    assert.ok(/getCustomerOrders\s*=\s*async[\s\S]{0,400}orders:\s*\[\]/.test(orderSvc) || /return\s*\{\s*total:\s*0,\s*limit,\s*offset,\s*orders:\s*\[\]\s*\}/.test(orderSvc), 'orderService.getCustomerOrders returns an envelope, not a bare array');
    const addrCtrl = fs.readFileSync(path.join(ROOT, 'server/controllers/addressController.js'), 'utf8');
    assert.ok(/sendSuccess\(res,\s*addresses,/.test(addrCtrl), 'addresses stayed a bare array response, unlike orders');
  });
  await test('ORDERS TAB', 'a real successful login (envelope response, matching production) renders the order, not a crash / stuck loading state', async () => {
    const { elements, sf } = await renderAccountFor('envelope');
    const html = elements.accountOrdersList.innerHTML;
    assert.ok(!html.includes('Loading your orders'), 'must not be stuck on the loading placeholder');
    assert.ok(html.includes('CHP-100501') || /100501/.test(html), `order row rendered: ${html.slice(0, 200)}`);
    assert.ok(!sf.logs.error.some((l) => /is not a function/.test(l)), `no "is not a function" console error: ${JSON.stringify(sf.logs.error)}`);
    assert.strictEqual(lastUnhandledRejection, null, `no unhandled rejection from renderOrdersTab: ${lastUnhandledRejection && lastUnhandledRejection.message}`);
  });
  await test('ORDERS TAB', 'the dashboard is shown (login completed) even before/independent of the orders fetch resolving', async () => {
    const { elements } = await renderAccountFor('envelope');
    assert.strictEqual(elements.authFormsContainer.style.display, 'none');
    assert.strictEqual(elements.accountDashboardContainer.style.display, 'block');
  });
  await test('ORDERS TAB', 'a genuinely empty order history still shows the "No Orders Placed Yet" empty state, not a crash', async () => {
    const { elements } = await renderAccountFor('empty-envelope');
    assert.ok(elements.accountOrdersList.innerHTML.includes('No Orders Placed Yet'));
  });
  await test('ORDERS TAB', 'back-compat: a bare array response (if the API ever reverts) still renders correctly', async () => {
    const { elements } = await renderAccountFor('bare-array');
    assert.ok(elements.accountOrdersList.innerHTML.includes('CHP-100501') || /100501/.test(elements.accountOrdersList.innerHTML));
  });
  await test('ORDERS TAB', 'a network/API failure falls back to the local order cache instead of crashing the tab', async () => {
    const elements = accountElements();
    const sf = loadStorefront({
      elements,
      fetch: async (url) => { if (/\/customer\/me/.test(url)) return envelope({ is_admin: false, is_customer: true, customer: { id: 1, email: 'qa@chipakk.shop' } }); if (/\/orders\?/.test(url)) throw new Error('network down'); return envelope([]); },
      extraScripts: ['account.js']
    });
    assert.ok(sf.authListeners.length >= 1);
    sf.authListeners.forEach((fn) => fn({ uid: 'qa-test-uid', email: 'qa@chipakk.shop' }));
    for (let i = 0; i < 400; i++) { const html = elements.accountOrdersList.innerHTML; if (html && !html.includes('Loading your orders')) break; await sleep(10); }
    assert.ok(!elements.accountOrdersList.innerHTML.includes('Loading your orders'));
    assert.ok(elements.accountOrdersList.innerHTML.includes('No Orders Placed Yet'), 'falls back to the empty state, not a stuck loader');
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\nCUSTOMER ORDERS TAB: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
