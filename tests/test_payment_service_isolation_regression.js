const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

// In-memory data structures
const mockUsers = [
  { id: 101, firebase_uid: 'uid_store1_customer', email: 'cust1@chipakk.shop', name: 'Store 1 Customer' },
  { id: 102, firebase_uid: 'uid_store2_customer', email: 'cust2@marshans.shop', name: 'Store 2 Customer' }
];

let mockRetailOrders = [];
let mockCustomForgeOrders = [];
let mockPayments = [];
let mockCustomForgePayments = [];

function resetDb() {
  mockRetailOrders = [
    // Store 1 retail order with numeric ID 1
    {
      id: 1,
      order_number: 'ORD-CHK-2026-0001',
      customer_id: 101,
      customer_email: 'cust1@chipakk.shop',
      customer_name: 'Store 1 Customer',
      shipping_address: JSON.stringify({ phone: '9876543210', city: 'Mumbai' }),
      payment_method: 'RAZORPAY',
      payment_status: 'pending',
      fulfillment_status: 'pending',
      total_price: 15, // ₹15 (Store 1 stores whole rupees)
      gateway_order_id: 'order_rzp_store1_001',
      store_id: 1
    },
    // Store 2 retail order with numeric ID 1 (Intentional collision test scenario)
    {
      id: 1,
      order_number: 'ORD-MRSH-2026-0001',
      customer_id: 102,
      customer_email: 'cust2@marshans.shop',
      customer_name: 'Store 2 Customer',
      shipping_address: JSON.stringify({ phone: '9123456780', city: 'Bengaluru' }),
      payment_method: 'RAZORPAY',
      payment_status: 'pending',
      fulfillment_status: 'pending',
      total_price: 27000, // ₹270 (Store 2 stores paise)
      gateway_order_id: 'order_rzp_store2_001',
      store_id: 2
    },
    // Store 2 retail order with ID 2 and null gateway_order_id to test creation
    {
      id: 2,
      order_number: 'ORD-MRSH-2026-0002',
      customer_id: 102,
      customer_email: 'cust2@marshans.shop',
      customer_name: 'Store 2 Customer',
      shipping_address: JSON.stringify({ phone: '9123456780', city: 'Bengaluru' }),
      payment_method: 'RAZORPAY',
      payment_status: 'pending',
      fulfillment_status: 'pending',
      total_price: 35000,
      gateway_order_id: null,
      store_id: 2
    }
  ];

  mockCustomForgeOrders = [
    // Custom Forge order with numeric ID 1 and alphanumeric CF-MRSH-2026-0001
    {
      id: 1,
      order_number: 'CF-MRSH-2026-0001',
      customer_id: 102,
      customer_email: 'cust2@marshans.shop',
      customer_name: 'Store 2 Customer',
      customer_phone: '9123456780',
      shipping_address: JSON.stringify({ phone: '9123456780', city: 'Bengaluru' }),
      payment_method: 'RAZORPAY',
      payment_status: 'pending',
      production_status: 'order_placed',
      total_price: 350000, // ₹3,500 (Paise)
      gateway_order_id: 'order_rzp_cf_001',
      store_id: 2
    }
  ];

  mockPayments = [];
  mockCustomForgePayments = [];
}

resetDb();

