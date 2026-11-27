/**
 * Security Verification Test Suite: API Client Credential Isolation & Admin Login/Logout Handling
 *
 * Verifies:
 * 1. web/js/api.js attaches Firebase Authorization and X-Session-ID ONLY to same-origin requests.
 * 2. Unrelated/external absolute URLs do not receive Authorization or X-Session-ID.
 * 3. X-Store-ID behavior and JSON/FormData handling are preserved.
 * 4. Normal admin endpoints (login-event, verify, logout-event) receive credentials.
 * 5. web/js/admin.js definitively clears custom session and signs out Firebase on 403 (Access Denied).
 * 6. web/js/admin.js handles transient network/server failures without unnecessarily wiping session or signing out.
 * 7. Inactivity logout and manual logout send session_id in request body and maintain consistent Firebase & UI state.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

async function runTests() {
  console.log('===============================================================');
  console.log('🔒 API CLIENT CREDENTIAL ISOLATION & ADMIN AUTH CLIENT TESTS');
  console.log('===============================================================\n');

  const apiJsSource = fs.readFileSync(path.join(ROOT, 'web/js/api.js'), 'utf8');
  const adminJsSource = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');

  // ---------------------------------------------------------------------------
  // SUITE 1: API CLIENT URL & CREDENTIAL ISOLATION (web/js/api.js)
  // ---------------------------------------------------------------------------

  await test('1.1: web/js/api.js defines isSameOriginAsApi check', () => {
    assert.ok(apiJsSource.includes('isSameOriginAsApi'), 'api.js must define isSameOriginAsApi');
    assert.ok(apiJsSource.includes('resolveFullUrl'), 'api.js must define resolveFullUrl helper');
  });

  await test('1.2: isSameOriginAsApi correctly approves same-origin and blocks cross-origin URLs', () => {
    // Extract functions for pure algorithmic verification
    const sandbox = {
      window: {
        location: {
          hostname: 'chipakk.shop',
          origin: 'https://api.chipakk.shop',
          protocol: 'https:',
          port: ''
        }
      },
      URL: global.URL,
      API_BASE_URL: 'https://api.chipakk.shop/api'
    };

    const script = new vm.Script(`
      ${apiJsSource.slice(apiJsSource.indexOf('function resolveFullUrl'), apiJsSource.indexOf('async function request'))}
      this.resolveFullUrl = resolveFullUrl;
      this.isSameOriginAsApi = isSameOriginAsApi;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    const { resolveFullUrl, isSameOriginAsApi } = sandbox;

    // Relative paths -> same origin
    const relUrl = resolveFullUrl('/admin/dashboard');
    assert.strictEqual(relUrl, 'https://api.chipakk.shop/api/admin/dashboard');
    assert.strictEqual(isSameOriginAsApi(relUrl), true, 'Relative path must match API origin');

    // Same domain & protocol absolute URL -> same origin
    const exactAbsUrl = resolveFullUrl('https://api.chipakk.shop/api/orders');
    assert.strictEqual(exactAbsUrl, 'https://api.chipakk.shop/api/orders');
    assert.strictEqual(isSameOriginAsApi(exactAbsUrl), true, 'Same origin absolute URL must match');

    // External domain -> blocked
    const evilDomain = resolveFullUrl('https://evil-attacker.com/steal-token');
    assert.strictEqual(evilDomain, 'https://evil-attacker.com/steal-token');
    assert.strictEqual(isSameOriginAsApi(evilDomain), false, 'External domain must be rejected');

    // Attacker subdomain suffix trick -> blocked
    const subSuffix = resolveFullUrl('https://api.chipakk.shop.attacker.com/api');
    assert.strictEqual(isSameOriginAsApi(subSuffix), false, 'Attacker subdomain suffix must be rejected');

    // Protocol mismatch (HTTP vs HTTPS) -> blocked
    const httpMismatch = resolveFullUrl('http://api.chipakk.shop/api');
    assert.strictEqual(isSameOriginAsApi(httpMismatch), false, 'Plaintext HTTP mismatch must be rejected');

    // Different port -> blocked
    const portMismatch = resolveFullUrl('https://api.chipakk.shop:8080/api');
    assert.strictEqual(isSameOriginAsApi(portMismatch), false, 'Port mismatch must be rejected');
  });

  await test('1.3: Simulated request() attaches Authorization and X-Session-ID only to same-origin requests', async () => {
    let capturedFetchCalls = [];

    const mockLocalStorage = {
      store: {
        chipakk_admin_session_id: 'test_session_xyz_777',
        admin_active_store_id: '2'
      },
      getItem(k) { return this.store[k] || null; }
    };

    const mockAuth = {
      currentUser: {
        getIdToken: async () => 'mock_firebase_bearer_token_123'
      }
    };

    const mockFetch = async (url, config) => {
      capturedFetchCalls.push({ url, config });
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true })
      };
    };

    const sandbox = {
      window: {
        location: { hostname: 'chipakk.shop', origin: 'https://api.chipakk.shop', protocol: 'https:' },
        dispatchEvent: () => {}
      },
      localStorage: mockLocalStorage,
      auth: mockAuth,
      fetch: mockFetch,
      URL: global.URL,
      FormData: function() {},
      CustomEvent: function() {},
      API_BASE_URL: 'https://api.chipakk.shop/api',
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    // Extract request function implementation
    const requestSrc = apiJsSource.slice(
      apiJsSource.indexOf('async function getAuthToken'),
      apiJsSource.indexOf('export const apiClient')
    );

    const script = new vm.Script(`
      ${requestSrc}
      this.request = request;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    // Call 1: Same origin relative request
    await sandbox.request('/admin/orders');
    assert.strictEqual(capturedFetchCalls.length, 1);
    const call1 = capturedFetchCalls[0];
    assert.strictEqual(call1.url, 'https://api.chipakk.shop/api/admin/orders');
    assert.strictEqual(call1.config.headers['Authorization'], 'Bearer mock_firebase_bearer_token_123');
    assert.strictEqual(call1.config.headers['X-Session-ID'], 'test_session_xyz_777');
    assert.strictEqual(call1.config.headers['X-Store-ID'], '2');
    assert.strictEqual(call1.config.headers['Content-Type'], 'application/json');

    // Call 2: External cross-origin request
    await sandbox.request('https://external-webhook.example.com/notify');
    assert.strictEqual(capturedFetchCalls.length, 2);
    const call2 = capturedFetchCalls[1];
    assert.strictEqual(call2.url, 'https://external-webhook.example.com/notify');
    assert.strictEqual(call2.config.headers['Authorization'], undefined, 'Cross-origin request must NOT include Authorization header');
    assert.strictEqual(call2.config.headers['X-Session-ID'], undefined, 'Cross-origin request must NOT include X-Session-ID header');
    assert.strictEqual(call2.config.headers['X-Store-ID'], '2', 'Preserves X-Store-ID as required');
  });

  await test('1.4: FormData requests do not set Content-Type header', async () => {
    let capturedConfig = null;
    function MockFormData() {}

    const sandbox = {
      window: { location: { hostname: 'chipakk.shop', origin: 'https://api.chipakk.shop', protocol: 'https:' }, dispatchEvent: () => {} },
      localStorage: { getItem: () => null },
      auth: { currentUser: null },
      fetch: async (url, config) => {
        capturedConfig = config;
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) };
      },
      URL: global.URL,
      FormData: MockFormData,
      CustomEvent: function() {},
      API_BASE_URL: 'https://api.chipakk.shop/api',
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const requestSrc = apiJsSource.slice(
      apiJsSource.indexOf('async function getAuthToken'),
      apiJsSource.indexOf('export const apiClient')
    );

    const script = new vm.Script(`
      ${requestSrc}
      this.request = request;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    const fd = new MockFormData();
    await sandbox.request('/admin/upload', { method: 'POST', body: fd });
    assert.strictEqual(capturedConfig.headers['Content-Type'], undefined, 'FormData must omit Content-Type header so browser sets multipart boundary');
  });

  await test('1.5: Caller-supplied credentials in options.headers with varied casing are stripped for cross-origin URLs', async () => {
    let capturedFetchConfig = null;

    const mockFetch = async (url, config) => {
      capturedFetchConfig = config;
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true })
      };
    };

    const sandbox = {
      window: { location: { hostname: 'chipakk.shop', origin: 'https://api.chipakk.shop', protocol: 'https:' }, dispatchEvent: () => {} },
      localStorage: {
        getItem: (k) => {
          if (k === 'chipakk_admin_session_id') return 'valid_admin_session_456';
          if (k === 'admin_active_store_id') return '1';
          return null;
        }
      },
      auth: { currentUser: { getIdToken: async () => 'valid_token_abc' } },
      fetch: mockFetch,
      URL: global.URL,
      FormData: function() {},
      CustomEvent: function() {},
      API_BASE_URL: 'https://api.chipakk.shop/api',
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const requestSrc = apiJsSource.slice(
      apiJsSource.indexOf('async function getAuthToken'),
      apiJsSource.indexOf('export const apiClient')
    );

    const script = new vm.Script(`
      ${requestSrc}
      this.request = request;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    // Test with lowercase, uppercase, mixed-case headers supplied by caller to external URL
    const callerHeaders = {
      'authorization': 'Bearer caller_injected_token',
      'x-session-id': 'caller_injected_sess',
      'AUTHORIZATION': 'Bearer another_caller_token',
      'X-SESSION-ID': 'another_caller_sess',
      'X-Custom-Tracking': 'keep-me-safe'
    };

    await sandbox.request('https://external-api.untrusted.com/endpoint', {
      method: 'POST',
      headers: callerHeaders
    });

    assert.ok(capturedFetchConfig, 'fetch should have been invoked');
    const headers = capturedFetchConfig.headers;

    // Check case-insensitive removal
    const headerKeys = Object.keys(headers).map(k => k.toLowerCase());
    assert.strictEqual(headerKeys.includes('authorization'), false, 'All variants of authorization must be stripped on cross-origin');
    assert.strictEqual(headerKeys.includes('x-session-id'), false, 'All variants of x-session-id must be stripped on cross-origin');
    assert.strictEqual(headers['authorization'], undefined);
    assert.strictEqual(headers['Authorization'], undefined);
    assert.strictEqual(headers['AUTHORIZATION'], undefined);
    assert.strictEqual(headers['x-session-id'], undefined);
    assert.strictEqual(headers['X-Session-ID'], undefined);
    assert.strictEqual(headers['X-SESSION-ID'], undefined);

    // Preserved headers
    assert.strictEqual(headers['X-Custom-Tracking'], 'keep-me-safe', 'Non-credential headers should be preserved');
    assert.strictEqual(headers['X-Store-ID'], '1', 'Store ID must be preserved');
  });

  await test('1.6: Trusted same-origin requests retain and canonicalize Authorization and X-Session-ID', async () => {
    let capturedFetchConfig = null;

    const mockFetch = async (url, config) => {
      capturedFetchConfig = config;
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true })
      };
    };

    const sandbox = {
      window: { location: { hostname: 'chipakk.shop', origin: 'https://api.chipakk.shop', protocol: 'https:' }, dispatchEvent: () => {} },
      localStorage: { getItem: (k) => k === 'chipakk_admin_session_id' ? 'trusted_sess_999' : '2' },
      auth: { currentUser: { getIdToken: async () => 'trusted_firebase_jwt' } },
      fetch: mockFetch,
      URL: global.URL,
      FormData: function() {},
      CustomEvent: function() {},
      API_BASE_URL: 'https://api.chipakk.shop/api',
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const requestSrc = apiJsSource.slice(
      apiJsSource.indexOf('async function getAuthToken'),
      apiJsSource.indexOf('export const apiClient')
    );

    const script = new vm.Script(`
      ${requestSrc}
      this.request = request;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    // Call same-origin endpoint
    await sandbox.request('/admin/custom-forge/orders');

    assert.ok(capturedFetchConfig);
    const headers = capturedFetchConfig.headers;
    assert.strictEqual(headers['Authorization'], 'Bearer trusted_firebase_jwt');
    assert.strictEqual(headers['X-Session-ID'], 'trusted_sess_999');
    assert.strictEqual(headers['X-Store-ID'], '2');
  });

  // ---------------------------------------------------------------------------
  // SUITE 2: ADMIN LOGIN FAILURE & SESSION HARDENING (web/js/admin.js)
  // ---------------------------------------------------------------------------

  await test('2.1: onAuthStateChanged clears custom session and signs out Firebase on 403', () => {
    assert.ok(adminJsSource.includes('err.status === 403'), 'admin.js must check for err.status === 403');
    const authStateBlock = adminJsSource.slice(adminJsSource.indexOf("onAuthStateChanged(auth, async (user)"), adminJsSource.indexOf("loginBtn.addEventListener"));
    assert.ok(authStateBlock.includes('clearAdminSession()'), 'onAuthStateChanged must clear admin session on 403');
    assert.ok(authStateBlock.includes('signOut(auth)'), 'onAuthStateChanged must sign out Firebase on 403');
    assert.ok(authStateBlock.includes('Access Denied: Account'), 'Must display clear access denied message');
  });

  await test('2.2: onAuthStateChanged handles transient failures without signing out Firebase', () => {
    const authStateCatchBlock = adminJsSource.slice(adminJsSource.indexOf("[Auth State] Admin verification rejected:"), adminJsSource.indexOf("loginBtn.addEventListener"));
    assert.ok(authStateCatchBlock.includes('Temporary verification failure'), 'Must provide distinct temporary verification failure message');
    assert.ok(authStateCatchBlock.includes('err.status === 401'), 'Must distinguish 401 expired session from transient failure');
  });

  await test('2.3: loginBtn click clears session and signs out Firebase on 403', () => {
    const loginCatchBlock = adminJsSource.slice(adminJsSource.indexOf("[Login Error]"), adminJsSource.indexOf("loginBtn.disabled = false;"));
    assert.ok(loginCatchBlock.includes('err.status === 403'), 'login handler must handle 403 separately');
    assert.ok(loginCatchBlock.includes('clearAdminSession()'), 'login handler must clear session on 403');
    assert.ok(loginCatchBlock.includes('signOut(auth)'), 'login handler must sign out Firebase on 403');
    assert.ok(loginCatchBlock.includes('Access Denied: This account does not have administrative privileges.'), 'Must set explicit access denied message');
  });

  await test('2.4: loginBtn click distinguishes transient failure from access denied', () => {
    const loginCatchBlock = adminJsSource.slice(adminJsSource.indexOf("[Login Error]"), adminJsSource.indexOf("loginBtn.disabled = false;"));
    assert.ok(loginCatchBlock.includes('Temporary verification failure: Server or network error'), 'Must provide distinct transient error message');
  });

  await test('2.5: loadAllAdminData security guard clears session and signs out Firebase on 403', () => {
    const loadAllBlock = adminJsSource.slice(adminJsSource.indexOf("[loadAllAdminData] Protected admin endpoint rejected:"), adminJsSource.indexOf("if (catRes.status === 'fulfilled'"));
    assert.ok(loadAllBlock.includes('signOut(auth)'), 'loadAllAdminData must sign out Firebase on 403 rejection');
    assert.ok(loadAllBlock.includes('clearAdminSession()'), 'loadAllAdminData must clear session');
  });

  await test('2.6: Behavioral: Transient error (5xx or network) leaves pending session ID intact and avoids signOut', async () => {
    let localStorageData = {};
    const mockLocalStorage = {
      getItem: (k) => localStorageData[k] || null,
      setItem: (k, v) => { localStorageData[k] = String(v); },
      removeItem: (k) => { delete localStorageData[k]; }
    };

    let signOutCalled = false;
    const mockAuth = { currentUser: { email: 'admin@chipakk.shop' } };
    const mockSignOut = async () => { signOutCalled = true; };

    const mockApiClient = {
      post: async (path, body) => ({ success: true }),
      get: async (path) => {
        const err = new Error('500 Internal Server Error');
        err.status = 500;
        throw err;
      }
    };

    const sandbox = {
      localStorage: mockLocalStorage,
      auth: mockAuth,
      signOut: mockSignOut,
      signInWithEmailAndPassword: async () => mockAuth.currentUser,
      apiClient: mockApiClient,
      showToast: () => {},
      loginError: { textContent: '' },
      loginSection: { style: {} },
      adminWorkspace: { style: {} },
      stopInactivityTracker: () => {},
      startInactivityTracker: () => {},
      recordAdminActivity: () => {},
      initDashboard: () => {},
      loadAllAdminData: async () => {},
      emailInput: { value: 'admin@chipakk.shop' },
      passwordInput: { value: 'secretPassword123' },
      loginBtn: { disabled: false, textContent: 'ACCESS TERMINAL' },
      window: { crypto: { getRandomValues: (buf) => buf.fill(42) } },
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const sessionHelpers = adminJsSource.slice(
      adminJsSource.indexOf("const STORAGE_SESSION_ID_KEY"),
      adminJsSource.indexOf("// INACTIVITY AUTO-LOGOUT TRACKER")
    );

    const loginHandlerStart = adminJsSource.indexOf("loginBtn.addEventListener('click', async () => {");
    const logoutBtnMarker = adminJsSource.indexOf("const logoutBtn = document.getElementById('logout-btn');");
    const loginHandlerEnd = adminJsSource.lastIndexOf("});", logoutBtnMarker) + 3;
    const loginHandlerSrc = adminJsSource.slice(loginHandlerStart, loginHandlerEnd);

    const script = new vm.Script(`
      ${sessionHelpers}
      this.getAdminSessionId = getAdminSessionId;
      this.createNewAdminSessionId = createNewAdminSessionId;
      this.clearAdminSession = clearAdminSession;

      let clickHandler;
      const loginBtnProxy = {
        addEventListener: (event, handler) => {
          if (event === 'click') clickHandler = handler;
        }
      };
      const loginBtn = loginBtnProxy;
      (function() {
        ${loginHandlerSrc}
      })();
      this.runLogin = clickHandler;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    // Execute login with simulated 500 error on verify
    await sandbox.runLogin();

    const pendingSessionId = sandbox.getAdminSessionId();
    assert.ok(pendingSessionId, 'Pending session ID must NOT be cleared on transient 500 error');
    assert.ok(pendingSessionId.startsWith('sess_'), 'Must be a valid session ID');
    assert.strictEqual(signOutCalled, false, 'signOut must NOT be called on transient error');
    assert.strictEqual(sandbox.loginError.textContent.includes('Temporary verification failure'), true, 'Must display temporary failure message');
  });

  await test('2.7: Behavioral: Subsequent retry reuses the existing pending session ID avoiding duplicate active sessions', async () => {
    let localStorageData = {};
    const mockLocalStorage = {
      getItem: (k) => localStorageData[k] || null,
      setItem: (k, v) => { localStorageData[k] = String(v); },
      removeItem: (k) => { delete localStorageData[k]; }
    };

    let recordedSessionIds = [];
    const mockApiClient = {
      post: async (path, body) => {
        if (path === '/admin/auth/login-event') {
          recordedSessionIds.push(body.session_id);
        }
        return { success: true };
      },
      get: async (path) => {
        if (recordedSessionIds.length === 1) {
          // First attempt: network error
          const netErr = new Error('Network error / connection reset');
          throw netErr;
        }
        // Second attempt: succeeds
        return { success: true, admin: { email: 'admin@chipakk.shop' } };
      }
    };

    const sandbox = {
      localStorage: mockLocalStorage,
      auth: { currentUser: { email: 'admin@chipakk.shop' } },
      signOut: async () => {},
      signInWithEmailAndPassword: async () => ({ email: 'admin@chipakk.shop' }),
      apiClient: mockApiClient,
      showToast: () => {},
      loginError: { textContent: '' },
      loginSection: { style: {} },
      adminWorkspace: { style: {} },
      stopInactivityTracker: () => {},
      startInactivityTracker: () => {},
      recordAdminActivity: () => {},
      initDashboard: () => {},
      loadAllAdminData: async () => {},
      emailInput: { value: 'admin@chipakk.shop' },
      passwordInput: { value: 'secretPassword123' },
      loginBtn: { disabled: false, textContent: 'ACCESS TERMINAL' },
      window: { crypto: { getRandomValues: (buf) => buf.fill(7) } },
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const sessionHelpers = adminJsSource.slice(
      adminJsSource.indexOf("const STORAGE_SESSION_ID_KEY"),
      adminJsSource.indexOf("// INACTIVITY AUTO-LOGOUT TRACKER")
    );
    const loginHandlerStart = adminJsSource.indexOf("loginBtn.addEventListener('click', async () => {");
    const logoutBtnMarker = adminJsSource.indexOf("const logoutBtn = document.getElementById('logout-btn');");
    const loginHandlerEnd = adminJsSource.lastIndexOf("});", logoutBtnMarker) + 3;
    const loginHandlerSrc = adminJsSource.slice(loginHandlerStart, loginHandlerEnd);

    const script = new vm.Script(`
      ${sessionHelpers}
      this.getAdminSessionId = getAdminSessionId;
      this.createNewAdminSessionId = createNewAdminSessionId;
      this.clearAdminSession = clearAdminSession;

      let clickHandler;
      const loginBtnProxy = {
        addEventListener: (event, handler) => {
          if (event === 'click') clickHandler = handler;
        }
      };
      const loginBtn = loginBtnProxy;
      (function() {
        ${loginHandlerSrc}
      })();
      this.runLogin = clickHandler;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    // First attempt fails with transient error
    await sandbox.runLogin();
    assert.strictEqual(recordedSessionIds.length, 1);
    const firstSessionId = recordedSessionIds[0];
    assert.ok(firstSessionId);
    assert.strictEqual(sandbox.getAdminSessionId(), firstSessionId);

    // Second attempt (retry click)
    await sandbox.runLogin();
    assert.strictEqual(recordedSessionIds.length, 2);
    const retrySessionId = recordedSessionIds[1];

    // Crucial check: the retry reused the pending session ID rather than leaking a second active session
    assert.strictEqual(retrySessionId, firstSessionId, 'Retry must reuse the existing pending session ID');
    assert.strictEqual(sandbox.getAdminSessionId(), firstSessionId, 'Active session ID matches the reused ID');
    assert.strictEqual(sandbox.adminWorkspace.style.display, 'flex', 'Admin workspace displayed on successful retry');
  });

  await test('2.8: Behavioral: A 403 Access Denied clears the custom session and signs out Firebase', async () => {
    let localStorageData = {};
    const mockLocalStorage = {
      getItem: (k) => localStorageData[k] || null,
      setItem: (k, v) => { localStorageData[k] = String(v); },
      removeItem: (k) => { delete localStorageData[k]; }
    };

    let signOutCalled = false;
    const mockApiClient = {
      post: async () => {
        const err = new Error('Forbidden: Not an admin');
        err.status = 403;
        throw err;
      },
      get: async () => ({ success: true })
    };

    const sandbox = {
      localStorage: mockLocalStorage,
      auth: { currentUser: { email: 'intruder@gmail.com' } },
      signOut: async () => { signOutCalled = true; },
      signInWithEmailAndPassword: async () => ({ email: 'intruder@gmail.com' }),
      apiClient: mockApiClient,
      showToast: () => {},
      loginError: { textContent: '' },
      loginSection: { style: {} },
      adminWorkspace: { style: {} },
      stopInactivityTracker: () => {},
      startInactivityTracker: () => {},
      recordAdminActivity: () => {},
      initDashboard: () => {},
      loadAllAdminData: async () => {},
      emailInput: { value: 'intruder@gmail.com' },
      passwordInput: { value: 'intruderPassword' },
      loginBtn: { disabled: false, textContent: 'ACCESS TERMINAL' },
      window: { crypto: { getRandomValues: (buf) => buf.fill(9) } },
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const sessionHelpers = adminJsSource.slice(
      adminJsSource.indexOf("const STORAGE_SESSION_ID_KEY"),
      adminJsSource.indexOf("// INACTIVITY AUTO-LOGOUT TRACKER")
    );
    const loginHandlerStart = adminJsSource.indexOf("loginBtn.addEventListener('click', async () => {");
    const logoutBtnMarker = adminJsSource.indexOf("const logoutBtn = document.getElementById('logout-btn');");
    const loginHandlerEnd = adminJsSource.lastIndexOf("});", logoutBtnMarker) + 3;
    const loginHandlerSrc = adminJsSource.slice(loginHandlerStart, loginHandlerEnd);

    const script = new vm.Script(`
      ${sessionHelpers}
      this.getAdminSessionId = getAdminSessionId;
      this.createNewAdminSessionId = createNewAdminSessionId;
      this.clearAdminSession = clearAdminSession;

      let clickHandler;
      const loginBtnProxy = {
        addEventListener: (event, handler) => {
          if (event === 'click') clickHandler = handler;
        }
      };
      const loginBtn = loginBtnProxy;
      (function() {
        ${loginHandlerSrc}
      })();
      this.runLogin = clickHandler;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    // Attempt login with 403 response
    await sandbox.runLogin();

    assert.strictEqual(sandbox.getAdminSessionId(), null, 'Custom session must be cleared on 403');
    assert.strictEqual(signOutCalled, true, 'Firebase signOut must be called on 403');
    assert.strictEqual(sandbox.loginError.textContent.includes('Access Denied'), true);
  });

  await test('2.9: Behavioral: When login-event returns a replacement session ID, frontend persists it and uses it for verify', async () => {
    let localStorageData = {};
    const mockLocalStorage = {
      getItem: (k) => localStorageData[k] || null,
      setItem: (k, v) => { localStorageData[k] = String(v); },
      removeItem: (k) => { delete localStorageData[k]; }
    };

    let verifySessionIdSeen = null;
    const clientInitialSessionId = 'sess_colliding_client_id_001';
    const serverReplacementId = 'sess_server_assigned_replacement_999';

    const mockApiClient = {
      post: async (path, body) => {
        if (path === '/admin/auth/login-event') {
          assert.strictEqual(body.session_id, clientInitialSessionId);
          // Backend detects collision and returns replacement session ID
          return {
            success: true,
            data: {
              logged: true,
              session_id: serverReplacementId
            }
          };
        }
        return { success: true };
      },
      get: async (path) => {
        if (path === '/admin/auth/verify') {
          // Verify that localStorage contains the replacement ID before verify runs
          verifySessionIdSeen = mockLocalStorage.getItem('chipakk_admin_session_id');
          return { success: true, admin: { email: 'admin@chipakk.shop' } };
        }
        return { success: true };
      }
    };

    // Pre-populate with initial ID
    mockLocalStorage.setItem('chipakk_admin_session_id', clientInitialSessionId);

    const sandbox = {
      localStorage: mockLocalStorage,
      auth: { currentUser: { email: 'admin@chipakk.shop' } },
      signOut: async () => {},
      signInWithEmailAndPassword: async () => ({ email: 'admin@chipakk.shop' }),
      apiClient: mockApiClient,
      showToast: () => {},
      loginError: { textContent: '' },
      loginSection: { style: {} },
      adminWorkspace: { style: {} },
      stopInactivityTracker: () => {},
      startInactivityTracker: () => {},
      recordAdminActivity: () => {},
      initDashboard: () => {},
      loadAllAdminData: async () => {},
      emailInput: { value: 'admin@chipakk.shop' },
      passwordInput: { value: 'secretPassword123' },
      loginBtn: { disabled: false, textContent: 'ACCESS TERMINAL' },
      window: { crypto: { getRandomValues: (buf) => buf.fill(5) } },
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const sessionHelpers = adminJsSource.slice(
      adminJsSource.indexOf("const STORAGE_SESSION_ID_KEY"),
      adminJsSource.indexOf("// INACTIVITY AUTO-LOGOUT TRACKER")
    );
    const loginHandlerStart = adminJsSource.indexOf("loginBtn.addEventListener('click', async () => {");
    const logoutBtnMarker = adminJsSource.indexOf("const logoutBtn = document.getElementById('logout-btn');");
    const loginHandlerEnd = adminJsSource.lastIndexOf("});", logoutBtnMarker) + 3;
    const loginHandlerSrc = adminJsSource.slice(loginHandlerStart, loginHandlerEnd);

    const script = new vm.Script(`
      ${sessionHelpers}
      this.getAdminSessionId = getAdminSessionId;
      this.setAdminSessionId = setAdminSessionId;
      this.createNewAdminSessionId = createNewAdminSessionId;
      this.clearAdminSession = clearAdminSession;

      let clickHandler;
      const loginBtnProxy = {
        addEventListener: (event, handler) => {
          if (event === 'click') clickHandler = handler;
        }
      };
      const loginBtn = loginBtnProxy;
      (function() {
        ${loginHandlerSrc}
      })();
      this.runLogin = clickHandler;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    await sandbox.runLogin();

    // Verification:
    assert.strictEqual(verifySessionIdSeen, serverReplacementId, 'Verify must be called with the server-returned replacement ID rather than the original ID');
    assert.strictEqual(sandbox.getAdminSessionId(), serverReplacementId, 'Frontend must persist the server-assigned replacement ID in localStorage');
    assert.strictEqual(sandbox.adminWorkspace.style.display, 'flex', 'Admin workspace must be revealed on success');
  });

  await test('2.10: Behavioral: Database or login-event failure aborts login, avoids verify, and preserves pending session', async () => {
    let localStorageData = {};
    const mockLocalStorage = {
      getItem: (k) => localStorageData[k] || null,
      setItem: (k, v) => { localStorageData[k] = String(v); },
      removeItem: (k) => { delete localStorageData[k]; }
    };

    let verifyCalled = false;
    const pendingId = 'sess_pending_before_db_crash';
    mockLocalStorage.setItem('chipakk_admin_session_id', pendingId);

    const mockApiClient = {
      post: async (path) => {
        if (path === '/admin/auth/login-event') {
          const err = new Error('Database connection failed during session insert');
          err.status = 500;
          throw err;
        }
        return { success: true };
      },
      get: async (path) => {
        if (path === '/admin/auth/verify') {
          verifyCalled = true;
        }
        return { success: true };
      }
    };

    let signOutCalled = false;
    const sandbox = {
      localStorage: mockLocalStorage,
      auth: { currentUser: { email: 'admin@chipakk.shop' } },
      signOut: async () => { signOutCalled = true; },
      signInWithEmailAndPassword: async () => ({ email: 'admin@chipakk.shop' }),
      apiClient: mockApiClient,
      showToast: () => {},
      loginError: { textContent: '' },
      loginSection: { style: {} },
      adminWorkspace: { style: {} },
      stopInactivityTracker: () => {},
      startInactivityTracker: () => {},
      recordAdminActivity: () => {},
      initDashboard: () => {},
      loadAllAdminData: async () => {},
      emailInput: { value: 'admin@chipakk.shop' },
      passwordInput: { value: 'secretPassword123' },
      loginBtn: { disabled: false, textContent: 'ACCESS TERMINAL' },
      window: { crypto: { getRandomValues: (buf) => buf.fill(8) } },
      console: { log: () => {}, warn: () => {}, error: () => {} }
    };

    const sessionHelpers = adminJsSource.slice(
      adminJsSource.indexOf("const STORAGE_SESSION_ID_KEY"),
      adminJsSource.indexOf("// INACTIVITY AUTO-LOGOUT TRACKER")
    );
    const loginHandlerStart = adminJsSource.indexOf("loginBtn.addEventListener('click', async () => {");
    const logoutBtnMarker = adminJsSource.indexOf("const logoutBtn = document.getElementById('logout-btn');");
    const loginHandlerEnd = adminJsSource.lastIndexOf("});", logoutBtnMarker) + 3;
    const loginHandlerSrc = adminJsSource.slice(loginHandlerStart, loginHandlerEnd);

    const script = new vm.Script(`
      ${sessionHelpers}
      this.getAdminSessionId = getAdminSessionId;
      this.setAdminSessionId = setAdminSessionId;
      this.createNewAdminSessionId = createNewAdminSessionId;
      this.clearAdminSession = clearAdminSession;

      let clickHandler;
      const loginBtnProxy = {
        addEventListener: (event, handler) => {
          if (event === 'click') clickHandler = handler;
        }
      };
      const loginBtn = loginBtnProxy;
      (function() {
        ${loginHandlerSrc}
      })();
      this.runLogin = clickHandler;
    `);

    const context = vm.createContext(sandbox);
    script.runInContext(context);

    await sandbox.runLogin();

    assert.strictEqual(verifyCalled, false, 'Verify endpoint must NOT be called if login-event fails');
    assert.strictEqual(signOutCalled, false, 'signOut must NOT be called on transient database error');
    assert.strictEqual(sandbox.getAdminSessionId(), pendingId, 'Pending session ID must remain in localStorage for retry');
  });

  // ---------------------------------------------------------------------------
  // SUITE 3: INACTIVITY & MANUAL LOGOUT INTEGRITY (web/js/admin.js)
  // ---------------------------------------------------------------------------

  await test('3.1: checkInactivityState preserves session_id in request body and signs out Firebase', () => {
    const inactivityBlock = adminJsSource.slice(adminJsSource.indexOf("async function checkInactivityState()"), adminJsSource.indexOf("function startInactivityTracker()"));
    assert.ok(inactivityBlock.includes("const sessionId = getAdminSessionId();"), 'Must capture sessionId before clearing session');
    assert.ok(inactivityBlock.includes("clearAdminSession();"), 'Must clear local session');
    assert.ok(inactivityBlock.includes("session_id: sessionId, reason: 'inactivity_timeout'"), 'Must send session_id in request body');
    assert.ok(inactivityBlock.includes("signOut(auth)"), 'Must sign out Firebase');
  });

  await test('3.2: manual logoutBtn preserves session_id in request body and signs out Firebase', () => {
    const logoutBlock = adminJsSource.slice(adminJsSource.indexOf("logoutBtn.addEventListener('click'"), adminJsSource.indexOf("function initDashboard()"));
    assert.ok(logoutBlock.includes("const sessionId = getAdminSessionId();"), 'Must capture sessionId before clearing');
    assert.ok(logoutBlock.includes("clearAdminSession();"), 'Must clear session');
    assert.ok(logoutBlock.includes("session_id: sessionId, reason: 'user_action'"), 'Must send session_id in request body');
    assert.ok(logoutBlock.includes("signOut(auth)"), 'Must sign out Firebase');
  });

  await test('3.3: zero unverified destination beacons in logout paths', () => {
    assert.ok(!adminJsSource.includes('sendBeacon('), 'Must not use unverified sendBeacon');
    assert.ok(!apiJsSource.includes('sendBeacon('), 'apiClient must not use unverified sendBeacon');
  });

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('TEST SUMMARY');
  console.log('===============================================================');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Total Checks : ${results.length}`);
  console.log(`Passed       : ${passed}`);
  console.log(`Failed       : ${failed}`);

  if (failed > 0) {
    console.error('\nFAILURES ENCOUNTERED:');
    results.filter(r => !r.pass).forEach(r => console.error(` - ${r.name}: ${r.err.message}`));
    process.exit(1);
  } else {
    console.log('\nALL CREDENTIAL ISOLATION & LOGIN/LOGOUT AUDIT CHECKS PASSED!');
    process.exit(0);
  }
}

runTests();
