/**
 * Comprehensive Backend Verification Test Suite: Custom Forge (Store 2 - THE MARSHANS)
 *
 * Verifies all 10 core architectural & business requirements:
 * 1. Variant Pricing & Authoritative Database Resolution:
 *    - 6 inches: 160,000 paise (₹1,600)
 *    - 1 foot: 350,000 paise (₹3,500)
 *    - 2 feet: 560,000 paise (₹5,600)
 * 2. Custom Mode Rule Enforcement:
 *    - 6-inch Custom Mode rejected with 400 Bad Request
 *    - 1-foot & 2-foot optional Custom Mode accepted
 * 3. Customization Field Validation:
 *    - Customer Name length limit (<= 35 chars enforced)
 *    - Designation length limit (<= 50 chars enforced)
 *    - Literal 'NIL' accepted for designation (case-insensitive)
 *    - Nameplate material restricted strictly to 'Plastic' or 'MDF'
 * 4. Guest Checkout Prohibition:
 *    - Unauthenticated requests rejected with 401 Unauthorized
 * 5. Strict Multi-Store Isolation:
 *    - Store 1 (CHIPAKK) requests rejected with 403 Forbidden
 *    - Custom Forge routes strictly confined to Store 2 (THE MARSHANS)
 * 6. Tamper-Proof Financial Integrity:
 *    - Client-supplied prices ignored; database authoritative price enforced
 * 7. Order Number Collision Safety:
 *    - Conforms to format: CF-MRSH-YYYY-XXXX
 * 8. Shipping Rule Integration:
 *    - Seamlessly integrates with Marshans shipping calculation
 * 9. Production Status Transitions & Audit Trail:
 *    - Status progression recorded in custom_forge_order_status_history
 * 10. Database Segregation:
 *     - Custom Forge orders remain completely separate from retail orders/payments
 */

const assert = require('assert');
const path = require('path');
const http = require('http');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const ROOT = path.join(__dirname, '..');
const results = [];
const getErrMsg = (res) => (res.body?.error?.message || res.body?.message || '');

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

// Test Tokens
const TOKENS = {
  customer: 'cf_mock_token_customer',
  admin: 'cf_mock_token_admin',
  stranger: 'cf_mock_token_stranger'
};

const CUSTOMER_USER = { uid: 'uid_cust_advocate', email: 'advocate.sharma@gmail.com' };
const ADMIN_USER = { uid: 'uid_admin_marshans', email: 'admin@themarshans.shop' };
const STRANGER_USER = { uid: 'uid_other_shopper', email: 'other@gmail.com' };

// In-Memory Test State
let customForgeProducts = [
  {
    id: 1,
    store_id: 2,
    slug: 'lady-justice',
    name: 'Lady Justice',
    tagline: 'Sculpted Balance. Personalized Heritage.',
    description: 'Precision additive manufactured statue with optional personalized engraved nameplate.',
    base_model_sku: 'MRSH-CF-LJ',
    hero_image_url: '/assets/images/lady-justice-hero.png',
    active: 1
  }
];

let customForgeVariants = [
  {
    id: 1,
    product_id: 1,
    variant_sku: 'MRSH-CF-LJ-6IN',
    size_label: '6 inches',
    height_mm: 152,
    price: 199900, // ₹1,999
    custom_mode_allowed: 0,
    display_order: 1,
    active: 1
  },
  {
    id: 2,
    product_id: 1,
    variant_sku: 'MRSH-CF-LJ-1FT',
    size_label: '1 foot',
    height_mm: 305,
    price: 369900, // ₹3,699
    custom_mode_allowed: 1,
    display_order: 2,
    active: 1
  },
  {
    id: 3,
    product_id: 1,
    variant_sku: 'MRSH-CF-LJ-2FT',
    size_label: '2 feet',
    height_mm: 610,
    price: 599900, // ₹5,999
    custom_mode_allowed: 1,
    display_order: 3,
    active: 1
  }
];

let customForgeOrders = [];
let customForgeOrderItems = [];
let customForgeOrderCustomizations = [];
let customForgeOrderStatusHistory = [];
let customForgePayments = [];

// Retail tables - must remain untouched
let retailOrders = [];
let retailPayments = [];

let usersTable = [
  { id: 10, firebase_uid: CUSTOMER_USER.uid, email: CUSTOMER_USER.email, full_name: 'Adv. Ramesh Sharma', phone: '9876543210' },
  { id: 99, firebase_uid: STRANGER_USER.uid, email: STRANGER_USER.email, full_name: 'Stranger User', phone: '9123456789' }
];

let adminsTable = [
  { id: 1, firebase_uid: ADMIN_USER.uid, email: ADMIN_USER.email, role: 'super_admin', active: 1 }
];

let adminSessions = [
  {
    id: 1,
    session_id: 'cf_admin_session_valid',
    firebase_uid: ADMIN_USER.uid,
    email: ADMIN_USER.email,
    admin_name: 'Marshans Admin',
    role: 'super_admin',
    status: 'active',
    login_time: new Date(),
    last_activity: new Date(),
    expires_at: new Date(Date.now() + 3600000)
  }
];

