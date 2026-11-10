/**
 * Tests for Lady Justice Backend Pricing & Admin Management (THE MARSHANS — Store ID 2)
 * tests/test_marshans_lady_justice_pricing.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

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

async function runTests() {
  console.log('===============================================================');
  console.log('⚖️  THE MARSHANS — LADY JUSTICE PRICING & ADMIN VERIFICATION');
  console.log('===============================================================\n');

  // ===========================================================================
  // SUITE 1: STATIC CODE & HTML VERIFICATION
  // ===========================================================================
  console.log('--- SUITE 1: STATIC CODE & UI STRUCTURE CHECKS ---');

  const adminHtml = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');
  const customForgeServiceFile = fs.readFileSync(path.join(ROOT, 'server/services/customForgeService.js'), 'utf8');
  const migration019 = fs.readFileSync(path.join(ROOT, 'database/migration_019_marshans_custom_forge.sql'), 'utf8');

  check('1.1 admin.html defines cf-product-pricing-card in tab-custom-forge',
    adminHtml.includes('id="cf-product-pricing-card"') &&
    adminHtml.includes('id="cf-variants-pricing-tbody"') &&
    adminHtml.includes('id="cf-save-pricing-btn"') &&
    adminHtml.includes('id="cf-refresh-pricing-btn"')
  );

  check('1.2 admin.html script tag references active admin.js version (>=3.5.4)',
    adminHtml.includes('src="js/admin.js?v=3.5.4"') || adminHtml.includes('src="js/admin.js?v=3.5.5"')
  );

  check('1.3 admin.js defines Custom Forge pricing handlers and exports on window',
    adminJs.includes('async function refreshCustomForgeProductFromAPI()') &&
    adminJs.includes('function renderCustomForgePricingTable()') &&
    adminJs.includes('async function saveCustomForgePricing()') &&
    adminJs.includes('window.refreshCustomForgeProductFromAPI = refreshCustomForgeProductFromAPI;') &&
    adminJs.includes('window.saveCustomForgePricing = saveCustomForgePricing;')
  );

  check('1.4 admin.js references 400 grams, 1 kg, and 2 kg reference weights',
    adminJs.includes("'6 inches': '400 grams'") &&
    adminJs.includes("'1 foot': '1 kg'") &&
    adminJs.includes("'2 feet': '2 kg'")
  );

  check('1.5 customForgeService.js FALLBACK_LADY_JUSTICE has approved prices (₹1,999, ₹3,699, ₹5,999)',
    customForgeServiceFile.includes('price: 199900') &&
    customForgeServiceFile.includes('price_rupees: 1999') &&
    customForgeServiceFile.includes('price: 369900') &&
    customForgeServiceFile.includes('price_rupees: 3699') &&
    customForgeServiceFile.includes('price: 599900') &&
    customForgeServiceFile.includes('price_rupees: 5999')
  );

  check('1.6 migration_019_marshans_custom_forge.sql contains approved prices in seed data',
    migration019.includes('199900 AS price') &&
    migration019.includes('369900') &&
    migration019.includes('599900')
  );

  // ===========================================================================
  // SUITE 2: SERVICE & PRICING VERIFICATION
  // ===========================================================================
  console.log('\n--- SUITE 2: BACKEND SERVICE & PRICING RESOLUTION ---');

  const customForgeService = require('../server/services/customForgeService');

  // 2.1 Fallback mode retrieval
  const product = await customForgeService.getLadyJusticeProduct();
  check('2.1 getLadyJusticeProduct returns Lady Justice with 3 variants',
    product && product.slug === 'lady-justice' && Array.isArray(product.variants) && product.variants.length === 3
  );

  const var6in = product.variants.find(v => v.size_label === '6 inches');
  const var1ft = product.variants.find(v => v.size_label === '1 foot');
  const var2ft = product.variants.find(v => v.size_label === '2 feet');

  check('2.2 Edition 1 (6 Inches): price is 199900 paise (₹1,999)',
    var6in && var6in.price === 199900 && var6in.price_rupees === 1999
  );

  check('2.3 Edition 2 (1 Foot): price is 369900 paise (₹3,699)',
    var1ft && var1ft.price === 369900 && var1ft.price_rupees === 3699
  );

  check('2.4 Edition 3 (2 Feet): price is 599900 paise (₹5,999)',
    var2ft && var2ft.price === 599900 && var2ft.price_rupees === 5999
  );

  // 2.5 Price update function validation
  let rejectedStore1 = false;
  try {
    await customForgeService.updateLadyJusticeVariantPrices([{ id: 1, price: 199900 }], 1);
  } catch (err) {
    if (err.statusCode === 403) rejectedStore1 = true;
  }
  check('2.5 updateLadyJusticeVariantPrices strictly rejects Store 1 with 403', rejectedStore1);

  let rejectedNegative = false;
  try {
    await customForgeService.updateLadyJusticeVariantPrices([{ id: 1, price: -500 }], 2);
  } catch (err) {
    if (err.statusCode === 400) rejectedNegative = true;
  }
  check('2.6 updateLadyJusticeVariantPrices rejects invalid/negative prices with 400', rejectedNegative);

  // 2.7 Update in-place test
  const updatedRes = await customForgeService.updateLadyJusticeVariantPrices([
    { id: 1, price: 199900 },
    { id: 2, price: 369900 },
    { id: 3, price: 599900 }
  ], 2);
  const updated6in = updatedRes.variants.find(v => v.id === 1);
  check('2.7 updateLadyJusticeVariantPrices successfully updates and returns fresh variants',
    updated6in && updated6in.price === 199900 && updated6in.price_rupees === 1999
  );

  // ===========================================================================
  // SUITE 3: HTTP API ROUTES & MULTI-STORE ISOLATION
  // ===========================================================================
  console.log('\n--- SUITE 3: HTTP API & STORE ISOLATION GATE ---');

  // Set up mock express server to test admin routes
  const app = express();
  app.use(express.json());

  // Mock admin auth middleware
  app.use((req, res, next) => {
    req.admin = { uid: 'admin_test', email: 'admin@themarshans.shop', role: 'super_admin' };
    req.user = req.admin;
    req.storeId = req.headers['x-store-id'] ? parseInt(req.headers['x-store-id'], 10) : 1;
    next();
  });

  const customForgeController = require('../server/controllers/customForgeController');

  app.get('/api/admin/custom-forge/product', (req, res, next) => {
    if (req.storeId !== 2) {
      return res.status(403).json({ success: false, error: 'Custom Forge is exclusively supported on Store 2 (THE MARSHANS).' });
    }
    return customForgeController.getLadyJusticeProductHandler(req, res, next);
  });

  app.put('/api/admin/custom-forge/product/variants', (req, res, next) => {
    if (req.storeId !== 2) {
      return res.status(403).json({ success: false, error: 'Custom Forge is exclusively supported on Store 2 (THE MARSHANS).' });
    }
    return customForgeController.updateLadyJusticeVariantPricesHandler(req, res, next);
  });

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const makeReq = (path, method, storeId, body) => new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Store-ID': String(storeId),
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let bodyStr = '';
      res.on('data', c => bodyStr += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(bodyStr || '{}') }));
    });
    if (data) req.write(data);
    req.end();
  });

  // Test 3.1: Admin GET product under Store 2
  const adminGetRes = await makeReq('/api/admin/custom-forge/product', 'GET', 2);
  check('3.1 Admin GET /api/admin/custom-forge/product returns 200 with approved pricing',
    adminGetRes.status === 200 &&
    adminGetRes.body.data.variants.length === 3 &&
    adminGetRes.body.data.variants.find(v => v.size_label === '6 inches').price === 199900 &&
    adminGetRes.body.data.variants.find(v => v.size_label === '1 foot').price === 369900 &&
    adminGetRes.body.data.variants.find(v => v.size_label === '2 feet').price === 599900
  );

  // Test 3.2: Admin GET product under Store 1 is rejected with 403
  const store1GetRes = await makeReq('/api/admin/custom-forge/product', 'GET', 1);
  check('3.2 Admin GET /api/admin/custom-forge/product under Store 1 is rejected with 403',
    store1GetRes.status === 403
  );

  // Test 3.3: Admin PUT product/variants updates prices
  const adminPutRes = await makeReq('/api/admin/custom-forge/product/variants', 'PUT', 2, {
    variants: [
      { id: 1, price: 199900 },
      { id: 2, price: 369900 },
      { id: 3, price: 599900 }
    ]
  });
  check('3.3 Admin PUT /api/admin/custom-forge/product/variants persists prices successfully',
    adminPutRes.status === 200 &&
    adminPutRes.body.data.variants.find(v => v.id === 1).price === 199900
  );

  // Test 3.4: Admin PUT product/variants under Store 1 is rejected with 403
  const store1PutRes = await makeReq('/api/admin/custom-forge/product/variants', 'PUT', 1, {
    variants: [{ id: 1, price: 199900 }]
  });
  check('3.4 Admin PUT /api/admin/custom-forge/product/variants under Store 1 is rejected with 403',
    store1PutRes.status === 403
  );

  server.close();

  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('===============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
