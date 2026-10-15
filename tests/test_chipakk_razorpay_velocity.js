const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const razorpayService = require('../server/services/razorpayService');
const velocityService = require('../server/services/velocityService');
const paymentService = require('../server/services/paymentService');

// Save original environment
const originalEnv = { ...process.env };

test.afterEach(() => {
  // Restore environment after each test
  process.env = { ...originalEnv };
  velocityService.resetTokenCache();
});

test.after(() => {
  process.env = originalEnv;
});

test('1. Money model: Store 1 converts whole INR to paise, Store 2 preserves paise', () => {
  // Store 1: DB stores 15 (₹15) -> 1500 paise
  const store1Paise = paymentService.toGatewayPaise(15, 1);
  assert.equal(store1Paise, 1500);

  // Store 2: DB stores 27000 (₹270) -> 27000 paise
  const store2Paise = paymentService.toGatewayPaise(27000, 2);
  assert.equal(store2Paise, 27000);

  // Fallback to Store 1 whole rupees when storeId not specified
  assert.equal(paymentService.toGatewayPaise(15, null), 1500);
});

test('2. Razorpay credential resolution: store-specific with fallback', () => {
  process.env.RAZORPAY_KEY_ID = 'shared_key_id';
  process.env.RAZORPAY_KEY_SECRET = 'shared_key_secret';
  delete process.env.CHIPAKK_RAZORPAY_KEY_ID;
  delete process.env.CHIPAKK_RAZORPAY_KEY_SECRET;
  delete process.env.MARSHANS_RAZORPAY_KEY_ID;
  delete process.env.MARSHANS_RAZORPAY_KEY_SECRET;

  // With shared env only
  assert.equal(razorpayService.getKeyId(1), 'shared_key_id');
  assert.equal(razorpayService.getKeyId(2), 'shared_key_id');
  assert.equal(razorpayService.isConfigured(1), true);
  assert.equal(razorpayService.isConfigured(2), true);

  // With store-specific override
  process.env.CHIPAKK_RAZORPAY_KEY_ID = 'chipakk_key_id';
  process.env.CHIPAKK_RAZORPAY_KEY_SECRET = 'chipakk_key_secret';
  process.env.MARSHANS_RAZORPAY_KEY_ID = 'marshans_key_id';
  process.env.MARSHANS_RAZORPAY_KEY_SECRET = 'marshans_key_secret';

  assert.equal(razorpayService.getKeyId(1), 'chipakk_key_id');
  assert.equal(razorpayService.getKeyId(2), 'marshans_key_id');
  assert.equal(razorpayService.isConfigured(1), true);
  assert.equal(razorpayService.isConfigured(2), true);
});

test('3. Razorpay payment signature verification works for both Store 1 and Store 2', () => {
  process.env.CHIPAKK_RAZORPAY_KEY_ID = 'chipakk_key';
  process.env.CHIPAKK_RAZORPAY_KEY_SECRET = 'chipakk_secret_9988';
  process.env.MARSHANS_RAZORPAY_KEY_ID = 'marshans_key';
  process.env.MARSHANS_RAZORPAY_KEY_SECRET = 'marshans_secret_1122';

  const orderId1 = 'order_chipakk_001';
  const payId1 = 'pay_chipakk_001';
  const sig1 = crypto
    .createHmac('sha256', 'chipakk_secret_9988')
    .update(`${orderId1}|${payId1}`)
    .digest('hex');

  // Verify Store 1 signature
  const validStore1 = razorpayService.verifyPaymentSignature({
    razorpay_order_id: orderId1,
    razorpay_payment_id: payId1,
    razorpay_signature: sig1,
    storeId: 1
  });
  assert.equal(validStore1, true);

  // Store 2 secret should reject Store 1 signature
  const crossStoreSig = razorpayService.verifyPaymentSignature({
    razorpay_order_id: orderId1,
    razorpay_payment_id: payId1,
    razorpay_signature: sig1,
    storeId: 2
  });
  assert.equal(crossStoreSig, false);

  // Verify Store 2 signature
  const orderId2 = 'order_marshans_002';
  const payId2 = 'pay_marshans_002';
  const sig2 = crypto
    .createHmac('sha256', 'marshans_secret_1122')
    .update(`${orderId2}|${payId2}`)
    .digest('hex');

  const validStore2 = razorpayService.verifyPaymentSignature({
    razorpay_order_id: orderId2,
    razorpay_payment_id: payId2,
    razorpay_signature: sig2,
    storeId: 2
  });
  assert.equal(validStore2, true);
});

