/**
 * CHIPAKK & THE MARSHANS — Admin Dashboard Store Isolation & Metrics Verification Test Suite
 * tests/test_admin_dashboard_store_isolation.js
 *
 * Verifies Scenarios A through P:
 *   [A] Store 1 Dashboard: Scoped strictly to CHIPAKK (store_id = 1 or NULL)
 *   [B] Store 2 Dashboard: Scoped strictly to THE MARSHANS (store_id = 2)
 *   [C] Store Isolation: Absolute isolation between Store 1 and Store 2 metrics
 *   [D] Lifetime Order Count: Server-authoritative from DB, unaffected by paginated limits
 *   [E] Revenue Excludes Unpaid Orders: Pending orders contribute ₹0 to revenue
 *   [F] Revenue Excludes Cancelled Orders: Cancelled orders contribute ₹0 to revenue
 *   [G] Revenue Excludes Failed Orders: Failed orders contribute ₹0 to revenue
 *   [H] Revenue Includes Paid Valid Orders: Paid non-cancelled orders accurately counted (rupees for Store 1, paise/100 for Store 2)
 *   [I] Orders Today: Accurately counts orders placed today for active store
 *   [J] Monthly Revenue: Accurately sums revenue for orders placed in current calendar month
 *   [K] 2-Month Chart: timeframe=current_vs_prev returns exactly 2 chronological months
 *   [L] 3-Month Chart: timeframe=last_3_months returns exactly 3 chronological months
 *   [M] 6-Month Chart: timeframe=last_6_months returns exactly 6 chronological months
 *   [N] Production Queue Store Isolation: Queue counts isolated to active store
 *   [O] Low-Stock Store Isolation: Low-stock counts isolated to active store
 *   [P] Security: Customer Firebase user cannot access Dashboard API (403 Forbidden)
 */

const assert = require('assert');
const { pool } = require('../server/config/database');
const { getAdminDashboardHandler } = require('../server/controllers/adminController');
const { requireAdmin } = require('../server/middleware/auth');

console.log('===============================================================');
console.log('📊 ADMIN DASHBOARD STORE ISOLATION & AUTHORITATIVE METRICS TESTS');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;
const results = [];

function record(code, name, passed, detail = '') {
  if (passed) {
    passCount++;
    console.log(`[PASS] [${code}] ${name}`);
    results.push({ code, name, status: 'PASS', detail });
  } else {
    failCount++;
    console.error(`[FAIL] [${code}] ${name} — ${detail}`);
    results.push({ code, name, status: 'FAIL', detail });
  }
}

