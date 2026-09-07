const { pool } = require('../config/database');

/**
 * Approved Fulfillment Statuses (Strict Uppercase Machine Values)
 */
const ALLOWED_FULFILLMENT_STATUSES = [
  'NEW',
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
  'REFUNDED'
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
 * Fetch list of orders with filters & pagination
 * Supports search (order_number, customer_name, customer_email, customer_phone),
 * fulfillment_status, payment_status, and pagination.
 */
const getOrders = async ({
  search,
  fulfillment_status,
  payment_status,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  if (fulfillment_status && String(fulfillment_status).trim()) {
    conditions.push('o.fulfillment_status = ?');
    params.push(String(fulfillment_status).trim().toUpperCase());
  }

  if (payment_status && String(payment_status).trim()) {
    conditions.push('o.payment_status = ?');
    params.push(String(payment_status).trim().toLowerCase());
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ?)');
    params.push(term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM orders o ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const query = `
    SELECT 
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.customer_email,
      o.customer_phone,
      o.shipping_address,
      o.payment_method,
      o.payment_status,
      o.fulfillment_status,
      o.subtotal,
      o.discount_total,
      o.shipping_charge,
      o.total_price,
      o.coupon_code,
      o.courier,
      o.tracking_no,
      o.ship_date,
      o.ship_notes,
      o.created_at,
      o.updated_at
    FROM orders o
    ${whereClause}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const orders = rows.map(r => {
    const totalPricePaise = parseInt(r.total_price, 10) || 0;
    return {
      ...r,
      shipping_address: safeJsonParse(r.shipping_address, null),
      total_price_rupees: Math.round(totalPricePaise / 100)
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    orders
  };
};

/**
 * Fetch a single order by BIGINT ID or order_number string with line items.
 */
const getOrderById = async (orderIdOrNumber) => {
  if (!orderIdOrNumber) return null;

  const numId = parseInt(orderIdOrNumber, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(orderIdOrNumber);

  const orderQuery = `
    SELECT 
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.customer_email,
      o.customer_phone,
      o.shipping_address,
      o.payment_method,
      o.payment_status,
      o.fulfillment_status,
      o.subtotal,
      o.discount_total,
      o.shipping_charge,
      o.total_price,
      o.coupon_code,
      o.courier,
      o.tracking_no,
      o.ship_date,
      o.ship_notes,
      o.created_at,
      o.updated_at
    FROM orders o
    WHERE ${isNumeric ? 'o.id = ?' : 'o.order_number = ?'}
    LIMIT 1
  `;

  const param = isNumeric ? numId : String(orderIdOrNumber).trim();
  const [orderRows] = await pool.execute(orderQuery, [param]);

  if (!orderRows || orderRows.length === 0) {
    return null;
  }

  const order = orderRows[0];
  const numOrderId = order.id;

  order.shipping_address = safeJsonParse(order.shipping_address, null);

  const totalPricePaise = parseInt(order.total_price, 10) || 0;
  order.total_price_rupees = Math.round(totalPricePaise / 100);

  // Fetch Order Items
  const itemsQuery = `
    SELECT 
      id,
      order_id,
      product_id,
      variant_id,
      product_name,
      sku,
      variant_options,
      unit_price,
      quantity,
      total_price,
      admin_product_id_snapshot,
      production_status,
      created_at
    FROM order_items
    WHERE order_id = ?
    ORDER BY id ASC
  `;

  const [itemRows] = await pool.execute(itemsQuery, [numOrderId]);

  order.items = itemRows.map(item => ({
    ...item,
    variant_options: safeJsonParse(item.variant_options, null),
    unit_price_rupees: Math.round((parseInt(item.unit_price, 10) || 0) / 100),
    total_price_rupees: Math.round((parseInt(item.total_price, 10) || 0) / 100)
  }));

  return order;
};

/**
 * Update order fulfillment_status with strict validation
 */
const updateOrderStatus = async (id, status) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid order ID format. Expected numeric BIGINT ID.');
  }

  const normalizedStatus = String(status || '').trim().toUpperCase();

  if (!ALLOWED_FULFILLMENT_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid fulfillment status. Allowed values: ${ALLOWED_FULFILLMENT_STATUSES.join(', ')}`);
  }

  const existing = await getOrderById(numId);
  if (!existing) {
    return null;
  }

  const query = 'UPDATE orders SET fulfillment_status = ? WHERE id = ?';
  await pool.execute(query, [normalizedStatus, numId]);

  return getOrderById(numId);
};

/**
 * Update order courier shipping tracking details
 */
const updateOrderShipping = async (id, shippingData = {}) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid order ID format. Expected numeric BIGINT ID.');
  }

  const existing = await getOrderById(numId);
  if (!existing) {
    return null;
  }

  const { courier, tracking_no, ship_date, ship_notes } = shippingData;

  const safeCourier = courier !== undefined ? (courier && String(courier).trim() ? String(courier).trim() : null) : existing.courier;
  const safeTrackingNo = tracking_no !== undefined ? (tracking_no && String(tracking_no).trim() ? String(tracking_no).trim() : null) : existing.tracking_no;
  
  let safeShipDate = existing.ship_date;
  if (ship_date !== undefined) {
    if (ship_date) {
      const parsedDate = new Date(ship_date);
      safeShipDate = !isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : String(ship_date).trim().slice(0, 10);
    } else {
      safeShipDate = null;
    }
  }

  const safeShipNotes = ship_notes !== undefined ? (ship_notes && String(ship_notes).trim() ? String(ship_notes).trim() : null) : existing.ship_notes;

  const query = `
    UPDATE orders 
    SET courier = ?, tracking_no = ?, ship_date = ?, ship_notes = ? 
    WHERE id = ?
  `;

  await pool.execute(query, [safeCourier, safeTrackingNo, safeShipDate, safeShipNotes, numId]);

  return getOrderById(numId);
};

module.exports = {
  ALLOWED_FULFILLMENT_STATUSES,
  getOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderShipping
};
