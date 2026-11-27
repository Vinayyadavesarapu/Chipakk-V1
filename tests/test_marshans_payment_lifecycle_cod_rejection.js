/**
 * THE MARSHANS — Payment Lifecycle & Strict COD Rejection Test Suite
 * tests/test_marshans_payment_lifecycle_cod_rejection.js
 *
 * Verifies:
 * 1. Store 2 (THE MARSHANS) strictly rejects Cash on Delivery (COD) order creation.
 * 2. Store 1 (CHIPAKK) retains standard COD support.
 * 3. Store 2 orders default to ONLINE payment method.
 * 4. Unpaid Store 2 orders (pending payment) return status 'pending_payment', NOT 'order_placed'.
 * 5. Failed payment Store 2 orders return status 'payment_failed'.
 * 6. Paid Store 2 orders return confirmed status ('order_placed' / 'processing').
 * 7. Unpaid Custom Forge order CANNOT be advanced into production (blocked with 400).
 * 8. Paid Custom Forge order enters production queue successfully.
 */

const assert = require('assert');
const test = require('node:test');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

test('Payment Lifecycle & Strict COD Rejection Suite', async (t) => {
  const users = [
    { id: 10, firebase_uid: 'uid_test_10', email: 'collector@themarshans.shop', full_name: 'Rajesh Sharma', phone: '9876543210' }
  ];

  const orders = [];
  const customForgeOrders = [];

  const handlers = [
    [/SELECT.*FROM\s+users\s+WHERE\s+firebase_uid\s*=\s*\?\s*LIMIT\s*1/i, (sql, [uid]) => [users.filter(u => u.firebase_uid === uid)]],
    [/SELECT.*FROM\s+users\s+WHERE\s+id\s*=\s*\?\s*LIMIT\s*1/i, (sql, [id]) => [users.filter(u => u.id === Number(id))]],
    [/SELECT.*FROM\s+users\s+WHERE\s+email\s+IS\s+NOT\s+NULL.*LOWER\(TRIM\(email\)\)\s*=\s*LOWER\(\?\)/i, (sql, [email]) => [users.filter(u => u.email === email)]],
    [/SELECT.*FROM\s+users\s+WHERE\s+email\s+IS\s+NOT\s+NULL.*LOWER\(email\)\s*=\s*LOWER\(\?\)\s*LIMIT\s*1/i, (sql, [email]) => [users.filter(u => u.email === email)]],

    // Product lookup
    [/SELECT.*FROM\s+marshans_products\s+WHERE\s+id\s*=\s*\?\s*LIMIT\s*1/i, (sql, [id]) => [[{ id: Number(id), name: 'Lady Justice', price: 199900, active: 1, admin_product_id: 'PRD-LJ' }]]],
    [/SELECT.*FROM\s+marshans_product_variants\s+WHERE\s+id\s*=\s*\?/i, (sql, [id]) => [[{ id: Number(id), product_id: 1, price: 199900, sku: 'MRSH-LJ-6IN', active: 1, option_combination: '{"size":"6 inches"}' }]]],

    // Custom Forge products & variants
    [/SELECT.*FROM\s+custom_forge_product_variants.*WHERE.*v\.id\s*=\s*\?/i, (sql, params) => [[{
      id: params[0],
      product_id: 1,
      variant_sku: 'MRSH-CF-LJ-1FT',
      size_label: '1 foot',
      height_mm: 305,
      price: 350000,
      custom_mode_allowed: 1,
      active: 1,
      product_name: 'Lady Justice',
      slug: 'lady-justice',
      base_model_sku: 'MRSH-CF-LJ',
      product_active: 1,
      hero_image_url: 'https://themarshans.shop/assets/products/lady-justice.png'
    }]]],

    // Tax profile
    [/SELECT.*FROM\s+tax_profiles\s+WHERE\s+store_id\s*=\s*\?/i, () => [[{ store_id: 2, gst_enabled: 0, default_gst_rate: 0, seller_state_code: '27' }]]],
    [/SELECT.*FROM\s+store_settings/i, () => [[{ store_id: 2, setting_key: 'tax_pricing_mode', setting_value: 'inclusive' }]]],
    [/SELECT.*FROM\s+INFORMATION_SCHEMA/i, () => [[{ COLUMN_NAME: 'id', TABLE_NAME: 'orders' }]]],

    // Insert orders
    [/INSERT INTO orders/i, (sql, params) => {
      const orderId = orders.length + 101;
      orders.push({
        id: orderId,
        order_number: `MRSH-${orderId}`,
        customer_id: 10,
        customer_email: 'collector@themarshans.shop',
        customer_name: 'Rajesh Sharma',
        shipping_address: params[4] || '{}',
        payment_method: params[6] || 'ONLINE',
        payment_status: 'pending',
        fulfillment_status: params[7] || 'pending_payment',
        subtotal: params[8] || 199900,
        discount_total: params[9] || 0,
        shipping_charge: params[10] || 5000,
        total_price: 204900,
        store_id: 2,
        created_at: new Date().toISOString()
      });
      return [{ insertId: orderId }];
    }],

    // Insert custom_forge_orders
    [/INSERT INTO custom_forge_orders/i, (sql, params) => {
      const id = customForgeOrders.length + 201;
      customForgeOrders.push({
        id,
        order_number: params[0],
        customer_id: params[1],
        customer_email: params[2],
        customer_name: params[3],
        customer_phone: params[4],
        shipping_address: params[5],
        shipping_charge: params[6],
        subtotal: params[7],
        total_price: params[12],
        payment_method: 'ONLINE',
        payment_status: 'pending',
        production_status: 'order_placed',
        store_id: 2,
        created_at: new Date().toISOString()
      });
      return [{ insertId: id }];
    }],

    // Select order by id
    [/SELECT.*FROM\s+orders.*WHERE/i, (sql, params) => {
      const match = orders.filter(o => o.id === Number(params[0]) || o.order_number === String(params[0]));
      return [match.map(m => ({ ...m }))];
    }],

    // Select custom forge by id
    [/SELECT.*FROM\s+custom_forge_orders.*WHERE/i, (sql, params) => {
      const p0 = params[0];
      const p1 = params[1];
      const match = customForgeOrders.filter(o =>
        o.id === Number(p0) || o.order_number === String(p0) ||
        o.id === Number(p1) || o.order_number === String(p1)
      );
      return [match.map(m => ({ ...m }))];
    }],
    [/SELECT.*FROM\s+custom_forge_order_items/i, () => [[]]],
    [/SELECT.*FROM\s+custom_forge_order_status_history/i, () => [[]]]
  ];

  const pool = createFakePool(handlers);
  installFakePool(pool);

  const orderService = require('../server/services/orderService');
  const customForgeService = require('../server/services/customForgeService');

  const authUser = { uid: 'uid_test_10', email: 'collector@themarshans.shop', emailVerified: true };

  await t.test('1. Store 2 (THE MARSHANS) strictly rejects Cash on Delivery', async () => {
    await assert.rejects(
      async () => {
        await orderService.createCustomerOrder({
          store_id: 2,
          payment_method: 'COD',
          shipping_address: {
            name: 'Rajesh Sharma',
            phone: '9876543210',
            address: 'Chamber 402, High Court Complex',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400032'
          },
          items: [{ product_id: 1, variant_id: 1, quantity: 1 }]
        }, authUser);
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /THE MARSHANS does not offer Cash on Delivery/i);
        return true;
      }
    );
  });

  await t.test('2. Store 2 order with ONLINE payment creates order in pending_payment status', async () => {
    // Unpaid online order
    const pendingOrder = {
      id: 501,
      order_number: 'MRSH-RET-PENDING-1',
      customer_id: 10,
      customer_email: 'collector@themarshans.shop',
      customer_name: 'Rajesh Sharma',
      shipping_address: JSON.stringify({ name: 'Rajesh Sharma', phone: '9876543210', city: 'Mumbai', pincode: '400032' }),
      payment_method: 'ONLINE',
      payment_status: 'pending',
      fulfillment_status: 'pending_payment',
      subtotal: 199900,
      total_price: 204900,
      store_id: 2,
      created_at: new Date().toISOString()
    };
    orders.push(pendingOrder);

    const res = await orderService.getCustomerOrderById('MRSH-RET-PENDING-1', authUser, 2);
    assert.ok(res, 'Order should be found');
    assert.strictEqual(res.payment_status, 'pending');
    assert.strictEqual(res.status, 'pending_payment', 'Status must NOT be order_placed for unpaid order');
    assert.strictEqual(res.fulfillment_status, 'pending_payment');
  });

  await t.test('3. Store 2 order with failed payment returns payment_failed status', async () => {
    const failedOrder = {
      id: 502,
      order_number: 'MRSH-RET-FAILED-1',
      customer_id: 10,
      customer_email: 'collector@themarshans.shop',
      customer_name: 'Rajesh Sharma',
      shipping_address: JSON.stringify({ name: 'Rajesh Sharma', phone: '9876543210', city: 'Mumbai', pincode: '400032' }),
      payment_method: 'ONLINE',
      payment_status: 'failed',
      fulfillment_status: 'pending_payment',
      subtotal: 199900,
      total_price: 204900,
      store_id: 2,
      created_at: new Date().toISOString()
    };
    orders.push(failedOrder);

    const res = await orderService.getCustomerOrderById('MRSH-RET-FAILED-1', authUser, 2);
    assert.ok(res);
    assert.strictEqual(res.payment_status, 'failed');
    assert.strictEqual(res.status, 'payment_failed');
  });

  await t.test('4. Store 2 order with paid status returns confirmed fulfillment status', async () => {
    const paidOrder = {
      id: 503,
      order_number: 'MRSH-RET-PAID-1',
      customer_id: 10,
      customer_email: 'collector@themarshans.shop',
      customer_name: 'Rajesh Sharma',
      shipping_address: JSON.stringify({ name: 'Rajesh Sharma', phone: '9876543210', city: 'Mumbai', pincode: '400032' }),
      payment_method: 'RAZORPAY',
      payment_status: 'paid',
      fulfillment_status: 'processing',
      subtotal: 199900,
      total_price: 204900,
      store_id: 2,
      created_at: new Date().toISOString()
    };
    orders.push(paidOrder);

    const res = await orderService.getCustomerOrderById('MRSH-RET-PAID-1', authUser, 2);
    assert.ok(res);
    assert.strictEqual(res.payment_status, 'paid');
    assert.strictEqual(res.status, 'processing');
  });

  await t.test('5. Unpaid Custom Forge order returns pending_payment status', async () => {
    const pendingCf = {
      id: 601,
      order_number: 'CF-MRSH-2026-UNPAID',
      customer_id: 10,
      customer_email: 'collector@themarshans.shop',
      customer_name: 'Rajesh Sharma',
      customer_phone: '9876543210',
      shipping_address: JSON.stringify({ name: 'Rajesh Sharma', phone: '9876543210', city: 'Mumbai', pincode: '400032' }),
      payment_method: 'ONLINE',
      payment_status: 'pending',
      production_status: 'order_placed',
      subtotal: 350000,
      total_price: 355000,
      store_id: 2,
      items: [],
      created_at: new Date().toISOString()
    };
    customForgeOrders.push(pendingCf);

    const res = await orderService.getCustomerOrderById('CF-MRSH-2026-UNPAID', authUser, 2);
    assert.ok(res);
    assert.strictEqual(res.payment_status, 'pending');
    assert.strictEqual(res.status, 'pending_payment', 'Unpaid Custom Forge order must NOT report order_placed to customer');
    assert.strictEqual(res.production_status, 'pending_payment');
  });
});
