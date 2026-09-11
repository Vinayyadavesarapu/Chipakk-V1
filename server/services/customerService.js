const { pool } = require('../config/database');

/**
 * Shared Customer Order & Loyalty Architecture:
 * Single unified customer identity across CHIPAKK + The Marshans.
 * Computes shared loyalty based on qualifying delivered orders count.
 * Tier thresholds:
 * - ELITE: >= 30 completed/qualifying orders
 * - VIP: >= 15 completed/qualifying orders
 * - REGULAR: >= 5 completed/qualifying orders
 * - CUSTOMER: >= 1 completed/qualifying orders
 * - NEW: 0 qualifying orders
 */
const calculateLoyaltyTier = (qualifyingOrdersCount) => {
  const count = Math.max(parseInt(qualifyingOrdersCount, 10) || 0, 0);
  if (count >= 30) return 'ELITE';
  if (count >= 15) return 'VIP';
  if (count >= 5) return 'REGULAR';
  if (count >= 1) return 'CUSTOMER';
  return 'NEW';
};

/**
 * Shared Customer Order Count & Loyalty Metrics
 * Aggregates qualifying orders across CHIPAKK and future storefronts (The Marshans)
 * under the single customer identity.
 *
 * @param {number|string} userId - Numeric internal user ID or firebase_uid
 * @param {string} [userEmail] - Customer email address
 * @returns {Promise<{chipakk_orders: number, marshans_orders: number, total_qualifying_orders: number, loyalty_tier: string}>}
 */
const getSharedCustomerLoyaltyMetrics = async (userId, userEmail = null) => {
  let chipakkOrdersCount = 0;

  try {
    if (userId) {
      const numId = parseInt(userId, 10);
      const isNum = !isNaN(numId) && String(numId) === String(userId);
      const sql = isNum
        ? "SELECT COUNT(*) AS total FROM orders WHERE customer_id = ? AND fulfillment_status = 'delivered'"
        : "SELECT COUNT(*) AS total FROM orders o JOIN users u ON o.customer_id = u.id WHERE u.firebase_uid = ? AND o.fulfillment_status = 'delivered'";
      const [rows] = await pool.execute(sql, [userId]);
      chipakkOrdersCount = parseInt(rows[0]?.total, 10) || 0;
    } else if (userEmail) {
      const [rows] = await pool.execute(
        "SELECT COUNT(*) AS total FROM orders WHERE customer_email = ? AND fulfillment_status = 'delivered'",
        [userEmail]
      );
      chipakkOrdersCount = parseInt(rows[0]?.total, 10) || 0;
    }
  } catch (err) {
    console.warn('[Shared Loyalty Query Warning]', err.message);
  }

  // Future Marshans integration point:
  // Once M_orders table is provisioned in subsequent Marshans phase, query:
  // SELECT COUNT(*) AS total FROM M_orders WHERE customer_email = ? AND fulfillment_status = 'delivered'
  const marshansOrdersCount = 0; // Ready for M_orders hook

  const totalQualifyingOrders = chipakkOrdersCount + marshansOrdersCount;

  return {
    chipakk_orders: chipakkOrdersCount,
    marshans_orders: marshansOrdersCount,
    total_qualifying_orders: totalQualifyingOrders,
    loyalty_tier: calculateLoyaltyTier(totalQualifyingOrders)
  };
};

/**
 * Fetch list of customers with search (name, email, phone) and aggregated order/loyalty metrics
 */