test('4. Razorpay webhook signature verification with multi-secret fallback', () => {
  process.env.CHIPAKK_RAZORPAY_WEBHOOK_SECRET = 'chipakk_wh_secret';
  process.env.MARSHANS_RAZORPAY_WEBHOOK_SECRET = 'marshans_wh_secret';
  delete process.env.RAZORPAY_WEBHOOK_SECRET;

  const payload = JSON.stringify({ event: 'payment.captured' });
  const sigChipakk = crypto.createHmac('sha256', 'chipakk_wh_secret').update(payload).digest('hex');
  const sigMarshans = crypto.createHmac('sha256', 'marshans_wh_secret').update(payload).digest('hex');
  const fakeSig = crypto.createHmac('sha256', 'wrong_secret').update(payload).digest('hex');

  // Multi-secret fallback validates both
  assert.equal(razorpayService.verifyWebhookSignature({ rawBody: payload, signature: sigChipakk }), true);
  assert.equal(razorpayService.verifyWebhookSignature({ rawBody: payload, signature: sigMarshans }), true);
  assert.equal(razorpayService.verifyWebhookSignature({ rawBody: payload, signature: fakeSig }), false);
});

test('5. Velocity pickup pincode resolution for Store 1 vs Store 2', () => {
  delete process.env.CHIPAKK_PICKUP_PINCODE;
  process.env.MARSHANS_PICKUP_PINCODE = '500090';

  // Store 1 pickup is unconfigured
  assert.equal(velocityService.isPickupConfigured(1), false);
  assert.throws(() => velocityService.getPickupPincode(1), /CHIPAKK_PICKUP_PINCODE/);

  // Store 2 pickup is configured
  assert.equal(velocityService.isPickupConfigured(2), true);
  assert.equal(velocityService.getPickupPincode(2), '500090');

  // Configure Store 1 pickup
  process.env.CHIPAKK_PICKUP_PINCODE = '500001';
  assert.equal(velocityService.isPickupConfigured(1), true);
  assert.equal(velocityService.getPickupPincode(1), '500001');
});

test('6. Velocity serviceability check returns unavailable gracefully when Store 1 pickup PIN is missing', async () => {
  delete process.env.CHIPAKK_PICKUP_PINCODE;
  process.env.VELOCITY_USERNAME = 'user';
  process.env.VELOCITY_PASSWORD = 'pass';

  const result = await velocityService.checkServiceability({
    to: '560001',
    payment_mode: 'prepaid',
    storeId: 1
  });

  assert.equal(result.serviceable, false);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.carriers, []);
});

test('7. Velocity forward shipment creation requires warehouse_id and valid package dimensions', async () => {
  // Should reject payload without warehouse_id
  await assert.rejects(
    () => velocityService.createForwardShipment({
      order_id: 123,
      length: 10,
      breadth: 10,
      height: 2,
      weight: 0.1
      // warehouse_id missing
    }, 1),
    (err) => err.statusCode === 422 && err.code === 'INVALID_SHIPMENT_SPECIFICATIONS'
  );

  // Should reject invalid dimensions
  await assert.rejects(
    () => velocityService.createForwardShipment({
      order_id: 123,
      warehouse_id: 'WH-01',
      length: 0,
      breadth: 10,
      height: 2,
      weight: 0.1
    }, 1),
    (err) => err.statusCode === 422
  );
});

test('8. Velocity shipment tracking rejects empty AWB', async () => {
  await assert.rejects(
    () => velocityService.trackShipment('', 1),
    (err) => err.statusCode === 400
  );
  await assert.rejects(
    () => velocityService.trackShipment([], 1),
    (err) => err.statusCode === 400
  );
});