// In-Memory Database Engine simulating Store 1 & Store 2 data
class MockDashboardDatabase {
  constructor() {
    const now = new Date();
    const todayYMD = now.toISOString().slice(0, 10);
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const oldMonthDate = new Date(now.getFullYear(), now.getMonth() - 4, 15);

    // Seed Orders:
    // Store 1 (CHIPAKK, prices in Rupees):
    // - Order 1: Paid, Shipped, ₹500, Today -> counts in total, today, this month, revenue
    // - Order 2: Paid, Processing, ₹1,200, This Month -> counts in total, this month, revenue
    // - Order 3: Pending, New, ₹300, Today -> counts in total, today, NOT in revenue
    // - Order 4: Cancelled, Cancelled, ₹800, Today -> counts in total, cancelled, NOT in revenue
    // - Order 5: Failed, Failed, ₹400, Today -> counts in total, NOT in revenue
    // - Order 6: Paid, Delivered, ₹1,500, Previous Month -> counts in total, revenue, 2-month/6-month chart
    // - Order 7: Paid, Delivered, ₹2,000, 4 Months Ago -> counts in total, revenue, 6-month chart
    // Total Store 1 Orders: 7. Paid Revenue: 500 + 1200 + 1500 + 2000 = ₹5,200. Month Revenue: 500 + 1200 = ₹1,700. Today: 4. Cancelled: 1.

    // Store 2 (THE MARSHANS, prices in Paise):
    // - Order 101: Paid, Processing, 250,000 paise (=₹2,500), Today -> counts in total, today, this month, revenue
    // - Order 102: Paid, Delivered, 500,000 paise (=₹5,000), Prev Month -> counts in total, revenue
    // - Order 103: Pending, New, 150,000 paise (=₹1,500), Today -> counts in total, NOT in revenue
    // - Order 104: Cancelled, Cancelled, 100,000 paise (=₹1,000) -> counts in total, cancelled, NOT in revenue
    // Total Store 2 Orders: 4. Paid Revenue: 2,500 + 5,000 = ₹7,500. Month Revenue: ₹2,500. Today: 2. Cancelled: 1.
    this.orders = [
      { id: 1, order_number: 'ORD-S1-01', store_id: 1, total_price: 500, payment_status: 'paid', fulfillment_status: 'shipped', created_at: `${todayYMD} 10:00:00` },
      { id: 2, order_number: 'ORD-S1-02', store_id: 1, total_price: 1200, payment_status: 'paid', fulfillment_status: 'processing', created_at: `${todayYMD} 09:00:00` },
      { id: 3, order_number: 'ORD-S1-03', store_id: 1, total_price: 300, payment_status: 'pending', fulfillment_status: 'new', created_at: `${todayYMD} 11:00:00` },
      { id: 4, order_number: 'ORD-S1-04', store_id: 1, total_price: 800, payment_status: 'cancelled', fulfillment_status: 'cancelled', created_at: `${todayYMD} 08:00:00` },
      { id: 5, order_number: 'ORD-S1-05', store_id: null, total_price: 400, payment_status: 'failed', fulfillment_status: 'pending', created_at: `${todayYMD} 07:00:00` },
      { id: 6, order_number: 'ORD-S1-06', store_id: 1, total_price: 1500, payment_status: 'paid', fulfillment_status: 'delivered', created_at: prevMonthDate.toISOString().slice(0, 19).replace('T', ' ') },
      { id: 7, order_number: 'ORD-S1-07', store_id: 1, total_price: 2000, payment_status: 'paid', fulfillment_status: 'delivered', created_at: oldMonthDate.toISOString().slice(0, 19).replace('T', ' ') },

      { id: 101, order_number: 'ORD-S2-01', store_id: 2, total_price: 250000, payment_status: 'paid', fulfillment_status: 'processing', created_at: `${todayYMD} 12:00:00` },
      { id: 102, order_number: 'ORD-S2-02', store_id: 2, total_price: 500000, payment_status: 'paid', fulfillment_status: 'delivered', created_at: prevMonthDate.toISOString().slice(0, 19).replace('T', ' ') },
      { id: 103, order_number: 'ORD-S2-03', store_id: 2, total_price: 150000, payment_status: 'pending', fulfillment_status: 'new', created_at: `${todayYMD} 13:00:00` },
      { id: 104, order_number: 'ORD-S2-04', store_id: 2, total_price: 100000, payment_status: 'cancelled', fulfillment_status: 'cancelled', created_at: `${todayYMD} 14:00:00` }
    ];

    // Order Items:
    // Store 1 items:
    // item 1: READY_TO_PRINT
    // item 2: PRINTING
    // item 3: READY_TO_PACK
    this.orderItems = [
      { id: 1, order_id: 2, production_status: 'PRINTING' },
      { id: 2, order_id: 3, production_status: 'READY_TO_PRINT' },
      { id: 3, order_id: 1, production_status: 'READY_TO_PACK' }
    ];

    // Store 2 Production Jobs:
    // job 1: Preparing (Ready to print)
    // job 2: Printing (Printing/Cutting)
    // job 3: Ready (Ready to Pack)
    this.productionJobs = [
      { id: 1, store_id: 2, stage: 'Preparing' },
      { id: 2, store_id: 2, stage: 'Printing' },
      { id: 3, store_id: 2, stage: 'Ready' }
    ];

    // Products
    this.products = [
      { id: 1, name: 'Anime Vinyl Sticker', store_id: 1, active: 1, featured: 1, price: 99 },
      { id: 2, name: 'Holo Sticker Pack', store_id: 1, active: 1, featured: 0, price: 199 },
      { id: 3, name: 'Cyberpunk Sticker', store_id: 1, active: 1, featured: 0, price: 149 }
    ];
    this.marshansProducts = [
      { id: 101, name: 'LUMO Ambient Lamp', store_id: 2, active: 1, featured: 1, price: 299900 },
      { id: 102, name: 'Geometric Planter', store_id: 2, active: 1, featured: 0, price: 149900 }
    ];

    // Categories
    this.categories = [
      { id: 1, name: 'Anime', store_id: 1, active: 1 },
      { id: 2, name: 'Holographic', store_id: 1, active: 1 }
    ];
    this.marshansCategories = [
      { id: 101, name: 'Ambient Lighting', store_id: 2, active: 1 }
    ];

    // Inventory / Low Stock
    // Store 1: 1 variant with stock 5 (<= 10) -> low stock = 1
    // Store 2: 1 material with stock 100 <= safety_stock 200 -> low stock = 1
    this.inventory = [
      { id: 1, variant_id: 1, stock: 5 },
      { id: 2, variant_id: 2, stock: 50 }
    ];
    this.productVariants = [
      { id: 1, product_id: 1 },
      { id: 2, product_id: 2 }
    ];
    this.materials = [
      { id: 1, store_id: 2, name: 'PLA Matte Black', stock: 100, safety_stock: 200, active: 1 },
      { id: 2, store_id: 2, name: 'PETG Silver', stock: 500, safety_stock: 200, active: 1 }
    ];

    this.users = [
      { id: 1, email: 'user1@example.com' },
      { id: 2, email: 'user2@example.com' }
    ];

    this.admins = [
      { id: 1, firebase_uid: 'admin_uid_valid', email: 'admin@chipakk.shop', role: 'super_admin', active: 1 }
    ];
  }

