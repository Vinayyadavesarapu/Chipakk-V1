const { pool } = require('../config/database');

/**
 * Approved Production Statuses (Strict Uppercase Machine Values)
 */
const ALLOWED_PRODUCTION_STATUSES = [
  'NOT_STARTED',
  'READY_TO_PRINT',
  'PRINTING',
  'PRINTED',
  'CUTTING',
  'CUT',
  'READY_TO_PACK',
  'PACKED'
];

/**
 * Safe JSON parser helper
 */
const safeJsonParse = (val, fallback = null) => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
};

/**
 * Query individual order_items in the POD Production Queue with search, status filter, and pagination
 */
const getProductionQueue = async ({
  search,
  production_status,
  store_id,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  if (store_id !== undefined && store_id !== null && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        conditions.push('(o.store_id = 1 OR o.store_id IS NULL)');
      } else {
        conditions.push('o.store_id = ?');
        params.push(sId);
      }
    }
  }

  if (production_status && String(production_status).trim()) {
    conditions.push('oi.production_status = ?');
    params.push(String(production_status).trim().toUpperCase());
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(o.order_number LIKE ? OR oi.product_name LIKE ? OR oi.sku LIKE ? OR oi.admin_product_id_snapshot LIKE ? OR o.customer_name LIKE ? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, "$.phone")), "") LIKE ?)');
    params.push(term, term, term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total count query
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    ${whereClause}
  `;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  // Items query JOINing order details
  const query = `
    SELECT
      oi.id AS order_item_id,
      oi.order_id,
      o.order_number,
      oi.product_id,
      oi.variant_id,
      oi.product_name,
      oi.sku,
      oi.admin_product_id_snapshot,
      oi.variant_options,
      oi.quantity,
      oi.unit_price,
      oi.total_price,
      oi.production_status,
      o.fulfillment_status,
      o.customer_name,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')), '') AS customer_phone,
      COALESCE(o.store_id, 1) AS store_id,
      oi.created_at
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    ${whereClause}
    ORDER BY oi.created_at DESC, oi.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const items = rows.map(r => {
    const isStore2 = parseInt(r.store_id, 10) === 2;
    const rawUnitPrice = parseInt(r.unit_price, 10) || 0;
    const rawTotalPrice = parseInt(r.total_price, 10) || 0;
    const unitPriceRupees = isStore2 ? Math.round(rawUnitPrice / 100) : rawUnitPrice;
    const totalPriceRupees = isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice;
    return {
      order_item_id: r.order_item_id,
      order_id: r.order_id,
      order_number: r.order_number,
      product_id: r.product_id,
      variant_id: r.variant_id,
      product_name: r.product_name,
      sku: r.sku,
      admin_product_id_snapshot: r.admin_product_id_snapshot,
      variant_options: safeJsonParse(r.variant_options, null),
      quantity: r.quantity,
      unit_price: unitPriceRupees,
      unit_price_rupees: unitPriceRupees,
      total_price: totalPriceRupees,
      total_price_rupees: totalPriceRupees,
      production_status: r.production_status,
      fulfillment_status: r.fulfillment_status,
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
      created_at: r.created_at
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    items
  };
};

/**
 * Fetch a single order_item by numeric BIGINT ID with associated order context
 */
const getProductionItemById = async (itemId, store_id = null) => {
  if (!itemId) return null;

  const numItemId = parseInt(itemId, 10);
  if (isNaN(numItemId)) return null;

  let storeCondition = '';
  const params = [numItemId];
  if (store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        storeCondition = ' AND (o.store_id = 1 OR o.store_id IS NULL)';
      } else {
        storeCondition = ' AND o.store_id = ?';
        params.push(sId);
      }
    }
  }

  const query = `
    SELECT
      oi.id AS order_item_id,
      oi.order_id,
      o.order_number,
      oi.product_id,
      oi.variant_id,
      oi.product_name,
      oi.sku,
      oi.admin_product_id_snapshot,
      oi.variant_options,
      oi.quantity,
      oi.unit_price,
      oi.total_price,
      oi.production_status,
      o.fulfillment_status,
      o.customer_name,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')), '') AS customer_phone,
      COALESCE(o.store_id, 1) AS store_id,
      oi.created_at
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.id = ?${storeCondition}
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, params);

  if (!rows || rows.length === 0) {
    return null;
  }

  const r = rows[0];
  const isStore2 = parseInt(r.store_id, 10) === 2;
  const rawUnitPrice = parseInt(r.unit_price, 10) || 0;
  const rawTotalPrice = parseInt(r.total_price, 10) || 0;
  const unitPriceRupees = isStore2 ? Math.round(rawUnitPrice / 100) : rawUnitPrice;
  const totalPriceRupees = isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice;

  return {
    order_item_id: r.order_item_id,
    order_id: r.order_id,
    order_number: r.order_number,
    product_id: r.product_id,
    variant_id: r.variant_id,
    product_name: r.product_name,
    sku: r.sku,
    admin_product_id_snapshot: r.admin_product_id_snapshot,
    variant_options: safeJsonParse(r.variant_options, null),
    quantity: r.quantity,
    unit_price: unitPriceRupees,
    unit_price_rupees: unitPriceRupees,
    total_price: totalPriceRupees,
    total_price_rupees: totalPriceRupees,
    production_status: r.production_status,
    fulfillment_status: r.fulfillment_status,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
    created_at: r.created_at
  };
};

/**
 * Update production_status for a specific order item
 */
const updateProductionStatus = async (itemId, status, store_id = null) => {
  const numItemId = parseInt(itemId, 10);
  if (isNaN(numItemId)) {
    throw new Error('Invalid order item ID format. Expected numeric BIGINT ID.');
  }

  const normalizedStatus = String(status || '').trim().toUpperCase();

  if (!ALLOWED_PRODUCTION_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid production status. Allowed values: ${ALLOWED_PRODUCTION_STATUSES.join(', ')}`);
  }

  const existing = await getProductionItemById(numItemId, store_id);
  if (!existing) {
    return null;
  }

  const query = 'UPDATE order_items SET production_status = ? WHERE id = ?';
  await pool.execute(query, [normalizedStatus, numItemId]);

  return getProductionItemById(numItemId, store_id);
};

module.exports = {
  ALLOWED_PRODUCTION_STATUSES,
  getProductionQueue,
  getProductionItemById,
  updateProductionStatus
};