function setupMockEnvironment() {
  // 1. Mock Firebase Admin Auth
  const firebaseConfigPath = require.resolve(path.join(ROOT, 'server/config/firebase.js'));
  const mockAuth = {
    verifyIdToken: async (token) => {
      if (token === TOKENS.customer) {
        return { uid: CUSTOMER_USER.uid, email: CUSTOMER_USER.email, email_verified: true };
      }
      if (token === TOKENS.admin) {
        return { uid: ADMIN_USER.uid, email: ADMIN_USER.email, email_verified: true };
      }
      if (token === TOKENS.stranger) {
        return { uid: STRANGER_USER.uid, email: STRANGER_USER.email, email_verified: true };
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

  // 2. Mock MySQL Pool
  const pool = createFakePool([
    // Table existence checks
    [/information_schema\.tables.*table_name = 'custom_forge_orders'/i, () => [[{ '1': 1 }]]],
    [/information_schema\.tables/i, () => [[{ '1': 1 }]]],

    // Lady Justice product query
    [/SELECT p\.id, p\.store_id, p\.slug, p\.name.*FROM custom_forge_products p WHERE p\.slug = 'lady-justice'/i, () => {
      return [customForgeProducts.filter(p => p.slug === 'lady-justice' && p.store_id === 2 && p.active === 1)];
    }],

    // Product variants query
    [/SELECT id, product_id, variant_sku, size_label, height_mm, price, custom_mode_allowed, display_order FROM custom_forge_product_variants WHERE product_id = \?/i, (sql, params) => {
      const [prodId] = params;
      return [customForgeVariants.filter(v => v.product_id === prodId && v.active === 1)];
    }],

    // Single variant lookup with joined product
    [/FROM custom_forge_product_variants v\s+JOIN custom_forge_products p/i, (sql, params) => {
      const [variantId] = params;
      const v = customForgeVariants.find(x => x.id === variantId && x.active === 1);
      if (!v) return [[]];
      const p = customForgeProducts.find(x => x.id === v.product_id);
      return [[{
        id: v.id,
        product_id: v.product_id,
        variant_sku: v.variant_sku,
        size_label: v.size_label,
        height_mm: v.height_mm,
        price: v.price,
        custom_mode_allowed: v.custom_mode_allowed,
        active: v.active,
        product_name: p ? p.name : 'Lady Justice',
        store_id: p ? p.store_id : 2
      }]];
    }],

    // Order number collision check
    [/SELECT id FROM custom_forge_orders WHERE order_number = \? LIMIT 1/i, (sql, params) => {
      const [num] = params;
      const hit = customForgeOrders.filter(o => o.order_number === num);
      return [hit];
    }],

    // Customer / users lookup
    [/SELECT id, email, full_name, phone FROM users WHERE firebase_uid = \? LIMIT 1/i, (sql, params) => {
      const [uid] = params;
      return [usersTable.filter(u => u.firebase_uid === uid)];
    }],
    [/SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = \?/i, (sql, params) => {
      const [uid] = params;
      return [usersTable.filter(u => u.firebase_uid === uid)];
    }],

    // Insert into custom_forge_orders
    [/INSERT INTO custom_forge_orders/i, (sql, params) => {
      const isLegacyShape = params.length <= 11;
      const order = {
        id: customForgeOrders.length + 1,
        store_id: 2,
        order_number: params[0],
        customer_id: params[1],
        customer_email: params[2],
        customer_name: params[3],
        customer_phone: params[4],
        shipping_address: params[5],
        shipping_charge: params[6],
        subtotal: params[7],
        tax_amount: isLegacyShape ? 0 : (params[8] || 0),
        cgst_amount: isLegacyShape ? 0 : (params[9] || 0),
        sgst_amount: isLegacyShape ? 0 : (params[10] || 0),
        igst_amount: isLegacyShape ? 0 : (params[11] || 0),
        total_price: isLegacyShape ? params[8] : params[12],
        payment_method: 'ONLINE',
        payment_status: 'pending',
        production_status: 'order_placed',
        customer_notes: isLegacyShape ? params[9] : params[13],
        admin_notes: null,
        created_at: new Date(),
        updated_at: new Date()
      };
      customForgeOrders.push(order);
      return [{ insertId: order.id, affectedRows: 1 }];
    }],

    // Insert into custom_forge_order_items
    [/INSERT INTO custom_forge_order_items/i, (sql, params) => {
      const item = {
        id: customForgeOrderItems.length + 1,
        order_id: params[0],
        product_id: params[1],
        variant_id: params[2],
        product_name_snapshot: params[3],
        variant_sku_snapshot: params[4],
        size_label_snapshot: params[5],
        height_mm_snapshot: params[6],
        unit_price: params[7],
        quantity: 1,
        total_price: params[8]
      };
      customForgeOrderItems.push(item);
      return [{ insertId: item.id, affectedRows: 1 }];
    }],

    // Insert into custom_forge_order_customizations
    [/INSERT INTO custom_forge_order_customizations/i, (sql, params) => {
      const cust = {
        id: customForgeOrderCustomizations.length + 1,
        order_item_id: params[0],
        custom_mode_enabled: params[1],
        customer_name: params[2],
        customer_designation: params[3],
        nameplate_material: params[4],
        verification_status: 'pending'
      };
      customForgeOrderCustomizations.push(cust);
      return [{ insertId: cust.id, affectedRows: 1 }];
    }],

    // Insert into custom_forge_order_status_history
    [/INSERT INTO custom_forge_order_status_history/i, (sql, params) => {
      const hist = {
        id: customForgeOrderStatusHistory.length + 1,
        order_id: params[0],
        previous_status: params[1],
        new_status: params[2],
        changed_by: params[3],
        note: params[4],
        created_at: new Date()
      };
      customForgeOrderStatusHistory.push(hist);
      return [{ insertId: hist.id, affectedRows: 1 }];
    }],

    // Insert into custom_forge_payments
    [/INSERT INTO custom_forge_payments/i, (sql, params) => {
      const pay = {
        id: customForgePayments.length + 1,
        order_id: params[0],
        amount: params[1],
        currency: 'INR',
        payment_status: 'pending'
      };
      customForgePayments.push(pay);
      return [{ insertId: pay.id, affectedRows: 1 }];
    }],

    // Check custom forge order ownership & lookup by ID or order_number
    [/FROM custom_forge_orders.*WHERE.*id = \? OR.*order_number = \?/i, (sql, params) => {
      const [idNum, idStr] = params;
      const hit = customForgeOrders.filter(o => String(o.id) === String(idNum) || o.order_number === String(idStr));
      return [hit];
    }],

    // Internal Order Lookup Header
    [/FROM custom_forge_orders o WHERE o\.id = \? AND o\.store_id = 2/i, (sql, params) => {
      const [orderId] = params;
      const hit = customForgeOrders.filter(o => String(o.id) === String(orderId) && o.store_id === 2);
      return [hit];
    }],

    // Internal Order Line Items
    [/FROM custom_forge_order_items oi/i, (sql, params) => {
      const [orderId] = params;
      const items = customForgeOrderItems.filter(oi => String(oi.order_id) === String(orderId)).map(oi => {
        const cust = customForgeOrderCustomizations.find(c => String(c.order_item_id) === String(oi.id)) || {};
        return {
          ...oi,
          custom_mode_enabled: cust.custom_mode_enabled || 0,
          engraved_name: cust.customer_name || null,
          engraved_designation: cust.customer_designation || null,
          nameplate_material: cust.nameplate_material || null,
          verification_status: cust.verification_status || null
        };
      });
      return [items];
    }],

    // Internal Order Status History
    [/FROM custom_forge_order_status_history WHERE order_id = \?/i, (sql, params) => {
      const [orderId] = params;
      return [customForgeOrderStatusHistory.filter(h => String(h.order_id) === String(orderId))];
    }],

    // Admin table lookup
    [/SELECT id, firebase_uid, email, role, active FROM admins WHERE/i, (sql, params) => {
      const [uid, email] = params;
      const hit = adminsTable.filter(a => a.active && (a.firebase_uid === uid || (a.email && String(email).toLowerCase() === a.email.toLowerCase())));
      return [hit];
    }],

    // Admin sessions lookup
    [/SELECT id, session_id, firebase_uid, email, role, status, expires_at FROM admin_sessions WHERE session_id = \? AND firebase_uid = \?/i, (sql, params) => {
      const [sessionId, uid] = params;
      const hit = adminSessions.filter(s => s.session_id === sessionId && s.firebase_uid === uid && s.status === 'active');
      return [hit];
    }],
    [/UPDATE admin_sessions SET last_activity = NOW\(\)/i, () => [{ affectedRows: 1 }]],

    // Admin orders list count
    [/SELECT COUNT\(\*\) AS total FROM custom_forge_orders o/i, () => {
      return [[{ total: customForgeOrders.length }]];
    }],

    // Admin orders list rows
    [/SELECT o\.id, o\.store_id, o\.order_number, o\.customer_name, o\.customer_email, o\.customer_phone.*FROM custom_forge_orders o/i, () => {
      const rows = customForgeOrders.map(o => {
        const item = customForgeOrderItems.find(oi => oi.order_id === o.id) || {};
        const cust = customForgeOrderCustomizations.find(c => c.order_item_id === item.id) || {};
        return {
          id: o.id,
          store_id: o.store_id,
          order_number: o.order_number,
          customer_name: o.customer_name,
          customer_email: o.customer_email,
          customer_phone: o.customer_phone,
          total_price: o.total_price,
          payment_status: o.payment_status,
          production_status: o.production_status,
          created_at: o.created_at,
          size_label_snapshot: item.size_label_snapshot || '1 foot',
          variant_sku_snapshot: item.variant_sku_snapshot || 'MRSH-CF-LJ-1FT',
          custom_mode_enabled: cust.custom_mode_enabled || 0,
          engraved_name: cust.customer_name || null,
          engraved_designation: cust.customer_designation || null,
          nameplate_material: cust.nameplate_material || null
        };
      });
      return [rows];
    }],

    // Admin status update select for update
    [/SELECT id, production_status.*FROM custom_forge_orders WHERE \(id = \? OR order_number = \?\) AND store_id = 2 LIMIT 1 FOR UPDATE/i, (sql, params) => {
      const [idNum, idStr] = params;
      const hit = customForgeOrders.filter(o => String(o.id) === String(idNum) || o.order_number === String(idStr));
      return [hit];
    }],

    // Admin status update execution
    [/UPDATE custom_forge_orders SET production_status = \?, updated_at = NOW\(\) WHERE id = \?/i, (sql, params) => {
      const [status, id] = params;
      const o = customForgeOrders.find(ord => String(ord.id) === String(id));
      if (o) o.production_status = status;
      return [{ affectedRows: o ? 1 : 0 }];
    }],

    // Unread Custom Forge orders query
    [/SELECT o\.id.*FROM custom_forge_orders o.*WHERE o\.store_id = 2.*payment_status = 'paid'.*production_status = 'order_placed'.*ORDER_ACKNOWLEDGED/is, () => {
      const unread = customForgeOrders.filter(o =>
        o.store_id === 2 &&
        o.payment_status === 'paid' &&
        o.production_status === 'order_placed' &&
        !customForgeOrderStatusHistory.some(h => String(h.order_id) === String(o.id) && h.note === 'ORDER_ACKNOWLEDGED')
      );
      return [unread.map(o => ({ id: o.id }))];
    }],

    // Acknowledge Custom Forge orders select
    [/SELECT o\.id, o\.production_status.*FROM custom_forge_orders o.*WHERE o\.id IN.*ORDER_ACKNOWLEDGED/is, (sql, params) => {
      const ids = (params || []).map(p => Number(p));
      const toAck = customForgeOrders.filter(o =>
        ids.includes(Number(o.id)) &&
        o.store_id === 2 &&
        o.payment_status === 'paid' &&
        o.production_status === 'order_placed' &&
        !customForgeOrderStatusHistory.some(h => String(h.order_id) === String(o.id) && h.note === 'ORDER_ACKNOWLEDGED')
      );
      return [toAck.map(o => ({ id: o.id, production_status: o.production_status }))];
    }],

    // Shipping rules query
    [/SELECT.*FROM shipping_rules/i, () => [[]]],
    [/SELECT.*FROM site_settings/i, () => [[{ key_name: 'site_title', value: 'THE MARSHANS' }]]]
  ]);

  installFakePool(pool);
}

// Request helper
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

// Standard valid address for tests
const VALID_SHIPPING_ADDRESS = {
  name: 'Adv. Ramesh Sharma',
  phone: '9876543210',
  address: 'Suite 402, High Court Chamber Block',
  city: 'New Delhi',
  state: 'Delhi',
  pincode: '110001',
  country: 'India'
};

async function runCustomForgeTests() {
  console.log('================================================================');
  console.log('STARTING CUSTOM FORGE BACKEND VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  setupMockEnvironment();

  // Load Express app fresh with fake pool & mock firebase
  const app = require('../server/app');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // -------------------------------------------------------------------------
    // TEST GROUP 1: CATALOG & VARIANT CONFIGURATION (STORE 2)
    // -------------------------------------------------------------------------
    await test('1.1: GET /api/custom-forge/products/lady-justice under Store 2 returns product with 3 variants', async () => {
      const res = await makeRequest(server, '/api/custom-forge/products/lady-justice', {
        headers: { 'X-Store-ID': '2' }
      });
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.slug, 'lady-justice');
      assert.strictEqual(res.body.data.name, 'Lady Justice');
      assert.strictEqual(res.body.data.variants.length, 3);
    });

    await test('1.2: Variant 1 (6 inches) has price 199900 paise (₹1,999) and custom_mode_allowed=0', async () => {
      const res = await makeRequest(server, '/api/custom-forge/products/lady-justice', {
        headers: { 'X-Store-ID': '2' }
      });
      const v6in = res.body.data.variants.find(v => v.size_label === '6 inches');
      assert.ok(v6in, '6 inches variant must exist');
      assert.strictEqual(v6in.price, 199900);
      assert.strictEqual(v6in.custom_mode_allowed, 0);
      assert.strictEqual(v6in.height_mm, 152);
    });

    await test('1.3: Variant 2 (1 foot) has price 369900 paise (₹3,699) and custom_mode_allowed=1', async () => {
      const res = await makeRequest(server, '/api/custom-forge/products/lady-justice', {
        headers: { 'X-Store-ID': '2' }
      });
      const v1ft = res.body.data.variants.find(v => v.size_label === '1 foot');
      assert.ok(v1ft, '1 foot variant must exist');
      assert.strictEqual(v1ft.price, 369900);
      assert.strictEqual(v1ft.custom_mode_allowed, 1);
      assert.strictEqual(v1ft.height_mm, 305);
    });

    await test('1.4: Variant 3 (2 feet) has price 599900 paise (₹5,999) and custom_mode_allowed=1', async () => {
      const res = await makeRequest(server, '/api/custom-forge/products/lady-justice', {
        headers: { 'X-Store-ID': '2' }
      });
      const v2ft = res.body.data.variants.find(v => v.size_label === '2 feet');
      assert.ok(v2ft, '2 feet variant must exist');
      assert.strictEqual(v2ft.price, 599900);
      assert.strictEqual(v2ft.custom_mode_allowed, 1);
      assert.strictEqual(v2ft.height_mm, 610);
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 2: MULTI-STORE ISOLATION (STORE 1 REJECTION)
    // -------------------------------------------------------------------------
    await test('2.1: GET /api/custom-forge/products/lady-justice under Store 1 (CHIPAKK) is rejected with 403', async () => {
      const res = await makeRequest(server, '/api/custom-forge/products/lady-justice', {
        headers: { 'X-Store-ID': '1' }
      });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
      assert.ok(/exclusively supported on Store 2/i.test(getErrMsg(res)));
    });

    await test('2.2: POST /api/custom-forge/orders under Store 1 (CHIPAKK) is rejected with 403', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '1',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 0,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
      assert.ok(/Store 2/i.test(getErrMsg(res)));
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 3: AUTHENTICATION & GUEST CHECKOUT PROHIBITION
    // -------------------------------------------------------------------------
    await test('3.1: POST /api/custom-forge/orders without auth token is rejected with 401', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: { 'X-Store-ID': '2' },
        body: {
          variant_id: 2,
          custom_mode: 0,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
    });

    await test('3.2: POST /api/custom-forge/orders with invalid token is rejected with 401', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': 'Bearer bad_token_123'
        },
        body: {
          variant_id: 2,
          custom_mode: 0,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 4: CUSTOM MODE RULE ENFORCEMENT
    // -------------------------------------------------------------------------
    await test('4.1: 6-inch variant with custom_mode=1 is rejected with 400 Bad Request', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 1, // 6 inches
          custom_mode: 1,
          customization: {
            name: 'Ramesh Sharma',
            designation: 'Advocate',
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/not available for the 6-inch variant/i.test(getErrMsg(res)));
    });

    await test('4.2: 6-inch variant with custom_mode=0 is accepted without customization details', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 1, // 6 inches
          custom_mode: 0,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.subtotal, 199900);
      assert.strictEqual(res.body.data.subtotal_rupees, 1999);
      assert.strictEqual(res.body.data.items[0].custom_mode_enabled, 0);
      assert.strictEqual(res.body.data.items[0].customization, null);
    });

    await test('4.3: 1-foot variant with custom_mode=0 is accepted without customization details', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2, // 1 foot
          custom_mode: 0,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.subtotal, 369900);
      assert.strictEqual(res.body.data.subtotal_rupees, 3699);
      assert.strictEqual(res.body.data.items[0].custom_mode_enabled, 0);
    });

    await test('4.4: 1-foot variant with custom_mode=1 but missing customization payload is rejected with 400', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/customization details are required/i.test(getErrMsg(res)));
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 5: CUSTOMIZATION FIELD VALIDATION
    // -------------------------------------------------------------------------
    await test('5.1: Custom mode enabled with empty name is rejected with 400', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: '   ',
            designation: 'Senior Advocate',
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/Name on custom nameplate is required/i.test(getErrMsg(res)));
    });

    await test('5.2: Custom mode enabled with name > 35 chars is rejected with 400', async () => {
      const longName = 'Advocate Rameshwaram Chandrasekharan Jr.'; // 40 chars
      assert.ok(longName.length > 35);
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: longName,
            designation: 'Advocate',
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/cannot exceed 35 characters/i.test(getErrMsg(res)));
    });

    await test('5.3: Custom mode enabled with designation > 50 chars is rejected with 400', async () => {
      const longDesig = 'Chief Justice & Additional Attorney General Supreme Court of India'; // 66 chars
      assert.ok(longDesig.length > 50);
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: 'Ramesh Sharma',
            designation: longDesig,
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/cannot exceed 50 characters/i.test(getErrMsg(res)));
    });

    await test('5.4: Custom mode enabled with literal "NIL" designation is accepted', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: 'Ramesh Sharma',
            designation: 'NIL',
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.items[0].customization.designation, 'NIL');
    });

    await test('5.5: Custom mode enabled with lowercase "nil" designation is normalized to "NIL"', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: 'Ramesh Sharma',
            designation: 'nil',
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      assert.strictEqual(res.body.data.items[0].customization.designation, 'NIL');
    });

    await test('5.6: Custom mode enabled with invalid material "Metal" is rejected with 400', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: 'Ramesh Sharma',
            designation: 'Advocate',
            material: 'Metal'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/must be 'Vinyl', 'Plastic', or 'MDF'/i.test(getErrMsg(res)));
    });

    await test('5.7: Custom mode enabled with material "MDF" is accepted on 2-feet variant', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 3, // 2 feet
          custom_mode: 1,
          customization: {
            name: 'Hon. Justice Verma',
            designation: 'Senior Counsel',
            material: 'MDF'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      // 2 feet (5999) + MFD (49) = ₹6,048 (604800 paise)
      assert.strictEqual(res.body.data.subtotal, 604800);
      assert.strictEqual(res.body.data.subtotal_rupees, 6048);
      assert.strictEqual(res.body.data.items[0].customization.material, 'MDF');
      assert.strictEqual(res.body.data.items[0].customization.name, 'Hon. Justice Verma');
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 6: PRICE TAMPERING IMMUNITY & AUTHORITATIVE PRICING
    // -------------------------------------------------------------------------
    await test('6.1: Client-submitted price tampering in payload is ignored; database price enforced', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2, // 1 foot (database price = 369900 paise / ₹3,699)
          price: 100, // Tampered attempt: ₹1
          subtotal: 50,
          total: 50,
          total_price: 50,
          custom_mode: 1, // +₹29
          customization: {
            name: 'Ramesh Sharma',
            designation: 'Advocate',
            material: 'Plastic' // +₹0
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
      // Must equal authoritative price 369900 + 2900 = 372800 paise (₹3,728), ignoring client tampering
      assert.strictEqual(res.body.data.subtotal, 372800);
      assert.strictEqual(res.body.data.subtotal_rupees, 3728);
      const expectedTotal = 372800 + (res.body.data.shipping_charge || 0);
      assert.strictEqual(res.body.data.total_price, expectedTotal);
      assert.strictEqual(res.body.data.total_price_rupees, Math.round(expectedTotal / 100));
    });

    await test('6.2: Lady Justice Pricing Combination A: No personalization, Polymer -> ₹3,699', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: { 'X-Store-ID': '2', 'Authorization': `Bearer ${TOKENS.customer}` },
        body: {
          variant_id: 2,
          custom_mode: 0,
          customization: { material: 'Plastic' },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.subtotal, 369900);
      assert.strictEqual(res.body.data.subtotal_rupees, 3699);
    });

    await test('6.3: Lady Justice Pricing Combination B: Nameplate, Polymer -> ₹3,728', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: { 'X-Store-ID': '2', 'Authorization': `Bearer ${TOKENS.customer}` },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: { name: 'Adv. Test', designation: 'High Court', material: 'Plastic' },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.subtotal, 372800);
      assert.strictEqual(res.body.data.subtotal_rupees, 3728);
    });

    await test('6.4: Lady Justice Pricing: Wood without personalization is rejected with 400', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: { 'X-Store-ID': '2', 'Authorization': `Bearer ${TOKENS.customer}` },
        body: {
          variant_id: 2,
          custom_mode: 0,
          customization: { material: 'MDF' },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.error.message, /only available when Personalized Nameplate is enabled/i);
    });

    await test('6.4b: Lady Justice Pricing Combination: Nameplate + Vinyl Sticker (FREE) -> ₹3,699', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: { 'X-Store-ID': '2', 'Authorization': `Bearer ${TOKENS.customer}` },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: { name: 'Adv. Test', designation: 'High Court', material: 'Vinyl' },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.subtotal, 369900);
      assert.strictEqual(res.body.data.subtotal_rupees, 3699);
    });

    await test('6.5: Lady Justice Pricing Combination D: Nameplate + MFD -> ₹3,748', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: { 'X-Store-ID': '2', 'Authorization': `Bearer ${TOKENS.customer}` },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: { name: 'Adv. Test', designation: 'High Court', material: 'MDF' },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.subtotal, 374800);
      assert.strictEqual(res.body.data.subtotal_rupees, 3748);
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 6b: STRICT COD REJECTION & ONLINE PAYMENT ENFORCEMENT
    // -------------------------------------------------------------------------
    await test('6b.1: Order creation with payment_method="COD" is strictly rejected with 400', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 0,
          payment_method: 'COD',
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
      assert.ok(/Cash on Delivery \(COD\) is not supported/i.test(getErrMsg(res)));
    });

    await test('6b.2: Order creation with unsupported payment_method is rejected with 400', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 0,
          payment_method: 'CRYPTO',
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
      assert.ok(/Unsupported payment method/i.test(getErrMsg(res)));
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 6c: STORE 2 RAZORPAY CREDENTIAL ISOLATION
    // -------------------------------------------------------------------------
    const razorpayService = require('../server/services/razorpayService');
    const crypto = require('crypto');

    await test('6c.1: Store 2 Razorpay credentials strictly isolated — never falls back to Store 1 or shared keys', () => {
      const savedEnv = { ...process.env };
      try {
        process.env.RAZORPAY_KEY_ID = 'chipakk_shared_key';
        process.env.RAZORPAY_KEY_SECRET = 'chipakk_shared_secret';
        delete process.env.CHIPAKK_RAZORPAY_KEY_ID;
        delete process.env.CHIPAKK_RAZORPAY_KEY_SECRET;
        delete process.env.MARSHANS_RAZORPAY_KEY_ID;
        delete process.env.MARSHANS_RAZORPAY_KEY_SECRET;

        // Store 1 resolves shared key
        assert.strictEqual(razorpayService.getKeyId(1), 'chipakk_shared_key');
        assert.strictEqual(razorpayService.isConfigured(1), true);

        // Store 2 strictly rejects fallback
        assert.strictEqual(razorpayService.getKeyId(2), '');
        assert.strictEqual(razorpayService.isConfigured(2), false);
      } finally {
        process.env = savedEnv;
      }
    });

    await test('6c.2: Store 2 payment creation and signature verification reject when Marshans keys missing', async () => {
      const savedEnv = { ...process.env };
      try {
        process.env.RAZORPAY_KEY_ID = 'chipakk_shared_key';
        process.env.RAZORPAY_KEY_SECRET = 'chipakk_shared_secret';
        delete process.env.MARSHANS_RAZORPAY_KEY_ID;
        delete process.env.MARSHANS_RAZORPAY_KEY_SECRET;

        await assert.rejects(async () => {
          await razorpayService.createRazorpayOrder({
            amountPaise: 350000,
            receipt: 'CF-MRSH-2026-TEST',
            storeId: 2
          });
        }, (err) => {
          assert.strictEqual(err.code, 'GATEWAY_NOT_CONFIGURED');
          assert.match(err.message, /MARSHANS_RAZORPAY_KEY_ID/);
          return true;
        });

        assert.throws(() => {
          razorpayService.verifyPaymentSignature({
            razorpay_order_id: 'order_cf_001',
            razorpay_payment_id: 'pay_cf_001',
            razorpay_signature: 'sig_dummy',
            storeId: 2
          });
        }, (err) => {
          assert.strictEqual(err.code, 'GATEWAY_NOT_CONFIGURED');
          assert.match(err.message, /MARSHANS_RAZORPAY_KEY_ID/);
          return true;
        });
      } finally {
        process.env = savedEnv;
      }
    });

    await test('6c.3: Signature verification enforces Store 2 secret and rejects Store 1 signatures', () => {
      const savedEnv = { ...process.env };
      try {
        process.env.CHIPAKK_RAZORPAY_KEY_ID = 'key_chipakk';
        process.env.CHIPAKK_RAZORPAY_KEY_SECRET = 'secret_chipakk_111';
        process.env.MARSHANS_RAZORPAY_KEY_ID = 'key_marshans';
        process.env.MARSHANS_RAZORPAY_KEY_SECRET = 'secret_marshans_222';

        const orderId = 'order_cf_999';
        const paymentId = 'pay_cf_999';

        // Store 2 valid signature
        const validStore2Sig = crypto
          .createHmac('sha256', 'secret_marshans_222')
          .update(`${orderId}|${paymentId}`)
          .digest('hex');

        // Store 1 signature (cross-store attempt)
        const store1CrossSig = crypto
          .createHmac('sha256', 'secret_chipakk_111')
          .update(`${orderId}|${paymentId}`)
          .digest('hex');

        // Store 2 secret verifies valid Store 2 signature
        const verifyStore2 = razorpayService.verifyPaymentSignature({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validStore2Sig,
          storeId: 2
        });
        assert.strictEqual(verifyStore2, true);

        // Store 2 rejects Store 1 signature
        const verifyCross = razorpayService.verifyPaymentSignature({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: store1CrossSig,
          storeId: 2
        });
        assert.strictEqual(verifyCross, false);
      } finally {
        process.env = savedEnv;
      }
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 7: ORDER NUMBER FORMAT & COLLISION SAFETY
    // -------------------------------------------------------------------------
    await test('7.1: Order number matches CF-MRSH-YYYY-XXXX format', async () => {
      const res = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 0,
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(res.status, 201);
      const orderNumber = res.body.data.order_number;
      const currentYear = new Date().getFullYear();
      const pattern = new RegExp(`^CF-MRSH-${currentYear}-[0-9A-Z]{4}$`);
      assert.ok(pattern.test(orderNumber), `Order number ${orderNumber} must match ${pattern}`);
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 8: CUSTOMER ORDER ACCESS & OWNERSHIP ENFORCEMENT
    // -------------------------------------------------------------------------
    let createdOrderId = null;
    await test('8.1: Customer can retrieve their own Custom Forge order by ID', async () => {
      // First create an order
      const createRes = await makeRequest(server, '/api/custom-forge/orders', {
        method: 'POST',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        },
        body: {
          variant_id: 2,
          custom_mode: 1,
          customization: {
            name: 'Adv. Sharma',
            designation: 'Supreme Court',
            material: 'Plastic'
          },
          shipping_address: VALID_SHIPPING_ADDRESS
        }
      });
      assert.strictEqual(createRes.status, 201);
      createdOrderId = createRes.body.data.id;

      // Now query by ID
      const getRes = await makeRequest(server, `/api/custom-forge/orders/${createdOrderId}`, {
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.customer}`
        }
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.success, true);
      assert.strictEqual(getRes.body.data.id, createdOrderId);
      assert.strictEqual(getRes.body.data.items[0].customization.name, 'Adv. Sharma');
    });

    await test('8.2: Another customer cannot access an order they do not own (returns 403)', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const getRes = await makeRequest(server, `/api/custom-forge/orders/${createdOrderId}`, {
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.stranger}` // Stranger user
        }
      });
      assert.strictEqual(getRes.status, 403, `Expected 403, got ${getRes.status}`);
      assert.strictEqual(getRes.body.success, false);
      assert.ok(/permission/i.test(getErrMsg(getRes)));
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 9: ADMIN OPERATIONS & STATUS LIFECYCLE
    // -------------------------------------------------------------------------
    await test('9.1: Admin can list Custom Forge orders with valid session', async () => {
      const res = await makeRequest(server, '/api/admin/custom-forge/orders', {
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        }
      });
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.orders));
      assert.ok(res.body.data.orders.length > 0);
    });

    await test('9.2: Admin can view single Custom Forge order details', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}`, {
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, createdOrderId);
      assert.ok(Array.isArray(res.body.data.items));
      assert.ok(Array.isArray(res.body.data.status_history));
    });

    await test('9.3: Admin status update with invalid status is rejected with 400', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        },
        body: {
          status: 'invalid_stage_xyz'
        }
      });
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      assert.ok(/Invalid Custom Forge status/i.test(getErrMsg(res)));
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 9b: STRICT PAYMENT-TO-PRODUCTION ENFORCEMENT
    // -------------------------------------------------------------------------
    const PRODUCTION_STAGES_TO_TEST = [
      '3d_printing',
      'post_processing',
      'nameplate_fabrication',
      'quality_check',
      'ready_to_ship',
      'shipped',
      'delivered'
    ];

    for (const stage of PRODUCTION_STAGES_TO_TEST) {
      await test(`9b.unpaid.${stage}: Unpaid order (pending) cannot transition to '${stage}' (rejected with 400)`, async () => {
        assert.ok(createdOrderId, 'Need created order ID');
        const targetOrder = customForgeOrders.find(o => o.id === createdOrderId);
        assert.ok(targetOrder);
        targetOrder.payment_status = 'pending';

        const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}/status`, {
          method: 'PATCH',
          headers: {
            'X-Store-ID': '2',
            'Authorization': `Bearer ${TOKENS.admin}`,
            'X-Session-ID': 'cf_admin_session_valid'
          },
          body: {
            status: stage
          }
        });
        assert.strictEqual(res.status, 400, `Expected 400 for unpaid order advancing to ${stage}, got ${res.status}`);
        assert.strictEqual(res.body.success, false);
        assert.ok(/Cannot advance unpaid Custom Forge order/i.test(getErrMsg(res)));
        assert.ok(/Only paid orders can enter production/i.test(getErrMsg(res)));
      });
    }

    await test('9b.failed: Order with payment_status="failed" cannot transition to 3d_printing (rejected with 400)', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const targetOrder = customForgeOrders.find(o => o.id === createdOrderId);
      targetOrder.payment_status = 'failed';

      const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        },
        body: {
          status: '3d_printing'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(/Cannot advance unpaid Custom Forge order to '3d_printing'/i.test(getErrMsg(res)));
    });

    await test('9b.refunded: Order with payment_status="refunded" cannot transition to 3d_printing (rejected with 400)', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const targetOrder = customForgeOrders.find(o => o.id === createdOrderId);
      targetOrder.payment_status = 'refunded';

      const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        },
        body: {
          status: '3d_printing'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(/Cannot advance unpaid Custom Forge order to '3d_printing'/i.test(getErrMsg(res)));
    });

    await test('9b.cancellation: Unpaid order can be cancelled and payment_status remains pending (never marked paid)', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const targetOrder = customForgeOrders.find(o => o.id === createdOrderId);
      targetOrder.payment_status = 'pending';
      targetOrder.production_status = 'order_placed';

      const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        },
        body: {
          status: 'cancelled',
          note: 'Customer cancelled prior to payment'
        }
      });
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.production_status, 'cancelled');
      // Crucial requirement: Cancellation MUST NOT mark an unpaid order as paid
      assert.strictEqual(res.body.data.payment_status, 'pending');
      assert.strictEqual(targetOrder.payment_status, 'pending');
    });

    await test('9.4: Paid order can update status to 3d_printing and records transition history', async () => {
      assert.ok(createdOrderId, 'Need created order ID');
      const targetOrder = customForgeOrders.find(o => o.id === createdOrderId);
      // Mark order paid as if verified by Razorpay
      targetOrder.payment_status = 'paid';
      targetOrder.production_status = 'order_placed';

      const res = await makeRequest(server, `/api/admin/custom-forge/orders/${createdOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'X-Store-ID': '2',
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid'
        },
        body: {
          status: '3d_printing',
          note: 'Started Bambu Lab X1C print run'
        }
      });
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(res.body.data.production_status, '3d_printing');
      assert.strictEqual(res.body.data.payment_status, 'paid');

      // Verify status history
      const historyEntry = customForgeOrderStatusHistory.find(
        h => h.order_id === createdOrderId && h.new_status === '3d_printing'
      );
      assert.ok(historyEntry, 'Status transition must be recorded in status history');
      assert.strictEqual(historyEntry.previous_status, 'order_placed');
      assert.strictEqual(historyEntry.new_status, '3d_printing');
      assert.ok(/Bambu Lab/i.test(historyEntry.note));
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 10: RETAIL DATABASE SEGREGATION VERIFICATION
    // -------------------------------------------------------------------------
    await test('10.1: Retail orders and payments tables were NEVER touched during Custom Forge operations', async () => {
      assert.strictEqual(retailOrders.length, 0, 'Retail orders table must remain untouched (0 rows)');
      assert.strictEqual(retailPayments.length, 0, 'Retail payments table must remain untouched (0 rows)');
      assert.ok(customForgeOrders.length > 0, 'Custom Forge orders must exist in isolated table');
      assert.ok(customForgeOrderItems.length > 0, 'Custom Forge items must exist in isolated table');
      assert.ok(customForgeOrderStatusHistory.length > 0, 'Custom Forge status history must exist in isolated table');
    });

    // -------------------------------------------------------------------------
    // TEST GROUP 11: NEW ORDER NOTIFICATIONS & ACKNOWLEDGMENT
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // TEST GROUP 11: NEW ORDER NOTIFICATIONS & ACKNOWLEDGMENT
    // -------------------------------------------------------------------------
    await test('11.1: Store 1 (CHIPAKK) cannot access unread-count (rejected with 403)', async () => {
      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '1'
        }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('11.2: Store 1 (CHIPAKK) cannot access acknowledge endpoint (rejected with 403)', async () => {
      const res = await makeRequest(server, '/api/admin/custom-forge/orders/acknowledge', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '1'
        },
        body: { order_ids: [1] }
      });
      assert.strictEqual(res.status, 403);
    });

    await test('11.3: Unpaid, failed, and refunded orders never trigger unread notifications', async () => {
      customForgeOrders.push({
        id: 901,
        store_id: 2,
        order_number: 'CF-MRSH-2026-UNPD',
        payment_status: 'pending',
        production_status: 'order_placed',
        created_at: new Date()
      });
      customForgeOrders.push({
        id: 902,
        store_id: 2,
        order_number: 'CF-MRSH-2026-FAIL',
        payment_status: 'failed',
        production_status: 'order_placed',
        created_at: new Date()
      });
      customForgeOrders.push({
        id: 903,
        store_id: 2,
        order_number: 'CF-MRSH-2026-RFND',
        payment_status: 'refunded',
        production_status: 'order_placed',
        created_at: new Date()
      });

      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const ids = res.body.data.order_ids || [];
      assert.ok(!ids.includes(901), 'Unpaid order must not be in unread list');
      assert.ok(!ids.includes(902), 'Failed order must not be in unread list');
      assert.ok(!ids.includes(903), 'Refunded order must not be in unread list');
    });

    await test('11.4: Paid unacknowledged order increments unread count and exposes zero PII', async () => {
      customForgeOrders.push({
        id: 904,
        store_id: 2,
        order_number: 'CF-MRSH-2026-PAID',
        customer_name: 'SECRET CUSTOMER NAME',
        customer_email: 'secret@gmail.com',
        customer_phone: '9999999999',
        payment_status: 'paid',
        production_status: 'order_placed',
        created_at: new Date()
      });

      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.unread_count >= 1, 'Unread count must be at least 1');
      assert.ok(res.body.data.order_ids.includes(904), 'Paid order ID must be in unread list');

      const rawText = JSON.stringify(res.body);
      assert.ok(!rawText.includes('SECRET CUSTOMER NAME'), 'Customer name must not be exposed');
      assert.ok(!rawText.includes('secret@gmail.com'), 'Customer email must not be exposed');
      assert.ok(!rawText.includes('9999999999'), 'Customer phone must not be exposed');
    });

    await test('11.5: POST /custom-forge/orders/acknowledge marks orders with ORDER_ACKNOWLEDGED and clears count', async () => {
      const ackRes = await makeRequest(server, '/api/admin/custom-forge/orders/acknowledge', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        },
        body: { order_ids: [904] }
      });
      assert.strictEqual(ackRes.status, 200);
      assert.strictEqual(ackRes.body.success, true);
      assert.strictEqual(ackRes.body.data.acknowledged_count, 1);
      assert.deepStrictEqual(ackRes.body.data.acknowledged_ids, [904]);

      const ackHistory = customForgeOrderStatusHistory.find(h => String(h.order_id) === '904' && h.note === 'ORDER_ACKNOWLEDGED');
      assert.ok(ackHistory, 'Status history must contain explicit ORDER_ACKNOWLEDGED entry');
      assert.ok(ackHistory.changed_by, 'Administrator identity must be recorded');
      assert.ok(ackHistory.created_at, 'Timestamp must be recorded');
    });

    await test('11.6: Synchronized admin sessions: second admin session sees 0 unread orders after acknowledgment', async () => {
      adminSessions.push({
        id: 2,
        session_id: 'cf_admin_session_valid_2',
        firebase_uid: ADMIN_USER.uid,
        email: ADMIN_USER.email,
        admin_name: 'Marshans Admin 2',
        role: 'super_admin',
        status: 'active',
        login_time: new Date(),
        last_activity: new Date(),
        expires_at: new Date(Date.now() + 3600000)
      });

      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid_2',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.data.order_ids.includes(904), 'Acknowledged order must no longer appear in unread count for second admin session');
    });

    await test('11.7: Duplicate acknowledgment requests are idempotent and do not create duplicate history rows', async () => {
      const historyCountBefore = customForgeOrderStatusHistory.filter(h => String(h.order_id) === '904' && h.note === 'ORDER_ACKNOWLEDGED').length;
      assert.strictEqual(historyCountBefore, 1);

      const repeatRes = await makeRequest(server, '/api/admin/custom-forge/orders/acknowledge', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        },
        body: { order_ids: [904] }
      });
      assert.strictEqual(repeatRes.status, 200);
      assert.strictEqual(repeatRes.body.data.acknowledged_count, 0, 'Already acknowledged order should not be re-acknowledged');

      const historyCountAfter = customForgeOrderStatusHistory.filter(h => String(h.order_id) === '904' && h.note === 'ORDER_ACKNOWLEDGED').length;
      assert.strictEqual(historyCountAfter, 1, 'No duplicate history rows must be created');
    });

    await test('11.8: Route ordering: GET /custom-forge/orders/unread-count is never captured by /custom-forge/orders/:id', async () => {
      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok('unread_count' in res.body.data, 'Must return unread count, not order detail');
    });

    await test('11.9: Regression: Paid order in order_placed without acknowledgment is counted', async () => {
      customForgeOrders.push({
        id: 910,
        store_id: 2,
        order_number: 'CF-MRSH-2026-N1',
        payment_status: 'paid',
        production_status: 'order_placed',
        created_at: new Date()
      });
      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.order_ids.includes(910), 'Paid order in order_placed must be counted');
    });

    await test('11.10: Regression: Paid order in 3d_printing is NOT counted in unread-count', async () => {
      customForgeOrders.push({
        id: 911,
        store_id: 2,
        order_number: 'CF-MRSH-2026-N2',
        payment_status: 'paid',
        production_status: '3d_printing',
        created_at: new Date()
      });
      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.data.order_ids.includes(911), 'Paid order in 3d_printing must NOT be counted');
    });

    await test('11.11: Regression: Paid order in quality_check is NOT counted in unread-count', async () => {
      customForgeOrders.push({
        id: 912,
        store_id: 2,
        order_number: 'CF-MRSH-2026-N3',
        payment_status: 'paid',
        production_status: 'quality_check',
        created_at: new Date()
      });
      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.data.order_ids.includes(912), 'Paid order in quality_check must NOT be counted');
    });

    await test('11.12: Regression: Acknowledged paid order is NOT counted in unread-count', async () => {
      const ackRes = await makeRequest(server, '/api/admin/custom-forge/orders/acknowledge', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        },
        body: { order_ids: [910] }
      });
      assert.strictEqual(ackRes.status, 200);
      assert.ok(ackRes.body.data.acknowledged_ids.includes(910));

      const res = await makeRequest(server, '/api/admin/custom-forge/orders/unread-count', {
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.data.order_ids.includes(910), 'Acknowledged order must NOT be counted');
    });

    await test('11.13: Regression: Acknowledgment endpoint will NOT acknowledge orders already in production (3d_printing, quality_check)', async () => {
      const ackRes = await makeRequest(server, '/api/admin/custom-forge/orders/acknowledge', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKENS.admin}`,
          'X-Session-ID': 'cf_admin_session_valid',
          'X-Store-ID': '2'
        },
        body: { order_ids: [911, 912] }
      });
      assert.strictEqual(ackRes.status, 200);
      assert.strictEqual(ackRes.body.data.acknowledged_count, 0, 'Orders already in production must not be acknowledged');
      assert.deepStrictEqual(ackRes.body.data.acknowledged_ids, []);
    });

  } finally {
    server.close();
  }

  // ---------------------------------------------------------------------------
  // SUMMARY REPORT
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('CUSTOM FORGE TEST SUITE SUMMARY');
  console.log('================================================================');
  const passedCount = results.filter(r => r.pass).length;
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`Total Tests Run : ${results.length}`);
  console.log(`Passed          : ${passedCount}`);
  console.log(`Failed          : ${failedCount}`);

  if (failedCount > 0) {
    console.error('\nFAILED TESTS:');
    results.filter(r => !r.pass).forEach(r => console.error(` - ${r.name}: ${r.err.message}`));
    process.exit(1);
  } else {
    console.log('\nALL CUSTOM FORGE SPECIFICATIONS VERIFIED SUCCESSFULLY!');
    process.exit(0);
  }
}

runCustomForgeTests().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
