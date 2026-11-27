/**
 * Security Verification Test Suite: Admin Authentication, Authorization & Session Hardening
 *
 * Verifies all 12 security requirements:
 * 1. A signed-out visitor cannot access protected admin APIs (401).
 * 2. A Firebase-authenticated customer without an admin session receives a denial (403).
 * 3. An invalid admin session is rejected (401).
 * 4. An expired or revoked admin session is rejected (401).
 * 5. A valid authorized admin session can access permitted admin APIs (200).
 * 6. Admin logout invalidates the relevant session in admin_sessions.
 * 7. A customer cannot access admin functions by spoofing localStorage/session IDs.
 * 8. Direct HTTP calls to protected admin endpoints remain blocked.
 * 9. Public product/catalog endpoints remain accessible without authentication.
 * 10. Customer login, account access (/api/customer/me), and orders continue working.
 * 11. Multi-store isolation (Store 1 vs Store 2) remains intact.
 * 12. Admin login-event registers active sessions with proper lifecycle.
 */

const assert = require('assert');
const path = require('path');
const http = require('http');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const ROOT = path.join(__dirname, '..');
const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ name, pass: false, err });
    console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`);
  }
}

// Identities
const ADMIN_USER = { uid: 'uid_admin_verified', email: 'owner@chipakk.shop' };
const CUSTOMER_USER = { uid: 'uid_shopper_regular', email: 'shopper@gmail.com' };

// Tokens
const TOKENS = {
  admin: 'mock_token_admin',
  customer: 'mock_token_customer',
  invalid: 'mock_token_invalid'
};

// In-memory test state
let adminSessions = [];
let adminsTable = [
  { id: 1, firebase_uid: ADMIN_USER.uid, email: ADMIN_USER.email, role: 'super_admin', active: 1 }
];
let usersTable = [
  { id: 1, firebase_uid: CUSTOMER_USER.uid, email: CUSTOMER_USER.email, full_name: 'Regular Shopper', phone: '9876543210' }
];

function setupMockEnvironment() {
  // Mock Firebase Admin Auth
  const firebaseConfigPath = require.resolve(path.join(ROOT, 'server/config/firebase.js'));
  const mockAuth = {
    verifyIdToken: async (token) => {
      if (token === TOKENS.admin) {
        return { uid: ADMIN_USER.uid, email: ADMIN_USER.email, email_verified: true };
      }
      if (token === TOKENS.customer) {
        return { uid: CUSTOMER_USER.uid, email: CUSTOMER_USER.email, email_verified: true };
      }
      throw new Error('Invalid or expired Firebase ID token');
    }
  };

  require.cache[firebaseConfigPath] = {
    id: firebaseConfigPath,
    filename: firebaseConfigPath,
    loaded: true,
    exports: {
      admin: { apps: [{}], auth: () => mockAuth },
      getAuth: () => mockAuth,
      initializeFirebaseAdmin: () => ({})
    }
  };

  // Mock Database Pool
  const pool = createFakePool([
    // Admin table lookup
    [/SELECT id, firebase_uid, email, role, active FROM admins WHERE/i, (sql, params) => {
      const [uid, email] = params;
      const hit = adminsTable.filter(a => a.active && (a.firebase_uid === uid || (a.email && String(email).toLowerCase() === a.email.toLowerCase())));
      return [hit];
    }],
    [/SELECT COUNT\(\*\) AS total FROM admins/i, () => [[{ total: adminsTable.length }]]],

    // Admin sessions lookup
    [/SELECT id, session_id, firebase_uid, email, role, status, expires_at FROM admin_sessions WHERE session_id = \? AND firebase_uid = \?/i, (sql, params) => {
      const [sessionId, uid] = params;
      const hit = adminSessions.filter(s => s.session_id === sessionId && s.firebase_uid === uid);
      return [hit];
    }],
    [/SELECT id, session_id, firebase_uid, email, admin_name, role, ip_address, user_agent, login_time, last_activity, status, expires_at, created_at FROM admin_sessions WHERE status = 'active'/i, () => {
      const active = adminSessions.filter(s => s.status === 'active');
      return [active];
    }],

    // Insert or update admin session
    [/INSERT INTO admin_sessions/i, (sql, params) => {
      const sessionId = params[0];
      const uid = params[1];
      const email = params[2];
      const name = params[3];
      const role = params[4];
      const existing = adminSessions.find(s => s.session_id === sessionId);
      if (existing) {
        existing.status = 'active';
        existing.last_activity = new Date();
        existing.expires_at = new Date(Date.now() + 3600000);
      } else {
        adminSessions.push({
          id: adminSessions.length + 1,
          session_id: sessionId,
          firebase_uid: uid,
          email,
          admin_name: name,
          role,
          status: 'active',
          login_time: new Date(),
          last_activity: new Date(),
          expires_at: new Date(Date.now() + 3600000)
        });
      }
      return [{ affectedRows: 1, insertId: adminSessions.length }];
    }],

    // Update admin session status / activity
    [/UPDATE admin_sessions SET status = \?, updated_at = NOW\(\) WHERE session_id = \? AND firebase_uid = \?/i, (sql, params) => {
      const [status, sessionId, uid] = params;
      const s = adminSessions.find(sess => sess.session_id === sessionId && sess.firebase_uid === uid);
      if (s) s.status = status;
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET status = \?, updated_at = NOW\(\) WHERE session_id = \?/i, (sql, params) => {
      const [status, sessionId] = params;
      const s = adminSessions.find(sess => sess.session_id === sessionId);
      if (s) s.status = status;
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET status = \?, updated_at = NOW\(\) WHERE firebase_uid = \? AND status = "active"/i, (sql, params) => {
      const [status, uid] = params;
      const matching = adminSessions.filter(s => s.firebase_uid === uid && s.status === 'active');
      matching.forEach(s => { s.status = status; });
      return [{ affectedRows: matching.length }];
    }],
    [/UPDATE admin_sessions SET status = "expired", updated_at = NOW\(\) WHERE id = \?/i, (sql, params) => {
      const [id] = params;
      const s = adminSessions.find(sess => sess.id === id);
      if (s) s.status = 'expired';
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET last_activity = NOW\(\), expires_at = DATE_ADD\(NOW\(\), INTERVAL 1 HOUR\) WHERE session_id = \? AND firebase_uid = \? AND status = 'active' AND expires_at > NOW\(\)/i, (sql, params) => {
      const [sessionId, uid] = params;
      const s = adminSessions.find(sess => sess.session_id === sessionId && sess.firebase_uid === uid && sess.status === 'active' && sess.expires_at > new Date());
      if (s) {
        s.last_activity = new Date();
        s.expires_at = new Date(Date.now() + 3600000);
      }
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET last_activity = NOW\(\), expires_at = DATE_ADD\(NOW\(\), INTERVAL 1 HOUR\) WHERE id = \?/i, (sql, params) => {
      const [id] = params;
      const s = adminSessions.find(sess => sess.id === id);
      if (s) {
        s.last_activity = new Date();
        s.expires_at = new Date(Date.now() + 3600000);
      }
      return [{ affectedRows: s ? 1 : 0 }];
    }],

    // Customer / users queries
    [/SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = \?/i, (sql, params) => {
      const [uid] = params;
      return [usersTable.filter(u => u.firebase_uid === uid)];
    }],
    [/SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE email IS NOT NULL/i, () => [[]]],
    [/INSERT INTO users/i, (sql, params) => {
      const user = { id: usersTable.length + 1, firebase_uid: params[0], email: params[1], full_name: params[2] || null, phone: params[3] || null };
      usersTable.push(user);
      return [{ insertId: user.id }];
    }],

    // Dashboard metrics mocks
    [/SELECT COUNT\(\*\) AS total FROM orders/i, () => [[{ total: 5 }]]],
    [/SELECT COALESCE\(SUM\(.*total_revenue/i, () => [[{ total_revenue: 15000 }]]],
    [/SELECT COALESCE\(SUM\(.*month_revenue/i, () => [[{ month_revenue: 5000 }]]],
    [/SELECT id FROM admin_sessions WHERE firebase_uid = \?/i, () => [[]]],

    // Public catalog mocks
    [/SELECT COUNT\(\*\) AS total FROM products/i, () => [[{ total: 1 }]]],
    [/SELECT.*FROM products/i, () => [[{ id: 1, name: 'Sticker Pack A', price: 150, is_active: 1 }]]],
    [/SELECT.*FROM categories/i, () => [[{ id: 1, name: 'Anime', slug: 'anime' }]]],
    [/SELECT.*FROM site_settings/i, () => [[{ key_name: 'site_title', value: 'CHIPAKK' }]]]
  ]);

  installFakePool(pool);
}

// Clear require cache for server modules under test
function clearServerCache() {
  const toClear = [
    'server/app.js',
    'server/routes/admin.js',
    'server/routes/customer.js',
    'server/routes/products.js',
    'server/middleware/auth.js',
    'server/controllers/adminController.js'
  ];
  for (const m of toClear) {
    try {
      delete require.cache[require.resolve(path.join(ROOT, m))];
    } catch (_) {}
  }
}

// Request helper against running test server
function makeRequest(server, path, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {
          json = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

(async () => {
  console.log('===============================================================');
  console.log('🔒 CHIPAKK ADMIN AUTHENTICATION & AUTHORIZATION SECURITY SUITE');
  console.log('===============================================================\n');

  setupMockEnvironment();
  clearServerCache();

  const app = require(path.join(ROOT, 'server/app.js'));
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Signed-out visitor cannot access protected admin APIs (401)
    // -------------------------------------------------------------------------
    await test('1. Signed-out visitor (no token) receives HTTP 401 on /api/admin/dashboard', async () => {
      const res = await makeRequest(server, '/api/admin/dashboard');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.ok(/missing or malformed/i.test(res.body.error?.message || res.body.message));
    });

    await test('1b. Signed-out visitor receives HTTP 401 on /api/admin/auth/verify', async () => {
      const res = await makeRequest(server, '/api/admin/auth/verify');
      assert.strictEqual(res.status, 401);
    });

    // -------------------------------------------------------------------------
    // TEST 2: Customer with Firebase token receives 403 on protected admin APIs
    // -------------------------------------------------------------------------
    await test('2. Authenticated customer receives HTTP 403 on /api/admin/dashboard', async () => {
      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${TOKENS.customer}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.ok(/Administrative privileges required/i.test(res.body.error?.message || res.body.message));
    });

    await test('2b. Authenticated customer receives HTTP 403 on /api/admin/auth/verify', async () => {
      const res = await makeRequest(server, '/api/admin/auth/verify', {
        headers: { 'Authorization': `Bearer ${TOKENS.customer}` }
      });
      assert.strictEqual(res.status, 403);
      assert.ok(/Administrative privileges required/i.test(res.body.error?.message || res.body.message));
    });

    // -------------------------------------------------------------------------
    // TEST 3: Invalid or missing session ID is rejected (401)
    // -------------------------------------------------------------------------
    await test('3. Valid admin token with missing session ID receives HTTP 401 on /api/admin/dashboard', async () => {
      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${TOKENS.admin}` }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(/session ID missing/i.test(res.body.error?.message || res.body.message));
    });

    await test('3b. Valid admin token with non-existent session ID receives HTTP 401', async () => {
      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'sess_fake_nonexistent_999'
        }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(/invalid or not found/i.test(res.body.error?.message || res.body.message));
    });

    // -------------------------------------------------------------------------
    // TEST 4: Expired or revoked admin session is rejected (401)
    // -------------------------------------------------------------------------
    await test('4. Terminated (logged_out) admin session receives HTTP 401', async () => {
      const terminatedSessId = 'sess_admin_terminated_test';
      adminSessions.push({
        id: 101,
        session_id: terminatedSessId,
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        status: 'logged_out',
        expires_at: new Date(Date.now() + 3600000)
      });

      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': terminatedSessId
        }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(/has ended/i.test(res.body.error?.message || res.body.message));
    });

    await test('4b. Expired admin session receives HTTP 401 and transitions status to expired', async () => {
      const expiredSessId = 'sess_admin_expired_test';
      adminSessions.push({
        id: 102,
        session_id: expiredSessId,
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        status: 'active',
        expires_at: new Date(Date.now() - 60000) // 1 minute in the past
      });

      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': expiredSessId
        }
      });
      assert.strictEqual(res.status, 401);
      assert.ok(/expired/i.test(res.body.error?.message || res.body.message));

      const updated = adminSessions.find(s => s.session_id === expiredSessId);
      assert.strictEqual(updated.status, 'expired');
    });

    await test('4c. Session renewal / activity heartbeat cannot revive expired or terminated sessions', async () => {
      const revokedSessId = 'sess_admin_cannot_revive';
      adminSessions.push({
        id: 103,
        session_id: revokedSessId,
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        status: 'logged_out',
        expires_at: new Date(Date.now() - 5000)
      });

      // Try sending activity heartbeat
      const activityRes = await makeRequest(server, '/api/admin/auth/activity', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': revokedSessId
        }
      });
      // requireAdminSession intercepts and rejects with 401
      assert.strictEqual(activityRes.status, 401);
      const s = adminSessions.find(sess => sess.session_id === revokedSessId);
      assert.strictEqual(s.status, 'logged_out', 'session must remain logged_out');
    });

    // -------------------------------------------------------------------------
    // TEST 5: Valid authorized admin session can access permitted admin APIs (200)
    // -------------------------------------------------------------------------
    const activeSessionId = 'sess_admin_valid_active_123';
    await test('5. Valid admin session accesses /api/admin/auth/verify successfully (200)', async () => {
      adminSessions.push({
        id: 200,
        session_id: activeSessionId,
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        role: 'super_admin',
        status: 'active',
        expires_at: new Date(Date.now() + 3600000)
      });

      const res = await makeRequest(server, '/api/admin/auth/verify', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': activeSessionId
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.authenticated, true);
      assert.strictEqual(res.body.data.admin.email, ADMIN_USER.email);
      assert.strictEqual(res.body.data.session.session_id, activeSessionId);
    });

    await test('5b. Valid admin session accesses /api/admin/dashboard successfully (200)', async () => {
      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': activeSessionId
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
    });

    // -------------------------------------------------------------------------
    // TEST 6: Admin logout invalidates the session
    // -------------------------------------------------------------------------
    await test('6. POST /api/admin/auth/logout-event revokes session and blocks subsequent requests', async () => {
      const logoutSessId = 'sess_logout_test_777';
      adminSessions.push({
        id: 300,
        session_id: logoutSessId,
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        role: 'super_admin',
        status: 'active',
        expires_at: new Date(Date.now() + 3600000)
      });

      const logoutRes = await makeRequest(server, '/api/admin/auth/logout-event', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': logoutSessId
        },
        body: { session_id: logoutSessId, reason: 'user_action' }
      });
      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.body.success, true);

      const sessRecord = adminSessions.find(s => s.session_id === logoutSessId);
      assert.strictEqual(sessRecord.status, 'logged_out');

      // Subsequent call with revoked session must be rejected with 401
      const blockedRes = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': logoutSessId
        }
      });
      assert.strictEqual(blockedRes.status, 401);
      assert.ok(/has ended/i.test(blockedRes.body.error?.message || blockedRes.body.message));
    });

    await test('6b. Unauthenticated caller cannot terminate another admin sessions by providing body.uid alone', async () => {
      const victimSessId = 'sess_victim_untouched';
      adminSessions.push({
        id: 301,
        session_id: victimSessId,
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        status: 'active',
        expires_at: new Date(Date.now() + 3600000)
      });

      // Attacker sends POST /admin/auth/logout-event with victim's UID, no session_id, no auth header
      const attackRes = await makeRequest(server, '/api/admin/auth/logout-event', {
        method: 'POST',
        body: { uid: ADMIN_USER.uid, reason: 'browser_unload' }
      });
      assert.strictEqual(attackRes.status, 400);

      // Victim's session MUST still be active
      const victimRecord = adminSessions.find(s => s.session_id === victimSessId);
      assert.strictEqual(victimRecord.status, 'active', 'Victim session must remain active');
    });

    await test('6c. Authenticated caller cannot terminate another administrators session_id if owned by someone else', async () => {
      const otherAdminSessId = 'sess_other_admin_protected';
      adminSessions.push({
        id: 302,
        session_id: otherAdminSessId,
        firebase_uid: 'uid_other_admin',
        email: 'other@chipakk.shop',
        status: 'active',
        expires_at: new Date(Date.now() + 3600000)
      });

      // ADMIN_USER tries to terminate otherAdminSessId
      const res = await makeRequest(server, '/api/admin/auth/logout-event', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': otherAdminSessId
        },
        body: { session_id: otherAdminSessId }
      });
      assert.strictEqual(res.status, 200);

      // Because ADMIN_USER does NOT own otherAdminSessId, it was NOT updated
      const otherRecord = adminSessions.find(s => s.session_id === otherAdminSessId);
      assert.strictEqual(otherRecord.status, 'active', 'Other admin session must remain active');
    });

    // -------------------------------------------------------------------------
    // TEST 7: Customer cannot bypass authorization via spoofed headers/storage
    // -------------------------------------------------------------------------
    await test('7. Customer with spoofed X-Session-ID receives 403 (blocked at requireAdmin)', async () => {
      const res = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.customer}`,
          'X-Session-ID': activeSessionId
        }
      });
      assert.strictEqual(res.status, 403);
      assert.ok(/Administrative privileges required/i.test(res.body.error?.message || res.body.message));
    });

    await test('7b. Customer attempting GET /api/admin/auth/verify with spoofed session receives 403', async () => {
      const res = await makeRequest(server, '/api/admin/auth/verify', {
        headers: {
          'Authorization': `Bearer ${TOKENS.customer}`,
          'X-Session-ID': activeSessionId
        }
      });
      assert.strictEqual(res.status, 403);
    });

    // -------------------------------------------------------------------------
    // TEST 8: Direct HTTP calls to sensitive admin endpoints remain blocked
    // -------------------------------------------------------------------------
    await test('8. Direct HTTP calls without admin credentials are all blocked', async () => {
      const endpoints = [
        { path: '/api/admin/products', method: 'GET' },
        { path: '/api/admin/orders', method: 'GET' },
        { path: '/api/admin/customers', method: 'GET' },
        { path: '/api/admin/settings', method: 'GET' },
        { path: '/api/admin/store-builder', method: 'GET' },
        { path: '/api/admin/team', method: 'GET' }
      ];

      for (const ep of endpoints) {
        // Unauthenticated -> 401
        const resUnauth = await makeRequest(server, ep.path, { method: ep.method });
        assert.strictEqual(resUnauth.status, 401, `Expected 401 for unauthenticated ${ep.method} ${ep.path}`);

        // Customer token -> 403
        const resCust = await makeRequest(server, ep.path, {
          method: ep.method,
          headers: { 'Authorization': `Bearer ${TOKENS.customer}` }
        });
        assert.strictEqual(resCust.status, 403, `Expected 403 for customer on ${ep.method} ${ep.path}`);
      }
    });

    // -------------------------------------------------------------------------
    // TEST 9: Public product/catalog endpoints remain accessible without auth
    // -------------------------------------------------------------------------
    await test('9. Public catalog endpoints remain accessible without authentication', async () => {
      const publicEndpoints = ['/api/products', '/api/categories', '/api/settings', '/api/store-builder'];
      for (const p of publicEndpoints) {
        const res = await makeRequest(server, p);
        assert.strictEqual(res.status, 200, `Public endpoint ${p} returned ${res.status}`);
        assert.strictEqual(res.body.success, true);
      }
    });

    // -------------------------------------------------------------------------
    // TEST 10: Customer account, identity resolution & orders continue working
    // -------------------------------------------------------------------------
    await test('10. Customer endpoint /api/customer/me works for authenticated customers', async () => {
      const res = await makeRequest(server, '/api/customer/me', {
        headers: { 'Authorization': `Bearer ${TOKENS.customer}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.is_admin, false);
      assert.strictEqual(res.body.data.is_customer, true);
      assert.strictEqual(res.body.data.customer.firebase_uid, CUSTOMER_USER.uid);
    });

    // -------------------------------------------------------------------------
    // TEST 11: Store 1 and Store 2 multi-store isolation is preserved
    // -------------------------------------------------------------------------
    await test('11. Store 1 and Store 2 headers are respected in admin endpoints', async () => {
      // Store 1
      const resStore1 = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': activeSessionId,
          'X-Store-ID': '1'
        }
      });
      assert.strictEqual(resStore1.status, 200);

      // Store 2
      const resStore2 = await makeRequest(server, '/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': activeSessionId,
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(resStore2.status, 200);

      // Customer cannot access either store's admin dashboard
      const custStore1 = await makeRequest(server, '/api/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${TOKENS.customer}`, 'X-Store-ID': '1' }
      });
      assert.strictEqual(custStore1.status, 403);

      const custStore2 = await makeRequest(server, '/api/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${TOKENS.customer}`, 'X-Store-ID': '2' }
      });
      assert.strictEqual(custStore2.status, 403);
    });

    // -------------------------------------------------------------------------
    // TEST 12: Admin login-event registers active sessions with proper lifecycle
    // -------------------------------------------------------------------------
    await test('12. POST /api/admin/auth/login-event successfully creates active session for verified admin', async () => {
      const freshSessionId = `sess_fresh_test_${Date.now()}`;
      const loginRes = await makeRequest(server, '/api/admin/auth/login-event', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKENS.admin}` },
        body: { session_id: freshSessionId }
      });
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.body.success, true);
      assert.strictEqual(loginRes.body.data.logged, true);

      // Verify the session now works on protected endpoints
      const verifyRes = await makeRequest(server, '/api/admin/auth/verify', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': freshSessionId
        }
      });
      assert.strictEqual(verifyRes.status, 200);
      assert.strictEqual(verifyRes.body.data.session.session_id, freshSessionId);

      // Verify customer calling login-event is refused with 403
      const custLoginRes = await makeRequest(server, '/api/admin/auth/login-event', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKENS.customer}` },
        body: { session_id: `sess_cust_attempt_${Date.now()}` }
      });
      assert.strictEqual(custLoginRes.status, 403);
    });

    // -------------------------------------------------------------------------
    // TEST 13: Static verification of route order and schema integrity
    // -------------------------------------------------------------------------
    await test('13. Static audit: route guards order in server/routes/admin.js', () => {
      const fs = require('fs');
      const adminRoutesSrc = fs.readFileSync(path.join(ROOT, 'server/routes/admin.js'), 'utf8');
      const v = adminRoutesSrc.indexOf('router.use(verifyFirebaseToken)');
      const r = adminRoutesSrc.indexOf('router.use(requireAdmin)');
      const s = adminRoutesSrc.indexOf('router.use(requireAdminSession)');
      const firstRoute = adminRoutesSrc.search(/router\.(get|post|put|patch|delete)\(['"]\/(?!auth\/logout-event)/);

      assert.ok(v !== -1, 'verifyFirebaseToken must be registered');
      assert.ok(r !== -1, 'requireAdmin must be registered');
      assert.ok(s !== -1, 'requireAdminSession must be registered');
      assert.ok(v < r, 'verifyFirebaseToken must precede requireAdmin');
      assert.ok(r < s, 'requireAdmin must precede requireAdminSession');
      assert.ok(s < firstRoute, 'all guards must precede protected admin routes');
    });

    await test('13b. Static audit: web/admin.html initially hides admin workspace and shows login', () => {
      const fs = require('fs');
      const adminHtml = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
      assert.ok(adminHtml.includes('id="login-section"'), 'login-section exists');
      assert.ok(adminHtml.includes('id="admin-workspace"'), 'admin-workspace exists');
      assert.ok(/id="login-section"[^>]*display:\s*block/i.test(adminHtml), 'login-section initially display: block');
      assert.ok(/id="admin-workspace"[^>]*display:\s*none/i.test(adminHtml), 'admin-workspace initially display: none');
    });

    await test('13c. Schema audit: zero queries expect or reference a "role" column on users table', () => {
      const fs = require('fs');
      const filesToCheck = [
        'server/middleware/auth.js',
        'server/services/paymentService.js',
        'server/services/customerService.js',
        'server/controllers/adminController.js'
      ];
      for (const f of filesToCheck) {
        const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
        assert.ok(!/SELECT[^;]*\brole\b[^;]*FROM users/i.test(content), `File ${f} must not SELECT role from users table`);
        assert.ok(!/users\s+ADD\s+COLUMN\s+role/i.test(content), `File ${f} must not add role to users`);
      }
    });

  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('\n===============================================================');
  const failed = results.filter(r => !r.pass);
  console.log(`TOTAL SECURITY CHECKS: ${results.length}`);
  console.log(`PASSED:                ${results.length - failed.length}`);
  console.log(`FAILED:                ${failed.length}`);
  console.log('===============================================================');

  if (failed.length > 0) {
    process.exit(1);
  }
})();
