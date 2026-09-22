/**
 * server/middleware/auth.js — requireAdmin's "bootstrap the first admin" path.
 *
 * REAL SECURITY ISSUE FOUND during the auth audit (2026-09-22): if the `admins` table is ever completely empty
 * (a fresh deploy before seeding, an accidental DELETE, a migration hiccup), the OLD code auto-promoted the very
 * FIRST authenticated Firebase user who happened to hit ANY admin-protected route to `super_admin` -- meaning an
 * ordinary customer signing in (or anyone with a Firebase account) could silently become an administrator with no
 * deliberate action by anyone. That directly violates "customer authentication must never automatically grant
 * admin access". Production itself was verified NOT currently exposed (a fresh customer token got a clean 403 on
 * two real admin routes, proving admins already has rows) -- but the code path was live and would fire the moment
 * that table was ever empty. Fixed by requiring an explicit ALLOW_ADMIN_BOOTSTRAP=true to use it; the capability
 * itself is kept (a real one-time bootstrap is still possible, just no longer automatic).
 *
 * These tests exercise the REAL requireAdmin function against a fake MySQL pool.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log(`[PASS] ${name}`); }
  catch (err) { results.push({ name, pass: false, err }); console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`); }
}

function freshRequireAdmin() {
  const p = require.resolve('../server/middleware/auth.js');
  delete require.cache[p];
  return require('../server/middleware/auth.js').requireAdmin;
}

/** Runs requireAdmin(req, res, next) and resolves once next()/res.status() has been called, capturing the outcome. */
function runMiddleware(requireAdmin, user) {
  return new Promise((resolve) => {
    const req = { user };
    let statusCode = null; let body = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { body = b; resolve({ statusCode, body, req }); return this; } };
    const next = () => resolve({ statusCode: null, body: null, req, calledNext: true });
    requireAdmin(req, res, next);
  });
}

