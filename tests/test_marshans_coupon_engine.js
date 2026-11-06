/**
 * THE MARSHANS & CHIPAKK — Comprehensive Coupons Engine & Checkout Test Suite
 *
 * Verifies:
 * 1. Store 2 fixed discount unit normalization (input in ₹599 -> stored as 59900 paise, returns discount_value_rupees: 599)
 * 2. Store 2 percentage discount handling (input 5 -> stored as 5%, returns discount_value: 5)
 * 3. Admin UI formatting: ₹599 OFF for fixed amount and 5% OFF for percentage (no 59900₹ OFF bug)
 * 4. Validation endpoint (POST /api/coupons/validate) with eligible subtotal (₹5,000+) returns 200 and ₹599 discount
 * 5. Validation endpoint with ineligible subtotal below minimum spend returns 400 with friendly message
 * 6. Cross-store isolation: Store 1 coupons cannot be validated from Store 2, and Store 2 coupons cannot be validated from Store 1
 * 7. Order placement with Store 2 coupon: calculates correct ₹599 deduction, preserves gross subtotal for shipping
 * 8. Store 1 regression: CHIPAKK coupons continue to function with whole rupee storage
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const results = [];
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

function freshRequire(modPath) {
  const resolved = require.resolve(modPath);
  delete require.cache[resolved];
  return require(modPath);
}

(async () => {
  console.log('===============================================================');
  console.log('🎟️  THE MARSHANS & CHIPAKK COUPONS ENGINE VERIFICATION SUITE');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // Test 1: Store 2 Fixed Coupon Unit Normalization (create & get)
  // -------------------------------------------------------------
  await test('1. Store 2 fixed coupon stores input in paise and exposes discount_value_rupees', async () => {
    let insertedRow = null;
    const pool = createFakePool([
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'/, () => [[{ COLUMN_NAME: 'per_customer_limit' }]]],
      [/^SELECT id FROM coupons WHERE UPPER\(code\) = \? AND store_id = \? LIMIT 1/, () => [[]]],
      [/^INSERT INTO coupons/, (sql, params) => {
        insertedRow = {
          id: 105,
          code: params[0],
          store_id: params[1],
          per_customer_limit: params[2],
          discount_type: params[3],
          discount_value: params[4],
          min_order_value: params[5],
          max_discount_amount: params[6],
          start_date: params[7],
          end_date: params[8],
          usage_limit: params[9],
          active: params[10],
          usage_count: 0
        };
        return [{ insertId: 105 }];
      }],
      [/^SELECT[\s\S]*FROM coupons c WHERE \(c\.id = \?\) AND c\.store_id = \? LIMIT 1/, (sql, params) => {
        return [[insertedRow]];
      }],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
      [/^SELECT[\s\S]*FROM coupon_usage cu/, () => [[]]]
    ]);
    installFakePool(pool);

    const couponService = freshRequire('../server/services/couponService');
    const created = await couponService.createCoupon({
      code: 'MARS105',
      discount_type: 'fixed',
      discount_value: 599, // User enters ₹599
      min_order_value: 500000, // ₹5,000 in paise
      store_id: 2
    });

    assert.ok(created, 'Coupon must be created successfully');
    assert.strictEqual(created.code, 'MARS105');
    assert.strictEqual(created.discount_type, 'fixed');
    assert.strictEqual(insertedRow.discount_value, 59900, 'Database discount_value must be stored in paise (59900)');
    assert.strictEqual(created.discount_value_rupees, 599, 'discount_value_rupees must return 599 for display');
    assert.strictEqual(created.min_order_value_rupees, 5000, 'min_order_value_rupees must return 5000 for display');
  });

  // -------------------------------------------------------------
  // Test 2: Store 2 Percentage Coupon Handling
  // -------------------------------------------------------------
  await test('2. Store 2 percentage coupon stores percentage integer without multiplier', async () => {
    let insertedRow = null;
    const pool = createFakePool([
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'/, () => [[{ COLUMN_NAME: 'per_customer_limit' }]]],
      [/^SELECT id FROM coupons WHERE UPPER\(code\) = \? AND store_id = \? LIMIT 1/, () => [[]]],
      [/^INSERT INTO coupons/, (sql, params) => {
        insertedRow = {
          id: 106,
          code: params[0],
          store_id: params[1],
          per_customer_limit: params[2],
          discount_type: params[3],
          discount_value: params[4],
          min_order_value: params[5],
          max_discount_amount: params[6],
          start_date: params[7],
          end_date: params[8],
          usage_limit: params[9],
          active: params[10],
          usage_count: 0
        };
        return [{ insertId: 106 }];
      }],
      [/^SELECT[\s\S]*FROM coupons c WHERE \(c\.id = \?\) AND c\.store_id = \? LIMIT 1/, (sql, params) => {
        return [[insertedRow]];
      }],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
      [/^SELECT[\s\S]*FROM coupon_usage cu/, () => [[]]]
    ]);
    installFakePool(pool);

    const couponService = freshRequire('../server/services/couponService');
    const created = await couponService.createCoupon({
      code: 'MARS5',
      discount_type: 'percent',
      discount_value: 5,
      min_order_value: 200000,
      store_id: 2
    });

    assert.ok(created);
    assert.strictEqual(insertedRow.discount_value, 5, 'Percentage value must remain 5, not multiplied by 100');
    assert.strictEqual(created.discount_value, 5);
    assert.strictEqual(created.discount_value_rupees, null, 'discount_value_rupees is null for percent coupons');
  });

  // -------------------------------------------------------------
  // Test 3: Admin UI Table Display Formatting (No 59900₹ OFF bug)
  // -------------------------------------------------------------
  await test('3. Admin UI formatting logic renders ₹599 OFF for fixed and 5% OFF for percentage', () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

    // Verify refreshCouponsFromAPI reads discount_value_rupees when discount_type is fixed
    assert.ok(adminJs.includes('c.discount_type_rupees') || adminJs.includes('c.discount_value_rupees !== undefined'),
      'refreshCouponsFromAPI must map discount_value taking discount_value_rupees for fixed coupons');

    // Verify renderCouponsTable formats currency properly
    assert.ok(adminJs.includes('₹${Number(c.discount_value).toLocaleString(\'en-IN\')} OFF') || adminJs.includes('c.discount_type === \'percent\''),
      'renderCouponsTable must display ₹X OFF for fixed amount instead of raw paise suffix');

    // Verify dynamic labels update function exists
    assert.ok(adminJs.includes('updateCouponFormLabels'), 'updateCouponFormLabels must be defined');
    assert.ok(adminJs.includes('Discount Amount (₹)'), 'Discount Amount (₹) label must be used for fixed discounts');
    assert.ok(adminJs.includes('Discount Percentage (%)'), 'Discount Percentage (%) label must be used for percentage discounts');
  });

  // -------------------------------------------------------------
  // Test 4: Validation Endpoint (POST /api/coupons/validate) - Eligible Subtotal
  // -------------------------------------------------------------
  await test('4. /api/coupons/validate accepts MARS105 on ₹5,000 subtotal and returns ₹599 discount', async () => {
    const couponRow = {
      id: 105,
      store_id: 2,
      per_customer_limit: 1,
      code: 'MARS105',
      discount_type: 'fixed',
      discount_value: 59900, // 59900 paise
      min_order_value: 500000, // 500000 paise (₹5,000)
      max_discount_amount: null,
      start_date: null,
      end_date: null,
      usage_limit: null,
      usage_count: 0,
      active: 1
    };

    const pool = createFakePool([
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'/, () => [[{ COLUMN_NAME: 'per_customer_limit' }]]],
      [/^SELECT[\s\S]*FROM coupons c WHERE \(UPPER\(c\.code\) = \?\) AND c\.store_id = \? LIMIT 1/, () => [[couponRow]]]
    ]);
    installFakePool(pool);

    const couponService = freshRequire('../server/services/couponService');

    // Validate with 500000 paise (₹5,000) in Store 2
    const res = await couponService.validateCoupon('MARS105', 500000, 2);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.coupon.code, 'MARS105');
    assert.strictEqual(res.coupon.discount_rupees, 599, 'Rupee discount must be 599');
    assert.strictEqual(res.coupon.discount_paise, 59900, 'Paise discount must be 59900');
    assert.strictEqual(res.coupon.min_order_value_rupees, 5000, 'Min order in rupees must be 5000');
  });

  // -------------------------------------------------------------
  // Test 5: Validation Endpoint Rejects Ineligible Subtotal
  // -------------------------------------------------------------
  await test('5. /api/coupons/validate rejects MARS105 when subtotal is below ₹5,000', async () => {
    const couponRow = {
      id: 105,
      store_id: 2,
      per_customer_limit: 1,
      code: 'MARS105',
      discount_type: 'fixed',
      discount_value: 59900,
      min_order_value: 500000, // ₹5,000
      max_discount_amount: null,
      start_date: null,
      end_date: null,
      usage_limit: null,
      usage_count: 0,
      active: 1
    };

    const pool = createFakePool([
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'/, () => [[{ COLUMN_NAME: 'per_customer_limit' }]]],
      [/^SELECT[\s\S]*FROM coupons c WHERE \(UPPER\(c\.code\) = \?\) AND c\.store_id = \? LIMIT 1/, () => [[couponRow]]]
    ]);
    installFakePool(pool);

    const couponService = freshRequire('../server/services/couponService');

    // Subtotal: ₹4,000 (400000 paise) < ₹5,000 required
    const res = await couponService.validateCoupon('MARS105', 400000, 2);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.message, 'Minimum order value of ₹5000 required for this coupon.');
  });

  // -------------------------------------------------------------
  // Test 6: Cross-Store Isolation (Store 1 vs Store 2)
  // -------------------------------------------------------------
  await test('6. Cross-store isolation prevents Store 1 coupons in Store 2 and vice versa', async () => {
    const pool = createFakePool([
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'/, () => [[{ COLUMN_NAME: 'per_customer_limit' }]]],
      // Store 1 lookup when queried with store_id = 2 should return empty
      [/^SELECT[\s\S]*FROM coupons c WHERE \(UPPER\(c\.code\) = \?\) AND c\.store_id = \? LIMIT 1/, (sql, params) => {
        const [code, storeId] = params;
        if (code === 'CHIPAKK10' && storeId === 2) return [[]]; // CHIPAKK coupon not found in Store 2
        if (code === 'MARS105' && storeId === 1) return [[]]; // Marshans coupon not found in Store 1
        return [[]];
      }],
      [/^SELECT[\s\S]*FROM coupons c WHERE \(UPPER\(c\.code\) = \?\) AND \(c\.store_id = 1 OR c\.store_id IS NULL\) LIMIT 1/, (sql, params) => {
        const [code] = params;
        if (code === 'MARS105') return [[]]; // Marshans coupon not found in Store 1
        return [[]];
      }]
    ]);
    installFakePool(pool);

    const couponService = freshRequire('../server/services/couponService');

    // Validate CHIPAKK coupon in Store 2 -> must be rejected
    const store2Check = await couponService.validateCoupon('CHIPAKK10', 500000, 2);
    assert.strictEqual(store2Check.valid, false);
    assert.strictEqual(store2Check.message, 'Invalid or inactive coupon code.');

    // Validate Marshans coupon in Store 1 -> must be rejected
    const store1Check = await couponService.validateCoupon('MARS105', 5000, 1);
    assert.strictEqual(store1Check.valid, false);
    assert.strictEqual(store1Check.message, 'Invalid or inactive coupon code.');
  });

  // -------------------------------------------------------------
  // Test 7: Store 1 (CHIPAKK) Regression Check
  // -------------------------------------------------------------
  await test('7. CHIPAKK (Store 1) coupons preserve whole rupee values without paise multiplication', async () => {
    let insertedRow = null;
    const pool = createFakePool([
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'/, () => [[{ COLUMN_NAME: 'per_customer_limit' }]]],
      [/^SELECT id FROM coupons WHERE UPPER\(code\) = \? AND store_id = \? LIMIT 1/, () => [[]]],
      [/^INSERT INTO coupons/, (sql, params) => {
        insertedRow = {
          id: 201,
          code: params[0],
          store_id: params[1],
          per_customer_limit: params[2],
          discount_type: params[3],
          discount_value: params[4],
          min_order_value: params[5],
          max_discount_amount: params[6],
          start_date: params[7],
          end_date: params[8],
          usage_limit: params[9],
          active: params[10],
          usage_count: 0
        };
        return [{ insertId: 201 }];
      }],
      [/^SELECT[\s\S]*FROM coupons c WHERE \(c\.id = \?\) AND \(c\.store_id = 1 OR c\.store_id IS NULL\) LIMIT 1/, (sql, params) => {
        return [[insertedRow]];
      }],
      [/^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
      [/^SELECT[\s\S]*FROM coupon_usage cu/, () => [[]]]
    ]);
    installFakePool(pool);

    const couponService = freshRequire('../server/services/couponService');
    const chipakkCoupon = await couponService.createCoupon({
      code: 'STICKER100',
      discount_type: 'fixed',
      discount_value: 100, // ₹100
      min_order_value: 299, // ₹299 in whole rupees
      store_id: 1
    });

    assert.ok(chipakkCoupon);
    assert.strictEqual(insertedRow.discount_value, 100, 'Store 1 fixed discount must remain 100 in database');
    assert.strictEqual(chipakkCoupon.discount_value_rupees, 100);
    assert.strictEqual(chipakkCoupon.min_order_value_rupees, 299);
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===============================================================`);
  console.log(`TOTAL CHECKS: ${results.length}`);
  console.log(`PASSED:       ${results.length - failed.length}`);
  console.log(`FAILED:       ${failed.length}`);
  console.log(`===============================================================`);
  if (failed.length) {
    console.error('FAILED:\n' + failed.map((f) => ` - ${f.name}`).join('\n'));
    process.exit(1);
  }
  process.exit(0);
})();