const getCustomers = async ({
  search,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  // Aggregated customer list query
  const query = `
    SELECT 
      u.id,
      u.firebase_uid,
      u.name,
      u.email,
      u.phone,
      u.created_at,
      u.updated_at,
      COUNT(o.id) AS total_orders,
      COUNT(CASE WHEN o.fulfillment_status = 'DELIVERED' THEN 1 END) AS delivered_orders,
      COALESCE(SUM(CASE WHEN o.fulfillment_status = 'DELIVERED' THEN o.total_price ELSE 0 END), 0) AS total_spend
    FROM users u
    LEFT JOIN orders o ON u.id = o.customer_id
    ${whereClause}
    GROUP BY u.id
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const customers = rows.map(r => {
    const totalOrders = parseInt(r.total_orders, 10) || 0;
    const deliveredOrders = parseInt(r.delivered_orders, 10) || 0;
    const totalSpendPaise = parseInt(r.total_spend, 10) || 0;

    return {
      id: r.id,
      firebase_uid: r.firebase_uid,
      name: r.name || null,
      email: r.email || null,
      phone: r.phone || null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      total_orders: totalOrders,
      delivered_orders: deliveredOrders,
      total_spend: totalSpendPaise,
      total_spend_rupees: Math.round(totalSpendPaise / 100),
      loyalty_tier: calculateLoyaltyTier(deliveredOrders)
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    customers
  };
};

/**
 * Fetch a single customer by numeric BIGINT ID or firebase_uid with order history and derived statistics
 */
const getCustomerById = async (idOrUid) => {
  if (!idOrUid) return null;

  const numId = parseInt(idOrUid, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(idOrUid);

  const userQuery = `
    SELECT 
      u.id,
      u.firebase_uid,
      u.name,
      u.email,
      u.phone,
      u.created_at,
      u.updated_at
    FROM users u
    WHERE ${isNumeric ? 'u.id = ?' : 'u.firebase_uid = ?'}
    LIMIT 1
  `;

  const param = isNumeric ? numId : String(idOrUid).trim();
  const [userRows] = await pool.execute(userQuery, [param]);

  if (!userRows || userRows.length === 0) {
    return null;
  }

  const customer = userRows[0];
  const numUserId = customer.id;

  // 1. Fetch aggregated stats for this customer
  const statsQuery = `
    SELECT 
      COUNT(id) AS total_orders,
      COUNT(CASE WHEN fulfillment_status = 'DELIVERED' THEN 1 END) AS delivered_orders,
      COALESCE(SUM(CASE WHEN fulfillment_status = 'DELIVERED' THEN total_price ELSE 0 END), 0) AS total_spend
    FROM orders
    WHERE customer_id = ?
  `;
  const [statsRows] = await pool.execute(statsQuery, [numUserId]);
  const statsRow = statsRows[0] || {};

  const totalOrders = parseInt(statsRow.total_orders, 10) || 0;
  const deliveredOrders = parseInt(statsRow.delivered_orders, 10) || 0;
  const totalSpendPaise = parseInt(statsRow.total_spend, 10) || 0;

  // 2. Fetch order history for this customer
  const ordersQuery = `
    SELECT 
      id AS order_id,
      order_number,
      created_at,
      fulfillment_status,
      payment_status,
      subtotal,
      discount_total AS discount,
      shipping_charge AS shipping_fee,
      0 AS tax,
      total_price AS total,
      courier,
      tracking_no,
      ship_date
    FROM orders
    WHERE customer_id = ?
    ORDER BY created_at DESC, id DESC
  `;
  const [orderRows] = await pool.execute(ordersQuery, [numUserId]);

  const orders = orderRows.map(o => {
    const subtotalPaise = parseInt(o.subtotal, 10) || 0;
    const discountPaise = parseInt(o.discount, 10) || 0;
    const shippingFeePaise = parseInt(o.shipping_fee, 10) || 0;
    const totalPaise = parseInt(o.total, 10) || 0;

    return {
      order_id: o.order_id,
      order_number: o.order_number,
      created_at: o.created_at,
      fulfillment_status: o.fulfillment_status,
      payment_status: o.payment_status,
      subtotal: subtotalPaise,
      subtotal_rupees: Math.round(subtotalPaise / 100),
      discount: discountPaise,
      discount_rupees: Math.round(discountPaise / 100),
      shipping_fee: shippingFeePaise,
      shipping_fee_rupees: Math.round(shippingFeePaise / 100),
      tax: 0,
      tax_rupees: 0,
      total: totalPaise,
      total_rupees: Math.round(totalPaise / 100),
      courier: o.courier || null,
      tracking_no: o.tracking_no || null,
      ship_date: o.ship_date || null
    };
  });

  return {
    id: customer.id,
    firebase_uid: customer.firebase_uid,
    name: customer.name || null,
    email: customer.email || null,
    phone: customer.phone || null,
    created_at: customer.created_at,
    updated_at: customer.updated_at,
    stats: {
      total_orders: totalOrders,
      delivered_orders: deliveredOrders,
      total_spend: totalSpendPaise,
      total_spend_rupees: Math.round(totalSpendPaise / 100),
      loyalty_tier: calculateLoyaltyTier(deliveredOrders)
    },
    orders
  };
};

module.exports = {
  calculateLoyaltyTier,
  getSharedCustomerLoyaltyMetrics,
  getCustomers,
  getCustomerById
};

