/**
 * tests/test_step5_integration_audit.js
 *
 * Dedicated Integration Test Suite for:
 * STEP 5 — FULL ADMIN -> API -> DB -> CUSTOMER INTEGRATION AUDIT
 *
 * Covers:
 * 1. Customer Management (Admin Service & Controller):
 *    - customerService.calculateCustomerTier unit assertions.
 *    - customerService.getCustomers with order metrics and store scoping.
 *    - customerService.getCustomerById with lifetime stats and orders.
 *    - customerController response formats (200 OK, 404 Not Found).
 * 2. Category Visibility Integration:
 *    - Public route hides inactive categories (activeOnly: true).
 *    - Admin route retains inactive categories (activeOnly: false).
 * 3. Product Visibility Integration:
 *    - Public route defaults to active products only.
 *    - Public single-product fetch returns 404 for inactive products.
 *    - Admin single-product fetch returns inactive products successfully.
 * 4. Customer Orders Multi-Store Isolation:
 *    - Customer order listing scopes to requested store_id (Store 1 vs Store 2).
 *    - Customer single order fetch rejects cross-store access.
 * 5. Admin UI Store Switcher Completeness:
 *    - admin.js switchActiveStore includes Store Builder, Events, and Coupons.
 * 6. Store Builder & Multi-Store Data Isolation:
 *    - Store 1 vs Store 2 partition verification.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    fn();
    console.log(`  \x1b[32mPASS\x1b[0m: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31mFAIL\x1b[0m: ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  try {
    await fn();
    console.log(`  \x1b[32mPASS\x1b[0m: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31mFAIL\x1b[0m: ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// -----------------------------------------------------------------------------
// In-Memory Database State for Hermetic Integration Testing
// -----------------------------------------------------------------------------
const mockDb = {
  users: [
    { id: 1, firebase_uid: 'uid_cust_1', full_name: 'Alice Customer', name: 'Alice Customer', email: 'alice@example.com', phone: '9876543210', created_at: new Date('2026-01-01') },
    { id: 2, firebase_uid: 'uid_cust_2', full_name: 'Bob Customer', name: 'Bob Customer', email: 'bob@example.com', phone: '9876543211', created_at: new Date('2026-01-05') }
  ],
  categories: [
    { id: 1, name: 'Active Stickers', slug: 'active-stickers', store_id: 1, active: 1, image_url: '/uploads/cat1.png' },
    { id: 2, name: 'Inactive Stickers', slug: 'inactive-stickers', store_id: 1, active: 0, image_url: null },
    { id: 10, name: 'Active Marshans Cat', slug: 'active-marshans', store_id: 2, active: 1, image_url: '/uploads/cat10.png' },
    { id: 20, name: 'Inactive Marshans Cat', slug: 'inactive-marshans', store_id: 2, active: 0, image_url: null }
  ],
  products: [
    { id: 101, admin_product_id: 'P101', name: 'Active Sticker 101', sku: 'SKU-101', category_id: 1, store_id: 1, active: 1, price: 19900 },
    { id: 102, admin_product_id: 'P102', name: 'Inactive Sticker 102', sku: 'SKU-102', category_id: 1, store_id: 1, active: 0, price: 19900 },
    { id: 201, admin_product_id: 'P201', name: 'Active Marshans 201', sku: 'MSH-201', category_id: 10, store_id: 2, active: 1, price: 50000 },
    { id: 202, admin_product_id: 'P202', name: 'Inactive Marshans 202', sku: 'MSH-202', category_id: 10, store_id: 2, active: 0, price: 50000 }
  ],
  orders: [
    { id: 1001, order_number: 'ORD-S1-001', customer_id: 1, customer_name: 'Alice Customer', customer_email: 'alice@example.com', store_id: 1, fulfillment_status: 'DELIVERED', payment_status: 'paid', total_price: 1500, created_at: new Date('2026-02-01') },
    { id: 1002, order_number: 'ORD-S1-002', customer_id: 1, customer_name: 'Alice Customer', customer_email: 'alice@example.com', store_id: 1, fulfillment_status: 'DELIVERED', payment_status: 'paid', total_price: 2500, created_at: new Date('2026-02-05') },
    { id: 2001, order_number: 'ORD-S2-001', customer_id: 1, customer_name: 'Alice Customer', customer_email: 'alice@example.com', store_id: 2, fulfillment_status: 'DELIVERED', payment_status: 'paid', total_price: 450000, created_at: new Date('2026-02-10') }
  ],
  order_items: [
    { id: 1, order_id: 1001, product_id: 101, product_name: 'Active Sticker 101', sku: 'SKU-101', quantity: 2, unit_price: 750, total_price: 1500, variant_options: null },
    { id: 2, order_id: 1002, product_id: 101, product_name: 'Active Sticker 101', sku: 'SKU-101', quantity: 1, unit_price: 2500, total_price: 2500, variant_options: null },
    { id: 3, order_id: 2001, product_id: 201, product_name: 'Active Marshans 201', sku: 'MSH-201', quantity: 1, unit_price: 450000, total_price: 450000, variant_options: null }
  ],
  site_settings: new Map([
    ['store_builder_hero_config_store_1', JSON.stringify({ slides: [{ banner: '/uploads/s1-hero.jpg', headline: 'CHIPAKK Stickers' }] })],
    ['store_builder_hero_config_store_2', JSON.stringify({ slides: [{ banner: '/uploads/s2-hero.jpg', headline: 'Marshans 3D Printing' }] })],
    ['store_builder_announcement_bar_store_1', JSON.stringify({ enabled: true, text: 'Welcome to CHIPAKK!' })],
    ['store_builder_announcement_bar_store_2', JSON.stringify({ enabled: true, text: 'Custom 3D Printing by Marshans!' })]
  ]),
  store_settings: new Map([
    ['1:::announcement_text', 'Welcome to CHIPAKK!'],
    ['2:::announcement_text', 'Custom 3D Printing by Marshans!']
  ])
};

// Intercept database module pool
const dbModule = require('../server/config/database');

const executeMockQuery = async (sql, params = []) => {
  const clean = sql.trim().replace(/\s+/g, ' ');

  // SHOW COLUMNS / TABLES
  if (clean.startsWith('SHOW COLUMNS')) {
    return [[{ Field: 'store_id' }, { Field: 'experience_id' }, { Field: 'hsn_code' }, { Field: 'image_url' }, { Field: 'is_best_seller' }]];
  }
  if (clean.startsWith('SHOW TABLES')) {
    return [[{ Tables_in_db: 'category_experiences' }]];
  }

  // --- USERS ---
  if (clean.includes('COUNT(*) AS total FROM users u')) {
    return [[{ total: mockDb.users.length }]];
  }

  if (clean.includes('FROM users u LEFT JOIN orders o')) {
    const rows = mockDb.users.map(u => {
      const userOrders = mockDb.orders.filter(o => o.customer_id === u.id || o.customer_id === u.firebase_uid);
      const deliveredOrders = userOrders.filter(o => o.fulfillment_status === 'DELIVERED').length;
      const totalSpent = userOrders.reduce((sum, o) => sum + (o.payment_status === 'paid' ? o.total_price : 0), 0);

      return {
        id: u.id,
        firebase_uid: u.firebase_uid,
        name: u.full_name,
        full_name: u.full_name,
        email: u.email,
        phone: u.phone,
        created_at: u.created_at,
        total_orders: userOrders.length,
        delivered_orders: deliveredOrders,
        total_spent: totalSpent
      };
    });
    return [rows];
  }

  if (clean.includes('FROM users u WHERE') || clean.includes('FROM users WHERE')) {
    const val = params[0];
    const found = mockDb.users.find(u => u.id === Number(val) || u.firebase_uid === String(val));
    if (found) {
      return [[{ ...found, name: found.full_name }]];
    }
    return [[]];
  }

  // --- CATEGORIES ---
  if (clean.includes('FROM categories c') && clean.includes('COUNT(p.id) AS product_count')) {
    let list = mockDb.categories.map(c => ({
      ...c,
      product_count: mockDb.products.filter(p => p.category_id === c.id && p.active === 1).length,
      exp_id: null,
      exp_code: null,
      exp_name: null,
      exp_settings: null
    }));

    if (clean.includes('c.active = ?')) {
      const activeVal = Number(params[params.length - 1]);
      list = list.filter(c => c.active === activeVal);
    }
    if (clean.includes('c.store_id = 1 OR c.store_id IS NULL')) {
      list = list.filter(c => c.store_id === 1 || c.store_id === null);
    } else if (clean.includes('c.store_id = ?')) {
      const sId = Number(params[0]);
      list = list.filter(c => c.store_id === sId);
    }
    return [list];
  }

  if (clean.includes('FROM category_media')) {
    return [[]];
  }

  // --- PRODUCTS ---
  if (clean.includes('COUNT(*) AS total FROM products p')) {
    let list = [...mockDb.products];
    if (clean.includes('p.active = ?')) {
      const activeVal = Number(params[0]);
      list = list.filter(p => p.active === activeVal);
    }
    return [[{ total: list.length }]];
  }

  if (clean.includes('FROM products p') && (clean.includes('p.id = ?') || clean.includes('p.admin_product_id = ?'))) {
    const queryId = String(params[0]);
    const found = mockDb.products.find(p => String(p.id) === queryId || p.admin_product_id === queryId);
    if (found) {
      return [[{ ...found, images: [], variants: [] }]];
    }
    return [[]];
  }

  if (clean.includes('SELECT') && clean.includes('FROM products p')) {
    let list = [...mockDb.products];
    if (clean.includes('p.active = ?')) {
      const activeVal = Number(params[0]);
      list = list.filter(p => p.active === activeVal);
    }
    return [list.map(p => ({ ...p, images: [], variants: [] }))];
  }

  if (clean.includes('FROM product_variants WHERE product_id = ?')) {
    return [[]];
  }

  if (clean.includes('FROM product_images WHERE product_id = ?')) {
    return [[]];
  }

  // --- ORDERS ---
  if (clean.includes('COUNT(*) AS total FROM orders WHERE customer_id = ?')) {
    const custId = params[0];
    let list = mockDb.orders.filter(o => o.customer_id === custId || o.customer_id === Number(custId));
    if (clean.includes('store_id = 1 OR store_id IS NULL')) {
      list = list.filter(o => o.store_id === 1 || o.store_id === null);
    } else if (clean.includes('store_id = ?')) {
      const sId = Number(params[1]);
      list = list.filter(o => o.store_id === sId);
    }
    return [[{ total: list.length }]];
  }

  if (clean.includes('FROM orders o') && (clean.includes('o.id = ?') || clean.includes('o.order_number = ?'))) {
    const idOrNum = String(params[0]);
    let found = mockDb.orders.find(o => String(o.id) === idOrNum || o.order_number === idOrNum);
    if (found) {
      if (clean.includes('o.store_id = 1 OR o.store_id IS NULL') && found.store_id !== 1 && found.store_id !== null) {
        return [[]];
      }
      if (clean.includes('o.store_id = ?')) {
        const sId = Number(params[1]);
        if (found.store_id !== sId) return [[]];
      }
      return [[{ ...found, items: [] }]];
    }
    return [[]];
  }

  if (clean.includes('FROM orders o') && clean.includes('WHERE o.customer_id = ?')) {
    const custId = params[0];
    let list = mockDb.orders.filter(o => o.customer_id === custId || o.customer_id === Number(custId));
    if (clean.includes('o.store_id = 1 OR o.store_id IS NULL')) {
      list = list.filter(o => o.store_id === 1 || o.store_id === null);
    } else if (clean.includes('o.store_id = ?')) {
      const sId = Number(params[1]);
      list = list.filter(o => o.store_id === sId);
    }
    return [list.map(o => ({ ...o, item_count: 1 }))];
  }

  if (clean.includes('FROM orders WHERE (customer_id = ?')) {
    const custId = params[0];
    let list = mockDb.orders.filter(o => o.customer_id === custId || o.customer_id === 1);
    if (clean.includes('store_id = 1 OR store_id IS NULL')) {
      list = list.filter(o => o.store_id === 1 || o.store_id === null);
    } else if (clean.includes('store_id = ?')) {
      const sId = Number(params[2]);
      list = list.filter(o => o.store_id === sId);
    }
    return [list];
  }

  if (clean.includes('FROM order_items oi WHERE oi.order_id = ?') || clean.includes('FROM order_items oi WHERE oi.order_id IN')) {
    return [mockDb.order_items];
  }

  // --- STORE BUILDER (Site Settings / Store Settings / Banners) ---
  if (clean.includes('SELECT setting_value FROM site_settings WHERE setting_key = ?')) {
    const key = params[0];
    if (mockDb.site_settings.has(key)) {
      return [[{ setting_value: mockDb.site_settings.get(key) }]];
    }
    return [[]];
  }

  if (clean.includes('SELECT setting_key, setting_value FROM store_settings WHERE store_id = ?')) {
    const sId = Number(params[0]);
    const rows = [];
    for (const [k, v] of mockDb.store_settings.entries()) {
      const [entryStore, entryKey] = k.split(':::');
      if (Number(entryStore) === sId) {
        rows.push({ setting_key: entryKey, setting_value: v });
      }
    }
    return [rows];
  }

  if (clean.includes('FROM banners WHERE active = 1 AND (store_id = ? OR store_id IS NULL)')) {
    const sId = Number(params[0]);
    return [[{ id: 1, title: `Banner for store ${sId}`, image_url: '/uploads/banner.jpg', sort_order: 1, store_id: sId }]];
  }

  return [[]];
};

// Patch dbModule pool for execute and query
dbModule.pool.execute = executeMockQuery;
dbModule.pool.query = executeMockQuery;
dbModule.pool.getConnection = async () => ({
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
  execute: executeMockQuery,
  query: executeMockQuery
});

// Helper to create mock Express response object
function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
}

// Load Controllers and Services AFTER Pool Patch
const customerService = require('../server/services/customerService');
const customerController = require('../server/controllers/customerController');
const categoryController = require('../server/controllers/categoryController');
const productController = require('../server/controllers/productController');
const orderService = require('../server/services/orderService');
const orderController = require('../server/controllers/orderController');
const storeBuilderService = require('../server/services/storeBuilderService');

async function main() {
  console.log('================================================================');
  console.log('STEP 5 INTEGRATION AUDIT TEST SUITE');
  console.log('================================================================\n');

  // TEST SUITE 1: Customer Management (Admin)
  console.log('--- TEST SUITE 1: Customer Management Service & Controller ---');

  runTest('Tier Calculation Logic for Customers', () => {
    assert.strictEqual(customerService.calculateCustomerTier(0), 'NEW');
    assert.strictEqual(customerService.calculateCustomerTier(1), 'REGULAR');
    assert.strictEqual(customerService.calculateCustomerTier(2), 'VIP');
    assert.strictEqual(customerService.calculateCustomerTier(4), 'VIP');
    assert.strictEqual(customerService.calculateCustomerTier(5), 'ELITE');
    assert.strictEqual(customerService.calculateCustomerTier(20), 'ELITE');
  });

  await runAsyncTest('customerService.getCustomers executes and returns formatted pagination', async () => {
    const result = await customerService.getCustomers({ limit: 10, offset: 0, store_id: 1 });
    assert(result !== null && typeof result === 'object');
    assert(Array.isArray(result.customers));
    assert(typeof result.total === 'number');
    assert.strictEqual(result.pagination.limit, 10);
    assert.strictEqual(result.pagination.offset, 0);

    assert.strictEqual(result.customers.length, 2);
    const c1 = result.customers[0];
    assert.strictEqual(c1.name, 'Alice Customer');
    assert.strictEqual(c1.email, 'alice@example.com');
    assert(c1.total_spent > 0);
    assert.strictEqual(c1.delivered_orders, 3);
    assert.strictEqual(c1.loyalty_tier, 'VIP');
  });

  await runAsyncTest('customerController.getCustomersHandler returns 200 sendSuccess', async () => {
    const req = {
      query: { limit: '5', offset: '0' },
      storeId: 1
    };
    const res = createMockRes();
    let nextCalled = false;

    await customerController.getCustomersHandler(req, res, (err) => {
      if (err) nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.data.customers));
    assert.strictEqual(res.body.data.customers.length, 2);
  });

  await runAsyncTest('customerController.getCustomerByIdHandler returns 200 for valid customer ID', async () => {
    const req = {
      params: { id: '1' },
      storeId: 1
    };
    const res = createMockRes();

    await customerController.getCustomerByIdHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.id, 1);
    assert.strictEqual(res.body.data.email, 'alice@example.com');
  });

  await runAsyncTest('customerController.getCustomerByIdHandler returns 404 for nonexistent customer ID', async () => {
    const req = {
      params: { id: '999999' },
      storeId: 1
    };
    const res = createMockRes();

    await customerController.getCustomerByIdHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
  });

  // TEST SUITE 2: Category Visibility (Public Storefront vs Admin)
  console.log('\n--- TEST SUITE 2: Category Visibility (Public vs Admin) ---');

  await runAsyncTest('categoryController hides inactive categories on public storefront request', async () => {
    const req = {
      baseUrl: '/api/categories',
      query: {},
      storeId: 1,
      admin: false
    };
    const res = createMockRes();

    await categoryController.getCategoriesHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    const categories = res.body.data.categories;
    assert(Array.isArray(categories));
    assert(categories.length > 0);
    for (const cat of categories) {
      assert.strictEqual(Number(cat.active), 1, `Category ${cat.name} (id ${cat.id}) is inactive but returned to public`);
    }
  });

  await runAsyncTest('categoryController permits inactive categories on admin request', async () => {
    const req = {
      baseUrl: '/api/admin/categories',
      query: {},
      storeId: 1,
      admin: true
    };
    const res = createMockRes();

    await categoryController.getCategoriesHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    const categories = res.body.data.categories;
    assert(Array.isArray(categories));

    const inactiveCat = categories.find(c => Number(c.active) === 0);
    assert(inactiveCat !== undefined, 'Admin should be able to view inactive categories');
  });

  // TEST SUITE 3: Product Visibility (Public Storefront vs Admin)
  console.log('\n--- TEST SUITE 3: Product Visibility (Public vs Admin) ---');

  await runAsyncTest('productController.getProductsHandler filters active=1 for public storefront', async () => {
    const req = {
      baseUrl: '/api/products',
      query: { limit: 10 },
      storeId: 1,
      admin: false
    };
    const res = createMockRes();

    await productController.getProductsHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);

    const products = res.body.data.products || res.body.data;
    for (const p of products) {
      assert.strictEqual(Number(p.active), 1, `Product ${p.name} (id ${p.id}) is inactive but returned on public endpoint`);
    }
  });

  await runAsyncTest('productController.getProductByIdHandler returns 404 for inactive product on public request', async () => {
    const req = {
      params: { id: '102' }, // Inactive product id 102
      baseUrl: '/api/products',
      storeId: 1,
      admin: false
    };
    const res = createMockRes();

    await productController.getProductByIdHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
  });

  await runAsyncTest('productController.getProductByIdHandler returns 200 for inactive product on admin request', async () => {
    const req = {
      params: { id: '102' }, // Inactive product id 102
      baseUrl: '/api/admin/products',
      storeId: 1,
      admin: true
    };
    const res = createMockRes();

    await productController.getProductByIdHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.id, 102);
    assert.strictEqual(res.body.data.active, 0);
  });

  // TEST SUITE 4: Customer Orders Multi-Store Isolation
  console.log('\n--- TEST SUITE 4: Customer Orders Multi-Store Isolation ---');

  await runAsyncTest('orderService.getCustomerOrders strictly scopes orders to requested store_id', async () => {
    // Customer 1 has 2 Store 1 orders and 1 Store 2 order
    const store1Result = await orderService.getCustomerOrders('uid_cust_1', { store_id: 1 });
    assert.strictEqual(store1Result.total, 2);
    for (const o of store1Result.orders) {
      assert.strictEqual(Number(o.store_id), 1);
    }

    const store2Result = await orderService.getCustomerOrders('uid_cust_1', { store_id: 2 });
    assert.strictEqual(store2Result.total, 1);
    for (const o of store2Result.orders) {
      assert.strictEqual(Number(o.store_id), 2);
    }
  });

  await runAsyncTest('orderService.getCustomerOrderById rejects cross-store order access', async () => {
    // Order 2001 belongs to Store 2
    // If Customer 1 requests Order 2001 while in Store 1 context, it must return null
    const crossStoreAttempt = await orderService.getCustomerOrderById(2001, 'uid_cust_1', 1);
    assert.strictEqual(crossStoreAttempt, null);

    // If Customer 1 requests Order 2001 in Store 2 context, it must succeed
    const validStoreAttempt = await orderService.getCustomerOrderById(2001, 'uid_cust_1', 2);
    assert(validStoreAttempt !== null);
    assert.strictEqual(validStoreAttempt.id, 2001);
  });

  await runAsyncTest('orderController passes storeId to customer order service', async () => {
    const req = {
      user: { uid: 'uid_cust_1' },
      query: { limit: '10' },
      storeId: 2
    };
    const res = createMockRes();

    await orderController.getCustomerOrdersHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.total, 1);
    assert.strictEqual(Number(res.body.data.orders[0].store_id), 2);
  });

  await runAsyncTest('orderController customer single order rejects unauthenticated request', async () => {
    const req = {
      user: null,
      params: { id: '1001' },
      storeId: 1
    };
    const res = createMockRes();

    await orderController.getCustomerOrderByIdHandler(req, res, () => {});
    assert.strictEqual(res.statusCode, 401);
  });

  // TEST SUITE 5: Admin UI Store Switcher Audit
  console.log('\n--- TEST SUITE 5: Admin UI Store Switcher Completeness ---');

  runTest('admin.js switchActiveStore includes Store Builder, Events, and Coupons', () => {
    const adminJsPath = path.join(__dirname, '../web/js/admin.js');
    const content = fs.readFileSync(adminJsPath, 'utf8');

    const switchStoreIdx = content.indexOf('async function switchActiveStore');
    assert(switchStoreIdx !== -1, 'switchActiveStore must exist in admin.js');

    // Was a fixed content.substring(switchStoreIdx, switchStoreIdx + 2000) window -- broke the moment a legitimate,
    // unrelated fix (closing stale edit forms on store switch, 2026-09-23 audit) added code earlier in the
    // function body and pushed these refresh calls past character 2000, even though they were still present and
    // unchanged. Match the actual function body (start to its closing brace at the base indent level) instead of
    // an arbitrary length so this doesn't silently go stale again.
    const switchStoreMatch = content.slice(switchStoreIdx).match(/^async function switchActiveStore\(targetStoreId\) \{[\s\S]*?\n    \}\n/);
    assert(switchStoreMatch, 'switchActiveStore function body must be parseable');
    const switchStoreBody = switchStoreMatch[0];
    assert(switchStoreBody.includes('refreshStoreBuilderFromAPI()'), 'switchActiveStore must refresh Store Builder');
    assert(switchStoreBody.includes('refreshEventsFromAPI()'), 'switchActiveStore must refresh Events');
    assert(switchStoreBody.includes('refreshCouponsFromAPI()'), 'switchActiveStore must refresh Coupons');
    assert(switchStoreBody.includes('refreshChipakkMaterialsFromAPI()'), 'switchActiveStore must refresh Chipakk Materials');
    assert(switchStoreBody.includes('refreshMaterialsFromAPI()'), 'switchActiveStore must refresh Marshans Materials');
  });

  // TEST SUITE 6: Multi-Store Isolation Verification
  console.log('\n--- TEST SUITE 6: Multi-Store Isolation Verification ---');

  await runAsyncTest('Store Builder Admin Data preserves partition between Store 1 and Store 2', async () => {
    const store1Data = await storeBuilderService.getStoreBuilderAdminData(1);
    const store2Data = await storeBuilderService.getStoreBuilderAdminData(2);

    assert(store1Data !== null);
    assert(store2Data !== null);
    assert.strictEqual(store1Data.store_id, 1);
    assert.strictEqual(store2Data.store_id, 2);
    assert(store1Data.hero_config.slides[0].headline.includes('CHIPAKK'));
    assert(store2Data.hero_config.slides[0].headline.includes('Marshans'));
  });

  await runAsyncTest('Public Store Builder Data returns isolated Hero and Announcements', async () => {
    const pubStore1 = await storeBuilderService.getPublicStoreBuilderData(1);
    const pubStore2 = await storeBuilderService.getPublicStoreBuilderData(2);

    assert(pubStore1 !== null);
    assert(pubStore2 !== null);
    assert.strictEqual(pubStore1.store_id, 1);
    assert.strictEqual(pubStore2.store_id, 2);
    assert.strictEqual(pubStore1.announcement_bar.text, 'Welcome to CHIPAKK!');
    assert.strictEqual(pubStore2.announcement_bar.text, 'Custom 3D Printing by Marshans!');
  });

  console.log('\n================================================================');
  console.log(`RESULTS: ${passedTests} passed, ${failedTests} failed.`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in integration test runner:', err);
  process.exit(1);
});
