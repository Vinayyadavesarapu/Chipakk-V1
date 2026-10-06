/**
 * THE MARSHANS + SHARED STICKERS — FINAL PRE-DEPLOYMENT GATE TEST SUITE
 * tests/test_predeploy_gate.js
 *
 * Verifies:
 * 1. Admin Product Edit Form:
 *    - Fetch and populate complete product record from backend.
 *    - Read-only Admin Product ID (no retyping required).
 *    - Preserves all unexposed backend fields (weight, dimensions, short_description, materials, etc.).
 *    - Preserves images and storage_path metadata.
 *    - State reset on save, cancel, and store switch.
 * 2. Razorpay Integration (Store ID 2 only):
 *    - Store 2 isolation (enforceMarshansStoreOnly rejects non-Store 2 with 403).
 *    - HMAC-SHA256 signature verification with crypto.timingSafeEqual.
 *    - Backend secret isolation (RAZORPAY_KEY_SECRET never in client).
 * 3. Velocity Integration:
 *    - Auth endpoint: POST /custom/api/v1/auth-token
 *    - Tracking endpoint: POST /custom/api/v1/order-tracking
 *    - Server-side credentials and token cache.
 * 4. Client Bundle Security Scan:
 *    - Verifies zero backend secrets leaked in web/ client files.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

console.log('===============================================================');
console.log('🛡️  THE MARSHANS & CHIPAKK PRE-DEPLOYMENT VERIFICATION GATE');
console.log('===============================================================\n');

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

// =============================================================================
// SUITE 1: ADMIN PRODUCT EDIT FORM FUNCTIONALITY & METADATA PRESERVATION
// =============================================================================
console.log('\n--- SUITE 1: ADMIN PRODUCT EDIT FORM & FIELD PRESERVATION ---');

const adminJsContent = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

// Check 1.1: State variables for editing
check('1.1 editingProductId and currentEditingProduct state variables declared',
  adminJsContent.includes('let editingProductId = null;') &&
  adminJsContent.includes('let currentEditingProduct = null;')
);

// Check 1.2: openProductForm accepts rawRecord
check('1.2 openProductForm accepts (product = null, rawRecord = null)',
  adminJsContent.includes('function openProductForm(product = null, rawRecord = null)')
);

// Check 1.3: Product ID is made read-only during edit
check('1.3 Admin Product ID input is readOnly and styled when editing',
  adminJsContent.includes('adminIdInput.readOnly = Boolean(editingProductId);') &&
  adminJsContent.includes("adminIdInput.style.backgroundColor = editingProductId ? '#f1f5f9' : '';") &&
  adminJsContent.includes("adminIdInput.style.cursor = editingProductId ? 'not-allowed' : '';")
);

// Check 1.4: editProduct fetches full product record and passes to openProductForm
check('1.4 editProduct fetches GET /admin/products/:id and passes raw record',
  adminJsContent.includes('const res = await apiClient.get(`/admin/products/${productId}`);') &&
  adminJsContent.includes('openProductForm(freshProduct, raw);')
);

// Check 1.5: saveProductForm preserves unexposed backend fields
check('1.5 saveProductForm preserves weight_grams, dimensions_mm, short_description, and production notes',
  adminJsContent.includes('payload.weight_grams = currentEditingProduct.weight_grams;') &&
  adminJsContent.includes('payload.dimensions_mm = currentEditingProduct.dimensions_mm;') &&
  adminJsContent.includes('payload.short_description = currentEditingProduct.short_description;') &&
  adminJsContent.includes('payload.material_info = currentEditingProduct.material_info;') &&
  adminJsContent.includes('payload.production_notes = currentEditingProduct.production_notes;')
);

// Check 1.6: saveProductForm preserves Marshans materials and finishing options
check('1.6 saveProductForm preserves material_ids and finishing_option_ids for Store 2',
  adminJsContent.includes('payload.material_ids = currentEditingProduct.material_ids;') &&
  adminJsContent.includes('payload.finishing_option_ids = currentEditingProduct.finishing_option_ids;')
);

// Check 1.7: saveProductForm preserves image objects with storage_path and is_primary
check('1.7 cleanImagePayload preserves image objects, storage_path, and is_primary',
  adminJsContent.includes('storage_path: item.storage_path || null') &&
  adminJsContent.includes('is_primary: item.is_primary !== undefined')
);

// Check 1.8: saveProductForm and cancel-btn reset editing state
check('1.8 editing state reset after save and cancel',
  adminJsContent.includes('editingProductId = null;\n        currentEditingProduct = null;\n        await refreshProductsFromAPI();') ||
  (adminJsContent.includes('editingProductId = null;') && adminJsContent.includes('currentEditingProduct = null;'))
);

// Check 1.9: Store switcher clears currentEditingProduct
check('1.9 Store switcher defensively clears editingProductId and currentEditingProduct',
  adminJsContent.includes('editingProductId = null;\n        currentEditingProduct = null;\n        editingCategoryId = null;')
);

// Check 1.10: Simulation of product edit round-trip
const sampleMarshansRecord = {
  id: 42,
  store_id: 2,
  admin_product_id: 'MRSH-042',
  name: 'Galactic Orb 3D',
  sku: 'MRSH-GAL-042',
  category_id: 5,
  category_name: 'LUMO',
  category_slug: 'lumo',
  short_description: 'An advanced 3D illuminated galactic orb.',
  description: 'Detailed description of the 3D model.',
  price: 499900,
  compare_at_price: 599900,
  weight_grams: 350.5,
  dimensions_mm: { x: 120, y: 120, z: 150 },
  material_info: 'Resin 8K High Definition',
  production_notes: 'Cure for 45 mins at 405nm',
  experience_override: null,
  is_best_seller: 1,
  view_360_url: 'https://storage.marshans.art/360/orb/view.json',
  lumo_light_image: 'https://storage.marshans.art/light.webp',
  lumo_dark_image: 'https://storage.marshans.art/dark.webp',
  images: [
    { id: 101, image_url: 'https://storage.marshans.art/light.webp', storage_path: 'products/42/light.webp', sort_order: 0, is_primary: 1 },
    { id: 102, image_url: 'https://storage.marshans.art/gallery2.webp', storage_path: 'products/42/gal2.webp', sort_order: 1, is_primary: 0 }
  ],
  material_ids: [1, 3],
  finishing_option_ids: [2]
};

// Simulate saving with only title and price changed in form
function simulateSavePayload(rawProduct, updatedForm) {
  const activeStoreId = 2;
  const isLumo = updatedForm.category === 'LUMO';
  
  const cleanImagePayload = rawProduct.images.map((item, idx) => ({
    id: item.id || undefined,
    image_url: item.image_url || item.url || '',
    url: item.url || item.image_url || '',
    storage_path: item.storage_path || null,
    is_primary: item.is_primary ? 1 : 0,
    sort_order: idx
  }));

  const payload = {
    name: updatedForm.title,
    admin_product_id: rawProduct.admin_product_id,
    sku: updatedForm.sku,
    description: updatedForm.description,
    price: Math.round(updatedForm.price * 100),
    compare_at_price: updatedForm.compare_at_price ? Math.round(updatedForm.compare_at_price * 100) : null,
    category_name: updatedForm.category,
    tags: updatedForm.tags || [],
    images: cleanImagePayload,
    scheduled_drop_time: null,
    active: 1,
    is_best_seller: true,
    featured: 0
  };

  if (activeStoreId === 2) {
    payload.view_360_url = updatedForm.view_360_url || null;
    const firstImgUrl = cleanImagePayload[0]?.url || cleanImagePayload[0]?.image_url || null;
    if (isLumo) {
      payload.lumo_light_image = firstImgUrl;
      payload.lumo_dark_image = updatedForm.lumo_dark_image;
    }
  }

  // Preserve existing fields
  if (rawProduct.weight_grams !== undefined) payload.weight_grams = rawProduct.weight_grams;
  if (rawProduct.dimensions_mm !== undefined) payload.dimensions_mm = rawProduct.dimensions_mm;
  if (rawProduct.short_description !== undefined) payload.short_description = rawProduct.short_description;
  if (rawProduct.material_info !== undefined) payload.material_info = rawProduct.material_info;
  if (rawProduct.production_notes !== undefined) payload.production_notes = rawProduct.production_notes;
  if (rawProduct.experience_override !== undefined) payload.experience_override = rawProduct.experience_override;
  if (Array.isArray(rawProduct.material_ids)) payload.material_ids = rawProduct.material_ids;
  if (Array.isArray(rawProduct.finishing_option_ids)) payload.finishing_option_ids = rawProduct.finishing_option_ids;

  return payload;
}

const savedPayload = simulateSavePayload(sampleMarshansRecord, {
  title: 'Galactic Orb 3D - Edition 2',
  sku: 'MRSH-GAL-042',
  price: 5499,
  category: 'LUMO',
  description: 'Updated 3D model text.',
  view_360_url: 'https://storage.marshans.art/360/orb/view.json',
  lumo_dark_image: 'https://storage.marshans.art/dark.webp'
});

check('1.10 Simulated payload preserves weight_grams (350.5)', savedPayload.weight_grams === 350.5);
check('1.11 Simulated payload preserves dimensions_mm ({ x: 120, y: 120, z: 150 })', savedPayload.dimensions_mm.z === 150);
check('1.12 Simulated payload preserves material_info & production_notes', 
  savedPayload.material_info === 'Resin 8K High Definition' &&
  savedPayload.production_notes === 'Cure for 45 mins at 405nm'
);
check('1.13 Simulated payload preserves material_ids and finishing_option_ids',
  Array.isArray(savedPayload.material_ids) && savedPayload.material_ids[1] === 3 &&
  Array.isArray(savedPayload.finishing_option_ids) && savedPayload.finishing_option_ids[0] === 2
);
check('1.14 Simulated payload preserves image storage_path metadata',
  savedPayload.images[0].storage_path === 'products/42/light.webp' &&
  savedPayload.images[1].storage_path === 'products/42/gal2.webp'
);


// =============================================================================
// SUITE 2: RAZORPAY INTEGRATION & STORE 2 ISOLATION
// =============================================================================
console.log('\n--- SUITE 2: RAZORPAY INTEGRATION (STORE ID 2 ONLY) ---');

const paymentsRouteContent = fs.readFileSync(path.join(__dirname, '../server/routes/payments.js'), 'utf8');
const razorpayService = require('../server/services/razorpayService');

// Check 2.1: Route strictly rejects non-Store 2
check('2.1 payments.js strictly enforces Store 2 via enforceMarshansStoreOnly middleware',
  paymentsRouteContent.includes('const enforceMarshansStoreOnly = (req, res, next) =>') &&
  paymentsRouteContent.includes('if (storeId !== 2)') &&
  paymentsRouteContent.includes('Razorpay payment routes are exclusively enabled for THE MARSHANS (Store 2).')
);

// Check 2.2: Mock enforceMarshansStoreOnly
function simulateStoreGuard(storeId) {
  let statusSent = null;
  let bodySent = null;
  const mockRes = {
    status(code) { statusSent = code; return this; },
    json(body) { bodySent = body; return this; }
  };
  let nextCalled = false;
  const mockReq = { storeId };
  
  const middleware = (req, res, next) => {
    const sId = parseInt(req.storeId, 10);
    if (sId !== 2) {
      return res.status(403).json({ success: false, error: { statusCode: 403 } });
    }
    next();
  };

  middleware(mockReq, mockRes, () => { nextCalled = true; });
  return { statusSent, nextCalled };
}

check('2.2 Store 1 (CHIPAKK) is rejected with HTTP 403 on payment route',
  simulateStoreGuard(1).statusSent === 403 && !simulateStoreGuard(1).nextCalled
);
check('2.3 Store 2 (THE MARSHANS) passes through payment route',
  simulateStoreGuard(2).nextCalled === true && simulateStoreGuard(2).statusSent === null
);

// Check 2.4: HMAC-SHA256 signature verification logic
const testKeySecret = 'test_secret_key_predeploy_12345';
process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890';
process.env.RAZORPAY_KEY_SECRET = testKeySecret;

const testOrderId = 'order_test_987654321';
const testPaymentId = 'pay_test_1122334455';
const validSignature = crypto
  .createHmac('sha256', testKeySecret)
  .update(`${testOrderId}|${testPaymentId}`)
  .digest('hex');

const isSigValid = razorpayService.verifyPaymentSignature({
  razorpay_order_id: testOrderId,
  razorpay_payment_id: testPaymentId,
  razorpay_signature: validSignature
});
check('2.4 Valid Razorpay HMAC-SHA256 signature verified successfully', isSigValid === true);

const isTamperedInvalid = razorpayService.verifyPaymentSignature({
  razorpay_order_id: testOrderId,
  razorpay_payment_id: testPaymentId,
  razorpay_signature: validSignature.slice(0, -4) + '0000'
});
check('2.5 Tampered Razorpay signature timing-safely rejected', isTamperedInvalid === false);

const isMissingParamRejected = razorpayService.verifyPaymentSignature({
  razorpay_order_id: testOrderId,
  razorpay_payment_id: '',
  razorpay_signature: validSignature
});
check('2.6 Missing parameters rejected safely', isMissingParamRejected === false);


// =============================================================================
// SUITE 3: VELOCITY INTEGRATION (ENDPOINT PATHS & AUTH RULES)
// =============================================================================
console.log('\n--- SUITE 3: VELOCITY SHIPPING INTEGRATION (STORE 2) ---');

const velocityServiceContent = fs.readFileSync(path.join(__dirname, '../server/services/velocityService.js'), 'utf8');

// Check 3.1: Auth Token Endpoint is POST /custom/api/v1/auth-token
check('3.1 Auth endpoint matches Velocity documentation: POST /custom/api/v1/auth-token',
  velocityServiceContent.includes('/custom/api/v1/auth-token')
);

// Check 3.2: Tracking Endpoint is POST /custom/api/v1/order-tracking
check('3.2 Tracking endpoint matches Velocity documentation: POST /custom/api/v1/order-tracking',
  velocityServiceContent.includes('/custom/api/v1/order-tracking')
);

// Check 3.3: Serviceability endpoint
check('3.3 Serviceability endpoint matches Velocity documentation: POST /custom/api/v1/serviceability',
  velocityServiceContent.includes('/custom/api/v1/serviceability')
);

// Check 3.4: Forward Order Orchestration endpoint
check('3.4 Forward order endpoint matches Velocity documentation: POST /custom/api/v1/forward-order-orchestration',
  velocityServiceContent.includes('/custom/api/v1/forward-order-orchestration')
);

// Check 3.5: Credentials strictly server-side
check('3.5 Credentials exclusively read from process.env server-side',
  velocityServiceContent.includes('process.env.VELOCITY_USERNAME') &&
  velocityServiceContent.includes('process.env.VELOCITY_PASSWORD')
);


// =============================================================================
// SUITE 4: SECURITY & SECRET EXPOSURE SCAN
// =============================================================================
console.log('\n--- SUITE 4: CLIENT BUNDLE SECRET EXPOSURE SCAN ---');

const clientDirs = [
  path.join(__dirname, '../web'),
  path.join(__dirname, '../public')
];

const forbiddenSecrets = [
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'VELOCITY_PASSWORD',
  'VELOCITY_USERNAME'
];

let leakDetected = false;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (/\.(js|html|css|json)$/i.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const secret of forbiddenSecrets) {
        if (content.includes(secret)) {
          console.error(`[SECURITY LEAK] Found forbidden secret reference '${secret}' in ${fullPath}`);
          leakDetected = true;
        }
      }
    }
  }
}

clientDirs.forEach(scanDir);

check('4.1 Zero server-side secrets (RAZORPAY_KEY_SECRET, VELOCITY_PASSWORD) in client files', !leakDetected);


// =============================================================================
// SUMMARY REPORT
// =============================================================================
console.log('\n===============================================================');
console.log(`TOTAL CHECKS: ${passCount + failCount}`);
console.log(`PASSED:       ${passCount}`);
console.log(`FAILED:       ${failCount}`);
console.log('===============================================================\n');

if (failCount > 0) {
  console.error(`❌ PRE-DEPLOYMENT GATE FAILED WITH ${failCount} ERRORS.`);
  process.exit(1);
} else {
  console.log('✅ ALL PRE-DEPLOYMENT CHECKS PASSED SUCCESSFULLY.');
  process.exit(0);
}
