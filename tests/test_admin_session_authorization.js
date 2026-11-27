/**
 * Adversarial regression suite for the admin SESSION-MANAGEMENT endpoints specifically
 * (GET /api/admin/active-sessions, POST /api/admin/active-sessions/:id/terminate,
 * POST /api/admin/auth/login-event).
 *
 * These are confirmed findings from an independent security review of the uncommitted
 * requireAdminSession / admin_sessions changes (2026-10-23) that tests/test_admin_auth_security.js
 * does NOT cover:
 *
 *   F1 (HIGH) - terminateSessionHandler (server/controllers/adminController.js) had NO ownership or
 *       role check: it accepted the admin_sessions numeric `id` from the URL and force-logged-out
 *       whatever row matched, for ANY authenticated admin regardless of role. IDs are small
 *       sequential integers (trivially enumerable), so ANY admin -- including the lowest-privilege
 *       one -- could force-logout ANY OTHER admin at will.
 *
 *   F2 (MEDIUM) - getActiveSessionsHandler returned the raw, literal `session_id` value (the exact
 *       bearer-equivalent credential requireAdminSession checks) of EVERY active admin to EVERY
 *       other admin, and showed every admin's session to every other admin regardless of role. The
 *       admin UI (web/js/admin.js renderActiveSessionsTable) never reads `.session_id` -- it only
 *       needs `.id` for the terminate button -- so this was pure unnecessary exposure that, combined
 *       with F3, let any admin hijack/invalidate another admin's session.
 *
 *   F3 (MEDIUM) - recordAdminLoginHandler's session upsert is
 *       `INSERT INTO admin_sessions (session_id, firebase_uid, ...) ... ON DUPLICATE KEY UPDATE
 *        firebase_uid = VALUES(firebase_uid), ...` keyed only on the UNIQUE session_id column, and
 *       session_id is CLIENT-supplied. Any admin who obtained another admin's session_id (e.g. via
 *       F2, or a log/XSS leak) could silently reassign that session row to their own identity by
 *       POSTing it back through /auth/login-event, invalidating the victim's real session.
 *
 * Methodology: this suite is written to assert the SECURE outcome. Run against the vulnerable
 * baseline, F1/F2/F3-specific assertions fail with the exact exploit outcome as the failure message
 * (proving the vulnerability); after the fix, the same assertions pass (regression coverage).
 */