// Create fake database pool
const fakePool = createFakePool([
  // findUserByFirebaseUid
  [/SELECT .* FROM users WHERE firebase_uid = \? LIMIT 1/, (sql, params) => {
    const user = mockUsers.find(u => u.firebase_uid === params[0]);
    return [[user || null].filter(Boolean)];
  }],

  // Query retail orders with store_id = 1
  [/SELECT .* FROM orders WHERE id = \? AND COALESCE\(store_id, 1\) = 1 LIMIT 1/, (sql, params) => {
    const ord = mockRetailOrders.find(o => o.id === params[0] && o.store_id === 1);
    return [[ord || null].filter(Boolean)];
  }],

  // Query retail orders with store_id = 2
  [/SELECT .* FROM orders WHERE id = \? AND COALESCE\(store_id, 1\) = 2 LIMIT 1/, (sql, params) => {
    const ord = mockRetailOrders.find(o => o.id === params[0] && o.store_id === 2);
    return [[ord || null].filter(Boolean)];
  }],

  // Query retail orders without store filter
  [/SELECT .* FROM orders WHERE id = \? LIMIT 1/, (sql, params) => {
    const ord = mockRetailOrders.find(o => o.id === params[0]);
    return [[ord || null].filter(Boolean)];
  }],

  // Query custom_forge_orders by order_number
  [/SELECT .* FROM custom_forge_orders WHERE order_number = \? AND store_id = 2 LIMIT 1/, (sql, params) => {
    const cf = mockCustomForgeOrders.find(o => o.order_number === params[0]);
    return [[cf || null].filter(Boolean)];
  }],

  // Query custom_forge_orders by (id = ? OR order_number = ?) AND store_id = 2
  [/SELECT .* FROM custom_forge_orders WHERE \(id = \? OR order_number = \?\) AND store_id = 2 LIMIT 1/, (sql, params) => {
    const cf = mockCustomForgeOrders.find(o => o.id === params[0] || o.order_number === params[1]);
    return [[cf || null].filter(Boolean)];
  }],

  // Query custom_forge_orders by gateway_order_id
  [/SELECT .* FROM custom_forge_orders WHERE gateway_order_id = \? LIMIT 1/, (sql, params) => {
    const cf = mockCustomForgeOrders.find(o => o.gateway_order_id === params[0]);
    return [[cf || null].filter(Boolean)];
  }],

  // Query orders by gateway_order_id
  [/SELECT .* FROM orders WHERE gateway_order_id = \? LIMIT 1/, (sql, params) => {
    const ord = mockRetailOrders.find(o => o.gateway_order_id === params[0]);
    return [[ord || null].filter(Boolean)];
  }],

  // Query payments by raw_event_reference
  [/SELECT id, status FROM payments WHERE raw_event_reference = \? LIMIT 1/, (sql, params) => {
    const p = mockPayments.find(x => x.raw_event_reference === params[0]);
    return [[p || null].filter(Boolean)];
  }],

  // Query coupon_usage
  [/SELECT .* FROM coupon_usage WHERE order_id = \?/, () => [[{ id: 1, coupon_id: 10 }]]],
  [/UPDATE coupon_usage SET status = 'consumed'/, () => [{ affectedRows: 1 }]],
  [/UPDATE coupons SET usage_count = usage_count \+ 1/, () => [{ affectedRows: 1 }]],

  // Query payments table
  [/SELECT id, order_id, status FROM payments WHERE gateway_payment_id = \? LIMIT 1/, (sql, params) => {
    const p = mockPayments.find(x => x.gateway_payment_id === params[0]);
    return [[p || null].filter(Boolean)];
  }],

  // Query custom_forge_payments table
  [/SELECT id, order_id, status FROM custom_forge_payments WHERE gateway_payment_id = \? LIMIT 1/, (sql, params) => {
    const p = mockCustomForgePayments.find(x => x.gateway_payment_id === params[0]);
    return [[p || null].filter(Boolean)];
  }],

  // Update orders payment_status to paid
  [/UPDATE orders SET payment_status = 'paid'.*WHERE id = \?/, (sql, params) => {
    const ord = mockRetailOrders.find(o => o.id === params[0]);
    if (ord) ord.payment_status = 'paid';
    return [{ affectedRows: 1 }];
  }],

  // Insert into payments
  [/INSERT INTO payments/, (sql, params) => {
    mockPayments.push({
      order_id: params[0],
      gateway_order_id: params[1],
      gateway_payment_id: params[2],
      gateway_signature: params[3],
      amount: params[4],
      status: 'captured'
    });
    return [{ affectedRows: 1, insertId: mockPayments.length }];
  }],

  // Insert into custom_forge_payments
  [/INSERT INTO custom_forge_payments/, (sql, params) => {
    mockCustomForgePayments.push({
      order_id: params[0],
      gateway_order_id: params[1],
      gateway_payment_id: params[2],
      gateway_signature: params[3],
      amount: params[4],
      status: 'captured'
    });
    return [{ affectedRows: 1, insertId: mockCustomForgePayments.length }];
  }],

  // custom_forge_orders updates
  [/UPDATE custom_forge_orders SET payment_status = ['"]paid['"].*WHERE id = \?/, (sql, params) => {
    // Parameter order in customForgeService: [gatewayOrderId, order.id]
    const orderId = params[params.length - 1];
    const cf = mockCustomForgeOrders.find(o => o.id === orderId);
    if (cf) cf.payment_status = 'paid';
    return [{ affectedRows: 1 }];
  }],

  // custom_forge_order_status_history insert
  [/INSERT INTO custom_forge_order_status_history/, () => [{ affectedRows: 1 }]],

  // custom_forge_order_notifications insert
  [/INSERT INTO custom_forge_order_notifications/, () => [{ affectedRows: 1 }]]
]);