  async execute(sql, params = []) {
    const trimmed = sql.trim();
    const now = new Date();
    const todayYMD = now.toISOString().slice(0, 10);
    const startOfMonthYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const isStore2Query = /o\.store_id\s*=\s*2|store_id\s*=\s*2/i.test(trimmed) && !/o\.store_id\s*=\s*1/i.test(trimmed);
    const scopedOrders = this.orders.filter(o => {
      if (isStore2Query) return o.store_id === 2;
      return o.store_id === 1 || o.store_id === null;
    });

    const isPaid = (o) => {
      const paySt = String(o.payment_status || '').toLowerCase();
      const fulSt = String(o.fulfillment_status || '').toLowerCase();
      return paySt === 'paid' && fulSt !== 'cancelled' && fulSt !== 'failed' && paySt !== 'failed';
    };

    const getRupees = (o) => {
      if (o.store_id === 2) return Math.round(o.total_price / 100);
      return o.total_price;
    };

    // 1. Total orders count
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+orders\s+o\s+WHERE/i.test(trimmed) && !/LOWER/i.test(trimmed) && !/DATE/i.test(trimmed)) {
      return [[{ total: scopedOrders.length }]];
    }

    // 2. Cancelled orders count
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+orders\s+o\s+WHERE.*cancelled/i.test(trimmed)) {
      const cancelled = scopedOrders.filter(o =>
        String(o.fulfillment_status).toLowerCase() === 'cancelled' ||
        String(o.payment_status).toLowerCase() === 'cancelled'
      );
      return [[{ total: cancelled.length }]];
    }

    // 3. Orders placed today
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+orders\s+o\s+WHERE.*DATE\(o\.created_at\)\s*=\s*CURDATE\(\)/i.test(trimmed)) {
      const todayOrders = scopedOrders.filter(o => o.created_at.startsWith(todayYMD));
      return [[{ total: todayOrders.length }]];
    }

    // 4. Awaiting confirmation
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+orders\s+o\s+WHERE.*IN\s*\('pending',\s*'new'\)/i.test(trimmed)) {
      const awaiting = scopedOrders.filter(o =>
        ['pending', 'new'].includes(String(o.fulfillment_status).toLowerCase()) &&
        String(o.fulfillment_status).toLowerCase() !== 'cancelled'
      );
      return [[{ total: awaiting.length }]];
    }

    // 5. Total commercial revenue
    if (/COALESCE\(SUM\(.*total_price.*\),\s*0\)\s+AS\s+total_revenue/i.test(trimmed)) {
      const totalRev = scopedOrders.filter(isPaid).reduce((sum, o) => sum + getRupees(o), 0);
      return [[{ total_revenue: totalRev }]];
    }

    // 6. Month commercial revenue
    if (/COALESCE\(SUM\(.*total_price.*\),\s*0\)\s+AS\s+month_revenue/i.test(trimmed)) {
      const monthRev = scopedOrders
        .filter(isPaid)
        .filter(o => o.created_at >= `${startOfMonthYMD} 00:00:00`)
        .reduce((sum, o) => sum + getRupees(o), 0);
      return [[{ month_revenue: monthRev }]];
    }

    // 7. Production queue (order items)
    if (/FROM\s+order_items\s+oi\s+JOIN\s+orders\s+o/i.test(trimmed)) {
      let readyCount = 0;
      let inProdCount = 0;
      let readyPackCount = 0;

      this.orderItems.forEach(item => {
        const ord = this.orders.find(o => o.id === item.order_id);
        if (!ord) return;
        const matchesStore = isStore2Query ? ord.store_id === 2 : (ord.store_id === 1 || ord.store_id === null);
        if (!matchesStore) return;
        const st = (item.production_status || '').toUpperCase();
        if (['READY_TO_PRINT', 'NEW', 'NOT_STARTED'].includes(st)) readyCount++;
        if (['PRINTING', 'PRINTED', 'CUTTING', 'CUT', 'PROCESSING'].includes(st)) inProdCount++;
        if (['READY_TO_PACK', 'PACKED'].includes(st)) readyPackCount++;
      });

      return [[{ ready_count: readyCount, in_prod_count: inProdCount, ready_pack_count: readyPackCount }]];
    }

    // 8. Production jobs (Store 2)
    if (/FROM\s+production_jobs\s+pj/i.test(trimmed)) {
      let readyCount = 0;
      let inProdCount = 0;
      let readyPackCount = 0;

      this.productionJobs.filter(pj => pj.store_id === 2).forEach(pj => {
        if (['Order Received', 'Preparing'].includes(pj.stage)) readyCount++;
        if (['Printing', 'Finishing'].includes(pj.stage)) inProdCount++;
        if (['Quality Check', 'Ready'].includes(pj.stage)) readyPackCount++;
      });

      return [[{ ready_count: readyCount, in_prod_count: inProdCount, ready_pack_count: readyPackCount }]];
    }

    // 9. Materials low stock (Store 2)
    if (/FROM\s+materials/i.test(trimmed)) {
      const lowMat = this.materials.filter(m => m.store_id === 2 && m.stock <= m.safety_stock && m.active === 1);
      return [[{ total: lowMat.length }]];
    }

    // 10. Inventory low stock (Store 1)
    if (/FROM\s+inventory\s+i\s+JOIN\s+product_variants/i.test(trimmed)) {
      let lowCount = 0;
      this.inventory.forEach(inv => {
        const pv = this.productVariants.find(v => v.id === inv.variant_id);
        if (pv) {
          const prod = this.products.find(p => p.id === pv.product_id);
          if (prod && (prod.store_id === 1 || prod.store_id === null) && inv.stock <= 10) {
            lowCount++;
          }
        }
      });
      return [[{ total: lowCount }]];
    }

    // 11. Products count
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+marshans_products/i.test(trimmed)) {
      return [[{ total: this.marshansProducts.length }]];
    }
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+products/i.test(trimmed)) {
      const prods = this.products.filter(p => isStore2Query ? p.store_id === 2 : (p.store_id === 1 || p.store_id === null));
      return [[{ total: prods.length }]];
    }

    // 12. Categories count
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+marshans_categories/i.test(trimmed)) {
      return [[{ total: this.marshansCategories.length }]];
    }
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+categories/i.test(trimmed)) {
      const cats = this.categories.filter(c => isStore2Query ? c.store_id === 2 : (c.store_id === 1 || c.store_id === null));
      return [[{ total: cats.length }]];
    }

    // 13. Users count
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+users/i.test(trimmed)) {
      return [[{ total: this.users.length }]];
    }

    // 14. Monthly aggregation query
    if (/SELECT.*DATE_FORMAT\(o\.created_at,\s*'%Y-%m'\)\s+AS\s+month_key/i.test(trimmed)) {
      const numMonths = params[0] || 6;
      const monthMap = {};

      scopedOrders.filter(isPaid).forEach(o => {
        const d = new Date(o.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[key]) {
          monthMap[key] = { month_key: key, revenue_rupees: 0, order_count: 0 };
        }
        monthMap[key].revenue_rupees += getRupees(o);
        monthMap[key].order_count += 1;
      });

      const rows = Object.values(monthMap).sort((a, b) => a.month_key.localeCompare(b.month_key));
      return [rows];
    }

    // 15. Recent orders
    if (/SELECT.*o\.order_number.*FROM\s+orders\s+o\s+WHERE.*ORDER\s+BY.*LIMIT\s+5/i.test(trimmed)) {
      const sorted = [...scopedOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const top5 = sorted.slice(0, 5).map(o => ({
        id: o.id,
        order_number: o.order_number,
        customer_name: 'Test Customer',
        total_price: getRupees(o),
        payment_status: o.payment_status,
        status: o.fulfillment_status,
        created_at: o.created_at
      }));
      return [top5];
    }

    // 16. Top products
    if (/SELECT.*title.*FROM\s+marshans_products/i.test(trimmed)) {
      const top = this.marshansProducts.slice(0, 5).map(p => ({
        id: p.id,
        title: p.name,
        price: Math.round(p.price / 100),
        image_url: 'https://example.com/lumo.png'
      }));
      return [top];
    }
    if (/SELECT.*title.*FROM\s+products/i.test(trimmed)) {
      const prods = this.products.filter(p => isStore2Query ? p.store_id === 2 : (p.store_id === 1 || p.store_id === null));
      const top = prods.slice(0, 5).map(p => ({
        id: p.id,
        title: p.name,
        price: p.price,
        image_url: 'https://example.com/sticker.png'
      }));
      return [top];
    }

    // 17. Admins query for auth middleware
    if (/SELECT\s+COUNT\(\*\)\s+AS\s+total\s+FROM\s+admins/i.test(trimmed)) {
      return [[{ total: this.admins.length }]];
    }
    if (/FROM\s+admins/i.test(trimmed)) {
      const uid = params[0];
      const email = params[1] || '';
      const match = this.admins.filter(a =>
        a.active === 1 &&
        (a.firebase_uid === uid || (a.email && email && a.email.toLowerCase() === email.toLowerCase()))
      );
      return [match];
    }

    return [[]];
  }
}