const assert = require('assert');
const path = require('path');
const http = require('http');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const ROOT = path.join(__dirname, '..');
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log(`[PASS] ${name}`); }
  catch (err) { results.push({ name, pass: false, err }); console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`); }
}

// Two DISTINCT real admins: SUPER_ADMIN (super_admin role) and LOW_ADMIN (plain 'admin' role, lower privilege).
const SUPER_ADMIN = { uid: 'uid_super_1', email: 'super@chipakk.shop' };
const LOW_ADMIN = { uid: 'uid_low_2', email: 'low@chipakk.shop' };
const TOKENS = { super: 'mock_token_super', low: 'mock_token_low' };

let adminSessions = [];
let currentPool = null;
let adminsTable = [
  { id: 1, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', active: 1 },
  { id: 2, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', active: 1 }
];

function setupMockEnvironment() {
  const firebaseConfigPath = require.resolve(path.join(ROOT, 'server/config/firebase.js'));
  const mockAuth = {
    verifyIdToken: async (token) => {
      if (token === TOKENS.super) return { uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, email_verified: true };
      if (token === TOKENS.low) return { uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, email_verified: true };
      throw new Error('Invalid or expired Firebase ID token');
    }
  };
  require.cache[firebaseConfigPath] = {
    id: firebaseConfigPath, filename: firebaseConfigPath, loaded: true,
    exports: { admin: { apps: [{}], auth: () => mockAuth }, getAuth: () => mockAuth, initializeFirebaseAdmin: () => ({}) }
  };

  const pool = createFakePool([
    [/SELECT id, firebase_uid, email, role, active FROM admins WHERE/i, (sql, params) => {
      const [uid, email] = params;
      return [adminsTable.filter(a => a.active && (a.firebase_uid === uid || (a.email && String(email).toLowerCase() === a.email.toLowerCase())))];
    }],
    [/SELECT COUNT\(\*\) AS total FROM admins/i, () => [[{ total: adminsTable.length }]]],

    [/SELECT id, session_id, firebase_uid, email, role, status, expires_at FROM admin_sessions WHERE session_id = \? AND firebase_uid = \?/i, (sql, params) => {
      const [sessionId, uid] = params;
      return [adminSessions.filter(s => s.session_id === sessionId && s.firebase_uid === uid)];
    }],
    // Lookup by session_id alone (used by the F3 hijack-prevention check in the fix)
    [/SELECT firebase_uid, status, expires_at FROM admin_sessions WHERE session_id = \?\s*LIMIT 1/i, (sql, params) => {
      const [sessionId] = params;
      return [adminSessions.filter(s => s.session_id === sessionId)];
    }],
    [/SELECT id, session_id, firebase_uid, email, admin_name, role, ip_address, user_agent, login_time, last_activity, status, expires_at, created_at FROM admin_sessions WHERE status = 'active'/i, (sql, params) => {
      const scoped = /AND firebase_uid = \?/.test(sql);
      return [adminSessions.filter(s => s.status === 'active' && (!scoped || s.firebase_uid === params[0]))];
    }],
    // Lookup by numeric id (used by terminateSessionHandler's ownership check)
    [/SELECT id, session_id, firebase_uid, email FROM admin_sessions WHERE id = \?/i, (sql, params) => {
      const [id] = params;
      return [adminSessions.filter(s => s.id === id)];
    }],

    [/INSERT INTO admin_sessions/i, (sql, params) => {
      const [sessionId, uid, email, name, role] = params;
      let existing = adminSessions.find(s => s.session_id === sessionId);
      if (existing) {
        existing.firebase_uid = uid; existing.email = email; existing.role = role;
        existing.status = 'active'; existing.last_activity = new Date(); existing.expires_at = new Date(Date.now() + 3600000);
      } else {
        existing = { id: adminSessions.length + 1, session_id: sessionId, firebase_uid: uid, email, admin_name: name, role, status: 'active', login_time: new Date(), last_activity: new Date(), expires_at: new Date(Date.now() + 3600000) };
        adminSessions.push(existing);
      }
      return [{ affectedRows: 1, insertId: existing.id }];
    }],
    [/UPDATE admin_sessions SET status = \?, updated_at = NOW\(\) WHERE session_id = \? AND firebase_uid = \?/i, (sql, params) => {
      const [status, sessionId, uid] = params;
      const s = adminSessions.find(x => x.session_id === sessionId && x.firebase_uid === uid);
      if (s) s.status = status;
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET status = \?, updated_at = NOW\(\) WHERE session_id = \?/i, (sql, params) => {
      const [status, sessionId] = params;
      const s = adminSessions.find(x => x.session_id === sessionId);
      if (s) s.status = status;
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET status = "logged_out", updated_at = NOW\(\) WHERE id = \?/i, (sql, params) => {
      const [id] = params;
      const s = adminSessions.find(x => x.id === id);
      if (s) s.status = 'logged_out';
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET status = "expired", updated_at = NOW\(\) WHERE id = \?/i, (sql, params) => {
      const [id] = params; const s = adminSessions.find(x => x.id === id); if (s) s.status = 'expired';
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET last_activity = NOW\(\), expires_at = DATE_ADD\(NOW\(\), INTERVAL 1 HOUR\) WHERE id = \?/i, (sql, params) => {
      const [id] = params; const s = adminSessions.find(x => x.id === id);
      if (s) { s.last_activity = new Date(); s.expires_at = new Date(Date.now() + 3600000); }
      return [{ affectedRows: s ? 1 : 0 }];
    }],
    [/UPDATE admin_sessions SET last_activity = NOW\(\), expires_at = DATE_ADD\(NOW\(\), INTERVAL 1 HOUR\) WHERE session_id = \? AND firebase_uid = \?/i, (sql, params) => {
      const [sessionId, uid] = params; const s = adminSessions.find(x => x.session_id === sessionId && x.firebase_uid === uid);
      if (s) { s.last_activity = new Date(); s.expires_at = new Date(Date.now() + 3600000); }
      return [{ affectedRows: s ? 1 : 0 }];
    }],

    [/SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = \?/i, () => [[]]],
    [/SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE email IS NOT NULL/i, () => [[]]],
    [/INSERT INTO users/i, () => [{ insertId: 1 }]],
    [/SELECT COUNT\(\*\) AS total FROM orders/i, () => [[{ total: 0 }]]],
    [/SELECT COALESCE\(SUM\(.*total_revenue/i, () => [[{ total_revenue: 0 }]]],
    [/SELECT COALESCE\(SUM\(.*month_revenue/i, () => [[{ month_revenue: 0 }]]],
    [/SELECT id FROM admin_sessions WHERE firebase_uid = \?/i, () => [[]]]
  ]);
  installFakePool(pool);
  currentPool = pool;
}

function clearServerCache() {
  for (const m of ['server/app.js', 'server/routes/admin.js', 'server/routes/customer.js', 'server/routes/products.js', 'server/middleware/auth.js', 'server/controllers/adminController.js']) {
    try { delete require.cache[require.resolve(path.join(ROOT, m))]; } catch (_) {}
  }
}

function makeRequest(server, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request({ hostname: '127.0.0.1', port, path: reqPath, method: options.method || 'GET', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(body); } catch (_) { json = body; } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

(async () => {
  console.log('===============================================================');
  console.log('🔒 ADMIN SESSION AUTHORIZATION - ADVERSARIAL REGRESSION SUITE');
  console.log('===============================================================\n');

  setupMockEnvironment();
  clearServerCache();
  const app = require(path.join(ROOT, 'server/app.js'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // -----------------------------------------------------------------------
    // F1: terminateSessionHandler IDOR / missing authorization
    // -----------------------------------------------------------------------
    await test('F1. A low-privilege admin CANNOT force-terminate a super_admin\'s active session', async () => {
      const victimSessionId = 'sess_super_victim_f1';
      adminSessions.push({ id: 500, session_id: victimSessionId, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const attackerSessionId = 'sess_low_attacker_f1';
      adminSessions.push({ id: 501, session_id: attackerSessionId, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/active-sessions/500/terminate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKENS.low}`, 'X-Session-ID': attackerSessionId }
      });

      assert.strictEqual(res.status, 403, `a low-privilege admin's terminate request must be refused (403), got ${res.status} body=${JSON.stringify(res.body)}`);
      const victim = adminSessions.find((s) => s.id === 500);
      assert.strictEqual(victim.status, 'active', "the super_admin's session must remain ACTIVE -- a non-owner, non-super_admin must never be able to force-logout another administrator");
    });

    await test('F1b. A super_admin CAN force-terminate another admin\'s active session (legitimate oversight capability preserved)', async () => {
      const victimSessionId = 'sess_low_victim_f1b';
      adminSessions.push({ id: 502, session_id: victimSessionId, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const superSessionId = 'sess_super_caller_f1b';
      adminSessions.push({ id: 503, session_id: superSessionId, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/active-sessions/502/terminate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKENS.super}`, 'X-Session-ID': superSessionId }
      });
      assert.strictEqual(res.status, 200, `super_admin oversight must still work: ${JSON.stringify(res.body)}`);
      assert.strictEqual(adminSessions.find((s) => s.id === 502).status, 'logged_out');
    });

    await test('F1c. Any admin CAN terminate their own session (self-service "log out this device")', async () => {
      const ownSessionId = 'sess_low_self_f1c';
      adminSessions.push({ id: 504, session_id: ownSessionId, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/active-sessions/504/terminate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKENS.low}`, 'X-Session-ID': ownSessionId }
      });
      assert.strictEqual(res.status, 200, `self-termination must be allowed: ${JSON.stringify(res.body)}`);
      assert.strictEqual(adminSessions.find((s) => s.id === 504).status, 'logged_out');
    });

    // -----------------------------------------------------------------------
    // F2: getActiveSessionsHandler over-disclosure
    // -----------------------------------------------------------------------
    await test('F2. GET /api/admin/active-sessions never returns the raw session_id field to anyone', async () => {
      const sessA = 'sess_super_f2'; const sessB = 'sess_low_f2';
      adminSessions.push({ id: 510, session_id: sessA, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });
      adminSessions.push({ id: 511, session_id: sessB, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/active-sessions', { headers: { Authorization: `Bearer ${TOKENS.super}`, 'X-Session-ID': sessA } });
      assert.strictEqual(res.status, 200);
      const sessions = res.body.data.sessions;
      for (const s of sessions) {
        assert.strictEqual(s.session_id, undefined, 'the raw session_id credential must never be sent to the client -- the UI only needs numeric `id` to terminate a session');
      }
    });

    await test('F2b. A low-privilege admin only sees THEIR OWN session(s), never other administrators\' sessions', async () => {
      const sessA = 'sess_super_f2b'; const sessB = 'sess_low_f2b';
      adminSessions.push({ id: 512, session_id: sessA, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });
      adminSessions.push({ id: 513, session_id: sessB, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/active-sessions', { headers: { Authorization: `Bearer ${TOKENS.low}`, 'X-Session-ID': sessB } });
      assert.strictEqual(res.status, 200);
      const sessions = res.body.data.sessions;
      assert.ok(sessions.every((s) => s.firebase_uid === LOW_ADMIN.uid), `a low-privilege admin must only see their own session(s), got: ${JSON.stringify(sessions.map((s) => s.email))}`);
    });

    await test('F2c. A super_admin CAN still see every administrator\'s session (legitimate oversight view preserved)', async () => {
      const sessA = 'sess_super_f2c'; const sessB = 'sess_low_f2c';
      adminSessions.push({ id: 514, session_id: sessA, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });
      adminSessions.push({ id: 515, session_id: sessB, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/active-sessions', { headers: { Authorization: `Bearer ${TOKENS.super}`, 'X-Session-ID': sessA } });
      assert.strictEqual(res.status, 200);
      const uids = res.body.data.sessions.map((s) => s.firebase_uid);
      assert.ok(uids.includes(SUPER_ADMIN.uid) && uids.includes(LOW_ADMIN.uid), `super_admin must retain the full oversight view, got uids: ${JSON.stringify(uids)}`);
    });

    // -----------------------------------------------------------------------
    // F3: recordAdminLoginHandler session-hijack-via-upsert
    // -----------------------------------------------------------------------
    await test('F3. POST /api/admin/auth/login-event cannot reassign another administrator\'s still-active session_id to the caller', async () => {
      const victimSessionId = 'sess_super_f3_target';
      adminSessions.push({ id: 520, session_id: victimSessionId, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      // LOW_ADMIN, with their OWN valid token, replays the SUPER_ADMIN's session_id (e.g. captured via a
      // leak, or -- before the F2 fix -- simply read it off GET /active-sessions).
      const res = await makeRequest(server, '/api/admin/auth/login-event', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKENS.low}` },
        body: { session_id: victimSessionId }
      });
      assert.strictEqual(res.status, 200);

      const row = adminSessions.find((s) => s.session_id === victimSessionId);
      assert.strictEqual(row.firebase_uid, SUPER_ADMIN.uid, "the victim's session row must still belong to the SUPER_ADMIN -- a different admin's login-event must never silently reassign ownership of someone else's active session");

      // And the caller must have been issued a session of their own instead, so they are not left with no session.
      const returnedId = res.body.data.session_id;
      assert.notStrictEqual(returnedId, victimSessionId, 'the caller must be issued a fresh session_id, not the hijacked one, when the supplied id collides with another identity\'s active session');
      const callerRow = adminSessions.find((s) => s.session_id === returnedId);
      assert.ok(callerRow && callerRow.firebase_uid === LOW_ADMIN.uid, 'the caller must receive their own valid, usable session');
    });

    await test('F3b. Re-using YOUR OWN existing session_id in login-event still works normally (no false positive)', async () => {
      const ownSessionId = 'sess_low_f3b_own';
      adminSessions.push({ id: 521, session_id: ownSessionId, firebase_uid: LOW_ADMIN.uid, email: LOW_ADMIN.email, role: 'admin', status: 'active', expires_at: new Date(Date.now() + 3600000) });

      const res = await makeRequest(server, '/api/admin/auth/login-event', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKENS.low}` },
        body: { session_id: ownSessionId }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.session_id, ownSessionId, 'reusing your own still-active session_id must be unaffected by the hijack guard');
      assert.strictEqual(adminSessions.find((s) => s.session_id === ownSessionId).firebase_uid, LOW_ADMIN.uid);
    });

    await test('F3c. Reusing an EXPIRED session_id that used to belong to someone else is safely re-issued to the new caller', async () => {
      const staleSessionId = 'sess_super_f3c_expired';
      adminSessions.push({ id: 522, session_id: staleSessionId, firebase_uid: SUPER_ADMIN.uid, email: SUPER_ADMIN.email, role: 'super_admin', status: 'expired', expires_at: new Date(Date.now() - 60000) });

      const res = await makeRequest(server, '/api/admin/auth/login-event', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKENS.low}` },
        body: { session_id: staleSessionId }
      });
      assert.strictEqual(res.status, 200);
      // Either a fresh id is issued, or (acceptable) the now-expired/foreign row is simply not reused for a
      // different identity -- the only wrong outcome is the row flipping to the caller while still "belonging"
      // to the record of a different admin's expired session.
      const returnedId = res.body.data.session_id;
      const callerRow = adminSessions.find((s) => s.session_id === returnedId);
      assert.ok(callerRow && callerRow.firebase_uid === LOW_ADMIN.uid);
    });

    await test('F3d. Database failure during collision lookup returns HTTP 500 and never returns logged: true', async () => {
      const failingSessionId = 'sess_f3d_db_collision_fail';
      currentPool.handlers.unshift([
        /SELECT firebase_uid, status, expires_at FROM admin_sessions WHERE session_id =/i,
        () => { throw new Error('Simulated query timeout during collision lookup'); }
      ]);

      try {
        const res = await makeRequest(server, '/api/admin/auth/login-event', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKENS.low}` },
          body: { session_id: failingSessionId }
        });
        assert.strictEqual(res.status, 500, 'Must return HTTP 500 on database failure');
        assert.strictEqual(res.body.success, false, 'Must indicate failure');
        assert.strictEqual(res.body?.data?.logged, undefined, 'Must not return logged: true on failure');
      } finally {
        currentPool.handlers.shift();
      }
    });

    await test('F3e. Database failure during session upsert returns HTTP 500 and never returns logged: true', async () => {
      const failingSessionId = 'sess_f3e_db_upsert_fail';
      currentPool.handlers.unshift([
        /INSERT INTO admin_sessions/i,
        () => { throw new Error('Simulated MySQL deadlock on upsert'); }
      ]);

      try {
        const res = await makeRequest(server, '/api/admin/auth/login-event', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKENS.low}` },
          body: { session_id: failingSessionId }
        });
        assert.strictEqual(res.status, 500, 'Must return HTTP 500 on database failure');
        assert.strictEqual(res.body.success, false, 'Must indicate failure');
        assert.strictEqual(res.body?.data?.logged, undefined, 'Must not return logged: true on failure');
      } finally {
        currentPool.handlers.shift();
      }
    });

    await test('F3f. Database failure during table verification returns HTTP 500 and never returns logged: true', async () => {
      const failingSessionId = 'sess_f3f_db_ddl_fail';
      currentPool.handlers.unshift([
        /CREATE TABLE IF NOT EXISTS `admin_sessions`/i,
        () => { throw new Error('Simulated DDL lock error'); }
      ]);

      try {
        const res = await makeRequest(server, '/api/admin/auth/login-event', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKENS.low}` },
          body: { session_id: failingSessionId }
        });
        assert.strictEqual(res.status, 500, 'Must return HTTP 500 on database failure');
        assert.strictEqual(res.body.success, false, 'Must indicate failure');
        assert.strictEqual(res.body?.data?.logged, undefined, 'Must not return logged: true on failure');
      } finally {
        currentPool.handlers.shift();
      }
    });

    // -----------------------------------------------------------------------
    // Sanity: the existing auth gate chain still works for these session-management routes
    // -----------------------------------------------------------------------
    await test('Sanity. Unauthenticated callers still get 401 on the session-management endpoints', async () => {
      const r1 = await makeRequest(server, '/api/admin/active-sessions');
      assert.strictEqual(r1.status, 401);
      const r2 = await makeRequest(server, '/api/admin/active-sessions/1/terminate', { method: 'POST' });
      assert.strictEqual(r2.status, 401);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n===============================================================');
  const failed = results.filter((r) => !r.pass);
  console.log(`TOTAL: ${results.length}  PASSED: ${results.length - failed.length}  FAILED: ${failed.length}`);
  console.log('===============================================================');
  if (failed.length > 0) process.exit(1);
})();
