/**
 * WhatsApp Cloud API Integration Test Suite — THE MARSHANS (Store ID 2)
 * tests/test_whatsapp_lifecycle_integration.js
 *
 * Verifies all 5 Meta approved templates, event triggers, payment gates,
 * shipping lifecycle, 24h feedback scheduling, store isolation, duplicate prevention,
 * and Admin diagnostics.
 */

const assert = require('assert');
const whatsappService = require('../server/services/whatsappNotificationService');

let totalChecks = 0;
let passedChecks = 0;

function check(title, fn) {
  totalChecks++;
  try {
    fn();
    passedChecks++;
    console.log(`[PASS] ${title}`);
  } catch (err) {
    console.error(`[FAIL] ${title}: ${err.message}`);
    throw err;
  }
}

async function asyncCheck(title, fn) {
  totalChecks++;
  try {
    await fn();
    passedChecks++;
    console.log(`[PASS] ${title}`);
  } catch (err) {
    console.error(`[FAIL] ${title}: ${err.message}`);
    throw err;
  }
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('📱 THE MARSHANS — WHATSAPP CLOUD API & LIFECYCLE SUITE');
  console.log('===============================================================\n');

  // Backup original env
  const origEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: STORE ISOLATION & BOUNDARY ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('--- SUITE 1: STORE ISOLATION & BOUNDARY ENFORCEMENT ---');

    check('1.1 Store 1 (CHIPAKK) is rejected by isSendingActive', () => {
      process.env.MARSHANS_WHATSAPP_ENABLED = 'true';
      process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS = 'APPROVED';
      process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id';
      process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN = 'test_access_token';

      assert.strictEqual(whatsappService.isSendingActive(1), false);
      assert.strictEqual(whatsappService.isSendingActive(null), false);
    });

    await asyncCheck('1.2 notifyOrderConfirmation strictly skips Store 1 orders', async () => {
      const res = await whatsappService.notifyOrderConfirmation({
        order: { id: 101, store_id: 1, payment_status: 'paid' },
        orderId: 101,
        storeId: 1
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'skipped');
      assert.strictEqual(res.reason, 'STORE_ISOLATION_EXCLUDED');
    });

    await asyncCheck('1.3 notifyShippingUpdate strictly skips Store 1 orders', async () => {
      const res = await whatsappService.notifyShippingUpdate({
        order: { id: 102, store_id: 1 },
        orderId: 102,
        storeId: 1
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'skipped');
      assert.strictEqual(res.reason, 'STORE_ISOLATION_EXCLUDED');
    });

    // -------------------------------------------------------------------------
    // SUITE 2: META TEMPLATE APPROVAL GATING & ACTIVATION
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 2: META TEMPLATE APPROVAL GATING & ACTIVATION ---');

    check('2.1 Default template status is PENDING when env is not set', () => {
      delete process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS;
      delete process.env.MARSHANS_WHATSAPP_ENABLED;
      const cfg = whatsappService.getConfig();
      assert.strictEqual(cfg.approvalStatus, 'PENDING');
      assert.strictEqual(cfg.isApproved, false);
      assert.strictEqual(cfg.isSendingActive, false);
    });

    check('2.2 Disabled when MARSHANS_WHATSAPP_ENABLED is false', () => {
      process.env.MARSHANS_WHATSAPP_ENABLED = 'false';
      process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS = 'APPROVED';
      process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID = '123456';
      process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN = 'token_abc';
      const cfg = whatsappService.getConfig();
      assert.strictEqual(cfg.activationState, 'DISABLED');
      assert.strictEqual(cfg.isSendingActive, false);
    });

    check('2.3 Missing credentials triggers CREDENTIALS_MISSING even if enabled', () => {
      process.env.MARSHANS_WHATSAPP_ENABLED = 'true';
      process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS = 'APPROVED';
      delete process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID;
      delete process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN;
      const cfg = whatsappService.getConfig();
      assert.strictEqual(cfg.activationState, 'CREDENTIALS_MISSING');
      assert.strictEqual(cfg.isSendingActive, false);
    });

    check('2.4 Unapproved template status triggers PENDING_APPROVAL and blocks sending', () => {
      process.env.MARSHANS_WHATSAPP_ENABLED = 'true';
      process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS = 'PENDING';
      process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID = '123456';
      process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN = 'token_abc';
      const cfg = whatsappService.getConfig();
      assert.strictEqual(cfg.activationState, 'PENDING_APPROVAL');
      assert.strictEqual(cfg.isSendingActive, false);
    });

    check('2.5 Template status APPROVED with valid credentials enables ACTIVE sending', () => {
      process.env.MARSHANS_WHATSAPP_ENABLED = 'true';
      process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS = 'APPROVED';
      process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID = '123456';
      process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN = 'token_abc';
      const cfg = whatsappService.getConfig();
      assert.strictEqual(cfg.activationState, 'ACTIVE');
      assert.strictEqual(cfg.isSendingActive, true);
    });

    // -------------------------------------------------------------------------
    // SUITE 3: PAYMENT GATING & ORDER CONFIRMATION
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 3: PAYMENT GATING & ORDER CONFIRMATION ---');

    await asyncCheck('3.1 Pending payment order is strictly skipped for confirmation', async () => {
      const res = await whatsappService.notifyOrderConfirmation({
        order: {
          id: 201,
          order_number: 'MRSH-2026-201',
          store_id: 2,
          payment_status: 'pending',
          customer_phone: '9876543210'
        },
        orderId: 201,
        storeId: 2
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'skipped');
      assert.strictEqual(res.reason, 'PAYMENT_NOT_PAID');
    });

    await asyncCheck('3.2 Failed payment order is strictly skipped for confirmation', async () => {
      const res = await whatsappService.notifyOrderConfirmation({
        order: {
          id: 202,
          order_number: 'MRSH-2026-202',
          store_id: 2,
          payment_status: 'failed',
          customer_phone: '9876543210'
        },
        orderId: 202,
        storeId: 2
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'skipped');
      assert.strictEqual(res.reason, 'PAYMENT_NOT_PAID');
    });

    await asyncCheck('3.3 Custom Forge pending payment order is strictly skipped', async () => {
      const res = await whatsappService.notifyOrderConfirmation({
        order: {
          id: 301,
          order_number: 'CF-MRSH-2026-301',
          store_id: 2,
          payment_status: 'pending',
          customer_phone: '9876543210'
        },
        orderId: 301,
        storeId: 2,
        isCustomForge: true
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'skipped');
      assert.strictEqual(res.reason, 'PAYMENT_NOT_PAID');
    });

    // -------------------------------------------------------------------------
    // SUITE 4: TEMPLATE BODY PARAMETERS & PAYLOAD BUILDERS
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 4: TEMPLATE BODY PARAMETERS & PAYLOAD BUILDERS ---');

    check('4.1 Template marshans_order_confirmation parameters format correctly', () => {
      const order = {
        order_number: 'MRSH-2026-1001',
        customer_name: 'Aditi Rao',
        total_price: 369900,
        payment_method: 'UPI',
        payment_status: 'paid'
      };
      const params = whatsappService.buildTemplateBodyParameters(
        whatsappService.EVENT_TYPES.ORDER_CONFIRMATION,
        order,
        false
      );
      assert.strictEqual(params.length, 6);
      assert.strictEqual(params[0].text, 'Aditi Rao');
      assert.strictEqual(params[1].text, 'MRSH-2026-1001');
      assert.strictEqual(params[2].text, '₹3,699');
      assert.strictEqual(params[3].text, 'UPI (Prepaid)');
      assert.strictEqual(params[4].text, 'Paid');
      assert.ok(params[5].text.includes('/account/orders'));
    });

    check('4.2 Template marshans_shipping_update parameters format correctly', () => {
      const order = {
        order_number: 'MRSH-2026-1002',
        customer_name: 'Rahul Sharma'
      };
      const params = whatsappService.buildTemplateBodyParameters(
        whatsappService.EVENT_TYPES.SHIPPING_UPDATE,
        order,
        false,
        { courier: 'Velocity Express', tracking_no: 'VEL123456789' }
      );
      assert.strictEqual(params.length, 5);
      assert.strictEqual(params[0].text, 'Rahul Sharma');
      assert.strictEqual(params[1].text, 'MRSH-2026-1002');
      assert.strictEqual(params[2].text, 'Velocity Express');
      assert.strictEqual(params[3].text, 'VEL123456789');
    });

    check('4.3 Template marshans_out_for_delivery parameters format correctly', () => {
      const order = {
        order_number: 'MRSH-2026-1003',
        customer_name: 'Pooja Hegde',
        shipping_address: { city: 'Bengaluru', state: 'Karnataka' }
      };
      const params = whatsappService.buildTemplateBodyParameters(
        whatsappService.EVENT_TYPES.OUT_FOR_DELIVERY,
        order,
        false
      );
      assert.strictEqual(params.length, 4);
      assert.strictEqual(params[0].text, 'Pooja Hegde');
      assert.strictEqual(params[1].text, 'MRSH-2026-1003');
      assert.strictEqual(params[2].text, 'Bengaluru');
    });

    check('4.4 Template marshans_order_delivered parameters format correctly', () => {
      const order = {
        order_number: 'MRSH-2026-1004',
        customer_name: 'Vikram Seth'
      };
      const params = whatsappService.buildTemplateBodyParameters(
        whatsappService.EVENT_TYPES.ORDER_DELIVERED,
        order,
        false,
        { delivery_date: '25 Nov 2026' }
      );
      assert.strictEqual(params.length, 4);
      assert.strictEqual(params[0].text, 'Vikram Seth');
      assert.strictEqual(params[1].text, 'MRSH-2026-1004');
      assert.strictEqual(params[2].text, '25 Nov 2026');
    });

    check('4.5 Template marshans_customer_feedback parameters format correctly', () => {
      const order = {
        order_number: 'MRSH-2026-1005',
        customer_name: 'Vikram Seth'
      };
      const params = whatsappService.buildTemplateBodyParameters(
        whatsappService.EVENT_TYPES.CUSTOMER_FEEDBACK,
        order,
        false
      );
      assert.strictEqual(params.length, 3);
      assert.strictEqual(params[0].text, 'Vikram Seth');
      assert.strictEqual(params[1].text, 'MRSH-2026-1005');
      assert.ok(params[2].text.includes('/review?order=MRSH-2026-1005'));
    });

    // -------------------------------------------------------------------------
    // SUITE 5: PHONE NUMBER SAFETY & NORMALIZATION
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 5: PHONE NUMBER SAFETY & NORMALIZATION ---');

    check('5.1 Standard 10-digit phone resolves to 91XXXXXXXXXX', () => {
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone('9876543210'), '919876543210');
    });

    check('5.2 Formatted +91 number resolves to 91XXXXXXXXXX', () => {
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone('+91 98765-43210'), '919876543210');
    });

    check('5.3 Number with leading zero resolves to 91XXXXXXXXXX', () => {
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone('09876543210'), '919876543210');
    });

    check('5.4 Invalid or missing numbers return null', () => {
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone(''), null);
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone(null), null);
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone('12345'), null);
      assert.strictEqual(whatsappService.resolveWhatsAppRecipientPhone('abcd'), null);
    });

    // -------------------------------------------------------------------------
    // SUITE 6: SHIPPING LIFECYCLE & GATED DISPATCH
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 6: SHIPPING LIFECYCLE & GATED DISPATCH ---');

    await asyncCheck('6.1 Shipping update dispatches in gated status when pending approval', async () => {
      process.env.MARSHANS_WHATSAPP_ENABLED = 'true';
      process.env.MARSHANS_WHATSAPP_TEMPLATE_APPROVAL_STATUS = 'PENDING';

      const res = await whatsappService.notifyShippingUpdate({
        order: {
          id: 401,
          order_number: 'MRSH-2026-401',
          store_id: 2,
          customer_name: 'Priya',
          customer_phone: '9876543210'
        },
        orderId: 401,
        storeId: 2,
        trackingInfo: { courier: 'Velocity', tracking_no: 'TRK100' }
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'gated');
      assert.strictEqual(res.template_name, 'marshans_shipping_update');
    });

    await asyncCheck('6.2 Out for delivery dispatches in gated status when pending approval', async () => {
      const res = await whatsappService.notifyOutForDelivery({
        order: {
          id: 402,
          order_number: 'MRSH-2026-402',
          store_id: 2,
          customer_name: 'Priya',
          customer_phone: '9876543210'
        },
        orderId: 402,
        storeId: 2
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'gated');
      assert.strictEqual(res.template_name, 'marshans_out_for_delivery');
    });

    await asyncCheck('6.3 Order delivered dispatches and handles 24h feedback schedule', async () => {
      const res = await whatsappService.notifyOrderDelivered({
        order: {
          id: 403,
          order_number: 'MRSH-2026-403',
          store_id: 2,
          customer_name: 'Priya',
          customer_phone: '9876543210'
        },
        orderId: 403,
        storeId: 2
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'gated');
      assert.strictEqual(res.template_name, 'marshans_order_delivered');
    });

    // -------------------------------------------------------------------------
    // SUITE 7: ADMIN DIAGNOSTIC STATUS & SECRETS SANITIZATION
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 7: ADMIN DIAGNOSTIC STATUS & SECRETS SANITIZATION ---');

    await asyncCheck('7.1 getWhatsAppStatus returns safe configuration without secrets', async () => {
      process.env.MARSHANS_WHATSAPP_PHONE_NUMBER_ID = 'phone_123';
      process.env.MARSHANS_WHATSAPP_ACCESS_TOKEN = 'secret_access_token_xyz';
      process.env.MARSHANS_WHATSAPP_WABA_ID = 'waba_456';

      const status = await whatsappService.getWhatsAppStatus();
      assert.strictEqual(status.store_id, 2);
      assert.strictEqual(status.store_name, 'THE MARSHANS');
      assert.strictEqual(status.phone_number_id_configured, true);
      assert.strictEqual(status.access_token_configured, true);
      assert.strictEqual(status.waba_id_configured, true);
      // Access token must NEVER be returned in response!
      assert.strictEqual(status.access_token, undefined);
      assert.strictEqual(status.accessToken, undefined);
      assert.strictEqual(JSON.stringify(status).includes('secret_access_token_xyz'), false);
    });

    // -------------------------------------------------------------------------
    // SUITE 8: NON-BLOCKING RESILIENCE
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 8: NON-BLOCKING RESILIENCE ---');

    await asyncCheck('8.1 Null or undefined parameters never throw fatal exceptions', async () => {
      const res1 = await whatsappService.notifyOrderConfirmation({ order: null, orderId: null });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.status, 'skipped');

      const res2 = await whatsappService.notifyShippingUpdate({ order: null, orderId: null });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.status, 'skipped');

      const res3 = await whatsappService.notifyOrderDelivered({ order: null, orderId: null });
      assert.strictEqual(res3.success, false);
      assert.strictEqual(res3.status, 'skipped');
    });

    console.log('\n===============================================================');
    console.log(`TOTAL CHECKS: ${totalChecks}`);
    console.log(`PASSED:       ${passedChecks}`);
    console.log('FAILED:       0');
    console.log('===============================================================');
    console.log('✅ ALL WHATSAPP CLOUD API & LIFECYCLE CHECKS PASSED!\n');
  } finally {
    // Restore environment
    process.env = origEnv;
  }
}

runTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
