/**
 * Automated Test Suite: Secure Order Alert Feed for CHIPAKK & THE MARSHANS
 * tests/test_alert_feed_backend.js
 *
 * Verifies:
 * - Fix 1: First installation recovers unacknowledged orders without 24-hour cutoff
 * - Fix 2: SQL keyset pagination with 100 orders sharing the exact same timestamp
 * - Fix 3: Direct Custom Forge acknowledgment across all payment states (pending, paid, etc.)
 * - Malformed cursor validation (HTTP 400)
 * - Rate limiting enforcement (HTTP 429 & Retry-After header)
 * - Payment status updates do not trigger duplicate buzzer alerts
 * - CHIPAKK and THE MARSHANS multi-store isolation and category detection
 * - Person 1 & Person 2 personalization preservation
 * - Secret sanitization & admin route protection
 */

const assert = require('assert');
const path = require('path');
const http = require('http');
const { createFakePool, installFakePool } = require('./helpers/fake_db');
const { resetRateLimiter } = require('../server/middleware/alertRateLimiter');

const ROOT = path.join(__dirname, '..');

let passCount = 0;
let failCount = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${name} ${extra ? '— ' + extra : ''}`);
  }
}

// Test Credentials
const VALID_ALERT_KEY_1 = 'mrsh_alert_live_testkey11111111111111111111111111111111111111111111111111111111';
const VALID_ALERT_KEY_2 = 'mrsh_alert_live_testkey22222222222222222222222222222222222222222222222222222222';
const REVOKED_KEY = 'mrsh_alert_live_revokedkey9999999999999999999999999999999999999999999999999';

// Setup Mock Orders Data
let mockOrders = [];
let mockOrderItems = [];
let mockCustomForgeOrders = [];
let mockCfOrderItems = [];
let mockOrderStatusHistory = [];
let mockCfOrderStatusHistory = [];

function resetMockData() {
  mockOrders = [
    // 1. CHIPAKK Retail (Store 1) - Pending COD (Created 3 days ago: tests Fix 1 recovery)
    {
      id: 101,
      order_number: 'CHK-2026-101',
      store_id: 1,
      customer_id: 5,
      customer_name: 'Chipakk Shopper',
      customer_email: 'shopper@chipakk.shop',
      shipping_address: JSON.stringify({
        name: 'Chipakk Shopper',
        phone: '9876543210',
        address: '12 Brigade Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India'
      }),
      payment_method: 'COD',
      payment_status: 'pending',
      fulfillment_status: 'pending',
      subtotal: 500, // Rupees in Store 1
      discount_total: 50,
      shipping_charge: 50,
      total_price: 500,
      coupon_code: 'STICKER10',
      created_at: '2026-11-17 10:00:00', // 3 days ago (> 24 hours)
      updated_at: '2026-11-17 10:00:00'
    },
    // 2. THE MARSHANS Retail (Store 2) - Paid Online
    {
      id: 102,
      order_number: 'MRSH-2026-102',
      store_id: 2,
      customer_id: 6,
      customer_name: 'Marshans Collector',
      customer_email: 'collector@marshans.shop',
      shipping_address: JSON.stringify({
        name: 'Marshans Collector',
        phone: '9811122233',
        address: '45 Banjara Hills',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500034',
        country: 'India'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      fulfillment_status: 'processing',
      subtotal: 100000, // Paise in Store 2 (₹1,000)
      discount_total: 0,
      shipping_charge: 0,
      total_price: 100000,
      coupon_code: null,
      created_at: '2026-11-20 10:05:00',
      updated_at: '2026-11-20 10:05:00'
    },
    // 3. CHIPAKK Retail (Store 1) - Failed Payment
    {
      id: 103,
      order_number: 'CHK-2026-103',
      store_id: 1,
      customer_id: 7,
      customer_name: 'Late Night Buyer',
      customer_email: 'buyer@test.com',
      shipping_address: JSON.stringify({
        name: 'Late Night Buyer',
        phone: '9988776655',
        address: '99 Park St',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700016',
        country: 'India'
      }),
      payment_method: 'RAZORPAY',
      payment_status: 'failed',
      fulfillment_status: 'pending',
      subtotal: 350,
      discount_total: 0,
      shipping_charge: 50,
      total_price: 400,
      coupon_code: null,
      created_at: '2026-11-20 10:10:00',
      updated_at: '2026-11-20 10:10:00'
    }
  ];

  mockOrderItems = [
    {
      id: 1,
      order_id: 101,
      product_name: 'Neon Cyberpunk Decal',
      sku: 'CHK-NC-01',
      variant_options: 'Glossy / 3 inch',
      unit_price: 250,
      quantity: 2,
      total_price: 500
    },
    {
      id: 2,
      order_id: 102,
      product_name: 'Artisan Resin Keycap',
      sku: 'MRSH-KEY-01',
      variant_options: 'Cherry Profile',
      unit_price: 100000,
      quantity: 1,
      total_price: 100000
    },
    {
      id: 3,
      order_id: 103,
      product_name: 'Holographic Sticker',
      sku: 'CHK-HOLO-02',
      variant_options: 'Rainbow',
      unit_price: 350,
      quantity: 1,
      total_price: 350
    }
  ];

  mockCustomForgeOrders = [
    // 4. THE MARSHANS Custom Forge (Store 2) - Lady Justice 1-foot with 2 persons (PENDING payment)
    {
      id: 1,
      store_id: 2,
      order_number: 'CF-MRSH-2026-0001',
      customer_id: 8,
      customer_name: 'Advocate Verma',
      customer_email: 'verma@law.com',
      customer_phone: '9123456789',
      shipping_address: JSON.stringify({
        name: 'Advocate Verma',
        phone: '9123456789',
        address: 'Chamber 42, High Court',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110001',
        country: 'India'
      }),
      payment_method: 'ONLINE',
      payment_status: 'pending', // PENDING payment: tests Fix 3 acknowledgment
      production_status: 'order_placed',
      subtotal: 369900, // ₹3,699 in paise
      shipping_charge: 0,
      total_price: 369900,
      created_at: '2026-11-20 10:15:00',
      updated_at: '2026-11-20 10:15:00'
    }
  ];

  mockCfOrderItems = [
    {
      id: 1,
      order_id: 1,
      product_name_snapshot: 'Lady Justice',
      variant_sku_snapshot: 'MRSH-CF-LJ-1FT',
      size_label_snapshot: '1 foot',
      height_mm_snapshot: 305,
      unit_price: 369900,
      quantity: 1,
      total_price: 369900,
      custom_mode_enabled: 1,
      engraved_name: 'Advocate A. Verma',
      engraved_designation: 'Senior Advocate',
      second_customer_name: 'Advocate B. Sharma',
      second_customer_designation: 'Advocate on Record',
      nameplate_material: 'MDF'
    }
  ];

  mockOrderStatusHistory = [];
  mockCfOrderStatusHistory = [];
}

// Setup Mock Pool with full SQL Keyset & Unacknowledged Predicate Support
function setupMockDb() {
  resetMockData();

  process.env.NODE_ENV = 'development';
  process.env.ALERT_DEVICE_KEYS = `${VALID_ALERT_KEY_1},${VALID_ALERT_KEY_2}`;
  process.env.ALERT_RATE_LIMIT_DISABLED = 'true';

  const fakePool = createFakePool([
    // Check tables / columns exist
    [/SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE.*TABLE_NAME = 'custom_forge_orders'/i, () => [[{ TABLE_NAME: 'custom_forge_orders' }]]],
    [/SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES/i, () => [[{ TABLE_NAME: 'custom_forge_orders' }]]],
    [/SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE.*COLUMN_NAME = 'second_customer_name'/i, () => [[{ '1': 1 }]]],
    [/SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE.*COLUMN_NAME = 'second_customer_name'/i, () => [[{ COLUMN_NAME: 'second_customer_name' }]]],
    [/SHOW COLUMNS FROM/i, () => [[{ Field: 'second_customer_name' }]]],

    // Retail orders query
    [/SELECT.*FROM orders/i, (sql, params) => {
      let filtered = [...mockOrders];

      // Single order lookup by ID
      if (sql.includes('WHERE o.id = ?') || sql.includes('WHERE id = ?')) {
        const id = Number(params[0]);
        return [filtered.filter(o => o.id === id)];
      }

      // Store filter
      if (sql.includes('o.store_id = 1 OR o.store_id IS NULL') || sql.includes('store_id = 1')) {
        filtered = filtered.filter(o => o.store_id === 1 || !o.store_id);
      } else if (sql.includes('o.store_id = 2') || sql.includes('store_id = 2')) {
        filtered = filtered.filter(o => o.store_id === 2);
      }

      // Unacknowledged filter (First Install: Fix 1)
      if (sql.includes('NOT EXISTS (SELECT 1 FROM order_status_history osh WHERE osh.order_id = o.id AND osh.note = "ORDER_ACKNOWLEDGED")')) {
        const ackedSet = new Set(mockOrderStatusHistory.filter(h => h.note === 'ORDER_ACKNOWLEDGED').map(h => h.order_id));
        filtered = filtered.filter(o => !ackedSet.has(o.id));
      }

      // Keyset cursor predicate: ((o.created_at > ?) OR (o.created_at = ? AND o.id > ?))
      if (sql.includes('((o.created_at > ?) OR (o.created_at = ? AND o.id > ?))')) {
        const cTimeMs = new Date(String(params[0]).includes('Z') ? params[0] : String(params[0]) + 'Z').getTime();
        const cId = Number(params[2]);
        filtered = filtered.filter(o => {
          const oTimeMs = new Date(String(o.created_at).includes('Z') ? o.created_at : String(o.created_at) + 'Z').getTime();
          return oTimeMs > cTimeMs || (oTimeMs === cTimeMs && o.id > cId);
        });
      } else if (sql.includes('o.created_at >= ?')) {
        const cTimeMs = new Date(String(params[0]).includes('Z') ? params[0] : String(params[0]) + 'Z').getTime();
        filtered = filtered.filter(o => {
          const oTimeMs = new Date(String(o.created_at).includes('Z') ? o.created_at : String(o.created_at) + 'Z').getTime();
          return oTimeMs >= cTimeMs;
        });
      } else if (sql.includes('o.created_at > ?')) {
        const cTimeMs = new Date(String(params[0]).includes('Z') ? params[0] : String(params[0]) + 'Z').getTime();
        filtered = filtered.filter(o => {
          const oTimeMs = new Date(String(o.created_at).includes('Z') ? o.created_at : String(o.created_at) + 'Z').getTime();
          return oTimeMs > cTimeMs;
        });
      }

      // Sort created_at ASC, id ASC
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);

      // Check for LIMIT parameter
      const limitParam = params[params.length - 1];
      if (typeof limitParam === 'number') {
        filtered = filtered.slice(0, limitParam);
      }

      return [filtered];
    }],

    // Custom Forge orders query
    [/SELECT.*FROM custom_forge_orders o/i, (sql, params) => {
      let filtered = [...mockCustomForgeOrders];

      // Single order lookup by ID
      if (sql.includes('WHERE o.id = ?') || sql.includes('WHERE id = ?')) {
        const id = Number(params[0]);
        return [filtered.filter(o => o.id === id)];
      }

      // Store 2 filter
      filtered = filtered.filter(o => o.store_id === 2);

      // Unacknowledged filter (First Install: Fix 1)
      if (sql.includes('NOT EXISTS (SELECT 1 FROM custom_forge_order_status_history h WHERE h.order_id = o.id AND h.note = "ORDER_ACKNOWLEDGED")')) {
        const ackedSet = new Set(mockCfOrderStatusHistory.filter(h => h.note === 'ORDER_ACKNOWLEDGED').map(h => h.order_id));
        filtered = filtered.filter(o => !ackedSet.has(o.id));
      }

      // Keyset cursor predicate
      if (sql.includes('((o.created_at > ?) OR (o.created_at = ? AND o.id > ?))')) {
        const cTime = params[0];
        const cId = Number(params[2]);
        filtered = filtered.filter(o => o.created_at > cTime || (o.created_at === cTime && o.id > cId));
      } else if (sql.includes('o.created_at >= ?')) {
        const timeVal = params[0];
        filtered = filtered.filter(o => o.created_at >= timeVal);
      } else if (sql.includes('o.created_at > ?')) {
        const timeVal = params[0];
        filtered = filtered.filter(o => o.created_at > timeVal);
      }

      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);

      const limitParam = params[params.length - 1];
      if (typeof limitParam === 'number') {
        filtered = filtered.slice(0, limitParam);
      }

      return [filtered];
    }],

    // Retail line items
    [/SELECT.*FROM order_items oi WHERE oi\.order_id IN/i, (sql, params) => {
      const ids = params.map(Number);
      const items = mockOrderItems.filter(it => ids.includes(it.order_id));
      return [items];
    }],

    // Custom Forge line items
    [/SELECT.*FROM custom_forge_order_items oi/i, (sql, params) => {
      const ids = params.map(Number);
      const items = mockCfOrderItems.filter(it => ids.includes(it.order_id));
      return [items];
    }],

    // Status history check for retail
    [/SELECT.*FROM order_status_history WHERE/i, (sql, params) => {
      if (sql.includes('order_id = ? AND note = "ORDER_ACKNOWLEDGED"')) {
        const rId = Number(params[0]);
        const exists = mockOrderStatusHistory.some(h => h.order_id === rId && h.note === 'ORDER_ACKNOWLEDGED');
        return exists ? [[{ id: 1 }]] : [[]];
      }
      const ids = params.map(Number);
      const found = mockOrderStatusHistory.filter(h => ids.includes(h.order_id) && h.note === 'ORDER_ACKNOWLEDGED');
      return [found.map(f => ({ order_id: f.order_id }))];
    }],

    // Status history check for CF
    [/SELECT.*FROM custom_forge_order_status_history WHERE/i, (sql, params) => {
      if (sql.includes('order_id = ? AND note = "ORDER_ACKNOWLEDGED"')) {
        const cfId = Number(params[0]);
        const exists = mockCfOrderStatusHistory.some(h => h.order_id === cfId && h.note === 'ORDER_ACKNOWLEDGED');
        return exists ? [[{ id: 1 }]] : [[]];
      }
      const ids = params.map(Number);
      const found = mockCfOrderStatusHistory.filter(h => ids.includes(h.order_id) && h.note === 'ORDER_ACKNOWLEDGED');
      return [found.map(f => ({ order_id: f.order_id }))];
    }],

    // Insert history for retail
    [/INSERT INTO order_status_history/i, (sql, params) => {
      mockOrderStatusHistory.push({
        id: mockOrderStatusHistory.length + 1,
        order_id: params[0],
        status: params[1],
        changed_by: params[2],
        note: params[3] || 'ORDER_ACKNOWLEDGED'
      });
      return [{ insertId: mockOrderStatusHistory.length }];
    }],

    // Insert history for CF (Fix 3: Direct CF acknowledgment)
    [/INSERT INTO custom_forge_order_status_history/i, (sql, params) => {
      mockCfOrderStatusHistory.push({
        id: mockCfOrderStatusHistory.length + 1,
        order_id: params[0],
        previous_status: params[1],
        new_status: params[2],
        changed_by: params[3],
        note: params[4] || 'ORDER_ACKNOWLEDGED'
      });
      return [{ insertId: mockCfOrderStatusHistory.length }];
    }]
  ]);

  installFakePool(fakePool);
}

function clearAppCache() {
  const modulesToClear = [
    'server/app.js',
    'server/routes/alerts.js',
    'server/routes/admin.js',
    'server/middleware/alertAuth.js',
    'server/middleware/alertRateLimiter.js',
    'server/controllers/alertController.js',
    'server/services/alertFeedService.js'
  ];
  for (const m of modulesToClear) {
    try {
      delete require.cache[require.resolve(path.join(ROOT, m))];
    } catch (_) {}
  }
}

function makeRequest(server, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: body });
        }
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=================================================================');
  console.log('🚨  SECURE ORDER ALERT FEED TEST SUITE (DEFECT FIXES & AUDIT)');
  console.log('=================================================================\n');

  setupMockDb();
  clearAppCache();

  const app = require('../server/app');
  const server = http.createServer(app);

  await new Promise(res => server.listen(0, res));

  try {
    // =========================================================================
    // SUITE 1: AUTHENTICATION & ACCESS CONTROL
    // =========================================================================
    console.log('--- SUITE 1: AUTHENTICATION & ACCESS CONTROL ---');

    const resNoAuth = await makeRequest(server, '/api/alerts/feed');
    check('1.1 Missing auth header rejected with 401', resNoAuth.status === 401);

    const resInvalid = await makeRequest(server, '/api/alerts/feed', {
      headers: { Authorization: 'Bearer invalid_bogus_key' }
    });
    check('1.2 Invalid key rejected with 401', resInvalid.status === 401);

    const resRevoked = await makeRequest(server, '/api/alerts/feed', {
      headers: { Authorization: `Bearer ${REVOKED_KEY}` }
    });
    check('1.3 Revoked key rejected with 401', resRevoked.status === 401);

    const resAuth1 = await makeRequest(server, '/api/alerts/health', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    check('1.4 Valid key #1 accepted on /api/alerts/health', resAuth1.status === 200 && resAuth1.body?.data?.status === 'online');

    const resAuth2 = await makeRequest(server, '/api/alerts/health', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_2}` }
    });
    check('1.5 Valid rotated key #2 accepted', resAuth2.status === 200);

    const resCustomHeader = await makeRequest(server, '/api/alerts/health', {
      headers: { 'X-Alert-Device-Key': VALID_ALERT_KEY_1 }
    });
    check('1.6 Custom X-Alert-Device-Key header accepted', resCustomHeader.status === 200);

    const resAdminForbidden = await makeRequest(server, '/api/admin/orders', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    check('1.7 Alert credential cannot access Admin APIs (401)', resAdminForbidden.status === 401);

    // =========================================================================
    // SUITE 2: FIX 1 — FIRST INSTALLATION WITHOUT 24-HOUR CUTOFF
    // =========================================================================
    console.log('\n--- SUITE 2: FIX 1 — FIRST INSTALLATION & HISTORICAL RECOVERY ---');

    // Call GET /api/alerts/feed with NO cursor and NO since parameter
    const resFirstInstall = await makeRequest(server, '/api/alerts/feed', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });

    check('2.1 First install returned HTTP 200', resFirstInstall.status === 200);
    const firstInstallOrders = resFirstInstall.body?.data?.orders || [];

    // Order 101 was created on 2026-11-17 (3 days ago). It MUST be returned because it is unacknowledged!
    const recoveredOldOrder = firstInstallOrders.find(o => o.order_number === 'CHK-2026-101');
    check('2.2 Order 101 (>24 hours old) recovered on first installation', Boolean(recoveredOldOrder));
    check('2.3 Recovered order is unacknowledged (is_acknowledged = false)', recoveredOldOrder?.is_acknowledged === false);
    check('2.4 All 4 unacknowledged orders returned on clean install', firstInstallOrders.length === 4);

    // Acknowledge Order 101
    await makeRequest(server, '/api/alerts/acknowledge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` },
      body: { feed_ids: ['retail_101'] }
    });

    // Re-call first installation endpoint (no cursor, no since)
    const resAfterAck = await makeRequest(server, '/api/alerts/feed', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const remainingUnacked = resAfterAck.body?.data?.orders || [];
    check('2.5 Acknowledged order 101 omitted from first install queue', !remainingUnacked.some(o => o.order_number === 'CHK-2026-101'));
    check('2.6 Remaining unacknowledged orders present (3 orders)', remainingUnacked.length === 3);

    // Re-call with explicit ?since=2026-11-16T00:00:00Z: should include order 101 because since was explicitly requested
    const resExplicitSince = await makeRequest(server, '/api/alerts/feed?since=2026-11-16T00:00:00Z', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const explicitOrders = resExplicitSince.body?.data?.orders || [];
    const foundWithSince = explicitOrders.find(o => o.order_number === 'CHK-2026-101');
    check('2.7 Explicit ?since includes acknowledged order 101 with is_acknowledged = true', foundWithSince?.is_acknowledged === true);

    // =========================================================================
    // SUITE 3: FIX 2 — SQL KEYSET PAGINATION WITH 100 IDENTICAL-TIMESTAMP ORDERS
    // =========================================================================
    console.log('\n--- SUITE 3: FIX 2 — 100 ORDERS SHARING EXACT SAME TIMESTAMP ---');

    // Create 100 retail orders all with the EXACT SAME TIMESTAMP
    const sharedTimestamp = '2026-11-20T12:00:00.000Z';
    const burstOrders = [];
    for (let i = 1; i <= 100; i++) {
      burstOrders.push({
        id: 1000 + i,
        order_number: `BURST-ORD-${i}`,
        store_id: 1,
        customer_id: 100,
        customer_name: `Burst Customer ${i}`,
        customer_email: `burst${i}@test.com`,
        shipping_address: JSON.stringify({ name: `Burst Customer ${i}`, city: 'Hyderabad', pincode: '500001' }),
        payment_method: 'ONLINE',
        payment_status: 'paid',
        fulfillment_status: 'pending',
        subtotal: 100,
        discount_total: 0,
        shipping_charge: 0,
        total_price: 100,
        created_at: sharedTimestamp,
        updated_at: sharedTimestamp
      });
    }

    // Save existing mockOrders and replace with burstOrders
    const savedMockOrders = mockOrders;
    mockOrders = burstOrders;

    // Fetch Page 1: limit = 50
    const resBurstPage1 = await makeRequest(server, `/api/alerts/feed?since=2026-11-20T12:00:00Z&limit=50`, {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const burstP1 = resBurstPage1.body?.data?.orders || [];
    check('3.1 Burst Page 1 returned exactly 50 orders', burstP1.length === 50);
    check('3.2 Burst Page 1 has_more is true', resBurstPage1.body?.data?.pagination?.has_more === true);
    check('3.3 Burst Page 1 first order is BURST-ORD-1', burstP1[0]?.order_number === 'BURST-ORD-1');
    check('3.4 Burst Page 1 last order is BURST-ORD-50', burstP1[49]?.order_number === 'BURST-ORD-50');

    const burstCursor1 = resBurstPage1.body?.data?.pagination?.next_cursor;
    check('3.5 Burst Page 1 next_cursor populated', Boolean(burstCursor1));

    // Fetch Page 2: with cursor from page 1, limit = 50
    const resBurstPage2 = await makeRequest(server, `/api/alerts/feed?cursor=${encodeURIComponent(burstCursor1)}&limit=50`, {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const burstP2 = resBurstPage2.body?.data?.orders || [];
    check('3.6 Burst Page 2 returned exactly 50 orders', burstP2.length === 50);
    check('3.7 Burst Page 2 first order is BURST-ORD-51', burstP2[0]?.order_number === 'BURST-ORD-51');
    check('3.8 Burst Page 2 last order is BURST-ORD-100', burstP2[49]?.order_number === 'BURST-ORD-100');
    check('3.9 Burst Page 2 has_more is false', resBurstPage2.body?.data?.pagination?.has_more === false);

    // Verify 0 overlaps between Page 1 and Page 2
    const p1Ids = new Set(burstP1.map(o => o.order_id));
    const p2Ids = new Set(burstP2.map(o => o.order_id));
    const overlap = burstP2.filter(o => p1Ids.has(o.order_id));
    check('3.10 Zero duplicate orders between Page 1 and Page 2', overlap.length === 0);

    // Verify total unique count is exactly 100
    const allRetrievedIds = new Set([...p1Ids, ...p2Ids]);
    check('3.11 Exactly 100 unique orders retrieved across pages (none lost)', allRetrievedIds.size === 100);

    // Fetch Page 3: with cursor from page 2
    const burstCursor2 = resBurstPage2.body?.data?.pagination?.next_cursor;
    const resBurstPage3 = await makeRequest(server, `/api/alerts/feed?cursor=${encodeURIComponent(burstCursor2)}&limit=50`, {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const burstP3 = resBurstPage3.body?.data?.orders || [];
    check('3.12 Burst Page 3 returns 0 orders', burstP3.length === 0);
    check('3.13 Burst Page 3 has_more is false', resBurstPage3.body?.data?.pagination?.has_more === false);

    // Restore standard mockOrders
    mockOrders = savedMockOrders;

    // =========================================================================
    // SUITE 4: FIX 3 — DIRECT ACKNOWLEDGMENT OF PENDING CUSTOM FORGE ORDERS
    // =========================================================================
    console.log('\n--- SUITE 4: FIX 3 — PENDING CUSTOM FORGE ACKNOWLEDGMENT ---');

    // CF order 1 has payment_status: 'pending'. Verify it was detected in feed
    const resCfFeedBefore = await makeRequest(server, '/api/alerts/feed?since=2026-11-20T00:00:00Z', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const cfBefore = resCfFeedBefore.body?.data?.orders?.find(o => o.order_number === 'CF-MRSH-2026-0001');
    check('4.1 Pending Custom Forge order detected in feed', Boolean(cfBefore));
    check('4.2 Pending Custom Forge payment_status is pending', cfBefore?.payment.status === 'pending');
    check('4.3 Pending Custom Forge is initially unacknowledged', cfBefore?.is_acknowledged === false);

    // Acknowledge the pending Custom Forge order via /api/alerts/acknowledge
    const resAckCf = await makeRequest(server, '/api/alerts/acknowledge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` },
      body: {
        feed_ids: ['custom_forge_1'],
        actor: 'Alert Test Suite'
      }
    });

    check('4.4 Acknowledge endpoint returned HTTP 200', resAckCf.status === 200);
    check('4.5 Acknowledged CF ID 1 in response', resAckCf.body?.data?.acknowledged_custom_forge_ids?.includes(1));

    // Verify CF history record was written with ORDER_ACKNOWLEDGED
    const cfHistEntry = mockCfOrderStatusHistory.find(h => h.order_id === 1 && h.note === 'ORDER_ACKNOWLEDGED');
    check('4.6 custom_forge_order_status_history received ORDER_ACKNOWLEDGED record', Boolean(cfHistEntry));
    check('4.7 Changed by recorded correctly', cfHistEntry?.changed_by === 'Alert Test Suite');

    // Re-query feed: verify is_acknowledged = true
    const resCfFeedAfter = await makeRequest(server, '/api/alerts/feed?since=2026-11-20T00:00:00Z', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const cfAfter = resCfFeedAfter.body?.data?.orders?.find(o => o.order_number === 'CF-MRSH-2026-0001');
    check('4.8 Pending Custom Forge order now marked is_acknowledged = true', cfAfter?.is_acknowledged === true);
    check('4.9 Custom Forge production_status unchanged (remains order_placed)', cfAfter?.production_status === 'order_placed');
    check('4.10 Custom Forge payment_status unchanged (remains pending)', cfAfter?.payment.status === 'pending');

    // Test retry safety (idempotency)
    const resAckRetry = await makeRequest(server, '/api/alerts/acknowledge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` },
      body: { feed_ids: ['custom_forge_1'] }
    });
    check('4.11 Acknowledgment retry returned HTTP 200', resAckRetry.status === 200);
    check('4.12 No duplicate history record created on retry', mockCfOrderStatusHistory.filter(h => h.order_id === 1).length === 1);

    // =========================================================================
    // SUITE 5: MALFORMED CURSOR VALIDATION
    // =========================================================================
    console.log('\n--- SUITE 5: MALFORMED CURSOR VALIDATION ---');

    const resBadCursor1 = await makeRequest(server, '/api/alerts/feed?cursor=malformed_non_iso_string', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    check('5.1 Non-ISO cursor rejected with HTTP 400', resBadCursor1.status === 400);
    check('5.2 Error code is ALERT_CURSOR_MALFORMED', resBadCursor1.body?.error?.details === 'ALERT_CURSOR_MALFORMED');

    const resBadCursor2 = await makeRequest(server, '/api/alerts/feed?cursor=2026-11-20T10:00:00.000Z_unknown_1', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    check('5.3 Unknown feed prefix rejected with HTTP 400', resBadCursor2.status === 400);

    const resBadCursor3 = await makeRequest(server, '/api/alerts/feed?cursor=2026-11-20T10:00:00.000Z_retail_abc', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    check('5.4 Non-numeric order ID rejected with HTTP 400', resBadCursor3.status === 400);

    // =========================================================================
    // SUITE 6: RATE LIMITER ENFORCEMENT & HTTP 429
    // =========================================================================
    console.log('\n--- SUITE 6: RATE LIMITER ENFORCEMENT & HTTP 429 ---');

    // Enable rate limiter with tight limit for testing (4 requests per minute)
    process.env.ALERT_RATE_LIMIT_DISABLED = 'false';
    process.env.ALERT_RATE_LIMIT_PER_MINUTE = '4';
    resetRateLimiter();

    const rateLimitHeaders = { Authorization: `Bearer ${VALID_ALERT_KEY_1}`, 'X-Forwarded-For': '198.51.100.42' };

    const r1 = await makeRequest(server, '/api/alerts/health', { headers: rateLimitHeaders });
    const r2 = await makeRequest(server, '/api/alerts/health', { headers: rateLimitHeaders });
    const r3 = await makeRequest(server, '/api/alerts/health', { headers: rateLimitHeaders });
    const r4 = await makeRequest(server, '/api/alerts/health', { headers: rateLimitHeaders });
    check('6.1 Requests 1-4 within limit succeed with 200', r1.status === 200 && r2.status === 200 && r3.status === 200 && r4.status === 200);

    // 5th request should be throttled
    const r5 = await makeRequest(server, '/api/alerts/health', { headers: rateLimitHeaders });
    check('6.2 5th request throttled with HTTP 429 Too Many Requests', r5.status === 429);
    check('6.3 Throttled response includes Retry-After header', Boolean(r5.headers['retry-after']));
    check('6.4 Error code is ALERT_RATE_LIMITED', r5.body?.error?.details === 'ALERT_RATE_LIMITED');

    // Reset rate limiter & disable for subsequent tests
    process.env.ALERT_RATE_LIMIT_DISABLED = 'true';
    resetRateLimiter();

    // =========================================================================
    // SUITE 7: PAYMENT STATUS UPDATE IMMUNITY (NO PHANTOM BUZZER)
    // =========================================================================
    console.log('\n--- SUITE 7: PAYMENT STATUS UPDATE IMMUNITY ---');

    // Get active cursor after order 103
    const resInitialFeed = await makeRequest(server, '/api/alerts/feed?since=2026-11-20T00:00:00Z', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const lastOrder = resInitialFeed.body?.data?.orders?.[resInitialFeed.body?.data?.orders?.length - 1];
    const feedCursor = resInitialFeed.body?.data?.pagination?.next_cursor;

    // Order 103 transitions from failed to paid
    const order103 = mockOrders.find(o => o.id === 103);
    order103.payment_status = 'paid';
    order103.updated_at = '2026-11-20 16:00:00'; // updated_at advanced, created_at strictly unchanged

    // Poll with feedCursor
    const resAfterPaymentUpdate = await makeRequest(server, `/api/alerts/feed?cursor=${encodeURIComponent(feedCursor)}`, {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const ordersAfterUpdate = resAfterPaymentUpdate.body?.data?.orders || [];

    check('7.1 Updated order 103 does NOT re-appear after cursor', !ordersAfterUpdate.some(o => o.id === 103));
    check('7.2 Feed returns 0 new orders (zero phantom buzzer on payment transition)', ordersAfterUpdate.length === 0);

    // =========================================================================
    // SUITE 8: MULTI-STORE LABELS, PERSONALIZATION & DATA SANITIZATION
    // =========================================================================
    console.log('\n--- SUITE 8: STORE LABELS, PERSONALIZATION & SECRET SANITIZATION ---');

    const resSanitize = await makeRequest(server, '/api/alerts/feed?since=2026-11-16T00:00:00Z', {
      headers: { Authorization: `Bearer ${VALID_ALERT_KEY_1}` }
    });
    const allOrders = resSanitize.body?.data?.orders || [];

    const chipakkOrder = allOrders.find(o => o.order_number === 'CHK-2026-101');
    check('8.1 CHIPAKK Retail store.id is 1', chipakkOrder?.store?.id === 1);
    check('8.2 CHIPAKK Retail price is in rupees (₹500)', chipakkOrder?.pricing?.total_price_rupees === 500);

    const marshansOrder = allOrders.find(o => o.order_number === 'MRSH-2026-102');
    check('8.3 THE MARSHANS Retail store.id is 2', marshansOrder?.store?.id === 2);
    check('8.4 THE MARSHANS Retail converted from paise to rupees (₹1,000)', marshansOrder?.pricing?.total_price_rupees === 1000);

    const cfOrder = allOrders.find(o => o.order_number === 'CF-MRSH-2026-0001');
    check('8.5 Custom Forge store.id is 2', cfOrder?.store?.id === 2);
    check('8.6 Custom Forge price converted from paise to rupees (₹3,699)', cfOrder?.pricing?.total_price_rupees === 3699);

    const cfItem = cfOrder?.items?.[0];
    check('8.7 Custom Forge Person 1 name matches', cfItem?.customization?.name === 'Advocate A. Verma');
    check('8.8 Custom Forge Person 1 designation matches', cfItem?.customization?.designation === 'Senior Advocate');
    check('8.9 Custom Forge Person 2 name matches', cfItem?.customization?.second_name === 'Advocate B. Sharma');
    check('8.10 Custom Forge Person 2 designation matches', cfItem?.customization?.second_designation === 'Advocate on Record');
    check('8.11 Custom Forge nameplate material is MDF', cfItem?.customization?.material === 'MDF');

    for (const ord of allOrders) {
      check(`8.12 Order ${ord.order_number} exposes zero internal passwords/tokens`,
        ord.db_password === undefined && ord.gateway_secret === undefined && ord.api_key === undefined
      );
    }

  } finally {
    server.close();
  }

  console.log('\n=================================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('=================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
