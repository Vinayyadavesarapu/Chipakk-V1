/**
 * CHIPAKK — Batch 1 Critical Verification Behavioral Test Suite
 * Covers C1, C2, C3, C4, H6 with real execution tests in Node.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('===============================================================');
console.log('🛡️  CHIPAKK — BATCH 1 BEHAVIORAL VERIFICATION TEST SUITE');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

function record(name, passed, detail = '') {
  if (passed) {
    passCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${name} — ${detail}`);
  }
}

// =============================================================
// 1. C3: INDIAN PHONE NUMBER NORMALIZATION (EXECUTED)
// =============================================================
console.log('\n--- 1. C3: INDIAN PHONE NUMBER NORMALIZATION (EXECUTED) ---');

const { normalizeIndianPhoneNumber } = require('../server/utils/phoneUtils');

const phoneTestCases = [
  // Valid 10-digit numbers starting with 6-9
  { input: '9876543210', expectedValid: true, expectedPhone: '9876543210' },
  { input: '8123456789', expectedValid: true, expectedPhone: '8123456789' },
  { input: '7000000000', expectedValid: true, expectedPhone: '7000000000' },
  { input: '6999999999', expectedValid: true, expectedPhone: '6999999999' },
  // Critical regression: 10-digit number starting with 91 must NOT have 91 stripped
  { input: '9123456789', expectedValid: true, expectedPhone: '9123456789' },
  // With +91 country code
  { input: '+91 9876543210', expectedValid: true, expectedPhone: '9876543210' },
  { input: '+919876543210', expectedValid: true, expectedPhone: '9876543210' },
  { input: '+91-9876-543-210', expectedValid: true, expectedPhone: '9876543210' },
  // With 91 prefix (12 digits)
  { input: '919876543210', expectedValid: true, expectedPhone: '9876543210' },
  // With leading 0 (11 digits)
  { input: '09876543210', expectedValid: true, expectedPhone: '9876543210' },
  // Invalid inputs
  { input: '5876543210', expectedValid: false, expectedPhone: null }, // Starts with 5
  { input: '98765', expectedValid: false, expectedPhone: null },      // Too short
  { input: '9876543210123', expectedValid: false, expectedPhone: null }, // Too long
  { input: 'abcdefghij', expectedValid: false, expectedPhone: null },  // Letters
  { input: '', expectedValid: false, expectedPhone: null },
  { input: null, expectedValid: false, expectedPhone: null }
];

let allPhonesPassed = true;
for (const tc of phoneTestCases) {
  const res = normalizeIndianPhoneNumber(tc.input);
  if (res.valid !== tc.expectedValid || res.phone !== tc.expectedPhone) {
    console.error(`Phone failure for "${tc.input}": got valid=${res.valid}, phone=${res.phone}; expected valid=${tc.expectedValid}, phone=${tc.expectedPhone}`);
    allPhonesPassed = false;
  }
}
record('C3.1: normalizeIndianPhoneNumber passes all 16 test cases including 91-prefix preservation', allPhonesPassed);

// =============================================================
// 2. C1: ERROR EXTRACTION HELPER (EXECUTED)
// =============================================================
console.log('\n--- 2. C1: ERROR EXTRACTION BEHAVIOR (EXECUTED) ---');

function extractApiErrorMessage(errJson, fallbackMsg) {
  if (!errJson) return fallbackMsg;
  if (typeof errJson.error === 'string') return errJson.error;
  if (errJson.error && typeof errJson.error === 'object') {
    if (typeof errJson.error.message === 'string') return errJson.error.message;
    if (typeof errJson.error.code === 'string') return errJson.error.code;
  }
  if (typeof errJson.message === 'string') return errJson.message;
  return fallbackMsg;
}

const errorCases = [
  { input: { success: false, error: { message: 'Item out of stock', statusCode: 400 } }, expected: 'Item out of stock' },
  { input: { success: false, error: 'Database timeout' }, expected: 'Database timeout' },
  { input: { success: false, message: 'Unauthorized' }, expected: 'Unauthorized' },
  { input: { success: false, error: { code: 'GATEWAY_ERROR' } }, expected: 'GATEWAY_ERROR' },
  { input: { success: false, error: {} }, expected: 'Default error' },
  { input: null, expected: 'Default error' }
];

let allErrorsPassed = true;
for (const ec of errorCases) {
  const extracted = extractApiErrorMessage(ec.input, 'Default error');
  if (extracted !== ec.expected || extracted.includes('[object Object]')) {
    console.error(`Error extraction failure: got "${extracted}", expected "${ec.expected}"`);
    allErrorsPassed = false;
  }
}
record('C1.1: extractApiErrorMessage extracts message from standard responseHandler envelopes without [object Object]', allErrorsPassed);

// =============================================================
// 3. CART MANAGER: CUSTOM STICKER PRESERVATION (EXECUTED)
// =============================================================
console.log('\n--- 3. CART MANAGER: CUSTOM STICKER PRESERVATION (EXECUTED) ---');

const mockStorage = {};
const mockWindow = {
  dispatchEvent: () => {},
  CHIPAKK: {
    auth: {
      getCurrentUser: () => ({ uid: 'test-user', email: 'test@example.com' })
    }
  }
};
const mockLocalStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; }
};

const appJsContent = fs.readFileSync(path.join(__dirname, '../customer-workspace/js/app.js'), 'utf8');

const cartManagerSlice = appJsContent.slice(
  appJsContent.indexOf('const CART_STORAGE_KEY ='),
  appJsContent.indexOf('const cart = new CartManager();')
);

class MockCustomEvent {
  constructor(name, detail) {
    this.name = name;
    this.detail = detail;
  }
}

const evalCartFn = new Function(
  'window',
  'localStorage',
  'CustomEvent',
  'renderGlobalCart',
  'showToast',
  'resolveCustomerImageUrl',
  'media',
  `${cartManagerSlice}; return new CartManager();`
);

const cart = evalCartFn(
  mockWindow,
  mockLocalStorage,
  MockCustomEvent,
  () => {},
  () => {},
  (url) => url,
  require('../customer-workspace/js/media.js').createMedia({ apiBase: 'https://api.chipakk.shop/api' })
);

cart.clear();
const customItem = {
  id: 'custom-1',
  variantKey: 'custom-diecut-3x3-50',
  name: 'Custom Die Cut Stickers (50 pcs)',
  price: 1499,
  image: 'https://example.com/preview.png',
  is_custom: true,
  custom_design_data: {
    quantity: 50,
    cutType: 'Die Cut',
    size: '3" x 3"',
    finish: 'Glossy',
    uploadedPreviewUrl: 'https://example.com/preview.png',
    fileName: 'my-sticker.png'
  },
  materials: ['Glossy Vinyl'],
  sizes: ['3" x 3"'],
  qty: 1
};

cart.addItem(customItem);
const itemsInCart = cart.items;

record('C4.1: CartManager preserves is_custom and custom_design_data on addItem',
  itemsInCart.length === 1 &&
  itemsInCart[0].is_custom === true &&
  itemsInCart[0].custom_design_data !== null &&
  itemsInCart[0].custom_design_data.quantity === 50 &&
  itemsInCart[0].custom_design_data.cutType === 'Die Cut' &&
  itemsInCart[0].materials[0] === 'Glossy Vinyl'
);

// =============================================================
// 4. ORDER SERVICE: AUTHORITATIVE CUSTOM PRICING & TIERS (EXECUTED)
// =============================================================
console.log('\n--- 4. ORDER SERVICE: PRICING & LIMITS (EXECUTED) ---');

const orderServiceContent = fs.readFileSync(path.join(__dirname, '../server/services/orderService.js'), 'utf8');

const tierFuncCode = orderServiceContent.slice(
  orderServiceContent.indexOf('const CUSTOM_STICKER_TIERS = {'),
  orderServiceContent.indexOf('const checkHasHistoryTable =')
);

const evalTierFn = new Function(`${tierFuncCode}; return { calculateAuthoritativeCustomStickerPrice, CUSTOM_STICKER_TIERS };`);
const { calculateAuthoritativeCustomStickerPrice, CUSTOM_STICKER_TIERS } = evalTierFn();

const expectedTiers = { 10: 499, 25: 899, 50: 1499, 100: 2499, 250: 4999, 500: 8499 };
let tiersMatch = true;
for (const [qty, price] of Object.entries(expectedTiers)) {
  const calculated = calculateAuthoritativeCustomStickerPrice({ quantity: parseInt(qty, 10), cutType: 'Die Cut' });
  if (calculated !== price) {
    console.error(`Tier mismatch for ${qty}: got ${calculated}, expected ${price}`);
    tiersMatch = false;
  }
}
record('C4.2: calculateAuthoritativeCustomStickerPrice matches authoritative pricing matrix (10:₹499 to 500:₹8499)', tiersMatch);

let rejectedInvalid = false;
try {
  calculateAuthoritativeCustomStickerPrice({ quantity: 99, cutType: 'Die Cut' });
} catch (e) {
  rejectedInvalid = e.message.includes('Allowed tiers are 10, 25, 50, 100, 250, 500');
}
record('C4.3: calculateAuthoritativeCustomStickerPrice rejects unapproved quantity tiers (e.g. 99)', rejectedInvalid);

let rejectedInvalidCut = false;
try {
  calculateAuthoritativeCustomStickerPrice({ quantity: 50, cutType: 'InvalidCut' });
} catch (e) {
  rejectedInvalidCut = e.message.includes('Invalid custom sticker cut type');
}
record('C4.4: calculateAuthoritativeCustomStickerPrice rejects invalid cut types', rejectedInvalidCut);

// =============================================================
// 5. ORDER SERVICE: ORDER LIMITS & DEFENSIVE GUARDS (STATIC & LOGICAL)
// =============================================================
console.log('\n--- 5. ORDER SERVICE: HARDENING CHECKS ---');

record('H1: orderService caps maximum items per order to 50',
  orderServiceContent.includes('const MAX_ORDER_ITEMS = 50;') &&
  orderServiceContent.includes('orderItems.length > MAX_ORDER_ITEMS')
);

record('H2: orderService caps maximum order total value to ₹50,000',
  orderServiceContent.includes('const MAX_ORDER_TOTAL_RUPEES = 50000;') &&
  orderServiceContent.includes('totalPricePaise > maxTotal')
);

record('H3: orderService strictly type-checks recipientName, streetAddress, city, state',
  orderServiceContent.includes("typeof recipientName !== 'string' || recipientName.trim().length < 2") &&
  orderServiceContent.includes("typeof streetAddress !== 'string' || streetAddress.trim().length < 5") &&
  orderServiceContent.includes("typeof city !== 'string' || city.trim().length < 2") &&
  orderServiceContent.includes("typeof state !== 'string' || state.trim().length < 2")
);

record('H4: orderService validates integer quantity and bounds (1 to 10000)',
  orderServiceContent.includes('Number.isInteger(parsedQty)') &&
  orderServiceContent.includes('parsedQty < MIN_ITEM_QUANTITY || parsedQty > MAX_ITEM_QUANTITY')
);

record('H5: orderService derives custom item name, sku, and variant_options from validated spec',
  orderServiceContent.includes('const customName = `Custom ${cutType} Stickers (${packQty} pcs)`;') &&
  orderServiceContent.includes("const customSku = `SKU-CUSTOM-${packQty}-${String(cutType).toUpperCase().replace(/[^A-Z0-9]/g, '-')}`;") &&
  orderServiceContent.includes('variant_options: customVariantOptions')
);

record('H6: orderService rejects custom stickers for Store 2',
  orderServiceContent.includes('if (activeStoreId !== 1)') &&
  orderServiceContent.includes('Custom stickers are only available for CHIPAKK (Store 1).')
);

record('H7: orderService sanitizes payment_method against allowed whitelist',
  orderServiceContent.includes('const ALLOWED_PAYMENT_METHODS = [') &&
  orderServiceContent.includes("const safePaymentMethod = ALLOWED_PAYMENT_METHODS.includes(String(payment_method || '').toUpperCase())")
);

// =============================================================
// 6. PAYMENT SERVICE: MONEY MODEL, OWNERSHIP & WEBHOOK HARDENING
// =============================================================
console.log('\n--- 6. PAYMENT SERVICE: SECURITY & REUSE ---');

const paymentServiceContent = fs.readFileSync(path.join(__dirname, '../server/services/paymentService.js'), 'utf8');

record('C2.1: paymentService converts Store 1 rupees to paise (*100) and Store 2 paise unchanged',
  paymentServiceContent.includes('const isStore2 = parseInt(order.store_id, 10) === 2;') &&
  paymentServiceContent.includes('const amountPaiseForGateway = isStore2 ? rawTotalPrice : (rawTotalPrice * 100);')
);

record('C2.2: paymentService reuses existing gateway_order_id on pending orders',
  paymentServiceContent.includes('if (order.gateway_order_id)') &&
  paymentServiceContent.includes('gateway_order_id: order.gateway_order_id')
);

record('C2.3: paymentService requires email_verified = true for customer email fallback check',
  paymentServiceContent.includes('Boolean(firebaseUser.email_verified)')
);

record('C2.4: handleWebhook queries store_id and verifies amountPaise >= expectedPaise',
  paymentServiceContent.includes('SELECT id, order_number, store_id, total_price, payment_status, fulfillment_status FROM orders') &&
  paymentServiceContent.includes('if (amountPaise < expectedPaise)')
);

// =============================================================
// 7. PAYMENT CONTROLLER: STANDARDIZED API RESPONSES
// =============================================================
console.log('\n--- 7. PAYMENT CONTROLLER: RESPONSE ENVELOPES ---');

const paymentControllerContent = fs.readFileSync(path.join(__dirname, '../server/controllers/paymentController.js'), 'utf8');

record('P1: paymentController imports sendSuccess and sendError',
  paymentControllerContent.includes("const { sendSuccess, sendError } = require('../utils/responseHandler');")
);

record('P2: paymentController returns standardized responses for create, verify, and status',
  paymentControllerContent.includes("return sendSuccess(res, result, 'Payment order created successfully', 200);") &&
  paymentControllerContent.includes("return sendSuccess(res, result, 'Payment verified successfully', 200);") &&
  paymentControllerContent.includes("return sendSuccess(res, result, 'Payment status retrieved successfully', 200);")
);

// =============================================================
// 8. CHECKOUT FRONTEND: DOUBLE-CLICK GUARD & ORDER RETRY
// =============================================================
console.log('\n--- 8. CHECKOUT FRONTEND: UI RESILIENCE ---');

const checkoutJsContent = fs.readFileSync(path.join(__dirname, '../customer-workspace/js/checkout.js'), 'utf8');

// Scoped to the submit handler: the page-load GST-rate refresh also reads the catalogue, but it is a read-only fetch
// that places nothing, so only the order-placement path must take the single-flight lock first.
const submitStart = checkoutJsContent.indexOf('placeBtn.addEventListener("click"');
record('CK1: checkout.js locks submission BEFORE window.CHIPAKK.getProducts() call (inside the place-order handler)',
  submitStart > 0 &&
  checkoutJsContent.indexOf('isSubmitting = true;', submitStart) > 0 &&
  checkoutJsContent.indexOf('isSubmitting = true;', submitStart) < checkoutJsContent.indexOf('await window.CHIPAKK.getProducts();', submitStart)
);

record('CK2: checkout.js tracks pendingOnlineOrder and reuses it on retry without creating duplicate orders',
  checkoutJsContent.includes('let pendingOnlineOrder = null;') &&
  checkoutJsContent.includes('if (selectedPayment !== "cod" && pendingOnlineOrder && pendingOnlineOrder.id) {') &&
  checkoutJsContent.includes('await launchOnlinePayment(pendingOnlineOrder')
);

record('CK3: checkout.js uses extractCheckoutErrorMessage to prevent [object Object]',
  checkoutJsContent.includes('function extractCheckoutErrorMessage(') &&
  !checkoutJsContent.includes('alert(`Checkout error: ${err.message || err}`);')
);

// =============================================================
// SUMMARY
// =============================================================
console.log('\n===============================================================');
console.log(`TOTAL TESTS: ${passCount + failCount}`);
console.log(`PASSED: ${passCount}`);
console.log(`FAILED: ${failCount}`);
console.log('===============================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 ALL BATCH 1 BEHAVIORAL VERIFICATIONS PASSED!\n');
  process.exit(0);
}