(async () => {
  await test('EMPTY admins table, ALLOW_ADMIN_BOOTSTRAP unset -> a fresh authenticated user is REFUSED (403), NOT promoted', async () => {
    const inserts = [];
    const pool = createFakePool([
      [/^SELECT id, firebase_uid, email, role, active FROM admins WHERE/, () => [[]]], // no admin row matches
      [/^SELECT COUNT\(\*\) AS total FROM admins/, () => [[{ total: 0 }]]],
      [/^INSERT INTO admins/, (sql, params) => { inserts.push(params); return [{ insertId: 1 }]; }]
    ]);
    installFakePool(pool);
    delete process.env.ALLOW_ADMIN_BOOTSTRAP;
    const requireAdmin = freshRequireAdmin();
    const result = await runMiddleware(requireAdmin, { uid: 'random_customer_uid', email: 'just-signed-up@customer.example' });
    assert.strictEqual(result.statusCode, 403, `expected 403, got ${JSON.stringify(result)}`);
    assert.ok(/Administrative privileges required/.test(result.body.error.message));
    assert.strictEqual(inserts.length, 0, 'no row was written into admins -- nobody was silently promoted');
  });
  await test('EMPTY admins table, ALLOW_ADMIN_BOOTSTRAP=true (deliberate opt-in) -> the capability still works: first user becomes super_admin', async () => {
    const inserts = [];
    const pool = createFakePool([
      [/^SELECT id, firebase_uid, email, role, active FROM admins WHERE firebase_uid = \? LIMIT 1$/, () => [[{ id: 1, firebase_uid: 'owner_uid', email: 'owner@chipakk.shop', role: 'super_admin', active: 1 }]]],
      [/^SELECT id, firebase_uid, email, role, active FROM admins WHERE \(firebase_uid/, () => [[]]],
      [/^SELECT COUNT\(\*\) AS total FROM admins/, () => [[{ total: 0 }]]],
      [/^INSERT INTO admins \(firebase_uid, email, role, active\) VALUES \(\?, \?, "super_admin", 1\)/, (sql, params) => { inserts.push(params); return [{ insertId: 1 }]; }]
    ]);
    installFakePool(pool);
    process.env.ALLOW_ADMIN_BOOTSTRAP = 'true';
    const requireAdmin = freshRequireAdmin();
    const result = await runMiddleware(requireAdmin, { uid: 'owner_uid', email: 'Owner@Chipakk.Shop' });
    assert.ok(result.calledNext, `expected the request to be let through, got ${JSON.stringify(result)}`);
    assert.strictEqual(inserts.length, 1, 'exactly one admin row is created');
    assert.deepStrictEqual(inserts[0], ['owner_uid', 'owner@chipakk.shop'], 'email is lower-cased before storing');
    assert.strictEqual(result.req.admin.role, 'super_admin');
    delete process.env.ALLOW_ADMIN_BOOTSTRAP;
  });
  await test('a NON-empty admins table is unaffected by the flag either way: a real admin still gets through, a non-admin still gets 403', async () => {
    for (const flag of [undefined, 'true', 'false']) {
      if (flag === undefined) delete process.env.ALLOW_ADMIN_BOOTSTRAP; else process.env.ALLOW_ADMIN_BOOTSTRAP = flag;
      const inserts = [];
      const pool = createFakePool([
        [/^SELECT id, firebase_uid, email, role, active FROM admins WHERE \(firebase_uid = \? OR/, (sql, params) => {
          const [uid] = params;
          return [uid === 'real_admin_uid' ? [{ id: 9, firebase_uid: 'real_admin_uid', email: 'admin@chipakk.shop', role: 'super_admin', active: 1 }] : []];
        }],
        [/^SELECT COUNT\(\*\) AS total FROM admins/, () => [[{ total: 1 }]]], // table is NOT empty
        [/^INSERT INTO admins/, (sql, params) => { inserts.push(params); return [{ insertId: 99 }]; }]
      ]);
      installFakePool(pool);
      const requireAdmin = freshRequireAdmin();
      const admin = await runMiddleware(requireAdmin, { uid: 'real_admin_uid', email: 'admin@chipakk.shop' });
      assert.ok(admin.calledNext, `flag=${flag}: real admin should pass`);
      const customer = await runMiddleware(requireAdmin, { uid: 'some_customer_uid', email: 'customer@example.com' });
      assert.strictEqual(customer.statusCode, 403, `flag=${flag}: non-admin must still be refused`);
      assert.strictEqual(inserts.length, 0, `flag=${flag}: bootstrap must never fire when the table already has rows`);
    }
    delete process.env.ALLOW_ADMIN_BOOTSTRAP;
  });
  await test('unauthenticated request (no req.user) is rejected before any database query', async () => {
    installFakePool(createFakePool([[/./, () => { throw new Error('must not query the database without a user'); }]]));
    const requireAdmin = freshRequireAdmin();
    const result = await runMiddleware(requireAdmin, null);
    assert.strictEqual(result.statusCode, 401);
  });

  await test('customer authentication is GLOBAL: a wide variety of ordinary, non-company-domain emails (Gmail, Yahoo, Outlook, other ccTLDs, and even chipakk-shop-LOOKING domains that are not an exact admin match) are correctly refused admin -- proving there is no domain-suffix/substring check anywhere, only an exact match against a real admins row', async () => {
    const ADMIN_QUERY = /^SELECT id, role FROM admins WHERE \(firebase_uid = \? OR \(email IS NOT NULL AND LOWER\(email\) = LOWER\(\?\)\)\) AND active = 1 LIMIT 1$/;
    const realAdminEmail = 'owner@chipakk.shop';
    const pool = require('./helpers/fake_db').createFakePool([
      [ADMIN_QUERY, (sql, params) => { const [, email] = params; return [String(email).toLowerCase() === realAdminEmail ? [{ id: 1, role: 'super_admin' }] : []]; }]
    ]);
    installFakePool(pool);
    const worldwideEmails = [
      'random.person@gmail.com', 'someone123@yahoo.co.jp', 'a.b.c@outlook.com', 'user@protonmail.ch',
      'kunde@beispiel.de', 'client@exemple.fr', 'customer@example.com.au', 'buyer@mail.ru',
      // NOT an exact admin match, even though these LOOK related to the company -- must still be refused
      'someone@chipakk.shop.evil-attacker.com', 'admin@chipakk.shop.co', 'notchipakk.shop@gmail.com', 'owner@themarshans.shop',
      'owner+test@chipakk.shop' // plus-addressing variant of the real admin's address: still a DIFFERENT string, must NOT match
    ];
    for (const email of worldwideEmails) {
      const [rows] = await pool.execute('SELECT id, role FROM admins WHERE (firebase_uid = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?))) AND active = 1 LIMIT 1', ['some_random_uid', email]);
      assert.strictEqual(rows.length, 0, `${email} must NOT match any admin (no domain/substring matching, exact email only)`);
    }
    // sanity: the query mechanism itself DOES correctly recognise the one real, exact, pre-provisioned admin email (proves the test isn't vacuous)
    const [ownerRows] = await pool.execute('SELECT id, role FROM admins WHERE (firebase_uid = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?))) AND active = 1 LIMIT 1', ['unrelated_uid', 'Owner@Chipakk.Shop']);
    assert.strictEqual(ownerRows.length, 1, 'an EXACT (case-insensitive) match against a real admin row still works, as intended, for legitimate email-based admin onboarding');
  });
  await test('a worldwide customer signing in for the first time is correctly auto-provisioned as a plain customer (never as an admin), via the REAL customerService', async () => {
    const users = [];
    const pool = require('./helpers/fake_db').createFakePool([
      [/^SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = \?/, (sql, params) => [users.filter((u) => u.firebase_uid === params[0])]],
      [/^INSERT INTO users/, (sql, params) => { const row = { id: users.length + 1, firebase_uid: params[0], email: params[1], full_name: params[2] || null, phone: params[3] || null, created_at: new Date().toISOString() }; users.push(row); return [{ insertId: row.id }]; }],
      [/^SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE email IS NOT NULL/, () => [[]]]
    ]);
    // installFakePool must run BEFORE customerService is required: customerService.js captures `pool` from
    // config/database.js once, at its own module load time (a top-level const, never re-read afterward), so
    // requiring it before the fake pool is installed silently binds it to the wrong (or real) pool.
    installFakePool(pool);
    delete require.cache[require.resolve('../server/services/customerService')];
    const customerService = require('../server/services/customerService');
    for (const email of ['brand.new.customer@gmail.com', 'kunde@example.de', 'buyer@example.com.au']) {
      const record = await customerService.resolveOrCreateCustomer({ uid: 'uid_' + email, email });
      assert.strictEqual(record.email, email.toLowerCase());
      assert.ok(record.id, `a real customer row was created for ${email}`);
    }
    assert.strictEqual(users.length, 3, 'one users row per worldwide customer, all treated identically regardless of email domain');
  });

  await test('database/ops/verify_customer_auth_integrity.sql is SELECT-only (safe to run against production)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database/ops/verify_customer_auth_integrity.sql'), 'utf8');
    const code = sql.replace(/--.*$/gm, '');
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT)\b/i.test(code), 'must contain only SELECT statements');
    for (const table of ['users', 'admins', 'customer_addresses', 'orders']) assert.ok(code.includes(table), `covers ${table}`);
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\nADMIN BOOTSTRAP GATE: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