installFakePool(fakePool);

// Load services after fake pool installation
const razorpayService = require('../server/services/razorpayService');
const paymentService = require('../server/services/paymentService');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const mockFetchCalls = [];

// Mock outbound Razorpay HTTP requests to prevent live gateway traffic & test credential failures
global.fetch = async (url, options = {}) => {
  if (typeof url === 'string' && url.includes('api.razorpay.com/v1/orders')) {
    mockFetchCalls.push({ url, options });
    const body = options.body ? JSON.parse(options.body) : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        entity: 'order',
        amount: body.amount,
        amount_paid: 0,
        amount_due: body.amount,
        currency: body.currency || 'INR',
        receipt: body.receipt,
        status: 'created',
        notes: body.notes || {},
        created_at: Math.floor(Date.now() / 1000)
      })
    };
  }
  if (originalFetch) return originalFetch(url, options);
  throw new Error(`Unhandled mock fetch call to: ${url}`);
};

async function runTests() {
  console.log('===============================================================');
  console.log('🛡️  RETAIL & CUSTOM FORGE PAYMENT SERVICE ISOLATION TESTS');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  const testCase = async (desc, fn) => {
    process.env = { ...originalEnv };
    // Setup test credentials
    process.env.CHIPAKK_RAZORPAY_KEY_ID = 'chipakk_key_test_123';
    process.env.CHIPAKK_RAZORPAY_KEY_SECRET = 'chipakk_secret_test_456';
    process.env.MARSHANS_RAZORPAY_KEY_ID = 'marshans_key_test_789';
    process.env.MARSHANS_RAZORPAY_KEY_SECRET = 'marshans_secret_test_012';

    try {
      await fn();
      console.log(`[PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${desc}:`, err.message);
      failed++;
    }
  };

  const user1 = { uid: 'uid_store1_customer', email: 'cust1@chipakk.shop', email_verified: true };
  const user2 = { uid: 'uid_store2_customer', email: 'cust2@marshans.shop', email_verified: true };

  // 1. Store 1 Retail Order Payment Creation
  await testCase('1.1 Store 1 retail order resolves under Store 1 and converts whole INR to paise', async () => {
    mockFetchCalls.length = 0;
    const res = await paymentService.createPaymentOrder(1, user1, 1);
    assert.equal(res.key_id, 'chipakk_key_test_123');
    assert.equal(res.order_number, 'ORD-CHK-2026-0001');
    assert.equal(res.amount, 1500); // ₹15 * 100 paise
    assert.equal(mockFetchCalls.length, 1);
    const expectedAuth = 'Basic ' + Buffer.from('chipakk_key_test_123:chipakk_secret_test_456').toString('base64');
    assert.equal(mockFetchCalls[0].options.headers.Authorization, expectedAuth);
  });

  // 1.2 Store 1 Cross-Store Protection
  await testCase('1.2 Cross-store attempt: Store 1 customer requesting Store 1 order under Store 2 is rejected', async () => {
    await assert.rejects(async () => {
      // Under reqStoreId: 2, retail query filters COALESCE(store_id, 1) = 2, which matches Store 2 order (belonging to user 2)
      await paymentService.createPaymentOrder(1, user1, 2);
    }, (err) => {
      assert.equal(err.status, 403);
      return true;
    });
  });

  // 2. Store 2 Retail Order Payment Creation
  await testCase('2.1 Store 2 retail order resolves under Store 2 and preserves paise directly', async () => {
    mockFetchCalls.length = 0;
    const res = await paymentService.createPaymentOrder(1, user2, 2);
    assert.equal(res.key_id, 'marshans_key_test_789');
    assert.equal(res.order_number, 'ORD-MRSH-2026-0001');
    assert.equal(res.amount, 27000); // 27000 paise preserved
    assert.equal(mockFetchCalls.length, 1);
    const expectedAuth = 'Basic ' + Buffer.from('marshans_key_test_789:marshans_secret_test_012').toString('base64');
    assert.equal(mockFetchCalls[0].options.headers.Authorization, expectedAuth);
  });

  // 2.2 Store 2 Strict Credential Isolation (No Fallback)
  await testCase('2.2 Store 2 rejects payment creation if MARSHANS keys missing, even if CHIPAKK keys exist', async () => {
    delete process.env.MARSHANS_RAZORPAY_KEY_ID;
    delete process.env.MARSHANS_RAZORPAY_KEY_SECRET;
    await assert.rejects(async () => {
      // Order ID 2 has no gateway_order_id, forcing createRazorpayOrder call
      await paymentService.createPaymentOrder(2, user2, 2);
    }, (err) => {
      assert.match(err.message, /MARSHANS_RAZORPAY_KEY_ID and MARSHANS_RAZORPAY_KEY_SECRET/);
      return true;
    });
  });

  // 3. Custom Forge Order Disambiguation & Isolation
  await testCase('3.1 Custom Forge order (CF- prefix) resolves directly to Store 2 and uses MARSHANS keys', async () => {
    mockFetchCalls.length = 0;
    const res = await paymentService.createPaymentOrder('CF-MRSH-2026-0001', user2, 2);
    assert.equal(res.key_id, 'marshans_key_test_789');
    assert.equal(res.order_number, 'CF-MRSH-2026-0001');
    assert.equal(res.amount, 350000); // ₹3,500
    assert.equal(mockFetchCalls.length, 1);
    const expectedAuth = 'Basic ' + Buffer.from('marshans_key_test_789:marshans_secret_test_012').toString('base64');
    assert.equal(mockFetchCalls[0].options.headers.Authorization, expectedAuth);
  });

  await testCase('3.2 Custom Forge order requested with Store 1 header is rejected with 403', async () => {
    await assert.rejects(async () => {
      await paymentService.createPaymentOrder('CF-MRSH-2026-0001', user2, 1);
    }, (err) => {
      assert.equal(err.status, 403);
      assert.match(err.message, /Cross-store order access denied/);
      return true;
    });
  });

  // 4. Payment Verification Signature & Table Segregation
  await testCase('4.1 Store 1 verification marks retail orders paid and inserts into payments table only', async () => {
    const rzpOrderId = 'order_rzp_store1_001';
    const rzpPaymentId = 'pay_store1_verify_001';
    const sig = crypto.createHmac('sha256', 'chipakk_secret_test_456').update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');

    const initialCfPaymentsCount = mockCustomForgePayments.length;
    const res = await paymentService.verifyPayment({
      order_id: 1,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: sig
    }, user1, 1);

    assert.equal(res.success, true);
    assert.equal(res.payment_status, 'paid');
    // Verify retail payment table received the record
    assert.equal(mockPayments.some(p => p.gateway_payment_id === rzpPaymentId), true);
    // Verify custom forge payment table was NOT touched
    assert.equal(mockCustomForgePayments.length, initialCfPaymentsCount);
  });

  await testCase('4.2 Custom Forge verification updates custom_forge_orders and custom_forge_payments only', async () => {
    const rzpOrderId = 'order_rzp_cf_001';
    const rzpPaymentId = 'pay_cf_verify_001';
    const sig = crypto.createHmac('sha256', 'marshans_secret_test_012').update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');

    const initialRetailPaymentsCount = mockPayments.length;
    const res = await paymentService.verifyPayment({
      order_id: 'CF-MRSH-2026-0001',
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: sig
    }, user2, 2);

    assert.equal(res.success, true);
    assert.equal(res.payment_status, 'paid');
    // Verify custom forge order was marked paid
    const cfOrder = mockCustomForgeOrders.find(o => o.order_number === 'CF-MRSH-2026-0001');
    assert.equal(cfOrder.payment_status, 'paid');
    // Verify retail payments table was NEVER touched
    assert.equal(mockPayments.length, initialRetailPaymentsCount);
  });

  // 5. Payment Verification Idempotency
  await testCase('5.1 Duplicate payment verification calls return already_paid without re-running mutations', async () => {
    const rzpOrderId = 'order_rzp_cf_001';
    const rzpPaymentId = 'pay_cf_verify_001';
    const sig = crypto.createHmac('sha256', 'marshans_secret_test_012').update(`${rzpOrderId}|${rzpPaymentId}`).digest('hex');

    const res = await paymentService.verifyPayment({
      order_id: 'CF-MRSH-2026-0001',
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: rzpPaymentId,
      razorpay_signature: sig
    }, user2, 2);

    assert.equal(res.success, true);
    assert.equal(res.already_paid, true);
  });

  // 6. Payment Status Lookup Isolation
  await testCase('6.1 getPaymentStatus resolves Store 1 retail order status with Store 1 headers', async () => {
    const st = await paymentService.getPaymentStatus(1, user1, 1);
    assert.equal(st.order_number, 'ORD-CHK-2026-0001');
    assert.equal(st.is_custom_forge, undefined);
  });

  await testCase('6.2 getPaymentStatus resolves Custom Forge order status with Store 2 headers', async () => {
    const st = await paymentService.getPaymentStatus('CF-MRSH-2026-0001', user2, 2);
    assert.equal(st.order_number, 'CF-MRSH-2026-0001');
    assert.equal(st.is_custom_forge, true);
  });

  // 7. Webhook Reconciliation & Idempotency
  await testCase('7.1 Webhook reconciliation reconciles retail order and marks paid', async () => {
    // Reset retail order 1 to pending
    const ord1 = mockRetailOrders.find(o => o.id === 1 && o.store_id === 1);
    ord1.payment_status = 'pending';
    ord1.gateway_order_id = 'order_rzp_webhook_retail_001';

    process.env.CHIPAKK_RAZORPAY_WEBHOOK_SECRET = 'webhook_sec_test_123';

    const payload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'payment.captured',
      event_id: 'evt_test_retail_001',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_webhook_retail_001',
            order_id: 'order_rzp_webhook_retail_001',
            amount: 1500,
            status: 'captured',
            method: 'upi'
          }
        }
      }
    });

    const sig = crypto.createHmac('sha256', 'webhook_sec_test_123').update(payload).digest('hex');
    const res = await paymentService.handleWebhook(payload, sig);
    assert.equal(res.status, 'reconciled');
    assert.equal(ord1.payment_status, 'paid');
  });

  await testCase('7.2 Duplicate webhook delivery is handled idempotently without re-running updates', async () => {
    process.env.CHIPAKK_RAZORPAY_WEBHOOK_SECRET = 'webhook_sec_test_123';

    // Event evt_test_retail_001 now has a mock payment with raw_event_reference
    mockPayments.push({
      order_id: 1,
      gateway_order_id: 'order_rzp_webhook_retail_001',
      gateway_payment_id: 'pay_rzp_webhook_retail_001',
      raw_event_reference: 'evt_test_retail_001',
      status: 'captured'
    });

    const payload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      event_id: 'evt_test_retail_001',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_webhook_retail_001',
            order_id: 'order_rzp_webhook_retail_001',
            amount: 1500
          }
        }
      }
    });

    const sig = crypto.createHmac('sha256', 'webhook_sec_test_123').update(payload).digest('hex');
    const res = await paymentService.handleWebhook(payload, sig);
    assert.equal(res.status, 'already_processed');
    assert.equal(res.event_id, 'evt_test_retail_001');
  });

  await testCase('7.3 Webhook reconciliation reconciles Custom Forge order to paid via customForgeService', async () => {
    const cf = mockCustomForgeOrders.find(o => o.order_number === 'CF-MRSH-2026-0001');
    cf.payment_status = 'pending';
    cf.gateway_order_id = 'order_rzp_webhook_cf_001';

    process.env.MARSHANS_RAZORPAY_WEBHOOK_SECRET = 'webhook_sec_marshans_456';

    const payload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      event_id: 'evt_test_cf_001',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_webhook_cf_001',
            order_id: 'order_rzp_webhook_cf_001',
            amount: 350000,
            status: 'captured',
            method: 'netbanking'
          }
        }
      }
    });

    const sig = crypto.createHmac('sha256', 'webhook_sec_marshans_456').update(payload).digest('hex');
    const res = await paymentService.handleWebhook(payload, sig);
    assert.equal(res.status, 'reconciled');
    assert.equal(res.payment_status, 'paid');
    assert.equal(cf.payment_status, 'paid');
  });

  console.log('\n===============================================================');
  console.log(`TOTAL ISOLATION TESTS: ${passed + failed}`);
  console.log(`PASSED:                ${passed}`);
  console.log(`FAILED:                ${failed}`);
  console.log('===============================================================\n');

  // Restore fetch
  global.fetch = originalFetch;

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Test runner fatal error:', e);
  process.exit(1);
});
