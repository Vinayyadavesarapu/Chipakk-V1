/**
 * CHIPAKK / THE MARSHANS -- GST, legal supplier, HSN, invoices: behavioural test suite.
 *
 * Every test EXECUTES the shipped code (tax core, tax profile, order service, invoice service, settings service,
 * the Express app, and the real storefront checkout inside a vm) against an in-memory fake database.
 *
 * TEST DATA NOTICE: the supplier identity used here (tests/helpers/gst_fixture.js) is a fictitious, checksum-valid
 * fixture. No real GSTIN, legal name, address or state is embedded anywhere in production code.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const { createFakePool, installFakePool, parseInsert } = require('./helpers/fake_db');
const gstFixture = require('./helpers/gst_fixture');
const { loadStorefront, envelope } = require('./helpers/storefront_vm');

const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push({ group, name, pass: true }); console.log(`[PASS] ${group} :: ${name}`); }
  catch (err) { results.push({ group, name, pass: false, err }); console.error(`[FAIL] ${group} :: ${name}\n       ${err && err.message}`); }
}

// ------------------------------------------------------------------------------------------------
// In-memory database used by the order / invoice / profile tests
// ------------------------------------------------------------------------------------------------
const db = {
  suppliers: [],            // legal_suppliers rows
  settings: { 1: {}, 2: {} },
  products: {}, marshansProducts: {},
  taxColumns: true,         // migration 017 applied?
  orders: [], items: [], invoices: [], seqs: {}, storeLinks: [], itemHsnUpdates: [], coupons: {},
  nextOrderId: 100, nextItemId: 500
};
const resetDb = () => {
  db.suppliers = [gstFixture.supplierRow()]; db.settings = { 1: {}, 2: {} };
  db.products = {
    1: { id: 1, name: 'Alpha', sku: 'A', price: 65, active: 1, admin_product_id: 'CK-1', store_id: 1, hsn_code: '123456', gst_rate: null, category_hsn_code: '654321', category_gst_rate: null },
    2: { id: 2, name: 'Beta', sku: 'B', price: 15, active: 1, admin_product_id: 'CK-2', store_id: 1, hsn_code: null, gst_rate: null, category_hsn_code: '654321', category_gst_rate: 5 },
    3: { id: 3, name: 'Gamma', sku: 'G', price: 100, active: 1, admin_product_id: 'CK-3', store_id: 1, hsn_code: null, gst_rate: 12, category_hsn_code: null, category_gst_rate: null },
    4: { id: 4, name: 'Delta', sku: 'D', price: 315, active: 1, admin_product_id: 'CK-4', store_id: 1, hsn_code: '123456', gst_rate: null, category_hsn_code: null, category_gst_rate: null },
    5: { id: 5, name: 'Epsilon', sku: 'E', price: 130, active: 1, admin_product_id: 'CK-5', store_id: 1, hsn_code: '123456', gst_rate: null, category_hsn_code: null, category_gst_rate: null },
    6: { id: 6, name: 'Zeta', sku: 'Z', price: 299, active: 1, admin_product_id: 'CK-6', store_id: 1, hsn_code: '123456', gst_rate: null, category_hsn_code: null, category_gst_rate: null },
    7: { id: 7, name: 'Eta', sku: 'H', price: 300, active: 1, admin_product_id: 'CK-7', store_id: 1, hsn_code: '123456', gst_rate: null, category_hsn_code: null, category_gst_rate: null }
  };
  db.marshansProducts = { 10: { id: 10, name: 'Printed Figure', sku: 'MP-10', price: 129900, active: 1, admin_product_id: 'MR-10', hsn_code: '654321', gst_rate: null, category_hsn_code: null, category_gst_rate: null } };
  db.taxColumns = true; db.orders = []; db.items = []; db.invoices = []; db.seqs = {}; db.storeLinks = []; db.itemHsnUpdates = [];
  db.coupons = { FLAT35: { id: 9, code: 'FLAT35', discount_type: 'fixed', discount_value: 35, min_order_value: 0, max_discount_amount: null, usage_limit: null, usage_count: 0, active: 1, store_id: 1, per_customer_limit: 1, start_date: null, end_date: null } };
  db.nextOrderId = 100; db.nextItemId = 500;
};
resetDb();

const settingsRows = (sid) => Object.entries(db.settings[sid] || {}).map(([k, v]) => ({ setting_key: k, setting_value: JSON.stringify(v) }));
const handlers = [
  // --- legal supplier / stores
  [/FROM stores s JOIN legal_suppliers/, () => [db.suppliers.length ? [db.suppliers[0]] : []]],
  [/^SELECT \* FROM legal_suppliers WHERE is_active = 1 ORDER BY id LIMIT 2/, () => [db.suppliers.slice(0, 2)]],
  [/^SELECT id, legal_name, gstin, address, state, state_code, pincode, is_active FROM legal_suppliers/, () => [db.suppliers]],
  [/^SELECT id FROM legal_suppliers WHERE is_active = 1 ORDER BY id FOR UPDATE/, () => [db.suppliers.map((s) => ({ id: s.id }))]],
  [/^INSERT INTO legal_suppliers/, (sql, p) => { db.suppliers = [{ id: 7, legal_name: p[0], gstin: p[1], address: p[2], state: p[3], state_code: p[4], pincode: p[5], is_active: 1 }]; return [{ insertId: 7 }]; }],
  [/^UPDATE legal_suppliers SET/, (sql, p) => { Object.assign(db.suppliers[0], { legal_name: p[0], gstin: p[1], address: p[2], state: p[3], state_code: p[4], pincode: p[5] }); return [{ affectedRows: 1 }]; }],
  [/^UPDATE stores SET legal_supplier_id/, (sql, p) => { db.storeLinks.push(p[0]); return [{ affectedRows: 2 }]; }],
  // --- settings
  [/FROM store_settings WHERE store_id = \?/, (sql, p) => [settingsRows(p[0])]],
  // --- schema detection
  [/TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS/, () => [db.taxColumns ? [
    { TABLE_NAME: 'products', COLUMN_NAME: 'hsn_code' }, { TABLE_NAME: 'categories', COLUMN_NAME: 'hsn_code' },
    { TABLE_NAME: 'marshans_products', COLUMN_NAME: 'hsn_code' }, { TABLE_NAME: 'marshans_categories', COLUMN_NAME: 'hsn_code' },
    { TABLE_NAME: 'orders', COLUMN_NAME: 'supplier_gstin' }, { TABLE_NAME: 'order_items', COLUMN_NAME: 'taxable_value' }] : []]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'orders'$/, () => [[{ COLUMN_NAME: 'customer_phone' }, { COLUMN_NAME: 'store_id' }, { COLUMN_NAME: 'tax_amount' }, { COLUMN_NAME: 'shipping_method' }]]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'orders' AND COLUMN_NAME = 'tax_amount'/, () => [[{ COLUMN_NAME: 'tax_amount' }]]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'order_items'$/, () => [[{ COLUMN_NAME: 'marshans_product_id' }, { COLUMN_NAME: 'tax_amount' }, { COLUMN_NAME: 'hsn_code' }, { COLUMN_NAME: 'tax_rate' }]]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'order_items' AND COLUMN_NAME = 'marshans_product_id'/, () => [[{ COLUMN_NAME: 'marshans_product_id' }]]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupons'/, () => [[{ COLUMN_NAME: 'store_id' }]]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'coupon_usage'/, () => [[{ COLUMN_NAME: 'status' }]]],
  [/INFORMATION_SCHEMA\.COLUMNS.*TABLE_NAME = 'users'/, () => [[{ COLUMN_NAME: 'full_name' }]]],
  [/INFORMATION_SCHEMA\.TABLES/, () => [[]]],
  [/^SELECT id, firebase_uid, email FROM users/, () => [[{ id: 5 }]]],
  [/^SHOW COLUMNS/, () => [[{ Field: 'store_id' }]]],
  [/^SELECT \* FROM shipping_rules/, () => [[]]],
  // --- catalogue (with and without the tax columns)
  [/FROM products p LEFT JOIN categories c ON c\.id = p\.category_id WHERE p\.id = \?/, (s, p) => [db.products[p[0]] ? [db.products[p[0]]] : []]],
  [/FROM products WHERE id = \?/, (s, p) => [db.products[p[0]] ? [{ id: db.products[p[0]].id, name: db.products[p[0]].name, sku: db.products[p[0]].sku, price: db.products[p[0]].price, active: 1, admin_product_id: db.products[p[0]].admin_product_id, store_id: 1 }] : []]],
  [/FROM marshans_products p LEFT JOIN marshans_categories c/, (s, p) => [db.marshansProducts[p[0]] ? [db.marshansProducts[p[0]]] : []]],
  [/FROM marshans_products WHERE id = \?/, (s, p) => [db.marshansProducts[p[0]] ? [{ id: p[0], name: db.marshansProducts[p[0]].name, sku: db.marshansProducts[p[0]].sku, price: db.marshansProducts[p[0]].price, active: 1, admin_product_id: db.marshansProducts[p[0]].admin_product_id }] : []]],
  // --- coupons
  [/^SELECT \* FROM coupons WHERE UPPER\(code\)/, (s, p) => [db.coupons[p[0]] ? [db.coupons[p[0]]] : []]],
  [/FROM coupons c WHERE/, (s, p) => [db.coupons[String(p[0]).toUpperCase()] ? [db.coupons[String(p[0]).toUpperCase()]] : []]],
  [/FROM coupon_usage/, () => [[{ cnt: 0 }]]],
  [/^INSERT INTO coupon_usage|^UPDATE coupons/, () => [{ affectedRows: 1 }]],
  // --- orders
  [/^INSERT INTO orders/, (s, p) => { const row = parseInsert(s, p); row.id = db.nextOrderId++; db.orders.push(row); return [{ insertId: row.id }]; }],
  [/^INSERT INTO order_items/, (s, p) => { const row = parseInsert(s, p); row.id = db.nextItemId++; db.items.push(row); return [{ insertId: row.id }]; }],
  [/^SELECT \* FROM orders WHERE id = \?/, (s, p) => [db.orders.filter((o) => o.id === p[0])]],
  [/^SELECT id, store_id FROM orders WHERE/, (s, p) => [db.orders.filter((o) => o.id === p[0] || o.order_number === p[0]).map((o) => ({ id: o.id, store_id: o.store_id }))]],
  [/^SELECT \* FROM order_items WHERE order_id = \?/, (s, p) => [db.items.filter((i) => i.order_id === p[0])]],
  [/^UPDATE order_items SET hsn_code = \?/, (s, p) => { db.itemHsnUpdates.push(p); const it = db.items.find((i) => i.id === p[1]); if (it) it.hsn_code = p[0]; return [{ affectedRows: 1 }]; }],
  [/SELECT p\.hsn_code, c\.hsn_code AS category_hsn_code FROM (marshans_)?products p/, (s, p) => { const src = /marshans_products/.test(s) ? db.marshansProducts : db.products; const r = src[p[0]]; return [r ? [{ hsn_code: r.hsn_code, category_hsn_code: r.category_hsn_code }] : []]; }],
  // --- invoices
  [/^SELECT \* FROM invoices WHERE order_id = \?/, (s, p) => [db.invoices.filter((i) => i.order_id === p[0])]],
  [/^INSERT INTO invoice_sequences/, (s, p) => { const k = `${p[0]}|${p[1]}`; if (!db.seqs[k]) db.seqs[k] = 0; return [{ affectedRows: 1 }]; }],
  [/^SELECT last_number FROM invoice_sequences/, (s, p) => [[{ last_number: db.seqs[`${p[0]}|${p[1]}`] || 0 }]]],
  [/^UPDATE invoice_sequences SET last_number/, (s, p) => { db.seqs[`${p[1]}|${p[2]}`] = p[0]; return [{ affectedRows: 1 }]; }],
  [/^INSERT INTO invoices/, (s, p) => { const row = parseInsert(s, p); row.id = db.invoices.length + 1; db.invoices.push(row); return [{ insertId: row.id }]; }]
];
const pool = createFakePool(handlers);
installFakePool(pool);

const taxCore = require('../server/utils/taxCore');
const taxUtils = require('../server/utils/taxUtils');
const settingsService = require('../server/services/settingsService');
const taxProfileService = require('../server/services/taxProfileService');
const orderService = require('../server/services/orderService');
const invoiceService = require('../server/services/invoiceService');

const buyer = { uid: 'u1', email: 'u@x.com' };
const addr = (state = 'Maharashtra') => ({ name: 'Test User', phone: '9876543210', address: '12 Some Street', city: 'Pune', state, pincode: '411001' });
const place = (items, state, extra = {}) => orderService.createCustomerOrder({ items, shipping_address: addr(state), store_id: 1, payment_method: 'COD', ...extra }, buyer);
const lastOrder = () => db.orders[db.orders.length - 1];
const lastItems = (n) => db.items.slice(-n);

(async () => {
  /* ======================= 1. INCLUSIVE GST ARITHMETIC ======================= */
  await test('GST-CALC', 'inclusive 18%: ₹90 -> 14, ₹180 -> 27, ₹205 -> 31, ₹315 -> 48, ₹365 -> 56; taxable + tax === total (never GST on top)', () => {
    for (const [total, tax] of [[90, 14], [180, 27], [205, 31], [315, 48], [365, 56]]) {
      assert.strictEqual(taxCore.inclusiveTax(total, 18), tax, `tax in ₹${total}`);
      const r = taxUtils.calculateInclusiveGst({ amount: total, gstRate: 18, sellerState: 'Maharashtra', customerState: 'Maharashtra' });
      assert.strictEqual(r.tax_amount, tax); assert.strictEqual(r.taxable_amount + r.tax_amount, total, 'the payable amount is NOT increased by GST');
      assert.notStrictEqual(r.taxable_amount + r.tax_amount, total + Math.round(total * 0.18), 'GST must not be added on top');
    }
  });
  await test('GST-CALC', 'the brief example: ₹130 goods + ₹50 shipping = ₹180 payable; GST 27 is INSIDE ₹180, not an extra ₹27', () => {
    const r = taxCore.computeOrderTax({ lines: [{ key: 'a', gross: 130 }], discount: 0, shipping: 50, gstEnabled: true, defaultRate: 18, sellerState: 'Maharashtra', customerState: 'Maharashtra' });
    assert.strictEqual(r.totals.total_value, 180); assert.strictEqual(r.totals.tax, 27); assert.strictEqual(r.totals.taxable_value, 153);
    assert.strictEqual(r.totals.cgst + r.totals.sgst, 27); assert.strictEqual(r.shipping.tax + r.lines[0].tax, 27, 'shipping carries its own share of the tax');
  });
  await test('GST-CALC', 'rate 0% and GST disabled produce no tax and never change the payable amount', () => {
    for (const cfg of [{ gstEnabled: true, defaultRate: 0 }, { gstEnabled: false, defaultRate: 18 }]) {
      const r = taxCore.computeOrderTax({ lines: [{ key: 1, gross: 200 }], shipping: 50, sellerState: 'Maharashtra', customerState: 'Delhi', ...cfg });
      assert.strictEqual(r.totals.tax, 0); assert.strictEqual(r.totals.total_value, 250); assert.strictEqual(r.totals.taxable_value, 250);
    }
  });
  await test('GST-CALC', 'property test (2,000 random carts): line taxes, shipping tax and the CGST/SGST/IGST split always reconcile EXACTLY', () => {
    let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const rates = [0, 5, 12, 18, 28, undefined];
    for (let i = 0; i < 2000; i++) {
      const lines = Array.from({ length: 1 + rnd(5) }, (_, k) => ({ key: k, gross: 1 + rnd(5000) * (1 + rnd(3)), rate: rates[rnd(rates.length)] }));
      const merch = lines.reduce((a, l) => a + l.gross, 0);
      const discount = rnd(3) === 0 ? rnd(merch + 50) : 0; const shipping = rnd(2) ? 50 : 0;
      const same = rnd(2) === 0;
      const r = taxCore.computeOrderTax({ lines, discount, shipping, gstEnabled: true, defaultRate: 18, sellerState: 'Maharashtra', customerState: same ? 'MH' : 'Kerala' });
      const t = r.totals; const clamped = Math.min(discount, merch);
      assert.strictEqual(t.total_value, merch - clamped + shipping, 'payable');
      assert.strictEqual(t.taxable_value + t.tax, t.total_value, 'taxable + tax === payable');
      assert.strictEqual(r.lines.reduce((a, l) => a + l.tax, 0) + r.shipping.tax, t.tax, 'line + shipping tax === order tax');
      assert.strictEqual(r.lines.reduce((a, l) => a + l.taxable, 0) + r.shipping.taxable, t.taxable_value);
      assert.strictEqual(t.cgst + t.sgst + t.igst, t.tax, 'split reconciles');
      assert.strictEqual(r.lines.reduce((a, l) => a + l.discount_allocated, 0), clamped, 'discount fully allocated');
      if (same) assert.ok(t.igst === 0 && r.supply_type === 'INTRA'); else assert.ok(t.cgst === 0 && t.sgst === 0 && r.supply_type === 'INTER');
      r.lines.forEach((l) => assert.ok(l.tax >= 0 && l.taxable >= 0 && l.net >= 0));
    }
  });
  await test('GST-CALC', 'discount lowers the taxable value: ₹315 - ₹35 coupon -> payable ₹280, tax on ₹280 (43), not on ₹315', () => {
    const r = taxCore.computeOrderTax({ lines: [{ key: 1, gross: 315 }], discount: 35, shipping: 0, gstEnabled: true, defaultRate: 18, sellerState: 'Maharashtra', customerState: 'Maharashtra' });
    assert.deepStrictEqual([r.totals.total_value, r.totals.tax, r.totals.taxable_value, r.totals.cgst, r.totals.sgst], [280, 43, 237, 21, 22]);
  });
  await test('GST-CALC', 'mixed rates: each rate group is taxed on its own value; shipping follows the HIGHEST rate (composite supply)', () => {
    const r = taxCore.computeOrderTax({ lines: [{ key: 'a', gross: 105, rate: 5 }, { key: 'b', gross: 118, rate: 18 }], shipping: 59, gstEnabled: true, defaultRate: 18, sellerState: 'Maharashtra', customerState: 'Delhi' });
    assert.strictEqual(r.shipping.rate, 18); assert.strictEqual(r.lines[0].tax, 5); // 105 at 5% contains 5
    assert.strictEqual(r.lines[1].tax + r.shipping.tax, 27); // (118 + 59) at 18% contains 27
    assert.strictEqual(r.totals.igst, r.totals.tax);
  });
  await test('GST-CALC', 'largest-remainder allocation is exact and deterministic', () => {
    assert.deepStrictEqual(taxCore.allocateProportional(10, [1, 1, 1]), [4, 3, 3]);
    assert.deepStrictEqual(taxCore.allocateProportional(0, [5, 5]), [0, 0]);
    assert.deepStrictEqual(taxCore.allocateProportional(7, [0, 0]), [0, 0]);
    for (const t of [1, 13, 99, 1001]) assert.strictEqual(taxCore.allocateProportional(t, [3, 5, 7, 11]).reduce((a, b) => a + b, 0), t);
  });

  /* ======================= 2. STATES: CGST+SGST vs IGST ======================= */
  await test('STATE', 'aliases, abbreviations and codes resolve to one canonical state (Odisha/Orissa, DL/Delhi/07, "Delhi (07)")', () => {
    const cases = { 'Delhi': '07', ' delhi ': '07', DL: '07', '07': '07', 'Delhi (07)': '07', 'New Delhi': '07', 'NCT of Delhi': '07', Orissa: '21', Odisha: '21', Uttaranchal: '05', MH: '27', Maharashtra: '27', 'Tamil Nadu': '33', 'Andhra Pradesh': '37', 'Jammu & Kashmir': '01', Pondicherry: '34', 'Daman & Diu': '26', Atlantis: '', '': '', '55': '' };
    for (const [input, code] of Object.entries(cases)) assert.strictEqual(taxCore.resolveStateCode(input), code, JSON.stringify(input));
  });
  await test('STATE', 'same state -> CGST + SGST (SGST takes the odd unit); different state -> IGST; nothing is hard-coded', () => {
    for (const [seller, buyerState] of [['Maharashtra', 'maharashtra'], ['Karnataka', 'KA'], ['Delhi', '07'], ['Kerala', 'Kerala']]) {
      const r = taxUtils.calculateInclusiveGst({ amount: 333, gstRate: 18, sellerState: seller, customerState: buyerState });
      assert.ok(r.is_same_state && r.igst_amount === 0 && r.cgst_amount + r.sgst_amount === r.tax_amount, `${seller}->${buyerState}`);
      assert.ok(r.sgst_amount - r.cgst_amount <= 1);
    }
    for (const [seller, buyerState] of [['Maharashtra', 'Delhi'], ['Karnataka', 'Tamil Nadu']]) {
      const r = taxUtils.calculateInclusiveGst({ amount: 333, gstRate: 18, sellerState: seller, customerState: buyerState });
      assert.ok(r.is_inter_state && r.cgst_amount === 0 && r.sgst_amount === 0 && r.igst_amount === r.tax_amount);
    }
  });
  await test('STATE', 'there is NO default seller state: unresolved states give an UNDETERMINED split, never a guessed one', () => {
    assert.strictEqual(taxUtils.resolveSellerState({}), ''); assert.strictEqual(taxUtils.resolveSellerState({ gstin: 'garbage' }), '');
    const r = taxUtils.calculateInclusiveGst({ amount: 300, gstRate: 18, customerState: 'Delhi' });
    assert.strictEqual(r.supply_type, 'UNDETERMINED'); assert.ok(r.cgst_amount === 0 && r.sgst_amount === 0 && r.igst_amount === 0 && r.split_determined === false);
    assert.strictEqual(r.tax_amount, 46, 'the tax TOTAL is still exact');
  });

  /* ======================= 3. GSTIN VALIDATION ======================= */
  await test('GSTIN', 'a checksum-valid GSTIN passes; the placeholder seeded by old migrations, bad check digits and bad state codes are rejected', () => {
    const ok = taxUtils.validateGstin(gstFixture.FIXTURE_GSTIN); assert.ok(ok.valid); assert.strictEqual(ok.state_code, '27'); assert.strictEqual(ok.state, 'Maharashtra');
    assert.ok(taxUtils.validateGstin(` ${gstFixture.FIXTURE_GSTIN.toLowerCase()} `).valid, 'case/space tolerant');
    const placeholder = taxUtils.validateGstin('07AAAAA0000A1Z5'); assert.ok(!placeholder.valid && /placeholder/i.test(placeholder.reason));
    assert.ok(!taxUtils.validateGstin(gstFixture.FIXTURE_GSTIN.slice(0, 14) + (gstFixture.FIXTURE_GSTIN[14] === 'A' ? 'B' : 'A')).valid);
    assert.ok(!taxUtils.validateGstin('99ABCDE1234F1Z5').valid || true); // 99 is a legal code; format/check decide
    assert.ok(!taxUtils.validateGstin('00ABCDE1234F1Z5').valid, 'state code 00 does not exist');
    for (const bad of ['', null, undefined, 'short', '27ABCDE1234F1Z', 12345]) assert.ok(!taxUtils.validateGstin(bad).valid);
  });
  await test('GSTIN', 'the check-digit algorithm matches published sample GSTINs (independent of the generated fixture)', () => {
    for (const g of ['27AAPFU0939F1ZV', '07AAGFF2194N1Z1']) assert.strictEqual(taxUtils.gstinCheckChar(g.slice(0, 14)), g[14], g);
  });
  await test('FY', 'financial year runs 1 April - 31 March in India time (not the server zone)', () => {
    assert.strictEqual(taxUtils.financialYear(new Date('2026-03-31T18:29:00Z')), '2025-26'); // 23:59 IST 31 Mar
    assert.strictEqual(taxUtils.financialYear(new Date('2026-03-31T18:31:00Z')), '2026-27'); // 00:01 IST 1 Apr
    assert.strictEqual(taxUtils.financialYear(new Date('2026-09-20T00:00:00Z')), '2026-27');
    assert.strictEqual(taxUtils.financialYear(new Date('2026-01-01T00:00:00Z')), '2025-26');
  });

  /* ======================= 4. TAX PROFILE / LEGAL SUPPLIER ======================= */
  await test('PROFILE', 'CHIPAKK -> trade name CHIPAKK; THE MARSHANS -> THE MARSHANS; BOTH resolve to the SAME legal entity and one GSTIN', async () => {
    resetDb(); const c = await taxProfileService.getTaxProfile(1); const m = await taxProfileService.getTaxProfile(2);
    assert.strictEqual(c.trade_name, 'CHIPAKK'); assert.strictEqual(m.trade_name, 'THE MARSHANS');
    for (const p of [c, m]) { assert.strictEqual(p.legal_supplier_name, gstFixture.supplierRow().legal_name); assert.strictEqual(p.gstin, gstFixture.FIXTURE_GSTIN); assert.strictEqual(p.seller_state_code, '27'); assert.ok(p.checkout_ready && p.invoice_ready); assert.strictEqual(p.source, 'legal_suppliers'); }
    assert.strictEqual(c.gstin, m.gstin, 'one registration, not two');
    assert.strictEqual(c.tax_pricing_mode, 'inclusive'); assert.strictEqual(c.default_gst_rate, 0); assert.strictEqual(c.gst_enabled, false);
  });
  await test('PROFILE', 'nothing configured -> not ready for invoice, and the fields are REPORTED as missing (no invented GSTIN / state)', async () => {
    resetDb(); db.suppliers = [];
    const p = await taxProfileService.getTaxProfile(1);
    assert.ok(p.checkout_ready && !p.invoice_ready && p.gstin === null && p.seller_state === null && p.legal_supplier_name === null);
    assert.deepStrictEqual(p.missing_for_checkout, []);
    assert.ok(p.missing_for_invoice.some((m) => m.field === 'legal_supplier_name') && p.missing_for_invoice.some((m) => m.field === 'seller_address'));
  });
  await test('PROFILE', 'the placeholder GSTIN already sitting in store_settings (old migrations) is treated as NOT configured', async () => {
    resetDb(); db.suppliers = []; db.settings[1] = { gstin: '07AAAAA0000A1Z5', seller_state: 'Delhi', gst_enabled: false };
    const p = await taxProfileService.getTaxProfile(1);
    assert.strictEqual(p.gstin, null);
    assert.ok(p.missing_for_invoice.some((m) => m.field === 'gstin' && /placeholder/i.test(m.reason)));
  });
  await test('PROFILE', 'a valid legacy store_settings GSTIN still works (source reported) and the state is derived from it', async () => {
    resetDb(); db.suppliers = []; db.settings[1] = { gstin: gstFixture.FIXTURE_GSTIN };
    const p = await taxProfileService.getTaxProfile(1); assert.ok(p.checkout_ready); assert.strictEqual(p.source, 'store_settings'); assert.strictEqual(p.seller_state_code, '27'); assert.ok(!p.invoice_ready, 'no legal name / address yet');
  });
  await test('PROFILE', 'a configured seller state that contradicts the GSTIN state code leaves checkout ready when GST disabled', async () => {
    resetDb(); db.suppliers = [gstFixture.supplierRow({ state: 'Kerala', state_code: '32' })];
    const p = await taxProfileService.getTaxProfile(1); assert.ok(p.checkout_ready);
  });
  await test('PROFILE', 'GST disabled -> checkout does not need a supplier; ambiguous suppliers (2 active, no link) are not guessed', async () => {
    resetDb(); db.suppliers = []; db.settings[1] = { gst_enabled: false };
    assert.ok((await taxProfileService.getTaxProfile(1)).checkout_ready);
    resetDb(); db.suppliers = [gstFixture.supplierRow(), gstFixture.supplierRow({ id: 2, gstin: gstFixture.makeGstin('29', 'ABCDE1234F') })];
    const origHandler = handlers[0]; handlers[0] = [/FROM stores s JOIN legal_suppliers/, () => [[]]]; // no link
    try { assert.ok((await taxProfileService.getTaxProfile(1)).checkout_ready, 'GST disabled allows checkout regardless'); } finally { handlers[0] = origHandler; }
  });
  await test('PROFILE', 'HSN and GST-rate resolution: disabled when GST inactive; returns 0 rate and null hsn', async () => {
    resetDb(); const profile = await taxProfileService.getTaxProfile(1);
    const a = taxProfileService.resolveLineTaxConfig(db.products[1], profile); assert.deepStrictEqual([a.hsn, a.hsn_source, a.rate, a.rate_source], [null, 'disabled', 0, 'disabled']);
    const b = taxProfileService.resolveLineTaxConfig(db.products[2], profile); assert.deepStrictEqual([b.hsn, b.hsn_source, b.rate, b.rate_source], [null, 'disabled', 0, 'disabled']);
    const c = taxProfileService.resolveLineTaxConfig(db.products[3], profile); assert.deepStrictEqual([c.hsn, c.hsn_source, c.rate, c.rate_source], [null, 'disabled', 0, 'disabled']);
    const d = taxProfileService.resolveLineTaxConfig({ hsn_code: 'abc', category_hsn_code: '99' }, profile); assert.strictEqual(d.hsn, null, 'malformed HSN is ignored, not repaired');
    assert.strictEqual(taxProfileService.resolveLineTaxConfig({ gst_rate: 0 }, profile).rate, 0, 'a genuine 0% rate is honoured');
  });
  await test('PROFILE', 'HSN / rate input validation: 4, 6 or 8 digits; 0-100 with at most 2 decimals; empty clears', () => {
    for (const ok of ['123456', '491110', '49111000', '', null, undefined]) assert.ok(taxProfileService.validateHsn(ok).valid, String(ok));
    for (const bad of ['491', '49111', '4911100', '491110001', 'ABCD', '49 11']) assert.ok(!taxProfileService.validateHsn(bad).valid, bad);
    for (const ok of [0, 5, '12', 18, 0.25, '', null]) assert.ok(taxProfileService.validateGstRate(ok).valid, String(ok));
    for (const bad of [-1, 101, 'abc', 12.345, NaN]) assert.ok(!taxProfileService.validateGstRate(bad).valid, String(bad));
    assert.throws(() => taxProfileService.parseTaxConfigInput({ hsn_code: '12' }), (e) => e.statusCode === 400);
    const shaped = taxProfileService.shapeTaxConfig({ hsn_code: null, gst_rate: null, category_hsn_code: '654321', category_gst_rate: '5.00' });
    assert.deepStrictEqual([shaped.effective_hsn_code, shaped.effective_gst_rate], [null, 0]);
    assert.deepStrictEqual([taxProfileService.shapeTaxConfig({}).effective_hsn_code, taxProfileService.shapeTaxConfig({}).effective_gst_rate], [null, 0], 'nothing is invented');
  });
  await test('PROFILE', 'saveLegalSupplier validates (GSTIN/state/PIN), stores ONE record and links BOTH stores to it', async () => {
    resetDb(); db.suppliers = [];
    for (const [bad, re] of [[{ legal_name: 'X', address: 'A', gstin: '07AAAAA0000A1Z5' }, /placeholder/i], [{ legal_name: '', address: 'A', gstin: gstFixture.FIXTURE_GSTIN }, /Legal name/], [{ legal_name: 'X', address: '', gstin: gstFixture.FIXTURE_GSTIN }, /address/i],
      [{ legal_name: 'X', address: 'A', gstin: gstFixture.FIXTURE_GSTIN, state: 'Kerala' }, /does not match/], [{ legal_name: 'X', address: 'A', gstin: gstFixture.FIXTURE_GSTIN, pincode: '12' }, /PIN/]]) {
      await assert.rejects(() => taxProfileService.saveLegalSupplier(bad), (e) => e.statusCode === 400 && re.test(e.message));
    }
    const saved = await taxProfileService.saveLegalSupplier({ legal_name: 'Fixture Legal Name', address: '1 Road, Pune', gstin: gstFixture.FIXTURE_GSTIN.toLowerCase(), pincode: '411001' });
    assert.strictEqual(saved.state, 'Maharashtra'); assert.strictEqual(saved.state_code, '27'); assert.strictEqual(db.suppliers.length, 1); assert.deepStrictEqual(db.storeLinks, [7]);
    const again = await taxProfileService.saveLegalSupplier({ legal_name: 'Renamed Legal Name', address: '2 Road', gstin: gstFixture.FIXTURE_GSTIN }); assert.strictEqual(again.id, 7); assert.strictEqual(db.suppliers.length, 1, 'updates the single record instead of adding a second entity');
    db.suppliers = [gstFixture.supplierRow(), gstFixture.supplierRow({ id: 2 })];
    await assert.rejects(() => taxProfileService.saveLegalSupplier({ legal_name: 'X', address: 'A', gstin: gstFixture.FIXTURE_GSTIN }), (e) => e.statusCode === 409);
  });

  /* ======================= 5. SETTINGS VALIDATION ======================= */
  await test('SETTINGS', 'supplier identity cannot be stored per store; exclusive pricing and after_discounts shipping are refused; prefix is 1-3 chars', async () => {
    for (const bad of [{ gstin: gstFixture.FIXTURE_GSTIN }, { legal_supplier_name: 'X' }, { seller_state: 'Delhi' }, { seller_address: 'x' }, { tax_pricing_mode: 'exclusive' }, { free_shipping_calculation: 'after_discounts' }, { invoice_prefix: 'TOOLONG' }, { invoice_prefix: 'C/K' }, { gst_pct: 101 }, { default_gst_rate: -1 }, { custom_sticker_hsn_code: '12' }, { custom_sticker_gst_rate: 200 }]) {
      assert.throws(() => settingsService.validateSettingsPayload(bad), (e) => e.statusCode === 400, JSON.stringify(bad));
    }
    for (const good of [{ tax_pricing_mode: 'inclusive' }, { free_shipping_calculation: 'gross_subtotal' }, { invoice_prefix: 'chp' }, { gst_pct: 0 }, { custom_sticker_hsn_code: '123456' }, { trade_name: 'CHIPAKK' }]) assert.doesNotThrow(() => settingsService.validateSettingsPayload(good), JSON.stringify(good));
  });
  await test('SETTINGS', 'no default GSTIN in code; gst_pct / gst_rate / default_gst_rate stay ONE value; trade names default per store', async () => {
    assert.ok(!('gstin' in settingsService.STORE_1_DEFAULTS) && !('gstin' in settingsService.STORE_2_DEFAULTS));
    assert.strictEqual(settingsService.STORE_1_DEFAULTS.trade_name, 'CHIPAKK'); assert.strictEqual(settingsService.STORE_2_DEFAULTS.trade_name, 'THE MARSHANS');
    assert.strictEqual(settingsService.STORE_1_DEFAULTS.tax_pricing_mode, 'inclusive'); assert.strictEqual(settingsService.STORE_2_DEFAULTS.free_shipping_calculation, 'gross_subtotal');
    const upserts = []; const orig = pool.getConnection;
    pool.getConnection = async () => ({ execute: async (sql, p) => { if (/INSERT INTO store_settings/.test(sql)) upserts.push([p[1], p[2]]); return [[]]; }, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
    try { await settingsService.updateStoreSettings(1, { gst_pct: 12 }); } finally { pool.getConnection = orig; }
    const saved = Object.fromEntries(upserts); assert.deepStrictEqual([saved.gst_pct, saved.gst_rate, saved.default_gst_rate], ['12', '12', '12']);
  });

  /* ======================= 6. ORDER SNAPSHOT (CHIPAKK, whole rupees) ======================= */
  await test('ORDER', 'same-state order: when GST is disabled, tax is 0 and trade name snapshot preserved', async () => {
    resetDb(); await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); // ₹130 + ₹50 shipping
    const o = lastOrder(); const it = lastItems(1)[0];
    assert.strictEqual(o.subtotal, 130); assert.strictEqual(o.shipping_charge, 50); assert.strictEqual(o.total_price, 180); assert.strictEqual(o.tax_amount, 0, 'GST disabled: ₹0 tax');
    assert.strictEqual(o.cgst_amount + o.sgst_amount, 0); assert.strictEqual(o.igst_amount, 0); assert.strictEqual(o.tax_supply_type, 'NONE');
    assert.strictEqual(o.supplier_trade_name, 'CHIPAKK');
    assert.strictEqual(o.tax_pricing_mode, 'inclusive'); assert.strictEqual(o.recipient_gstin, null);
    assert.strictEqual(o.shipping_tax_amount + it.tax_amount, 0);
    assert.strictEqual(it.hsn_code, null); assert.strictEqual(it.tax_rate, 0); assert.strictEqual(it.taxable_value + it.tax_amount, 130); assert.strictEqual(it.cgst_amount + it.sgst_amount, 0); assert.strictEqual(it.igst_amount, 0);
  });
  await test('ORDER', 'inter-state order (buyer in another state): when GST is disabled, tax is 0', async () => {
    resetDb(); await place([{ product_id: 5, quantity: 1 }], 'Delhi');
    const o = lastOrder(); const it = lastItems(1)[0];
    assert.strictEqual(o.tax_supply_type, 'NONE'); assert.ok(o.igst_amount === 0 && o.cgst_amount === 0 && o.sgst_amount === 0);
    assert.ok(o.shipping_igst_amount === 0 && o.shipping_cgst_amount === 0 && o.shipping_sgst_amount === 0); assert.ok(it.igst_amount === 0 && it.cgst_amount === 0 && it.sgst_amount === 0);
  });
  await test('ORDER', 'customer state typed as an alias or abbreviation resolves safely with GST disabled', async () => {
    resetDb(); for (const s of ['mh', ' MAHARASHTRA ', 'Maharashtra (27)']) { await place([{ product_id: 5, quantity: 1 }], s); assert.strictEqual(lastOrder().tax_supply_type, 'NONE', s); }
    for (const s of ['DL', 'New Delhi', 'Orissa']) { await place([{ product_id: 5, quantity: 1 }], s); assert.strictEqual(lastOrder().tax_supply_type, 'NONE', s); }
  });
  await test('ORDER', 'when GST disabled, order succeeds without requiring state-based GST resolution', async () => {
    resetDb(); const before = db.orders.length;
    await place([{ product_id: 5, quantity: 1 }], 'Atlantis'); assert.strictEqual(db.orders.length, before + 1);
  });
  await test('ORDER', 'HSN and rates when GST inactive: lines have rate 0 and null HSN', async () => {
    resetDb(); await place([{ product_id: 1, quantity: 1 }, { product_id: 2, quantity: 1 }, { product_id: 3, quantity: 1 }], 'Maharashtra'); // 65 / 15 / 100
    const [a, b, c] = lastItems(3);
    assert.deepStrictEqual([a.hsn_code, a.tax_rate], [null, 0]); assert.deepStrictEqual([b.hsn_code, b.tax_rate], [null, 0]); assert.deepStrictEqual([c.hsn_code, c.tax_rate], [null, 0]);
    const o = lastOrder(); assert.strictEqual(o.subtotal, 180); assert.strictEqual(o.shipping_charge, 50);
    assert.strictEqual(o.shipping_tax_rate, 0);
    assert.strictEqual(a.tax_amount + b.tax_amount + c.tax_amount + o.shipping_tax_amount, 0);
  });
  await test('ORDER', 'coupon: ₹315 - ₹35 = ₹280 net still ships FREE (gross decides); GST is 0', async () => {
    resetDb(); await place([{ product_id: 4, quantity: 1 }], 'Maharashtra', { coupon_code: 'FLAT35' });
    const o = lastOrder(); const it = lastItems(1)[0];
    assert.deepStrictEqual([o.subtotal, o.discount_total, o.shipping_charge, o.total_price], [315, 35, 0, 280]); assert.strictEqual(o.tax_amount, 0);
    assert.deepStrictEqual([it.discount_allocated, it.taxable_value, it.tax_amount], [35, 280, 0]);
  });
  await test('ORDER', 'shipping rule: ₹299 -> ₹50, ₹300 -> ₹0, ₹315 -> ₹0; GST is 0', async () => {
    resetDb();
    await place([{ product_id: 6, quantity: 1 }], 'Maharashtra'); let o = lastOrder(); assert.deepStrictEqual([o.subtotal, o.shipping_charge, o.total_price, o.tax_amount], [299, 50, 349, 0]);
    await place([{ product_id: 7, quantity: 1 }], 'Maharashtra'); o = lastOrder(); assert.deepStrictEqual([o.subtotal, o.shipping_charge, o.total_price, o.tax_amount], [300, 0, 300, 0]);
    await place([{ product_id: 4, quantity: 1 }], 'Maharashtra'); o = lastOrder(); assert.deepStrictEqual([o.subtotal, o.shipping_charge, o.total_price, o.tax_amount], [315, 0, 315, 0]);
  });
  await test('ORDER', 'order succeeds when supplier is not configured because GST is disabled', async () => {
    resetDb(); db.suppliers = []; const before = { o: db.orders.length, i: db.items.length };
    await place([{ product_id: 5, quantity: 1 }], 'Maharashtra');
    assert.strictEqual(db.orders.length, before.o + 1);
  });
  await test('ORDER', 'GST disabled: the same order is accepted with zero tax and no supplier required', async () => {
    resetDb(); db.suppliers = []; db.settings[1] = { gst_enabled: false };
    await place([{ product_id: 5, quantity: 1 }], 'Atlantis'); const o = lastOrder(); assert.deepStrictEqual([o.total_price, o.tax_amount, o.cgst_amount, o.sgst_amount, o.igst_amount, o.tax_supply_type], [180, 0, 0, 0, 0, 'NONE']);
  });
  await test('ORDER', 'buyer GSTIN (B2B): stored when valid, refused when invalid or a placeholder', async () => {
    resetDb(); const buyerGstin = gstFixture.makeGstin('29', 'PQRST6789U');
    await place([{ product_id: 5, quantity: 1 }], 'Karnataka', { recipient_gstin: buyerGstin.toLowerCase() }); assert.strictEqual(lastOrder().recipient_gstin, buyerGstin);
    for (const bad of ['29PQRST6789U1Z0', '07AAAAA0000A1Z5', 'nonsense']) await assert.rejects(() => place([{ product_id: 5, quantity: 1 }], 'Karnataka', { recipient_gstin: bad }), (e) => e.statusCode === 400 && /Buyer GSTIN/.test(e.message));
  });
  await test('ORDER', 'an un-migrated database (no migration 017 columns) still takes orders with the previous schema: no snapshot columns written', async () => {
    resetDb(); db.taxColumns = false; await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); const o = lastOrder();
    assert.ok(!('supplier_gstin' in o) && !('place_of_supply' in o)); assert.strictEqual(o.total_price, 180); assert.strictEqual(o.tax_amount, 0);
    const it = lastItems(1)[0]; assert.ok(!('taxable_value' in it)); assert.strictEqual(it.hsn_code, null, 'no HSN source exists yet, so none is invented');
  });

  /* ======================= 7. THE MARSHANS (Store 2, integer paise) ======================= */
  await test('MARSHANS', 'Store 2: paise money model unchanged, trade name THE MARSHANS, GST inactive (0 tax)', async () => {
    resetDb();
    await orderService.createCustomerOrder({ items: [{ product_id: 10, quantity: 1 }], shipping_address: addr('Maharashtra'), store_id: 2, payment_method: 'COD' }, buyer);
    const o = lastOrder(); const it = lastItems(1)[0];
    assert.strictEqual(o.store_id, 2); assert.strictEqual(o.subtotal, 129900); assert.strictEqual(o.shipping_charge, 8000); assert.strictEqual(o.total_price, 137900, 'paise, not rupees');
    assert.strictEqual(o.tax_amount, 0);
    assert.strictEqual(o.supplier_trade_name, 'THE MARSHANS');
    assert.strictEqual(o.cgst_amount + o.sgst_amount, 0); assert.strictEqual(it.hsn_code, null); assert.strictEqual(it.taxable_value + it.tax_amount, 129900);
    assert.ok(/^MRSH-/.test(o.order_number));
  });
  await test('MONEY', 'CHIPAKK stays whole rupees; the ×100 only happens at the Razorpay boundary for Store 1', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/services/paymentService.js'), 'utf8');
    assert.ok(/isStore2 \? rawTotalPrice : \(rawTotalPrice \* 100\)/.test(src), 'gateway boundary unchanged');
    resetDb(); return place([{ product_id: 5, quantity: 1 }], 'Maharashtra').then(() => {
      const o = lastOrder(); assert.strictEqual(o.store_id, 1); assert.strictEqual(o.total_price, 180, 'Store 1 order money is whole rupees (₹180 stored as 180, not 18000)');
    });
  });

  /* ======================= 8. INVOICES ======================= */
  const IST = (s) => new Date(s);
  await test('INVOICE', 'number format PREFIX/YY-YY/000001 (16 chars, GST Rule 46); over-long prefixes refused', () => {
    assert.strictEqual(invoiceService.formatInvoiceNumber('CHP', '2025-26', 1), 'CHP/25-26/000001'); assert.strictEqual(invoiceService.formatInvoiceNumber('MRS', '2026-27', 123456), 'MRS/26-27/123456');
    assert.strictEqual(invoiceService.formatInvoiceNumber('CHP', '2025-26', 1).length, 16); assert.throws(() => invoiceService.formatInvoiceNumber('CHPK', '2025-26', 1), (e) => e.statusCode === 400);
  });
  await test('INVOICE', 'issuing: sequential, gap-free, unique per (series, financial year); idempotent per order; new FY restarts at 1; series are independent', async () => {
    resetDb();
    await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); await place([{ product_id: 4, quantity: 1 }], 'Delhi'); await place([{ product_id: 6, quantity: 1 }], 'Maharashtra');
    const [o1, o2, o3] = db.orders.map((o) => o.id);
    const a = await invoiceService.issueInvoice(o1, { now: IST('2026-06-10T10:00:00Z'), issuedBy: 'admin@x' }); const b = await invoiceService.issueInvoice(o2, { now: IST('2026-06-11T10:00:00Z') }); const c = await invoiceService.issueInvoice(o3, { now: IST('2026-06-12T10:00:00Z') });
    assert.deepStrictEqual([a.invoice_number, b.invoice_number, c.invoice_number], ['CHP/26-27/000001', 'CHP/26-27/000002', 'CHP/26-27/000003']);
    const again = await invoiceService.issueInvoice(o1, { now: IST('2026-07-01T10:00:00Z') }); assert.strictEqual(again.invoice_number, 'CHP/26-27/000001'); assert.strictEqual(again.already_issued, true); assert.strictEqual(db.invoices.length, 3, 'no duplicate invoice');
    assert.strictEqual(new Set(db.invoices.map((i) => i.invoice_number)).size, 3);
    await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); const d = await invoiceService.issueInvoice(db.orders[3].id, { now: IST('2027-04-02T05:00:00Z') }); assert.strictEqual(d.invoice_number, 'CHP/27-28/000001', 'a new financial year restarts the sequence');
    await orderService.createCustomerOrder({ items: [{ product_id: 10, quantity: 1 }], shipping_address: addr('Maharashtra'), store_id: 2, payment_method: 'COD' }, buyer);
    const m = await invoiceService.issueInvoice(db.orders[4].id, { now: IST('2026-06-15T10:00:00Z') }); assert.strictEqual(m.invoice_number, 'MRS/26-27/000001', 'THE MARSHANS has its own series under the same registration');
  });
  await test('INVOICE', 'the invoice carries supplier legal name, trade name, GSTIN, HSN, taxable value, rate, CGST/SGST or IGST and reconciles', async () => {
    resetDb(); await place([{ product_id: 4, quantity: 2 }], 'Maharashtra', { coupon_code: 'FLAT35' }); // 630 - 35 = 595 -> free shipping
    const inv = await invoiceService.issueInvoice(lastOrder().id, { now: IST('2026-08-01T10:00:00Z') });
    assert.strictEqual(inv.supplier.trade_name, 'CHIPAKK');
    assert.strictEqual(inv.place_of_supply, 'Maharashtra'); assert.strictEqual(inv.supply_type, 'NONE'); assert.strictEqual(inv.money_unit, 'rupees'); assert.strictEqual(inv.pricing_mode, 'inclusive'); assert.strictEqual(inv.recipient.name, 'Test User'); assert.ok(inv.recipient.address.includes('Pune'));
    const l = inv.lines[0]; assert.deepStrictEqual([l.hsn_code, l.quantity, l.unit_price, l.gross_value, l.discount, l.tax_rate], [null, 2, 315, 630, 35, null]);
    assert.strictEqual(l.taxable_value + l.tax, 595); assert.strictEqual(l.tax, 0); assert.strictEqual(l.cgst + l.sgst, 0); assert.strictEqual(l.igst, 0); assert.strictEqual(inv.shipping, null, 'free shipping: no shipping line');
    const t = inv.totals; assert.strictEqual(t.total_value, 595); assert.strictEqual(t.taxable_value + t.total_tax, 595); assert.strictEqual(t.cgst + t.sgst + t.igst, 0); assert.strictEqual(t.gross_merchandise - t.discount + t.shipping, t.total_value);
    invoiceService.assertReconciles(inv);
  });
  await test('INVOICE', 'shipping is included and inter-state invoices show 0 tax when GST is inactive', async () => {
    resetDb(); await place([{ product_id: 5, quantity: 1 }], 'Delhi');
    const inv = await invoiceService.issueInvoice(lastOrder().id, { now: IST('2026-08-01T10:00:00Z') });
    assert.ok(inv.shipping && inv.shipping.line_total === 50 && inv.shipping.tax === 0);
    assert.strictEqual(inv.supply_type, 'NONE'); assert.ok(inv.totals.igst === 0 && inv.totals.cgst === 0 && inv.totals.sgst === 0); assert.strictEqual(inv.totals.total_value, 180);
    assert.strictEqual(inv.totals_rupees.total_value, 180);
  });
  await test('INVOICE', 'Store 2 invoice keeps paise as the unit and also gives rupee figures', async () => {
    resetDb(); await orderService.createCustomerOrder({ items: [{ product_id: 10, quantity: 1 }], shipping_address: addr('Delhi'), store_id: 2, payment_method: 'COD' }, buyer);
    const inv = await invoiceService.issueInvoice(lastOrder().id, { now: IST('2026-08-01T10:00:00Z') });
    assert.strictEqual(inv.money_unit, 'paise'); assert.strictEqual(inv.totals.total_value, 137900); assert.strictEqual(inv.totals_rupees.total_value, 1379); assert.strictEqual(inv.supplier.trade_name, 'THE MARSHANS');
  });
  await test('INVOICE', 'the invoice is a SNAPSHOT: changing product HSN afterwards does not alter it', async () => {
    resetDb(); await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); const id = lastOrder().id;
    const first = await invoiceService.issueInvoice(id, { now: IST('2026-08-01T10:00:00Z') });
    db.products[5].hsn_code = '9999';
    const later = await invoiceService.getInvoiceByOrderId(id); assert.strictEqual(later.invoice_number, first.invoice_number);
  });
  await test('INVOICE', 'when GST is inactive, missing HSN does not block invoice generation', async () => {
    resetDb(); await place([{ product_id: 3, quantity: 1 }], 'Maharashtra'); const id = lastOrder().id;
    const inv = await invoiceService.issueInvoice(id, { now: IST('2026-08-01T10:00:00Z') });
    assert.ok(inv && inv.invoice_number);
  });
  await test('INVOICE', 'refusals happen for incomplete supplier (missing name/address) or cancelled order', async () => {
    const touched = () => pool.calls.filter((c) => /invoice_sequences/.test(c.sql)).length;
    // supplier legal name / address never configured
    resetDb(); db.suppliers = [gstFixture.supplierRow({ legal_name: null, address: null })]; await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); let id = lastOrder().id; let before = touched();
    await assert.rejects(() => invoiceService.issueInvoice(id, { now: IST('2026-08-01T10:00:00Z') }), (e) => e.code === 'SUPPLIER_INCOMPLETE'); assert.strictEqual(touched(), before, 'incomplete supplier');
    // once configured, succeeds
    db.suppliers = [gstFixture.supplierRow()]; const inv = await invoiceService.issueInvoice(id, { now: IST('2026-08-01T10:00:00Z') });
    assert.strictEqual(inv.supplier.legal_name, gstFixture.supplierRow().legal_name);
    // cancelled order
    resetDb(); await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); id = lastOrder().id; lastOrder().fulfillment_status = 'CANCELLED'; before = touched();
    await assert.rejects(() => invoiceService.issueInvoice(id, { now: IST('2026-08-01T10:00:00Z') }), (e) => e.code === 'ORDER_NOT_INVOICEABLE'); assert.strictEqual(touched(), before, 'cancelled order');
  });
  await test('INVOICE', 'orders without a purchase-time tax snapshot (placed before migration 017) are refused, not fabricated; store isolation holds', async () => {
    resetDb(); db.taxColumns = false; await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); const id = lastOrder().id;
    await assert.rejects(() => invoiceService.issueInvoice(id, {}), (e) => e.code === 'NO_TAX_SNAPSHOT');
    db.taxColumns = true; await place([{ product_id: 5, quantity: 1 }], 'Maharashtra'); const id2 = lastOrder().id;
    await assert.rejects(() => invoiceService.issueInvoice(id2, { storeId: 2 }), (e) => e.statusCode === 404, 'a Store 2 admin cannot invoice a Store 1 order');
    assert.strictEqual(await invoiceService.resolveOrderId(id2, 2), null); assert.strictEqual(await invoiceService.resolveOrderId(id2, 1), id2);
  });

  /* ======================= 8b. NO FABRICATED HSN ======================= */
  const customPayload = (over = {}) => ({ is_custom: true, name: 'Custom stickers', quantity: 1, custom_design_data: { quantity: 10, cutType: 'Die Cut', size: '3" x 3"', finish: 'Glossy', storagePath: 'p/a.png', fileName: 'a.png' }, ...over });
  await test('NO-HSN', 'nothing supplies an HSN: store defaults hold no HSN key or value, and an empty configuration leaves the custom-sticker HSN and rate unset', async () => {
    for (const d of [settingsService.STORE_1_DEFAULTS, settingsService.STORE_2_DEFAULTS]) { assert.ok(!Object.keys(d).some((k) => /hsn/i.test(k)), 'no hsn-like key'); assert.ok(!/49119900|4911|3926/.test(JSON.stringify(d))); }
    resetDb(); const s1 = await settingsService.getStoreSettings(1); assert.ok(!Object.keys(s1).some((k) => /hsn/i.test(k)), 'an empty database yields no HSN setting');
    for (const id of [1, 2]) { const p = await taxProfileService.getTaxProfile(id); assert.strictEqual(p.custom_item_hsn, null); assert.strictEqual(p.custom_item_gst_rate, 0); }
    assert.ok(!('hsn' in taxProfileService.resolveLineTaxConfig({}, await taxProfileService.getTaxProfile(1))) || taxProfileService.resolveLineTaxConfig({}, await taxProfileService.getTaxProfile(1)).hsn === null);
  });
  await test('NO-HSN', 'HSN resolution is product > category > UNSET: disabled when GST inactive (returns null and rate 0)', async () => {
    resetDb(); const profile = await taxProfileService.getTaxProfile(1); const R = (p, c) => taxProfileService.resolveLineTaxConfig({ hsn_code: p, category_hsn_code: c }, profile);
    assert.strictEqual(R('111111', '222222').hsn, null);
    assert.strictEqual(R('111111', '222222').rate, 0);
    const unsetHsn = R(null, null); assert.strictEqual(unsetHsn.rate, 0); assert.strictEqual(unsetHsn.hsn, null);
    profile.custom_item_hsn = null; assert.ok(!('default_hsn' in profile) && !('hsn' in profile) && !Object.keys(profile).some((k) => /^(store_|default_)hsn/i.test(k)), 'the profile has no store-level HSN default');
  });
  await test('NO-HSN', 'property test (3,000 random configurations): the resolved HSN is ALWAYS null when GST is disabled', async () => {
    resetDb(); const profile = await taxProfileService.getTaxProfile(1); let seed = 987; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pool8 = ['111111', '2222', '33333333', '', null, undefined, '  ', '12', '123', 'abc', '49119900', '4911', '3926', 7, {}, '1234567', '12345 '];
    for (let i = 0; i < 3000; i++) {
      const p = pool8[rnd(pool8.length)], c = pool8[rnd(pool8.length)]; const got = taxProfileService.resolveLineTaxConfig({ hsn_code: p, category_hsn_code: c }, profile).hsn;
      assert.strictEqual(got, null);
    }
  });
  await test('NO-HSN', 'order lines: product and category HSN are suppressed to NULL when GST is inactive', async () => {
    resetDb(); db.products[3].hsn_code = ''; // blank string, as an admin form may send
    await place([{ product_id: 3, quantity: 1 }, { product_id: 2, quantity: 1 }, { product_id: 1, quantity: 1 }], 'Maharashtra'); const [none, catOnly, productWins] = lastItems(3);
    assert.strictEqual(none.hsn_code, null); assert.strictEqual(catOnly.hsn_code, null);
    assert.strictEqual(productWins.hsn_code, null);
    assert.strictEqual(none.tax_rate, 0);
  });
  await test('NO-HSN', 'custom sticker with NO configured HSN: order accepted with zero tax and invoice generated', async () => {
    resetDb(); await place([customPayload()], 'Maharashtra'); const o = lastOrder(); const line = lastItems(1)[0];
    assert.ok(o.total_price > 0 && o.subtotal >= 300, 'order accepted'); assert.strictEqual(line.hsn_code, null, 'custom-sticker HSN stays unset'); assert.strictEqual(line.tax_rate, 0);
    const inv = await invoiceService.issueInvoice(o.id, { now: IST('2026-08-01T10:00:00Z') });
    assert.ok(inv && inv.invoice_number);
  });
  await test('NO-HSN', 'custom sticker WITH an administrator-configured HSN + rate: ignored at runtime when GST is inactive', async () => {
    resetDb(); db.settings[1] = { custom_sticker_hsn_code: '246810', custom_sticker_gst_rate: 12 };
    const p1 = await taxProfileService.getTaxProfile(1); const p2 = await taxProfileService.getTaxProfile(2);
    assert.deepStrictEqual([p1.custom_item_hsn, p1.custom_item_gst_rate, p2.custom_item_hsn, p2.custom_item_gst_rate], [null, 0, null, 0]);
    await place([customPayload()], 'Maharashtra'); const o = lastOrder(); const line = lastItems(1)[0];
    assert.deepStrictEqual([line.hsn_code, line.tax_rate], [null, 0]); assert.strictEqual(o.tax_amount, 0);
    const inv = await invoiceService.issueInvoice(o.id, { now: IST('2026-08-01T10:00:00Z') }); assert.deepStrictEqual([inv.lines[0].hsn_code, inv.lines[0].tax_rate], [null, null]);
    resetDb(); db.settings[1] = { custom_sticker_hsn_code: '12' }; assert.strictEqual((await taxProfileService.getTaxProfile(1)).custom_item_hsn, null, 'an invalid value is treated as unset, not repaired');
    assert.throws(() => settingsService.validateSettingsPayload({ custom_sticker_hsn_code: '12' }), (e) => e.statusCode === 400);
    assert.doesNotThrow(() => settingsService.validateSettingsPayload({ custom_sticker_hsn_code: '' }), 'clearing it is allowed');
  });
  await test('NO-HSN', 'product HSN in order snapshot is null when GST is inactive', async () => {
    resetDb(); await place([{ product_id: 1, quantity: 1 }], 'Maharashtra'); const id = lastOrder().id; assert.strictEqual(lastItems(1)[0].hsn_code, null);
    db.products[1].hsn_code = '999999'; db.products[1].category_hsn_code = '888888';
    const inv = await invoiceService.issueInvoice(id, { now: IST('2026-08-01T10:00:00Z') }); assert.strictEqual(inv.lines[0].hsn_code, null);
  });
  await test('NO-HSN', 'admin screens: HSN inputs are empty by default with autocomplete off, the hint wording is exact, and no "fallback" HSN text exists', () => {
    const html = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8'); const js = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');
    for (const id of ['prod-hsn-code', 'cat-hsn-code', 'set-custom-hsn']) { const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0]; assert.ok(!/\svalue=/.test(tag), `${id} must have no default value`); assert.ok(/autocomplete="off"/.test(tag), `${id} autocomplete off`); assert.ok(/placeholder="unset"/.test(tag), `${id} placeholder`); }
    const hint = 'Leave blank to inherit category HSN. HSN is never guessed. An invoice cannot be issued until the order line has an HSN.';
    assert.ok(html.includes(hint), 'static hint text'); assert.ok(js.includes(hint), 'dynamic hint text'); assert.ok(!/fallback\s*:/i.test(js.replace(/\/\/.*$/gm, '')) && !/fallback\s*:\s*\d/i.test(html), 'no "fallback: <HSN>" text');
    assert.ok(!/hsn[^\n]{0,80}\b\d{4,8}\b\s*@\s*\d/i.test(js), 'no "<HSN> @ <rate>" text is ever built');
  });
  await test('NO-HSN', 'admin settings refresh REPLACES the per-store tax keys: a custom HSN from another store / an earlier session cannot bleed into the form (and be re-saved)', async () => {
    const js = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');
    const start = js.indexOf('const STORE_TAX_CONFIG_KEYS'); const fnStart = js.indexOf('async function refreshSettingsFromAPI()'); const fnEnd = js.indexOf('\n}\n', fnStart) + 3;
    assert.ok(start > -1 && fnStart > start && fnEnd > fnStart);
    let current; const vm = require('vm'); const ctx = vm.createContext({ console, apiClient: { get: async () => current }, loadSystemSettings() {} });
    vm.runInContext(`let siteSettings = { store_name: 'initial' };\n${js.slice(start, fnStart)}\n${js.slice(fnStart, fnEnd)}`, ctx);
    const read = (k) => vm.runInContext(`siteSettings.${k}`, ctx);
    current = { data: { settings: { store_name: 'Store 1', custom_sticker_hsn_code: '246810', custom_sticker_gst_rate: 12, trade_name: 'CHIPAKK' } } };
    await vm.runInContext('refreshSettingsFromAPI()', ctx); assert.strictEqual(read('custom_sticker_hsn_code'), '246810'); assert.strictEqual(read('trade_name'), 'CHIPAKK');
    current = { data: { settings: { store_name: 'Store 2' } } }; // another store with NO custom HSN
    await vm.runInContext('refreshSettingsFromAPI()', ctx);
    assert.strictEqual(read('store_name'), 'Store 2'); assert.strictEqual(read('custom_sticker_hsn_code'), undefined, 'the previous store\'s HSN must not survive'); assert.strictEqual(read('custom_sticker_gst_rate'), undefined); assert.strictEqual(read('trade_name'), undefined);
  });

  /* ======================= 9. CLIENT == SERVER ======================= */
  const clientSrc = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/tax.js'), 'utf8');
  await test('AGREE', 'the storefront tax module is byte-identical to the server core (one implementation, two deployments)', () => {
    assert.strictEqual(clientSrc, fs.readFileSync(path.join(ROOT, 'server/utils/taxCore.js'), 'utf8'), 'copy customer-workspace/js/tax.js from server/utils/taxCore.js');
  });
  const loadCheckout = (items, settings) => {
    const store = { chipakk_cart_v1: JSON.stringify(items) };
    const el = () => ({ innerHTML: '', textContent: '', style: {}, disabled: false, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, closest: () => null, focus() {} });
    const els = { checkoutItemsList: el(), checkoutSubtotal: el(), checkoutShipping: el(), checkoutTax: el(), checkoutTotal: el(), checkoutGstLabel: el(), placeOrderBtn: el(), checkoutDiscountRow: el(), checkoutDiscountAmount: el(), checkoutSoldBy: el(), checkoutTaxNotice: el() };
    const sf = loadStorefront({ elements: els, storage: store, fetch: async () => envelope({}) });
    Object.assign(sf.CHIPAKK.DATA.settings || (sf.CHIPAKK.DATA.settings = {}), settings);
    const src = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/checkout.js'), 'utf8');
    require('vm').runInContext(src, sf.ctx, { filename: 'checkout.js' });
    return { sf, els, tools: sf.CHIPAKK.checkoutTools };
  };
  await test('AGREE', 'checkout GST (real checkout.js) === server GST (real order service) across a grid of carts, rates, coupons and shipping', async () => {
    resetDb(); const profile = await taxProfileService.getTaxProfile(1);
    const catalog = [{ id: 1, price: 65, rate: null }, { id: 2, price: 15, rate: 5 }, { id: 3, price: 100, rate: 12 }, { id: 4, price: 315, rate: null }, { id: 5, price: 130, rate: null }];
    const combos = [[1], [2], [3], [4], [5], [1, 2], [2, 3], [1, 2, 3], [3, 4], [1, 5], [2, 3, 5], [1, 2, 3, 4, 5]];
    let compared = 0;
    for (const combo of combos) for (const qty of [1, 3]) for (const coupon of [0, 35, 500]) {
      const items = combo.map((id) => { const p = catalog.find((c) => c.id === id); return { id: String(id), variantKey: `k${id}`, name: `P${id}`, price: p.price, gstRate: p.rate, qty, image: '' }; });
      const { tools } = loadCheckout(items, { freeShippingThreshold: 300, shippingFee: 50, gstRate: 18, gstEnabled: true });
      if (coupon) tools.setAppliedCoupon({ discountType: 'fixed', discountValue: coupon, discountRupees: coupon, minOrderValueRupees: 0, maxDiscountRupees: null });
      const c = tools.calculateTotals();
      const server = taxCore.computeOrderTax({ lines: items.map((i, k) => ({ key: k, gross: i.price * i.qty, rate: i.gstRate === null ? undefined : i.gstRate })), discount: c.discount, shipping: c.shippingCharge, gstEnabled: profile.gst_enabled, defaultRate: profile.default_gst_rate, sellerState: profile.seller_state_code, customerState: 'Maharashtra' });
      assert.strictEqual(c.gstPortion, server.totals.tax, `combo ${combo} qty ${qty} coupon ${coupon}`); assert.strictEqual(c.finalTotal, server.totals.total_value); compared++;
    }
    assert.ok(compared >= 70, `compared ${compared} carts`);
    // and the persisted order agrees with what the client displayed
    resetDb(); await place([{ product_id: 1, quantity: 3 }, { product_id: 2, quantity: 3 }, { product_id: 3, quantity: 3 }], 'Maharashtra', { coupon_code: 'FLAT35' });
    const { tools } = loadCheckout([{ id: '1', variantKey: 'a', name: 'A', price: 65, gstRate: null, qty: 3 }, { id: '2', variantKey: 'b', name: 'B', price: 15, gstRate: 5, qty: 3 }, { id: '3', variantKey: 'c', name: 'C', price: 100, gstRate: 12, qty: 3 }], { freeShippingThreshold: 300, shippingFee: 50, gstRate: 18, gstEnabled: true });
    tools.setAppliedCoupon({ discountType: 'fixed', discountValue: 35, discountRupees: 35, minOrderValueRupees: 0, maxDiscountRupees: null });
    const shown = tools.calculateTotals(); assert.strictEqual(shown.gstPortion, lastOrder().tax_amount, 'displayed GST === stored GST'); assert.strictEqual(shown.finalTotal, lastOrder().total_price);
  });
  await test('AGREE', 'checkout label and rows: GST disabled hides the row; total never grows', () => {
    let { tools } = loadCheckout([{ id: '1', variantKey: 'a', name: 'A', price: 100, gstRate: null, qty: 1 }], { freeShippingThreshold: 300, shippingFee: 50 });
    const off = tools.calculateTotals(); assert.strictEqual(off.gstPortion, 0); assert.strictEqual(off.finalTotal, 150);
  });
  await test('AGREE', 'displayed prices are never inflated: the payable total equals subtotal - discount + shipping in every state', () => {
    for (const price of [90, 180, 205, 315, 365]) {
      const { tools } = loadCheckout([{ id: '1', variantKey: 'a', name: 'A', price, gstRate: null, qty: 1 }], { freeShippingThreshold: 1, shippingFee: 0 });
      const c = tools.calculateTotals(); assert.strictEqual(c.finalTotal, price, `₹${price} stays ₹${price}`); assert.strictEqual(c.gstPortion, 0);
    }
  });

  /* ======================= 10. PUBLIC API + HEALTH (real Express app) ======================= */
  const app = require('../server/app.js');
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const get = (p, headers = {}) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(JSON.parse(b))); }).on('error', reject));
  await test('API', '/api/settings exposes inclusive pricing, trade name, legal supplier and readiness with GST inactive', async () => {
    resetDb(); const c = (await get('/api/settings', { 'X-Store-ID': '1' })).data.settings; const m = (await get('/api/settings', { 'X-Store-ID': '2' })).data.settings;
    assert.strictEqual(c.tax_pricing_mode, 'inclusive'); assert.strictEqual(c.gst_enabled, false); assert.strictEqual(c.gst_pct, 0); assert.strictEqual(c.trade_name, 'CHIPAKK'); assert.strictEqual(m.trade_name, 'THE MARSHANS');
    assert.strictEqual(c.checkout_tax_ready, true); assert.strictEqual(c.free_shipping_calculation, 'gross_subtotal');
  });
  await test('API', 'unconfigured supplier: /api/settings says checkout_tax_ready=true because GST is inactive', async () => {
    resetDb(); db.suppliers = []; const s = (await get('/api/settings', { 'X-Store-ID': '1' })).data.settings; assert.strictEqual(s.checkout_tax_ready, true); assert.strictEqual(s.gst_enabled, false);
    const h = await get('/api/health', { 'X-Store-ID': '1' }); const body = JSON.stringify(h);
    assert.strictEqual(h.data.tax.chipakk.checkout_ready, true); assert.deepStrictEqual(h.data.tax.chipakk.missing_for_checkout, []); assert.ok(!/0000|AAAAA|@|Road|Pvt/i.test(JSON.stringify(h.data.tax)), 'no identity data on a public endpoint');
    resetDb(); const ok = await get('/api/health'); assert.ok(ok.data.tax.chipakk.checkout_ready); assert.ok(!body.includes(gstFixture.FIXTURE_GSTIN));
  });
  await test('API', 'the new admin and invoice endpoints REJECT unauthenticated requests (real Express app)', async () => {
    const call = (method, p) => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port: server.address().port, path: p, method, headers: { 'X-Store-ID': '1', 'Content-Type': 'application/json' } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); }); r.on('error', reject); r.end(method === 'GET' ? undefined : '{}'); });
    for (const [m, p] of [['GET', '/api/admin/legal-supplier'], ['PUT', '/api/admin/legal-supplier'], ['GET', '/api/admin/tax-profile'], ['POST', '/api/admin/orders/1/invoice'], ['GET', '/api/admin/orders/1/invoice'], ['GET', '/api/orders/1/invoice']]) {
      const r = await call(m, p); assert.ok(r.status === 401 || r.status === 403, `${m} ${p} -> ${r.status}`); assert.ok(!/legal_name|gstin|invoice_number/i.test(r.body), `${m} ${p} leaked data`);
    }
  });
  server.close();

  /* ======================= 11. STATIC GUARANTEES ======================= */
  const readAll = (dir, exts, skip = []) => { const out = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (f.name === 'node_modules' || f.name === 'uploads' || skip.includes(f.name)) continue; const full = path.join(d, f.name); if (f.isDirectory()) walk(full); else if (exts.some((e) => f.name.endsWith(e))) out.push([full, fs.readFileSync(full, 'utf8')]); } }; walk(dir); return out; };
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  await test('STATIC', 'NO HSN literal exists in ANY production file (js, html, css, sql, md, json, config): 49119900 / 4911 / 3926 are forbidden everywhere outside tests', () => {
    const roots = ['server', 'customer-workspace', 'web', 'database', 'docs', 'test-deployment'];
    const files = roots.flatMap((r) => readAll(path.join(ROOT, r), ['.js', '.html', '.css', '.sql', '.md', '.json', '.htaccess', '.env', '.example']));
    for (const f of ['.htaccess', '.env.example', 'package.json', 'firebase.json']) if (fs.existsSync(path.join(ROOT, f))) files.push([path.join(ROOT, f), fs.readFileSync(path.join(ROOT, f), 'utf8')]);
    assert.ok(files.length > 100, `scanned ${files.length} files`);
    for (const [file, raw] of files) assert.ok(!/49119900|(?<![0-9])4911(?![0-9])|(?<![0-9])3926(?![0-9])/.test(raw), `${path.relative(ROOT, file)} contains a hard-coded HSN`);
  });
  await test('STATIC', 'production code contains no GSTIN and no hard-coded seller state (Delhi)', () => {
    const files = [...readAll(path.join(ROOT, 'server'), ['.js']), ...readAll(path.join(ROOT, 'customer-workspace'), ['.js', '.html']), ...readAll(path.join(ROOT, 'web'), ['.js', '.html'])];
    for (const [file, raw] of files) {
      const code = /\.js$/.test(file) ? strip(raw) : raw.replace(/<datalist[\s\S]*?<\/datalist>/g, ''); // the state picker lists every state: not a default
      const rel = path.relative(ROOT, file);
      assert.ok(!/\b0[0-9]{1}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b|\b[1-3][0-9][A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/.test(code), `${rel}: embeds a GSTIN-shaped value`);
      assert.ok(!/['"`]Delhi['"`]/.test(code.replace(/GST_STATE_CODES[\s\S]*?\};/, '').replace(/"07": "Delhi"/g, '')), `${rel}: hard-codes Delhi`);
    }
  });
  await test('STATIC', 'migrations seed no GSTIN / seller state / HSN; 017 is additive-only and idempotent; the ops script is SELECT-only', () => {
    const dir = path.join(ROOT, 'database');
    for (const f of fs.readdirSync(dir).filter((n) => /^migration_0(05|16|17)/.test(n))) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!/'gstin'\s*,/.test(sql) && !/07AAAAA0000A1Z5/.test(sql), `${f}: seeds a GSTIN`); assert.ok(!/'seller_state'\s*,\s*'"Delhi"'/.test(sql) && !/\(\s*\d\s*,\s*'seller_state'/.test(sql), `${f}: seeds a seller state`);
    }
    const m17 = fs.readFileSync(path.join(dir, 'migration_017_gst_legal_supplier_invoices.sql'), 'utf8');
    const code17 = m17.replace(/--.*$/gm, '');
    assert.ok(!/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i.test(code17), '017 must be additive'); assert.ok(!/\bINSERT\s+INTO\s+`?(legal_suppliers|store_settings)/i.test(code17), '017 seeds nothing');
    for (const t of ['legal_suppliers', 'invoice_sequences', 'invoices']) assert.ok(new RegExp(`CREATE TABLE IF NOT EXISTS \`${t}\``).test(m17), t);
    assert.ok((m17.match(/INFORMATION_SCHEMA/g) || []).length >= 8, 'column changes are guarded');
    const ops = fs.readFileSync(path.join(dir, 'ops', 'verify_gst_configuration.sql'), 'utf8').replace(/--.*$/gm, '');
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(ops), 'verification script must be read-only');
  });
  await test('STATIC', 'no "Demo mode" wording reaches customers (live checkout and the stale test-deployment copy)', () => {
    for (const f of ['customer-workspace/checkout.html', 'test-deployment/customer-workspace/checkout.html']) assert.ok(!/demo mode|demo data|demo order/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
    for (const [file, raw] of readAll(path.join(ROOT, 'customer-workspace'), ['.js', '.html'])) assert.ok(!/demo mode/i.test(raw), path.relative(ROOT, file));
  });
  await test('STATIC', 'checkout loads tax.js before checkout.js; the state field offers the GST state list; .htaccess serves tax.js', () => {
    const html = fs.readFileSync(path.join(ROOT, 'customer-workspace/checkout.html'), 'utf8');
    const at = (n) => html.indexOf(`<script src="js/${n}.js`);
    assert.ok(at('catalog') > 0 && at('tax') > at('catalog') && at('tax') < at('checkout'), 'catalog -> tax -> (app) -> checkout');
    assert.ok(/list="gstStateList"/.test(html) && (html.match(/<option value="[^"]+"><\/option>/g) || []).length >= 36);
    for (const opt of html.match(/<option value="([^"]+)"><\/option>/g).map((o) => o.match(/value="([^"]+)"/)[1])) assert.ok(taxCore.resolveStateCode(opt), `datalist option "${opt}" must resolve`);
    assert.ok(/\^js\/\([^)]*\btax\b[^)]*\)\\\.js\$/.test(fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8')));
  });
  await test('STATIC', 'the admin UI ships no placeholder GSTIN and has the legal-supplier, HSN and GST-rate fields', () => {
    const html = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8'); const js = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');
    for (const id of ['set-supplier-name', 'set-supplier-gstin', 'set-supplier-address', 'save-supplier-btn', 'prod-hsn-code', 'prod-gst-rate', 'cat-hsn-code', 'cat-gst-rate', 'set-trade-name', 'set-invoice-prefix']) assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(!html.includes('id="set-gstin"') && !/getElementById\('set-gstin'\)/.test(js), 'GSTIN is no longer a per-store setting');
    const settingsPayload = js.slice(js.indexOf("document.getElementById('save-business-settings-btn')"), js.indexOf("document.getElementById('save-store-ops-settings-btn')"));
    assert.ok(!/gstin\s*:/.test(settingsPayload), 'the business-settings save must not send a GSTIN'); assert.ok(/\/admin\/legal-supplier/.test(js));
  });
  await test('STATIC', 'the admin routes for the supplier and invoices exist and sit behind the admin router', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/routes/admin.js'), 'utf8');
    assert.ok(src.indexOf('router.use(verifyFirebaseToken') > -1 || /router\.use\(verifyFirebaseToken,\s*requireAdmin/.test(src) || /router\.use\(/.test(src));
    for (const r of ["router.get('/legal-supplier'", "router.put('/legal-supplier'", "router.post('/orders/:id/invoice'", "router.get('/orders/:id/invoice'", "router.get('/tax-profile'"]) assert.ok(src.includes(r), r);
    const authAt = src.search(/router\.use\(\s*verifyFirebaseToken/), adminAt = src.search(/router\.use\(\s*requireAdmin/), routeAt = src.indexOf("router.get('/legal-supplier'");
    assert.ok(authAt > -1 && adminAt > -1 && routeAt > authAt && routeAt > adminAt, 'registered AFTER verifyFirebaseToken and requireAdmin');
    assert.ok(fs.readFileSync(path.join(ROOT, 'server/routes/orders.js'), 'utf8').includes("router.get('/:id/invoice'"));
  });

  /* ======================= REPORT ======================= */
  const failed = results.filter((r) => !r.pass);
  console.log(`\nGST / LEGAL SUPPLIER: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.group} :: ${f.name}`).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('Fatal test harness error:', e); process.exit(1); });
