/**
 * THE MARSHANS & CHIPAKK — Google Customer Authentication & Historical Order Resolution Test Suite
 * tests/test_google_auth_historical_orders_resolution.js
 *
 * Verifies:
 * 1. Google Firebase user maps to existing Store ID 2 customer profile by verified email.
 * 2. Pre-existing retail orders for Store ID 2 are retrieved when authenticated with Google.
 * 3. Pre-existing Custom Forge orders for Store ID 2 are retrieved when authenticated with Google.
 * 4. Merged timeline: newest-first sorting across retail and Custom Forge orders.
 * 5. Strict Store ID isolation: Store 1 orders never leak to Store 2; Store 2 Custom Forge never leaks to Store 1.
 * 6. Cross-customer defense: Customer A cannot see Customer B's orders by email or customer_id tampering.
 * 7. Single order lookup (getCustomerOrderById) and tracking for both Retail and Custom Forge.
 * 8. Zero duplicate customer creation: resolving orders preserves the single authoritative customer record.
 */

const assert = require('assert');
const test = require('node:test');
const path = require('path');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

test('Google Auth & Historical Order Resolution End-to-End Suite', async (t) => {
  // In-memory data store simulating production MySQL
  const users = [
    {
      id: 10,
      firebase_uid: 'phone_uid_collector_10',
      email: 'collector@themarshans.shop',
      full_name: 'Rajesh Sharma',
      phone: '9876543210',
      created_at: new Date('2026-10-01T10:00:00Z')
    },
    {
      id: 20,
      firebase_uid: 'phone_uid_other_20',
      email: 'other.collector@example.com',
      full_name: 'Other Collector',
      phone: '9123456780',
      created_at: new Date('2026-10-05T10:00:00Z')
    }
  ];

  const orders = [
    // Historical Store 2 Retail Order belonging to collector@themarshans.shop (id: 10)
    {
      id: 101,
      order_number: 'MRSH-RET-101',
      customer_id: 10,
      customer_name: 'Rajesh Sharma',
      customer_email: 'collector@themarshans.shop',
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({
        name: 'Rajesh Sharma',
        phone: '9876543210',
        address: 'Chamber 402, High Court Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400032'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      fulfillment_status: 'shipped',
      subtotal: 199900,
      discount_total: 0,
      shipping_charge: 5000,
      total_price: 204900,
      coupon_code: null,
      courier: 'Delhivery',
      tracking_no: 'DEL123456789',
      ship_date: '2026-11-10T12:00:00Z',
      created_at: '2026-11-08T10:00:00.000Z',
      store_id: 2
    },
    // Store 1 (CHIPAKK) Order belonging to collector@themarshans.shop (must NOT leak to Store 2)
    {
      id: 102,
      order_number: 'CHP-102',
      customer_id: 10,
      customer_name: 'Rajesh Sharma',
      customer_email: 'collector@themarshans.shop',
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({
        name: 'Rajesh Sharma',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400032'
      }),
      payment_method: 'COD',
      payment_status: 'pending',
      fulfillment_status: 'processing',
      subtotal: 349,
      discount_total: 0,
      shipping_charge: 0,
      total_price: 349,
      coupon_code: null,
      courier: null,
      tracking_no: null,
      ship_date: null,
      created_at: '2026-11-09T10:00:00.000Z',
      store_id: 1
    },
    // Historical Store 2 Retail Order belonging to other.collector@example.com (id: 20)
    {
      id: 103,
      order_number: 'MRSH-RET-103',
      customer_id: 20,
      customer_name: 'Other Collector',
      customer_email: 'other.collector@example.com',
      customer_phone: '9123456780',
      shipping_address: JSON.stringify({
        name: 'Other Collector',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      fulfillment_status: 'delivered',
      subtotal: 369900,
      discount_total: 0,
      shipping_charge: 0,
      total_price: 369900,
      coupon_code: null,
      courier: 'Blue Dart',
      tracking_no: 'BD987654321',
      ship_date: '2026-11-12T12:00:00Z',
      created_at: '2026-11-11T10:00:00.000Z',
      store_id: 2
    }
  ];

  const customForgeOrders = [
    // Historical Store 2 Custom Forge Order belonging to collector@themarshans.shop (id: 10)
    {
      id: 201,
      order_number: 'CF-MRSH-2026-0001',
      customer_id: 10,
      customer_name: 'Rajesh Sharma',
      customer_email: 'collector@themarshans.shop',
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({
        name: 'Rajesh Sharma',
        phone: '9876543210',
        address: 'Chamber 402, High Court Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400032'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      production_status: '3d_printing',
      subtotal: 599900,
      shipping_charge: 5000,
      total_price: 604900,
      gateway_order_id: 'order_rzp_cf_201',
      created_at: '2026-11-15T15:00:00.000Z',
      store_id: 2
    }
  ];

  const orderItems = [
    {
      id: 501,
      order_id: 101,
      product_id: null,
      marshans_product_id: 1,
      variant_id: 1,
      product_name: 'Lady Justice Statue 6in',
      sku: 'MRSH-CF-LJ-6IN',
      variant_options: null,
      unit_price: 199900,
      quantity: 1,
      total_price: 199900,
      product_image: 'https://themarshans.shop/assets/products/lady-justice-6in.png'
    }
  ];

  const customForgeItems = [
    {
      id: 601,
      order_id: 201,
      product_id: 1,
      variant_id: 3,
      quantity: 1,
      unit_price: 599900,
      total_price: 599900,
      product_name_snapshot: 'Lady Justice Statue',
      variant_sku_snapshot: 'MRSH-CF-LJ-2FT',
      size_label_snapshot: '2 feet',
      height_mm_snapshot: 610,
      custom_mode_enabled: 1,
      engraved_name: 'Adv. Rajesh Sharma',
      engraved_designation: 'Senior Advocate',
      second_customer_name: null,
      second_customer_designation: null,
      nameplate_material: 'Vinyl',
      verification_status: 'verified',
      hero_image_url: 'https://themarshans.shop/assets/products/lady-justice.png'
    }
  ];

  // Set up handlers for fake MySQL pool
  const handlers = [
    // INFORMATION_SCHEMA queries
    [/INFORMATION_SCHEMA\.TABLES.*TABLE_NAME\s*=\s*'custom_forge_orders'/i, () => [[{ TABLE_NAME: 'custom_forge_orders' }]]],
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME\s*=\s*'orders'.*customer_phone/i, () => [[{ COLUMN_NAME: 'customer_phone' }]]],
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME\s*=\s*'order_items'.*marshans_product_id/i, () => [[{ COLUMN_NAME: 'marshans_product_id' }]]],
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME\s*=\s*'custom_forge_order_customizations'.*second_customer_name/i, () => [[{ COLUMN_NAME: 'second_customer_name' }]]],
    [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME\s*=\s*'users'.*full_name/i, () => [[{ COLUMN_NAME: 'full_name' }]]],

    // SELECT users by id
    [/SELECT.*FROM\s+users\s+WHERE\s+id\s*=\s*\?\s*LIMIT\s*1/i, (sql, [id]) => {
      const match = users.filter(u => u.id === Number(id));
      return [match.map(m => ({ ...m }))];
    }],

    // SELECT users by firebase_uid
    [/SELECT.*FROM\s+users\s+WHERE\s+firebase_uid\s*=\s*\?\s*LIMIT\s*1/i, (sql, [uid]) => {
      const match = users.filter(u => u.firebase_uid === uid);
      return [match.map(m => ({ ...m }))];
    }],

    // SELECT users by email
    [/SELECT.*FROM\s+users\s+WHERE\s+email\s+IS\s+NOT\s+NULL.*LOWER\(TRIM\(email\)\)\s*=\s*LOWER\(\?\)/i, (sql, [email]) => {
      const match = users.filter(u => u.email && u.email.toLowerCase().trim() === String(email).toLowerCase().trim());
      return [match.map(m => ({ ...m }))];
    }],
    [/SELECT.*FROM\s+users\s+WHERE\s+email\s+IS\s+NOT\s+NULL.*LOWER\(email\)\s*=\s*LOWER\(\?\)\s*LIMIT\s*1/i, (sql, [email]) => {
      const match = users.filter(u => u.email && u.email.toLowerCase().trim() === String(email).toLowerCase().trim());
      return [match.map(m => ({ ...m }))];
    }],

    // UPDATE users (linking)
    [/UPDATE\s+users\s+SET\s+firebase_uid\s*=\s*\?/i, (sql, params) => {
      const [newUid, rawName, cleanPhone, id] = params;
      const target = users.find(u => u.id === id);
      if (target) {
        target.firebase_uid = newUid;
        if (rawName && !target.full_name) target.full_name = rawName;
        if (cleanPhone && !target.phone) target.phone = cleanPhone;
      }
      return [{ affectedRows: target ? 1 : 0 }];
    }],

    // COUNT orders for Store 2
    [/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+orders\s+WHERE.*store_id\s*=\s*2/i, (sql, params) => {
      const custIdMatch = sql.match(/customer_id\s+IN\s*\(([^)]+)\)/i);
      const custIdCount = custIdMatch ? custIdMatch[1].split(',').length : 0;
      const candidateIds = params.slice(0, custIdCount).map(Number);

      const hasEmail = sql.includes('LOWER(TRIM(COALESCE(customer_email');
      const email = hasEmail ? String(params[custIdCount] || '').toLowerCase().trim() : '';

      const orderIdMatch = sql.match(/\bid\s+IN\s*\(([^)]+)\)/i);
      const orderIdCount = orderIdMatch ? orderIdMatch[1].split(',').length : 0;
      const addressOrderIds = orderIdMatch ? params.slice(custIdCount + (hasEmail ? 1 : 0), custIdCount + (hasEmail ? 1 : 0) + orderIdCount).map(Number) : [];

      const matched = orders.filter(o => {
        return o.store_id === 2 &&
          (candidateIds.includes(Number(o.customer_id)) ||
           addressOrderIds.includes(Number(o.id)) ||
           (email && o.customer_email && o.customer_email.toLowerCase().trim() === email));
      });
      return [[{ total: matched.length }]];
    }],

    // SELECT orders for Store 2
    [/SELECT.*FROM\s+orders\s+o\s+WHERE.*o\.store_id\s*=\s*2/i, (sql, params) => {
      const fetchLimit = params[params.length - 1];
      const queryParams = params.slice(0, -1);

      const custIdMatch = sql.match(/o\.customer_id\s+IN\s*\(([^)]+)\)/i);
      const custIdCount = custIdMatch ? custIdMatch[1].split(',').length : 0;
      const candidateIds = queryParams.slice(0, custIdCount).map(Number);

      const hasEmail = sql.includes('LOWER(TRIM(COALESCE(o.customer_email');
      const email = hasEmail ? String(queryParams[custIdCount] || '').toLowerCase().trim() : '';

      const orderIdMatch = sql.match(/o\.id\s+IN\s*\(([^)]+)\)/i);
      const orderIdCount = orderIdMatch ? orderIdMatch[1].split(',').length : 0;
      const addressOrderIds = orderIdMatch ? queryParams.slice(custIdCount + (hasEmail ? 1 : 0), custIdCount + (hasEmail ? 1 : 0) + orderIdCount).map(Number) : [];

      const matched = orders.filter(o => {
        return o.store_id === 2 &&
          (candidateIds.includes(Number(o.customer_id)) ||
           addressOrderIds.includes(Number(o.id)) ||
           (email && o.customer_email && o.customer_email.toLowerCase().trim() === email));
      });
      matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return [matched.slice(0, fetchLimit).map(m => ({ ...m, item_count: 1 }))];
    }],

    // Address-only email lookup for orders
    [/SELECT\s+id,\s*customer_id,\s*shipping_address\s+FROM\s+orders\s+WHERE\s+store_id\s*=\s*2\s+AND\s+\(customer_email\s+IS\s+NULL\s+OR\s+customer_email\s*=\s*""\)/i, () => {
      const matched = orders.filter(o => o.store_id === 2 && (!o.customer_email || o.customer_email.trim() === ''));
      return [matched.map(m => ({ id: m.id, customer_id: m.customer_id, shipping_address: m.shipping_address }))];
    }],

    // Address-only email lookup for custom_forge_orders
    [/SELECT\s+id,\s*customer_id,\s*shipping_address\s+FROM\s+custom_forge_orders\s+WHERE\s+store_id\s*=\s*2\s+AND\s+\(customer_email\s+IS\s+NULL\s+OR\s+customer_email\s*=\s*""\)/i, () => {
      const matched = customForgeOrders.filter(o => o.store_id === 2 && (!o.customer_email || o.customer_email.trim() === ''));
      return [matched.map(m => ({ id: m.id, customer_id: m.customer_id, shipping_address: m.shipping_address }))];
    }],

    // SELECT DISTINCT customer_id FROM orders
    [/SELECT\s+DISTINCT\s+customer_id\s+FROM\s+orders/i, (sql, [email]) => {
      const cleanEmail = String(email || '').toLowerCase().trim();
      const matched = orders.filter(o => {
        return o.customer_email && o.customer_email.toLowerCase().trim() === cleanEmail;
      });
      const ids = Array.from(new Set(matched.map(m => m.customer_id).filter(Boolean)));
      return [ids.map(id => ({ customer_id: id }))];
    }],

    // SELECT DISTINCT customer_id FROM custom_forge_orders
    [/SELECT\s+DISTINCT\s+customer_id\s+FROM\s+custom_forge_orders/i, (sql, [email]) => {
      const cleanEmail = String(email || '').toLowerCase().trim();
      const matched = customForgeOrders.filter(o => {
        return o.customer_email && o.customer_email.toLowerCase().trim() === cleanEmail;
      });
      const ids = Array.from(new Set(matched.map(m => m.customer_id).filter(Boolean)));
      return [ids.map(id => ({ customer_id: id }))];
    }],

    // COUNT custom_forge_orders for Store 2
    [/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+custom_forge_orders\s+WHERE.*store_id\s*=\s*2/i, (sql, params) => {
      const custIdMatch = sql.match(/customer_id\s+IN\s*\(([^)]+)\)/i);
      const custIdCount = custIdMatch ? custIdMatch[1].split(',').length : 0;
      const candidateIds = params.slice(0, custIdCount).map(Number);

      const hasEmail = sql.includes('LOWER(TRIM(COALESCE(customer_email');
      const email = hasEmail ? String(params[custIdCount] || '').toLowerCase().trim() : '';

      const orderIdMatch = sql.match(/\bid\s+IN\s*\(([^)]+)\)/i);
      const orderIdCount = orderIdMatch ? orderIdMatch[1].split(',').length : 0;
      const addressOrderIds = orderIdMatch ? params.slice(custIdCount + (hasEmail ? 1 : 0), custIdCount + (hasEmail ? 1 : 0) + orderIdCount).map(Number) : [];

      const matched = customForgeOrders.filter(o => {
        return o.store_id === 2 &&
          (candidateIds.includes(Number(o.customer_id)) ||
           addressOrderIds.includes(Number(o.id)) ||
           (email && o.customer_email && o.customer_email.toLowerCase().trim() === email));
      });
      return [[{ total: matched.length }]];
    }],

    // getCustomForgeOrderByIdInternal lookup
    [/SELECT.*FROM\s+custom_forge_orders\s+o\s+WHERE\s+o\.id\s*=\s*\?\s*AND\s+o\.store_id\s*=\s*2/i, (sql, [orderId]) => {
      const match = customForgeOrders.filter(o => o.id === orderId && o.store_id === 2);
      return [match.map(m => ({ ...m }))];
    }],

    // Single order lookup custom_forge_orders
    [/SELECT\s+id,\s*customer_id,\s*customer_email(?:,\s*shipping_address)?\s+FROM\s+custom_forge_orders\s+WHERE/i, (sql, params) => {
      const [numId, cleanId] = params;
      const match = customForgeOrders.filter(o => o.id === numId || o.order_number === cleanId);
      return [match.map(m => ({ id: m.id, customer_id: m.customer_id, customer_email: m.customer_email, shipping_address: m.shipping_address }))];
    }],

    // SELECT custom_forge_orders for Store 2
    [/SELECT.*FROM\s+custom_forge_orders\s+o\s+WHERE.*o\.store_id\s*=\s*2/i, (sql, params) => {
      const fetchLimit = params[params.length - 1];
      const queryParams = params.slice(0, -1);

      const custIdMatch = sql.match(/o\.customer_id\s+IN\s*\(([^)]+)\)/i);
      const custIdCount = custIdMatch ? custIdMatch[1].split(',').length : 0;
      const candidateIds = queryParams.slice(0, custIdCount).map(Number);

      const hasEmail = sql.includes('LOWER(TRIM(COALESCE(o.customer_email');
      const email = hasEmail ? String(queryParams[custIdCount] || '').toLowerCase().trim() : '';

      const orderIdMatch = sql.match(/o\.id\s+IN\s*\(([^)]+)\)/i);
      const orderIdCount = orderIdMatch ? orderIdMatch[1].split(',').length : 0;
      const addressOrderIds = orderIdMatch ? queryParams.slice(custIdCount + (hasEmail ? 1 : 0), custIdCount + (hasEmail ? 1 : 0) + orderIdCount).map(Number) : [];

      const matched = customForgeOrders.filter(o => {
        return o.store_id === 2 &&
          (candidateIds.includes(Number(o.customer_id)) ||
           addressOrderIds.includes(Number(o.id)) ||
           (email && o.customer_email && o.customer_email.toLowerCase().trim() === email));
      });
      matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return [matched.slice(0, fetchLimit).map(m => ({ ...m }))];
    }],

    // SELECT order items for retail
    [/SELECT.*FROM\s+order_items\s+oi\s+WHERE\s+oi\.order_id\s+IN/i, (sql, params) => {
      const matched = orderItems.filter(item => params.includes(item.order_id));
      return [matched.map(m => ({ ...m }))];
    }],
    [/SELECT.*FROM\s+order_items\s+oi\s+WHERE\s+oi\.order_id\s*=\s*\?/i, (sql, [orderId]) => {
      const matched = orderItems.filter(item => item.order_id === Number(orderId));
      return [matched.map(m => ({ ...m }))];
    }],

    // SELECT custom_forge line items
    [/SELECT.*FROM\s+custom_forge_order_items\s+oi.*WHERE\s+oi\.order_id\s+IN/i, (sql, params) => {
      const matched = customForgeItems.filter(item => params.includes(item.order_id));
      return [matched.map(m => ({ ...m }))];
    }],
    [/SELECT.*FROM\s+custom_forge_order_items\s+oi\s+WHERE\s+oi\.order_id\s*=\s*\?/i, (sql, [orderId]) => {
      const match = customForgeItems.filter(i => i.order_id === orderId);
      return [match.map(m => ({ ...m }))];
    }],
    [/SELECT.*FROM\s+custom_forge_order_status_history.*WHERE\s+order_id\s*=\s*\?/i, () => [[]]],

    // Single order lookup orders (by order_number or id, with optional store_id)
    [/SELECT.*FROM\s+orders\s+o\s+WHERE\s+\(?o\.(?:id|order_number)\s*=\s*\?.*LIMIT\s+1/i, (sql, params) => {
      const [idOrNum, storeId] = params;
      const match = orders.filter(o => {
        const matchesId = o.id === Number(idOrNum) || o.order_number === String(idOrNum);
        if (!matchesId) return false;
        if (storeId !== undefined) {
          return o.store_id === Number(storeId);
        }
        return true;
      });
      return [match.map(m => ({ ...m }))];
    }],
    [/SELECT.*FROM\s+orders.*WHERE\s+\(id\s*=\s*\?\s*OR\s*order_number\s*=\s*\?\)/i, (sql, params) => {
      const [numId, cleanId] = params;
      const match = orders.filter(o => o.id === numId || o.order_number === cleanId);
      return [match.map(m => ({ ...m }))];
    }]
  ];

  const pool = createFakePool(handlers);
  installFakePool(pool);

  // Require orderService after installing fake pool
  const orderService = require('../server/services/orderService');

  // Customer logs in with Google account:
  // Google gives a new Firebase UID, but email is collector@themarshans.shop
  const googleUser = {
    uid: 'google_uid_rajesh_999',
    email: 'collector@themarshans.shop',
    emailVerified: true,
    displayName: 'Adv. Rajesh Sharma'
  };

  await t.test('1. Google Authentication resolves customer and retrieves historical orders', async () => {
    const res = await orderService.getCustomerOrders(googleUser, { store_id: 2 });
    assert.ok(res, 'Must return response object');
    assert.strictEqual(res.total, 2, 'Must retrieve exactly 2 historical Store 2 orders (1 retail + 1 Custom Forge)');
    assert.strictEqual(res.orders.length, 2);

    // Verify newest-first order
    assert.strictEqual(res.orders[0].order_number, 'CF-MRSH-2026-0001', 'Newest order must be Custom Forge order from Nov 15');
    assert.strictEqual(res.orders[0].is_custom_forge, true);
    assert.strictEqual(res.orders[0].production_status, '3d_printing');
    assert.strictEqual(res.orders[0].total_price_rupees, 6049);

    assert.strictEqual(res.orders[1].order_number, 'MRSH-RET-101', 'Second order must be Retail order from Nov 8');
    assert.strictEqual(res.orders[1].is_custom_forge, false);
    assert.strictEqual(res.orders[1].fulfillment_status, 'shipped');
    assert.strictEqual(res.orders[1].total_price_rupees, 2049);
    assert.strictEqual(res.orders[1].courier, 'Delhivery');
    assert.strictEqual(res.orders[1].tracking_no, 'DEL123456789');
  });

  await t.test('2. Store 1 (CHIPAKK) orders are completely excluded from Store 2 results', async () => {
    const res = await orderService.getCustomerOrders(googleUser, { store_id: 2 });
    const hasChipakkOrder = res.orders.some(o => o.order_number === 'CHP-102');
    assert.strictEqual(hasChipakkOrder, false, 'Store 1 order (CHP-102) must NEVER appear in Store 2 orders');
  });

  await t.test('3. Cross-customer defense: Other customer cannot see Rajesh orders', async () => {
    const otherUser = {
      uid: 'google_uid_attacker_888',
      email: 'attacker@evil.com',
      emailVerified: true
    };
    const res = await orderService.getCustomerOrders(otherUser, { store_id: 2 });
    assert.strictEqual(res.total, 0, 'Attacker must see 0 orders');
    assert.strictEqual(res.orders.length, 0);

    // Single order lookup attempt by attacker
    const orderDirect = await orderService.getCustomerOrderById('CF-MRSH-2026-0001', otherUser, 2);
    assert.strictEqual(orderDirect, null, 'Attacker must be denied access to another customer order');
  });

  await t.test('4. Legitimate single order lookup and tracking verification', async () => {
    const cfOrder = await orderService.getCustomerOrderById('CF-MRSH-2026-0001', googleUser, 2);
    assert.ok(cfOrder, 'Customer must be able to view their own Custom Forge order');
    assert.strictEqual(cfOrder.order_number, 'CF-MRSH-2026-0001');

    const retOrder = await orderService.getCustomerOrderById('MRSH-RET-101', googleUser, 2);
    assert.ok(retOrder, 'Customer must be able to view their own Retail order');
    assert.strictEqual(retOrder.order_number, 'MRSH-RET-101');
  });

  await t.test('5. Zero duplicate user rows created during order retrieval', async () => {
    // Verified that users array still has the original users bound
    const userRow = users.find(u => u.email === 'collector@themarshans.shop');
    assert.ok(userRow, 'Original customer record preserved');
    assert.strictEqual(userRow.id, 10, 'Customer ID remains 10');
    assert.strictEqual(userRow.firebase_uid, 'google_uid_rajesh_999', 'Firebase UID bound to Google login');
  });

  await t.test('6. Resolves historical Custom Forge orders where customer_email is empty and email exists only in shipping_address', async () => {
    // Add an order with customer_email = null/empty, customer_id = 999 (unlinked legacy ID), email inside shipping_address
    customForgeOrders.push({
      id: 202,
      order_number: 'CF-MRSH-2026-LEGACY-ADDR',
      customer_id: 999,
      customer_name: 'Rajesh Sharma',
      customer_email: '', // empty!
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({
        name: 'Rajesh Sharma',
        phone: '9876543210',
        email: 'collector@themarshans.shop',
        address: 'Chamber 402, High Court Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400032'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      production_status: 'order_placed',
      subtotal: 369900,
      shipping_charge: 0,
      total_price: 369900,
      gateway_order_id: 'order_rzp_cf_202',
      created_at: '2026-11-20T12:00:00.000Z',
      store_id: 2
    });

    customForgeItems.push({
      id: 602,
      order_id: 202,
      product_id: 1,
      variant_id: 2,
      quantity: 1,
      unit_price: 369900,
      total_price: 369900,
      product_name_snapshot: 'Lady Justice 1 Foot',
      variant_sku_snapshot: 'MRSH-CF-LJ-1FT',
      size_label_snapshot: '1 foot',
      height_mm_snapshot: 305,
      custom_mode_enabled: 0,
      hero_image_url: 'https://themarshans.shop/assets/products/lady-justice.png'
    });

    const res = await orderService.getCustomerOrders(googleUser, { store_id: 2 });
    assert.ok(res.orders.some(o => o.order_number === 'CF-MRSH-2026-LEGACY-ADDR'), 'Legacy order with email in shipping_address must be resolved');

    const singleLookup = await orderService.getCustomerOrderById('CF-MRSH-2026-LEGACY-ADDR', googleUser, 2);
    assert.ok(singleLookup, 'Single lookup must succeed for order matching via shipping_address.email');
    assert.strictEqual(singleLookup.order_number, 'CF-MRSH-2026-LEGACY-ADDR');
  });

  await t.test('7. Historical Guest Customer signs in with Google and claims guest orders via verified email', async () => {
    // Guest customer Priya placed an order before signing up with Google
    const guestUser = {
      uid: 'google_uid_priya_555',
      email: 'priya.sharma@example.in',
      emailVerified: true,
      displayName: 'Priya Sharma'
    };

    orders.push({
      id: 301,
      order_number: 'MRSH-GUEST-301',
      customer_id: null, // Guest checkout: no user account yet
      customer_name: 'Priya Sharma',
      customer_email: 'priya.sharma@example.in',
      customer_phone: '9820011223',
      shipping_address: JSON.stringify({
        name: 'Priya Sharma',
        phone: '9820011223',
        email: 'priya.sharma@example.in',
        address: 'B-12, Green Park',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      fulfillment_status: 'processing',
      subtotal: 399900,
      discount_total: 0,
      shipping_charge: 5000,
      total_price: 404900,
      coupon_code: null,
      courier: null,
      tracking_no: null,
      ship_date: null,
      created_at: '2026-11-21T09:00:00.000Z',
      store_id: 2
    });

    const res = await orderService.getCustomerOrders(guestUser, { store_id: 2 });
    assert.ok(res.orders.some(o => o.order_number === 'MRSH-GUEST-301'), 'Guest order must be claimed by verified Google email');
    assert.strictEqual(res.orders.length, 1);
  });

  await t.test('8. Customer with Multiple Historical User IDs sees all orders across linked profiles', async () => {
    // Simulate customer who had user ID 10 and a duplicate legacy user ID 30
    users.push({
      id: 30,
      firebase_uid: 'legacy_uid_30',
      email: 'collector@themarshans.shop', // identical email
      full_name: 'Rajesh Sharma Legacy',
      phone: '9876543210',
      created_at: new Date('2026-09-15T10:00:00Z')
    });

    orders.push({
      id: 302,
      order_number: 'MRSH-RET-LEGACY-302',
      customer_id: 30, // attached to legacy ID 30
      customer_name: 'Rajesh Sharma',
      customer_email: 'collector@themarshans.shop',
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({
        name: 'Rajesh Sharma',
        phone: '9876543210',
        email: 'collector@themarshans.shop',
        address: 'High Court',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400032'
      }),
      payment_method: 'ONLINE',
      payment_status: 'paid',
      fulfillment_status: 'delivered',
      subtotal: 150000,
      discount_total: 0,
      shipping_charge: 5000,
      total_price: 155000,
      coupon_code: null,
      courier: 'BlueDart',
      tracking_no: 'BD998877',
      ship_date: '2026-09-18T10:00:00.000Z',
      created_at: '2026-09-16T10:00:00.000Z',
      store_id: 2
    });

    const res = await orderService.getCustomerOrders(googleUser, { store_id: 2 });
    const orderNumbers = res.orders.map(o => o.order_number);
    assert.ok(orderNumbers.includes('MRSH-RET-LEGACY-302'), 'Legacy order attached to user ID 30 must be included');
    assert.ok(orderNumbers.includes('CF-MRSH-2026-0001'), 'Current Custom Forge order must be included');
    assert.ok(orderNumbers.includes('MRSH-RET-101'), 'Current retail order must be included');
  });

  await t.test('9. Population-based Cross-Customer Access Rejection', async () => {
    // 3 distinct customers:
    // User A: collector@themarshans.shop
    // User B: other.collector@example.com (id: 20)
    // User C: priya.sharma@example.in (guest)
    const userB = { uid: 'uid_b', email: 'other.collector@example.com', emailVerified: true };
    const userC = { uid: 'uid_c', email: 'priya.sharma@example.in', emailVerified: true };

    const resA = await orderService.getCustomerOrders(googleUser, { store_id: 2 });
    const resB = await orderService.getCustomerOrders(userB, { store_id: 2 });
    const resC = await orderService.getCustomerOrders(userC, { store_id: 2 });

    const numsA = new Set(resA.orders.map(o => o.order_number));
    const numsB = new Set(resB.orders.map(o => o.order_number));
    const numsC = new Set(resC.orders.map(o => o.order_number));

    // Zero overlap between A, B, and C
    for (const num of numsA) {
      assert.strictEqual(numsB.has(num), false, `User B must NOT see order ${num} belonging to A`);
      assert.strictEqual(numsC.has(num), false, `User C must NOT see order ${num} belonging to A`);
    }
    for (const num of numsB) {
      assert.strictEqual(numsA.has(num), false, `User A must NOT see order ${num} belonging to B`);
      assert.strictEqual(numsC.has(num), false, `User C must NOT see order ${num} belonging to B`);
    }
  });

  await t.test('10. Store Scoping Invariant: Store 1 orders never leak into Store 2', async () => {
    // Ensure CHP-102 (Store 1) is never accessible via store_id = 2
    const res = await orderService.getCustomerOrders(googleUser, { store_id: 2 });
    assert.ok(!res.orders.some(o => o.store_id === 1), 'No Store 1 orders in Store 2 response');
    for (const o of res.orders) {
      assert.strictEqual(o.store_id, 2, `Order ${o.order_number} must have store_id = 2`);
    }
  });

  await t.test('11. Pagination, Sorting (newest first), and Totals Integrity', async () => {
    const res = await orderService.getCustomerOrders(googleUser, { limit: 2, offset: 0, store_id: 2 });
    assert.strictEqual(res.orders.length, 2, 'Must obey limit: 2');
    assert.ok(res.total >= 3, 'Total count reflects full order population');

    // Newest first order
    const date1 = new Date(res.orders[0].created_at).getTime();
    const date2 = new Date(res.orders[1].created_at).getTime();
    assert.ok(date1 >= date2, 'Orders must be sorted in descending chronological order');
  });
});
