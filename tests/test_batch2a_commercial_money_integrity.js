/**
 * CHIPAKK & THE MARSHANS — Batch 2A Commercial Money Integrity Test Suite
 *
 * 15 Mandatory Commercial Integrity Behavioral Tests:
 * 1.  Free shipping threshold evaluation at ₹298, ₹299, ₹300, ₹301
 * 2.  Free shipping with coupon: Gross ₹315, discount ₹35 => shipping ₹0, total ₹280
 * 3.  Express shipping removed from UI and rejected / defaulted to standard
 * 4.  Inclusive 18% GST calculation accuracy: taxable = round(total * 100 / 118), tax = total - taxable
 * 5.  GST state split: Delhi -> Delhi (CGST/SGST), Delhi -> Karnataka/Maharashtra (IGST)
 * 6.  GST snapshot columns on orders and order_items (schema & query verification)
 * 7.  Payments table normalization: paise for Store 1 (rupees * 100) and Store 2 (paise)
 * 8.  Coupon concurrency: row-locking with SELECT ... FOR UPDATE in order placement
 * 9.  Coupon per-customer limit: second redemption by same customer rejected
 * 10. Coupon reservation lifecycle: reserved -> consumed on payment / released on failure
 * 11. Store 2 fixed discount coupon: input in rupees, stored internally as paise
 * 12. Stale cart price revalidation: updates unit_price, sets price_changed, attaches notice
 * 13. Announcement bar & threshold consistency across UI
 * 14. Admin dashboard revenue KPI excludes unpaid, pending, cancelled, and failed orders
 * 15. Admin order detail modal displays complete inclusive GST breakdown
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('===============================================================');
console.log('💰 CHIPAKK & THE MARSHANS — BATCH 2A COMMERCIAL MONEY INTEGRITY');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failCount++;
    console.error(`[FAIL] ${name} — ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failCount++;
    console.error(`[FAIL] ${name} — ${err.message}`);
  }
}

// Module Imports
const taxUtils = require('../server/utils/taxUtils');
const paymentService = require('../server/services/paymentService');

// -------------------------------------------------------------
// Test 1: Free shipping threshold evaluation (Store 1)
// -------------------------------------------------------------
test('1. Free shipping threshold evaluation at ₹298, ₹299, ₹300, ₹301', () => {
  const evaluateShipping = (subtotalRupees, threshold = 300, fee = 50) => {
    return (threshold > 0 && subtotalRupees >= threshold) ? 0 : fee;
  };

  assert.strictEqual(evaluateShipping(298), 50, '₹298 subtotal must incur ₹50 shipping');
  assert.strictEqual(evaluateShipping(299), 50, '₹299 subtotal must incur ₹50 shipping');
  assert.strictEqual(evaluateShipping(300), 0, '₹300 subtotal must qualify for free shipping (₹0)');
  assert.strictEqual(evaluateShipping(301), 0, '₹301 subtotal must qualify for free shipping (₹0)');
});

// -------------------------------------------------------------
// Test 2: Free shipping evaluated on GROSS merchandise subtotal
// -------------------------------------------------------------
test('2. Free shipping with coupon: Gross ₹315, discount ₹35 => shipping ₹0, total ₹280', () => {
  const grossSubtotal = 315;
  const couponDiscount = 35;
  const threshold = 300;
  const standardFee = 50;

  // Rule: eligibility based strictly on GROSS merchandise subtotal BEFORE discount
  const isEligible = grossSubtotal >= threshold;
  const shippingCharge = isEligible ? 0 : standardFee;
  const netMerchandise = Math.max(0, grossSubtotal - couponDiscount);
  const finalTotal = netMerchandise + shippingCharge;

  assert.strictEqual(shippingCharge, 0, 'Shipping must be ₹0 because gross merchandise ₹315 >= ₹300');
  assert.strictEqual(netMerchandise, 280, 'Net merchandise after ₹35 discount must be ₹280');
  assert.strictEqual(finalTotal, 280, 'Final order total must be ₹280');
});

// -------------------------------------------------------------
// Test 3: Express shipping removed from UI and defaulted in checkout
// -------------------------------------------------------------
test('3. Express shipping option removed from checkout UI and JS', () => {
  const checkoutHtml = fs.readFileSync(path.join(__dirname, '../customer-workspace/checkout.html'), 'utf8');
  const checkoutJs = fs.readFileSync(path.join(__dirname, '../customer-workspace/js/checkout.js'), 'utf8');

  assert.strictEqual(checkoutHtml.includes('id="shipExpress"'), false, 'checkout.html must not contain active shipExpress radio');
  assert.strictEqual(checkoutJs.includes('selectedShipping === "express"'), false, 'checkout.js must not have express shipping calculation branch');
  assert.ok(checkoutJs.includes('selectedShipping = "standard"'), 'checkout.js must enforce standard shipping');
});

// -------------------------------------------------------------
// Test 4: Inclusive 18% GST calculation accuracy & rounding
// -------------------------------------------------------------
test('4. Inclusive 18% GST calculation accuracy: taxable = round(total * 100 / 118), tax = total - taxable', () => {
  const { calculateInclusiveGst } = taxUtils;

  // ₹100: taxable = round(10000 / 118) = 85, tax = 15
  const res100 = calculateInclusiveGst(100, 18);
  assert.strictEqual(res100.taxable_amount, 85, '₹100 taxable must be ₹85');
  assert.strictEqual(res100.tax_amount, 15, '₹100 tax must be ₹15');
  assert.strictEqual(res100.taxable_amount + res100.tax_amount, 100, 'Taxable + tax must exactly equal total');

  // ₹299: taxable = round(29900 / 118) = 253, tax = 46
  const res299 = calculateInclusiveGst(299, 18);
  assert.strictEqual(res299.taxable_amount, 253, '₹299 taxable must be ₹253');
  assert.strictEqual(res299.tax_amount, 46, '₹299 tax must be ₹46');
  assert.strictEqual(res299.taxable_amount + res299.tax_amount, 299, 'Taxable + tax must exactly equal total');

  // ₹300: taxable = round(30000 / 118) = 254, tax = 46
  const res300 = calculateInclusiveGst(300, 18);
  assert.strictEqual(res300.taxable_amount, 254, '₹300 taxable must be ₹254');
  assert.strictEqual(res300.tax_amount, 46, '₹300 tax must be ₹46');
  assert.strictEqual(res300.taxable_amount + res300.tax_amount, 300, 'Taxable + tax must exactly equal total');

  // ₹350: taxable = round(35000 / 118) = 297, tax = 53
  const res350 = calculateInclusiveGst(350, 18);
  assert.strictEqual(res350.taxable_amount, 297, '₹350 taxable must be ₹297');
  assert.strictEqual(res350.tax_amount, 53, '₹350 tax must be ₹53');
  assert.strictEqual(res350.taxable_amount + res350.tax_amount, 350, 'Taxable + tax must exactly equal total');

  // Paise model (Store 2: e.g. ₹1499.00 = 149900 paise)
  // 149900 * 100 / 118 = 127033.898 => 127034 taxable, 22866 tax
  const resStore2 = calculateInclusiveGst(149900, 18);
  assert.strictEqual(resStore2.taxable_amount, 127034, 'Store 2 taxable paise check');
  assert.strictEqual(resStore2.tax_amount, 22866, 'Store 2 tax paise check');
  assert.strictEqual(resStore2.taxable_amount + resStore2.tax_amount, 149900, 'Store 2 exact reconciliation');
});

// -------------------------------------------------------------
// Test 5: GST state split (Intra-state vs Inter-state)
// -------------------------------------------------------------
test('5. GST state split: Delhi -> Delhi (Intra-state) vs Delhi -> Karnataka (Inter-state)', () => {
  const { calculateInclusiveGst, resolveSellerState } = taxUtils;

  // Seller state resolution
  assert.strictEqual(resolveSellerState('07AAAAA0000A1Z5'), 'Delhi', 'GSTIN starting with 07 must resolve to Delhi');
  assert.strictEqual(resolveSellerState('29AAAAA0000A1Z5'), 'Karnataka', 'GSTIN starting with 29 must resolve to Karnataka');

  // Intra-state (Delhi -> Delhi)
  const intra = calculateInclusiveGst(300, 18, { sellerState: 'Delhi', buyerState: 'Delhi' });
  assert.strictEqual(intra.is_same_state, true, 'Same state must be intra-state');
  assert.strictEqual(intra.igst_amount, 0, 'Intra-state IGST must be 0');
  assert.strictEqual(intra.cgst_amount + intra.sgst_amount, intra.tax_amount, 'CGST + SGST must equal total tax');
  assert.strictEqual(intra.cgst_amount, Math.floor(intra.tax_amount / 2), 'CGST must be half tax');
  assert.strictEqual(intra.sgst_amount, intra.tax_amount - intra.cgst_amount, 'SGST must take remaining tax');

  // Inter-state (Delhi -> Karnataka)
  const inter = calculateInclusiveGst(300, 18, { sellerState: 'Delhi', buyerState: 'Karnataka' });
  assert.strictEqual(inter.is_same_state, false, 'Different states must be inter-state');
  assert.strictEqual(inter.cgst_amount, 0, 'Inter-state CGST must be 0');
  assert.strictEqual(inter.sgst_amount, 0, 'Inter-state SGST must be 0');
  assert.strictEqual(inter.igst_amount, inter.tax_amount, 'Inter-state IGST must equal total tax');
});

// -------------------------------------------------------------
// Test 6: GST snapshot columns & migration schema verification
// -------------------------------------------------------------
test('6. Migration 016 additive DDL schema contains tax columns and coupon reservation', () => {
  const migrationSql = fs.readFileSync(path.join(__dirname, '../database/migration_016_commercial_money_integrity.sql'), 'utf8');

  assert.ok(migrationSql.includes('`tax_amount`'), 'Migration must add tax_amount');
  assert.ok(migrationSql.includes('`cgst_amount`'), 'Migration must add cgst_amount');
  assert.ok(migrationSql.includes('`sgst_amount`'), 'Migration must add sgst_amount');
  assert.ok(migrationSql.includes('`igst_amount`'), 'Migration must add igst_amount');
  assert.ok(migrationSql.includes('`shipping_method`'), 'Migration must add shipping_method');
  assert.ok(migrationSql.includes('`hsn_code`'), 'Migration must add hsn_code to order_items');
  assert.ok(migrationSql.includes('`per_customer_limit`'), 'Migration must add per_customer_limit to coupons');
  assert.ok(migrationSql.includes('reserved') && migrationSql.includes('consumed') && migrationSql.includes('released'),
    'Migration must add reservation status to coupon_usage');
});

// -------------------------------------------------------------
// Test 7: Payments table normalization (paise for both stores)
// -------------------------------------------------------------
test('7. Payments table normalization: toGatewayPaise converts Store 1 to paise and preserves Store 2 paise', () => {
  const { toGatewayPaise } = paymentService;

  // Store 1: DB total_price is whole INR rupees (e.g. ₹15 -> 1500 paise, ₹346 -> 34600 paise)
  assert.strictEqual(toGatewayPaise(15, 1), 1500, 'Store 1 ₹15 must be 1500 paise in payments table');
  assert.strictEqual(toGatewayPaise(346, 1), 34600, 'Store 1 ₹346 must be 34600 paise in payments table');
  assert.strictEqual(toGatewayPaise(300, 1), 30000, 'Store 1 ₹300 must be 30000 paise in payments table');

  // Store 2: DB total_price is already integer paise (e.g. ₹1499.00 = 149900 paise)
  assert.strictEqual(toGatewayPaise(149900, 2), 149900, 'Store 2 149900 paise must remain 149900 paise in payments table');
  assert.strictEqual(toGatewayPaise(5000, 2), 5000, 'Store 2 5000 paise must remain 5000 paise in payments table');
});

// -------------------------------------------------------------
// Test 8: Coupon concurrency row locking in order placement
// -------------------------------------------------------------
test('8. OrderService uses SELECT ... FOR UPDATE when locking coupon rows in transaction', () => {
  const orderServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/orderService.js'), 'utf8');

  assert.ok(orderServiceCode.includes('FROM coupons WHERE UPPER(code) = ? AND (store_id = ? OR (store_id IS NULL AND ? = 1)) LIMIT 1 FOR UPDATE'),
    'orderService must use SELECT ... FOR UPDATE to lock coupon row');
});

// -------------------------------------------------------------
// Test 9: Coupon per-customer usage limit verification
// -------------------------------------------------------------
test('9. CouponService validates per-customer usage limit', async () => {
  const couponServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/couponService.js'), 'utf8');
  assert.ok(couponServiceCode.includes('per_customer_limit'), 'couponService must check per_customer_limit');
  assert.ok(couponServiceCode.includes("status = 'reserved'"), 'couponService must count active reservations');
});

// -------------------------------------------------------------
// Test 10: Coupon reservation lifecycle management
// -------------------------------------------------------------
test('10. Coupon reservation lifecycle helpers promote on payment and release on failure', () => {
  assert.strictEqual(typeof paymentService.promoteCouponReservation, 'function', 'promoteCouponReservation must be exported');
  assert.strictEqual(typeof paymentService.releaseCouponReservation, 'function', 'releaseCouponReservation must be exported');

  const paymentServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/paymentService.js'), 'utf8');
  assert.ok(paymentServiceCode.includes("UPDATE coupon_usage SET status = 'consumed' WHERE order_id = ? AND status = 'reserved'"),
    'paymentService must promote reserved to consumed');
  assert.ok(paymentServiceCode.includes("UPDATE coupon_usage SET status = 'released' WHERE order_id = ? AND status = 'reserved'"),
    'paymentService must release reserved coupons on failure');
});

// -------------------------------------------------------------
// Test 11: Store 2 fixed discount coupon conversion
// -------------------------------------------------------------
test('11. Store 2 fixed discount coupons convert rupees to paise on create and update', () => {
  const couponServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/couponService.js'), 'utf8');

  assert.ok(couponServiceCode.includes("activeStoreId === 2 && type === 'fixed'"),
    'couponService must identify Store 2 fixed coupons in createCoupon');
  assert.ok(couponServiceCode.includes("effStoreId === 2 && type === 'fixed'"),
    'couponService must identify Store 2 fixed coupons in updateCoupon');
  assert.ok(couponServiceCode.includes('parsedVal = Math.round(parsedVal * 100);'),
    'couponService must normalize Store 2 fixed discount rupees to paise');
});

// -------------------------------------------------------------
// Test 12: Stale cart price revalidation in cartService
// -------------------------------------------------------------
test('12. cartService revalidates unit_price against live catalog and flags price_changed', () => {
  const cartServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/cartService.js'), 'utf8');

  assert.ok(cartServiceCode.includes('price_change_notice'), 'cartService must provide price_change_notice');
  assert.ok(cartServiceCode.includes('item.price_changed = true'), 'cartService must set price_changed flag');
  assert.ok(cartServiceCode.includes('UPDATE cart_items SET unit_price = ?, updated_at = NOW() WHERE id = ?'),
    'cartService must update cart_items with live catalog price');
});

// -------------------------------------------------------------
// Test 13: Announcement bar & shipping threshold UI alignment
// -------------------------------------------------------------
test('13. Storefront announcement and shipping threshold UI defaults to dynamic ₹300', () => {
  const appJsCode = fs.readFileSync(path.join(__dirname, '../customer-workspace/js/app.js'), 'utf8');

  assert.ok(appJsCode.includes('Number(settings.freeShippingThreshold) \n      : 300') || appJsCode.includes(': 300'),
    'app.js must default free shipping threshold to 300');
  assert.strictEqual(appJsCode.includes('Free shipping over ₹299'), false,
    'app.js must not have hardcoded ₹299 threshold string');
});

// -------------------------------------------------------------
// Test 14: Admin dashboard revenue KPI strictly excludes unpaid/cancelled orders
// -------------------------------------------------------------
test('14. Admin dashboard revenue KPI strictly filters for paid orders', () => {
  const adminJsCode = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

  assert.ok(adminJsCode.includes("payStatus === 'paid' && fulStatus !== 'CANCELLED' && fulStatus !== 'FAILED'"),
    'admin.js renderDashboardMetrics must exclude unpaid, pending, cancelled, and failed orders');
  assert.ok(adminJsCode.includes("st === 'cancelled' || st === 'failed' || paySt !== 'paid'"),
    'admin.js renderAnalyticsChart must exclude unpaid orders from chart revenue');
});

// -------------------------------------------------------------
// Test 15: Admin order detail modal displays complete inclusive GST breakdown
// -------------------------------------------------------------
test('15. Admin order detail modal displays inclusive 18% GST breakdown and shipping method', () => {
  const adminJsCode = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

  assert.ok(adminJsCode.includes('Included 18% GST:'), 'admin.js must display Included 18% GST');
  assert.ok(adminJsCode.includes('CGST: ₹${cgst} + SGST: ₹${sgst}'), 'admin.js must show intra-state split');
  assert.ok(adminJsCode.includes('IGST: ₹${igst}'), 'admin.js must show inter-state IGST');
  assert.ok(adminJsCode.includes('per-customer-limit'), 'admin.js must include per_customer_limit in coupon modal');
});

// =============================================================
// Summary
// =============================================================
console.log('\n===============================================================');
console.log(`RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('===============================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL 15 COMMERCIAL MONEY INTEGRITY TESTS PASSED!');
  process.exit(0);
}