// Mock Express Response Helper
const createMockRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
};

// Runner for Test Cases
async function runTests() {
  const mockDb = new MockDashboardDatabase();
  const origExecute = pool.execute;
  pool.execute = mockDb.execute.bind(mockDb);

  try {
    // -------------------------------------------------------------
    // CHECK A: Store 1 Dashboard
    // -------------------------------------------------------------
    console.log('\n--- CHECK A: Store 1 Dashboard ---');
    const reqS1 = {
      storeId: 1,
      admin: { id: 1, email: 'admin@chipakk.shop', role: 'super_admin', firebase_uid: 'admin_uid_valid' },
      query: { timeframe: 'last_6_months' }
    };
    const resS1 = createMockRes();
    await getAdminDashboardHandler(reqS1, resS1, (err) => { if (err) throw err; });

    const mS1 = resS1.body?.data?.metrics;
    assert.strictEqual(mS1.storeId, 1, 'Store ID must be 1');
    assert.strictEqual(mS1.storeCode, 'chipakk', 'Store Code must be chipakk');
    assert.strictEqual(mS1.totalOrders, 7, 'Store 1 total orders count must be exactly 7');
    record('A', 'Store 1 Dashboard metrics scoped to CHIPAKK (7 orders)', mS1.storeId === 1 && mS1.totalOrders === 7);

    // -------------------------------------------------------------
    // CHECK B: Store 2 Dashboard
    // -------------------------------------------------------------
    console.log('\n--- CHECK B: Store 2 Dashboard ---');
    const reqS2 = {
      storeId: 2,
      admin: { id: 1, email: 'admin@chipakk.shop', role: 'super_admin', firebase_uid: 'admin_uid_valid' },
      query: { timeframe: 'last_6_months' }
    };
    const resS2 = createMockRes();
    await getAdminDashboardHandler(reqS2, resS2, (err) => { if (err) throw err; });

    const mS2 = resS2.body?.data?.metrics;
    assert.strictEqual(mS2.storeId, 2, 'Store ID must be 2');
    assert.strictEqual(mS2.storeCode, 'marshans', 'Store Code must be marshans');
    assert.strictEqual(mS2.totalOrders, 4, 'Store 2 total orders count must be exactly 4');
    record('B', 'Store 2 Dashboard metrics scoped to THE MARSHANS (4 orders)', mS2.storeId === 2 && mS2.totalOrders === 4);

    // -------------------------------------------------------------
    // CHECK C: Store Isolation
    // -------------------------------------------------------------
    console.log('\n--- CHECK C: Store Isolation ---');
    const noLeakOrders = (mS1.totalOrders + mS2.totalOrders === 11);
    const isolatedRevenue = mS1.totalRevenue !== mS2.totalRevenue;
    const isolatedProds = mS1.totalProducts !== mS2.totalProducts;
    record('C', 'Zero data leakage between Store 1 and Store 2', noLeakOrders && isolatedRevenue && isolatedProds);

    // -------------------------------------------------------------
    // CHECK D: Lifetime Order Count from DB, not Paginated Frontend
    // -------------------------------------------------------------
    console.log('\n--- CHECK D: Lifetime Order Count from DB ---');
    // Store 1 DB has 7 orders; even if recentOrders returns only 5 (paginated limit)
    const recentLimit5 = mS1.recentOrders.length <= 5;
    const dbTotal7 = mS1.totalOrders === 7;
    record('D', 'Lifetime order count (7) is server-authoritative and not capped by recent list (5)', dbTotal7 && recentLimit5);

    // -------------------------------------------------------------
    // CHECK E: Revenue Excludes Unpaid Orders
    // -------------------------------------------------------------
    console.log('\n--- CHECK E: Revenue Excludes Unpaid Orders ---');
    // Store 1 order 3 is pending (₹300) -> should NOT be in totalRevenue
    // Paid orders = 500 + 1200 + 1500 + 2000 = 5200. With order 3 it would be 5500.
    const unpaidExcluded = mS1.totalRevenue === 5200;
    record('E', 'Revenue excludes pending/unpaid orders (₹300 excluded)', unpaidExcluded);

    // -------------------------------------------------------------
    // CHECK F: Revenue Excludes Cancelled Orders
    // -------------------------------------------------------------
    console.log('\n--- CHECK F: Revenue Excludes Cancelled Orders ---');
    // Store 1 order 4 is cancelled (₹800) -> should NOT be in totalRevenue
    assert.strictEqual(mS1.cancelledOrders, 1, 'Store 1 cancelled orders count must be 1');
    const cancelledExcluded = mS1.totalRevenue === 5200;
    record('F', 'Revenue excludes cancelled orders (₹800 excluded, 1 cancelled recorded)', cancelledExcluded && mS1.cancelledOrders === 1);

    // -------------------------------------------------------------
    // CHECK G: Revenue Excludes Failed Orders
    // -------------------------------------------------------------
    console.log('\n--- CHECK G: Revenue Excludes Failed Orders ---');
    // Store 1 order 5 is failed (₹400) -> should NOT be in totalRevenue
    const failedExcluded = mS1.totalRevenue === 5200;
    record('G', 'Revenue excludes failed orders (₹400 excluded)', failedExcluded);

    // -------------------------------------------------------------
    // CHECK H: Revenue Includes Paid Valid Orders
    // -------------------------------------------------------------
    console.log('\n--- CHECK H: Revenue Includes Paid Valid Orders ---');
    // Store 1: orders 1 (500), 2 (1200), 6 (1500), 7 (2000) = ₹5,200
    // Store 2: orders 101 (250000 paise = ₹2500), 102 (500000 paise = ₹5000) = ₹7,500
    const s1RevenueCorrect = mS1.totalRevenue === 5200;
    const s2RevenueCorrect = mS2.totalRevenue === 7500;
    record('H', 'Revenue correctly computes paid orders (Store 1: ₹5,200, Store 2: ₹7,500)', s1RevenueCorrect && s2RevenueCorrect);

    // -------------------------------------------------------------
    // CHECK I: Orders Today
    // -------------------------------------------------------------
    console.log('\n--- CHECK I: Orders Today ---');
    // Store 1 orders created today: orders 1, 2, 3, 4, 5 = 5 (wait: in mock, 1, 2, 3, 4, 5 are today) -> 5
    // Store 2 orders created today: orders 101, 103, 104 = 3
    assert.strictEqual(mS1.ordersToday, 5, 'Store 1 today orders count must be 5');
    assert.strictEqual(mS2.ordersToday, 3, 'Store 2 today orders count must be 3');
    record('I', 'Orders Today accurately scoped by date & store (Store 1: 5, Store 2: 3)', mS1.ordersToday === 5 && mS2.ordersToday === 3);

    // -------------------------------------------------------------
    // CHECK J: Monthly Revenue
    // -------------------------------------------------------------
    console.log('\n--- CHECK J: Monthly Revenue ---');
    // Store 1 orders this month and paid: order 1 (₹500), order 2 (₹1200) = ₹1,700
    // Store 2 orders this month and paid: order 101 (₹2,500) = ₹2,500
    assert.strictEqual(mS1.monthRevenue, 1700, 'Store 1 month revenue must be ₹1,700');
    assert.strictEqual(mS2.monthRevenue, 2500, 'Store 2 month revenue must be ₹2,500');
    record('J', 'Revenue This Month scoped to calendar month & store (Store 1: ₹1,700, Store 2: ₹2,500)', mS1.monthRevenue === 1700 && mS2.monthRevenue === 2500);

    // -------------------------------------------------------------
    // CHECK K: 2-Month Chart (current_vs_prev)
    // -------------------------------------------------------------
    console.log('\n--- CHECK K: 2-Month Chart ---');
    const req2m = {
      storeId: 1,
      admin: { id: 1, email: 'admin@chipakk.shop', role: 'super_admin', firebase_uid: 'admin_uid_valid' },
      query: { timeframe: 'current_vs_prev' }
    };
    const res2m = createMockRes();
    await getAdminDashboardHandler(req2m, res2m, (err) => { if (err) throw err; });
    const stats2m = res2m.body?.data?.metrics?.monthlyStats;
    assert.strictEqual(stats2m.length, 2, '2-month timeframe must return exactly 2 months');
    record('K', 'Analytics timeframe current_vs_prev returns exactly 2 months', stats2m.length === 2);

    // -------------------------------------------------------------
    // CHECK L: 3-Month Chart (last_3_months)
    // -------------------------------------------------------------
    console.log('\n--- CHECK L: 3-Month Chart ---');
    const req3m = {
      storeId: 1,
      admin: { id: 1, email: 'admin@chipakk.shop', role: 'super_admin', firebase_uid: 'admin_uid_valid' },
      query: { timeframe: 'last_3_months' }
    };
    const res3m = createMockRes();
    await getAdminDashboardHandler(req3m, res3m, (err) => { if (err) throw err; });
    const stats3m = res3m.body?.data?.metrics?.monthlyStats;
    assert.strictEqual(stats3m.length, 3, '3-month timeframe must return exactly 3 months');
    record('L', 'Analytics timeframe last_3_months returns exactly 3 months', stats3m.length === 3);

    // -------------------------------------------------------------
    // CHECK M: 6-Month Chart (last_6_months)
    // -------------------------------------------------------------
    console.log('\n--- CHECK M: 6-Month Chart ---');
    const req6m = {
      storeId: 1,
      admin: { id: 1, email: 'admin@chipakk.shop', role: 'super_admin', firebase_uid: 'admin_uid_valid' },
      query: { timeframe: 'last_6_months' }
    };
    const res6m = createMockRes();
    await getAdminDashboardHandler(req6m, res6m, (err) => { if (err) throw err; });
    const stats6m = res6m.body?.data?.metrics?.monthlyStats;
    assert.strictEqual(stats6m.length, 6, '6-month timeframe must return exactly 6 months');
    record('M', 'Analytics timeframe last_6_months returns exactly 6 months', stats6m.length === 6);

    // -------------------------------------------------------------
    // CHECK N: Production Queue Store Isolation
    // -------------------------------------------------------------
    console.log('\n--- CHECK N: Production Queue Store Isolation ---');
    // Store 1 has 1 ready, 1 in prod, 1 ready to pack
    assert.strictEqual(mS1.readyToPrint, 1, 'Store 1 readyToPrint must be 1');
    assert.strictEqual(mS1.printingCutting, 1, 'Store 1 printingCutting must be 1');
    assert.strictEqual(mS1.readyToPack, 1, 'Store 1 readyToPack must be 1');
    // Store 2 has 1 preparing (ready), 1 printing, 1 ready (pack)
    assert.strictEqual(mS2.readyToPrint, 1, 'Store 2 readyToPrint must be 1');
    assert.strictEqual(mS2.printingCutting, 1, 'Store 2 printingCutting must be 1');
    assert.strictEqual(mS2.readyToPack, 1, 'Store 2 readyToPack must be 1');
    record('N', 'Production queue counts isolated by store context', mS1.readyToPrint === 1 && mS2.readyToPrint === 1);

    // -------------------------------------------------------------
    // CHECK O: Low-Stock Store Isolation
    // -------------------------------------------------------------
    console.log('\n--- CHECK O: Low-Stock Store Isolation ---');
    // Store 1: variant with stock 5 <= 10 -> 1
    // Store 2: material with stock 100 <= safety_stock 200 -> 1
    assert.strictEqual(mS1.lowStockCount, 1, 'Store 1 low stock count must be 1');
    assert.strictEqual(mS2.lowStockCount, 1, 'Store 2 low stock count must be 1');
    record('O', 'Low stock counts isolated to store inventory/materials', mS1.lowStockCount === 1 && mS2.lowStockCount === 1);

    // -------------------------------------------------------------
    // CHECK P: Customer Firebase User Cannot Access Dashboard API
    // -------------------------------------------------------------
    console.log('\n--- CHECK P: Security - Customer Token Rejection ---');
    let forbiddenRejected = false;
    const customerReq = {
      user: { uid: 'customer_uid_123', email: 'customer@gmail.com' }
    };
    const customerRes = createMockRes();
    const nextFn = (err) => {
      if (err) forbiddenRejected = true;
    };

    await requireAdmin(customerReq, customerRes, nextFn);
    if (customerRes.statusCode === 403) {
      forbiddenRejected = true;
    }

    assert.strictEqual(forbiddenRejected, true, 'Customer token must be rejected with HTTP 403');
    record('P', 'Customer Firebase account rejected from Admin Dashboard with HTTP 403', forbiddenRejected);

  } finally {
    pool.execute = origExecute;
  }

  console.log('\n===============================================================');
  console.log(`🏁 TEST RUN SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('===============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
