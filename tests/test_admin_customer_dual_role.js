/**
 * Dual-role identity: one Firebase identity may be BOTH an administrator and a customer.
 *
 * BUG THIS GUARDS: GET /api/customer/me returned { is_admin: true, is_customer: false } for any identity present in
 * `admins` WITHOUT resolving/creating its customer record, and account.js hid the customer dashboard behind a
 * blocking "ADMIN SESSION ACTIVE" card. An administrator therefore could not use their own profile, addresses or
 * orders. Now /me always resolves the customer and only ADDS is_admin:true; the UI shows the normal dashboard plus a
 * small "Open Admin Panel" link. Admin authorization is untouched: every admin API is still gated by requireAdmin,
 * which reads the `admins` table and knows nothing about the customer role.
 *
 * Exercises the REAL routes/customer.js handler, the REAL requireAdmin, and the REAL shipped account.js.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createFakePool, installFakePool } = require('./helpers/fake_db');
const { loadStorefront, envelope } = require('./helpers/storefront_vm');

const ROOT = path.join(__dirname, '..');
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log(`[PASS] ${name}`); }
  catch (err) { results.push({ name, pass: false, err }); console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastUnhandledRejection = null;
process.on('unhandledRejection', (e) => { lastUnhandledRejection = e; });

const ADMIN = { uid: 'uid_dual', email: 'owner@chipakk.shop' };
const CUSTOMER = { uid: 'uid_plain', email: 'shopper@gmail.com' };
const ADMIN_SQL = /FROM admins WHERE/;

function makeDb() {
  const users = [];
  const admins = [{ id: 1, firebase_uid: ADMIN.uid, email: ADMIN.email, role: 'super_admin', active: 1 }];
  const pool = createFakePool([
    [ADMIN_SQL, (sql, params) => {
      const [uid, email] = params;
      const hit = admins.filter((a) => a.active && (a.firebase_uid === uid || (a.email && String(email).toLowerCase() === a.email.toLowerCase())));
      return [hit];
    }],
    [/^SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = \?/, (sql, p) => [users.filter((u) => u.firebase_uid === p[0])]],
    [/^SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE email IS NOT NULL/, () => [[]]],
    [/^INSERT INTO users/, (sql, p) => { const row = { id: users.length + 1, firebase_uid: p[0], email: p[1], full_name: p[2] || null, phone: p[3] || null, created_at: new Date().toISOString() }; users.push(row); return [{ insertId: row.id }]; }]
  ]);
  return { pool, users };
}

function fresh() {
  for (const m of ['server/routes/customer.js', 'server/services/customerService.js', 'server/middleware/auth.js']) {
    delete require.cache[require.resolve(path.join(ROOT, m))];
  }
}

async function callMe(user) {
  const router = require(path.join(ROOT, 'server/routes/customer.js'));
  const layer = router.stack.find((l) => l.route && l.route.path === '/me' && l.route.methods.get);
  const handler = layer.route.stack[0].handle;
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  await handler({ user: { uid: user.uid, email: user.email }, headers: {}, query: {} }, res, (e) => { throw e; });
  return out;
}

async function callRequireAdmin(user) {
  const { requireAdmin } = require(path.join(ROOT, 'server/middleware/auth.js'));
  const out = { status: null, calledNext: false };
  const res = { status(c) { out.status = c; return this; }, json() { return this; } };
  await requireAdmin({ user: { uid: user.uid, email: user.email } }, res, () => { out.calledNext = true; });
  return out;
}

(async () => {
  await test('BACKEND :: /customer/me for an admin resolves+creates the customer record and reports is_admin:true AND is_customer:true', async () => {
    const { pool, users } = makeDb(); installFakePool(pool); fresh();
    const { status, body } = await callMe(ADMIN);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.is_admin, true);
    assert.strictEqual(body.data.is_customer, true, 'admin must ALSO be a customer');
    assert.ok(body.data.customer && body.data.customer.id, 'a customer record must be returned for the admin');
    assert.strictEqual(users.length, 1);
    assert.strictEqual(users[0].firebase_uid, ADMIN.uid, 'customer row keyed by the same Firebase UID');
  });

  await test('BACKEND :: /customer/me for a plain customer is unchanged (is_admin:false, is_customer:true)', async () => {
    const { pool } = makeDb(); installFakePool(pool); fresh();
    const { body } = await callMe(CUSTOMER);
    assert.strictEqual(body.data.is_admin, false);
    assert.strictEqual(body.data.is_customer, true);
    assert.ok(body.data.customer && body.data.customer.id);
  });

  await test('BACKEND :: calling /customer/me twice for the admin does not create a duplicate customer', async () => {
    const { pool, users } = makeDb(); installFakePool(pool); fresh();
    const a = await callMe(ADMIN); const b = await callMe(ADMIN);
    assert.strictEqual(users.length, 1);
    assert.strictEqual(a.body.data.customer.id, b.body.data.customer.id);
  });

  await test('ADMIN SECURITY :: the same dual-role identity passes requireAdmin, but a plain customer token gets 403 and no next()', async () => {
    const { pool } = makeDb(); installFakePool(pool); fresh();
    const admin = await callRequireAdmin(ADMIN);
    assert.strictEqual(admin.calledNext, true, 'authorized admin token reaches admin APIs');
    const cust = await callRequireAdmin(CUSTOMER);
    assert.strictEqual(cust.status, 403, 'customer token must be refused on admin APIs');
    assert.strictEqual(cust.calledNext, false);
  });

  await test('ADMIN SECURITY :: having a customer record grants nothing -- a user row alone never makes requireAdmin pass', async () => {
    const { pool, users } = makeDb(); installFakePool(pool); fresh();
    await callMe(CUSTOMER); // customer row now exists
    assert.strictEqual(users.length, 1);
    assert.strictEqual((await callRequireAdmin(CUSTOMER)).status, 403);
  });

  await test('ADMIN SECURITY :: every /api/admin route still sits behind verifyFirebaseToken THEN requireAdmin (static)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/routes/admin.js'), 'utf8');
    const v = src.indexOf('router.use(verifyFirebaseToken)');
    const r = src.indexOf('router.use(requireAdmin)');
    const firstRoute = src.search(/router\.(get|post|put|patch|delete)\(['"]\/(?!auth\/logout-event)/);
    assert.ok(v !== -1 && r !== -1 && v < r && r < firstRoute, 'auth + admin gates must precede every protected admin route');
  });

  await test('ISOLATION :: customer routes still require a verified token and scope to req.user.uid (static)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/routes/customer.js'), 'utf8');
    assert.ok(src.indexOf('router.use(verifyFirebaseToken)') !== -1 && src.indexOf('router.use(verifyFirebaseToken)') < src.indexOf("router.get('/me'"));
    assert.ok(/updateCustomerProfile\(firebaseUid/.test(src), 'profile update is keyed by the token UID, never a client-supplied id');
  });

  // ---- REAL account.js ----
  const ids = ['accountAddressContainer', 'accountAvatar', 'accountDashboardContainer', 'accountOrdersList', 'accountUserDisplayName', 'accountUserEmail', 'accountWishlistGrid', 'accountAdminPanelLink', 'authFormsContainer', 'logoutBtn', 'profileDisplayName', 'profileEmail', 'profilePhone', 'signInForm', 'signInEmail', 'signInPassword', 'signInError', 'signUpForm', 'tabBtnSignIn', 'tabBtnSignUp', 'panelSignIn', 'panelSignUp', 'signInGoogleBtn', 'signUpGoogleBtn', 'forgotPasswordBtn'];
  const el = () => ({ innerHTML: '', textContent: '', value: '', href: '', src: '', disabled: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, focus() {}, click() {}, appendChild() {}, remove() {} });

  async function renderAccount(meBody) {
    const elements = {}; ids.forEach((i) => (elements[i] = el()));
    const sf = loadStorefront({
      elements,
      fetch: async (url) => {
        if (/\/customer\/me/.test(url)) return envelope(meBody);
        if (/\/orders\?/.test(url)) return envelope({ total: 1, limit: 20, offset: 0, orders: [{ id: 9, order_number: 'CHP-900', created_at: '2026-09-20T10:00:00Z', fulfillment_status: 'PROCESSING', payment_status: 'paid', total_price_rupees: 99, items: [{ name: 'Sticker', qty: 1 }] }] });
        return envelope([]);
      },
      extraScripts: ['account.js']
    });
    lastUnhandledRejection = null;
    sf.authListeners.forEach((fn) => fn({ uid: 'u', email: 'owner@chipakk.shop', getIdToken: async () => 'fake' }));
    for (let i = 0; i < 300; i++) { const h = elements.accountOrdersList.innerHTML; if (h && !h.includes('Loading your orders')) break; await sleep(10); }
    await sleep(20);
    return elements;
  }

  await test('UI :: admin+customer sees the normal customer dashboard (NOT a blocking admin card), login form hidden, orders load, admin link shown', async () => {
    const e = await renderAccount({ is_admin: true, is_customer: true, customer: { id: 5, email: 'owner@chipakk.shop', full_name: 'Owner' } });
    assert.strictEqual(e.accountDashboardContainer.style.display, 'block');
    assert.strictEqual(e.authFormsContainer.style.display, 'none');
    assert.strictEqual(e.accountAdminPanelLink.style.display, 'inline-block');
    assert.ok(/CHP-900/.test(e.accountOrdersList.innerHTML), 'orders tab loads for the admin identity');
    assert.strictEqual(lastUnhandledRejection, null);
  });

  await test('UI :: plain customer sees the dashboard and NO admin link', async () => {
    const e = await renderAccount({ is_admin: false, is_customer: true, customer: { id: 6, email: 'shopper@gmail.com' } });
    assert.strictEqual(e.accountDashboardContainer.style.display, 'block');
    assert.strictEqual(e.accountAdminPanelLink.style.display, 'none');
  });

  await test('UI :: logout restores the login form and hides dashboard + admin link', async () => {
    const elements = {}; ids.forEach((i) => (elements[i] = el()));
    const sf = loadStorefront({ elements, fetch: async () => envelope({ is_admin: true, is_customer: true, customer: { id: 5 } }), extraScripts: ['account.js'] });
    sf.authListeners.forEach((fn) => fn({ uid: 'u', email: 'owner@chipakk.shop' }));
    await sleep(60);
    sf.authListeners.forEach((fn) => fn(null));
    await sleep(30);
    assert.strictEqual(elements.authFormsContainer.style.display, 'block');
    assert.strictEqual(elements.accountDashboardContainer.style.display, 'none');
    assert.strictEqual(elements.accountAdminPanelLink.style.display, 'none');
  });

  await test('UI :: account.html has no blocking admin card, and account.js never branches to hide the dashboard on is_admin', () => {
    const html = fs.readFileSync(path.join(ROOT, 'customer-workspace/account.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/account.js'), 'utf8');
    assert.ok(!/ADMIN SESSION ACTIVE/i.test(html) && !html.includes('adminSessionContainer'));
    assert.ok(!js.includes('adminSessionContainer'));
    assert.ok(html.includes('id="accountAdminPanelLink"'));
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\nADMIN + CUSTOMER DUAL ROLE: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
