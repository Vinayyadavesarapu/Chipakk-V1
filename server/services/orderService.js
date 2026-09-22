const { pool } = require('../config/database');
const couponService = require('./couponService');
const shippingService = require('./shippingService');
const settingsService = require('./settingsService');
const { isMarshansHybridCatalogEnabled } = require('../config/features');
const { normalizeIndianPhoneNumber } = require('../utils/phoneUtils');
const core = require('../utils/taxCore');
const taxUtils = require('../utils/taxUtils');
const taxProfileService = require('./taxProfileService');

let hasTaxColsCached = null;
const checkHasTaxCols = async () => {
  if (hasTaxColsCached !== null) return hasTaxColsCached;
  try {
    const [cols] = await pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'tax_amount'"
    );
    hasTaxColsCached = cols && cols.length > 0;
  } catch (_) {
    hasTaxColsCached = false;
  }
  return hasTaxColsCached;
};

/** Which of the optional GST configuration / snapshot columns exist yet (migration 017). */
const getTaxSchemaSupport = async (db) => {
  const support = { products: false, categories: false, marshans_products: false, marshans_categories: false, orderSnapshot: false, itemSplit: false };
  try {
    const [rows] = await db.execute(
      "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((COLUMN_NAME = 'hsn_code' AND TABLE_NAME IN ('products','categories','marshans_products','marshans_categories')) OR (TABLE_NAME = 'orders' AND COLUMN_NAME = 'supplier_gstin') OR (TABLE_NAME = 'order_items' AND COLUMN_NAME = 'taxable_value'))"
    );
    (rows || []).forEach((r) => {
      if (r.COLUMN_NAME === 'hsn_code' && support[r.TABLE_NAME] !== undefined) support[r.TABLE_NAME] = true;
      if (r.TABLE_NAME === 'orders' && r.COLUMN_NAME === 'supplier_gstin') support.orderSnapshot = true;
      if (r.TABLE_NAME === 'order_items' && r.COLUMN_NAME === 'taxable_value') support.itemSplit = true;
    });
  } catch (_) { /* treated as: nothing migrated */ }
  return support;
};

/**
 * Custom Sticker Tiers & Pricing Multipliers (Server Authoritative)
 */
const MIN_ITEM_QUANTITY = 1;
const MAX_ITEM_QUANTITY = 10000;
const MAX_ORDER_ITEMS = 50;
const MAX_ORDER_TOTAL_RUPEES = 50000;
const ALLOWED_PAYMENT_METHODS = ['COD', 'UPI', 'CARD', 'NETBANKING', 'ONLINE', 'WALLET'];

const CUSTOM_STICKER_TIERS = {
  10: 499,
  25: 899,
  50: 1499,
  100: 2499,
  250: 4999,
  500: 8499
};

const ALLOWED_CUT_TYPES = ['Die Cut', 'Kiss Cut', 'Holographic', 'Clear Vinyl', 'Clear'];
const ALLOWED_SIZES = ['2" x 2"', '3" x 3"', '4" x 4"'];
const ALLOWED_FINISHES = ['Glossy', 'Matte'];

const calculateAuthoritativeCustomStickerPrice = (customData) => {
  if (!customData || typeof customData !== 'object') {
    const err = new Error('Custom design specifications are required for custom stickers.');
    err.statusCode = 400;
    throw err;
  }

  const qty = parseInt(customData.quantity, 10);
  if (!CUSTOM_STICKER_TIERS[qty]) {
    const err = new Error(`Invalid custom sticker quantity tier: ${customData.quantity}. Allowed tiers are 10, 25, 50, 100, 250, 500.`);
    err.statusCode = 400;
    throw err;
  }

  const cutType = customData.cutType || 'Die Cut';
  if (!ALLOWED_CUT_TYPES.includes(cutType)) {
    const err = new Error(`Invalid custom sticker cut type: ${cutType}. Allowed types: ${ALLOWED_CUT_TYPES.join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }

  const size = customData.size || '3" x 3"';
  if (!ALLOWED_SIZES.includes(size)) {
    const err = new Error(`Invalid custom sticker size: ${size}. Allowed sizes: ${ALLOWED_SIZES.join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }

  if (customData.finish && !ALLOWED_FINISHES.includes(customData.finish)) {
    const err = new Error(`Invalid custom sticker finish: ${customData.finish}. Allowed finishes: ${ALLOWED_FINISHES.join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }

  let basePrice = CUSTOM_STICKER_TIERS[qty];

  // Cut type multiplier
  if (cutType === 'Holographic') {
    basePrice = Math.round(basePrice * 1.25);
  } else if (cutType === 'Clear Vinyl' || cutType === 'Clear') {
    basePrice = Math.round(basePrice * 1.15);
  }

  // Size multiplier
  if (size === '4" x 4"') {
    basePrice = Math.round(basePrice * 1.2);
  }

  return basePrice;
};

let hasMarshansColInOrderItems = null;
const checkHasMarshansOrderCol = async (conn = pool) => {
  if (hasMarshansColInOrderItems !== null) return hasMarshansColInOrderItems;
  try {
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'marshans_product_id'"
    );
    hasMarshansColInOrderItems = cols && cols.length > 0;
  } catch (_) {
    hasMarshansColInOrderItems = false;
  }
  return hasMarshansColInOrderItems;
};

/**
 * Approved Fulfillment Statuses (Strict Uppercase Machine Values)
 */
const ALLOWED_FULFILLMENT_STATUSES = [
  'NEW',
  'ORDER PLACED',
  'CONFIRMED',
  'ORDER CONFIRMED',
  'PROCESSING',
  'PREPARING',
  'QUALITY CHECK',
  'QUALITY_CHECK',
  'READY',
  'READY_TO_SHIP',
  'PACKED',
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

let hasHistoryTable = null;
const checkHasHistoryTable = async (connection = pool) => {
  if (hasHistoryTable !== null) return hasHistoryTable;
  try {
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_status_history'"
    );
    hasHistoryTable = tables && tables.length > 0;
  } catch (err) {
    hasHistoryTable = false;
  }
  return hasHistoryTable;
};

/**
 * Automatically record a chronological status history transition
 */
const recordOrderStatusHistory = async (orderId, status, { changed_by = 'System', note = null } = {}, connection = pool) => {
  try {
    const hasTable = await checkHasHistoryTable(connection);
    if (!hasTable) return;
    await connection.execute(
      'INSERT INTO order_status_history (order_id, status, changed_by, note, created_at) VALUES (?, ?, ?, ?, NOW())',
      [orderId, String(status).trim(), changed_by || 'System', note || null]
    );
  } catch (err) {
    console.warn('[OrderStatusHistory Warning]', err.message);
  }
};

/**
 * Retrieve chronological status history timeline for an order
 */
const getOrderStatusHistory = async (orderId, connection = pool) => {
  try {
    const hasTable = await checkHasHistoryTable(connection);
    if (!hasTable) return [];
    const [rows] = await connection.execute(
      'SELECT id, order_id, status, changed_by, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC, id ASC',
      [orderId]
    );
    return rows.map(r => ({
      id: r.id,
      status: r.status,
      changed_by: r.changed_by,
      actor: r.changed_by,
      note: r.note,
      created_at: r.created_at,
      timestamp: r.created_at
    }));
  } catch (err) {
    console.warn('[OrderStatusHistory Fetch Error]', err.message);
    return [];
  }
};

/**
 * Fetch list of orders with filters & pagination
 * Supports search (order_number, customer_name, customer_email, customer_phone),
 * fulfillment_status, payment_status, store_id, and pagination.
 */
const getOrders = async ({
  search,
  fulfillment_status,
  payment_status,
  store_id = null,
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

  if (store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
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

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, "$.phone")), "") LIKE ?)');
    params.push(term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM orders o ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const hasTax = await checkHasTaxCols();

  const query = `
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.customer_email,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')), '') AS customer_phone,
      o.shipping_address,
      o.payment_method,
      o.payment_status,
      o.fulfillment_status,
      o.subtotal,
      o.discount_total,
      o.shipping_charge,
      ${hasTax ? 'COALESCE(o.tax_amount, 0) AS tax_amount, COALESCE(o.cgst_amount, 0) AS cgst_amount, COALESCE(o.sgst_amount, 0) AS sgst_amount, COALESCE(o.igst_amount, 0) AS igst_amount, COALESCE(o.shipping_method, "standard") AS shipping_method,' : '0 AS tax_amount, 0 AS cgst_amount, 0 AS sgst_amount, 0 AS igst_amount, "standard" AS shipping_method,'}
      o.total_price,
      o.coupon_code,
      o.courier,
      o.tracking_no,
      o.ship_date,
      o.ship_notes,
      COALESCE(o.store_id, 1) AS store_id,
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
    const isStore2 = parseInt(r.store_id, 10) === 2;
    const rawTotalPrice = parseInt(r.total_price, 10) || 0;
    const rawSubtotal = parseInt(r.subtotal, 10) || 0;
    const rawDiscount = parseInt(r.discount_total, 10) || 0;
    const rawShipping = parseInt(r.shipping_charge, 10) || 0;
    const rawTax = parseInt(r.tax_amount, 10) || 0;
    const rawCgst = parseInt(r.cgst_amount, 10) || 0;
    const rawSgst = parseInt(r.sgst_amount, 10) || 0;
    const rawIgst = parseInt(r.igst_amount, 10) || 0;

    const totalPriceRupees = isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice;
    const taxRupees = isStore2 ? Math.round(rawTax / 100) : rawTax;

    return {
      ...r,
      shipping_address: safeJsonParse(r.shipping_address, null),
      total_price_rupees: totalPriceRupees,
      subtotal_rupees: isStore2 ? Math.round(rawSubtotal / 100) : rawSubtotal,
      discount_total_rupees: isStore2 ? Math.round(rawDiscount / 100) : rawDiscount,
      shipping_charge_rupees: isStore2 ? Math.round(rawShipping / 100) : rawShipping,
      tax_amount: 0,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: 0,
      tax_amount_rupees: 0,
      cgst_amount_rupees: 0,
      sgst_amount_rupees: 0,
      igst_amount_rupees: 0,
      taxable_amount_rupees: totalPriceRupees,
      shipping_method: r.shipping_method || 'standard'
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
const getOrderById = async (orderIdOrNumber, storeId = null) => {
  if (!orderIdOrNumber) return null;

  const numId = parseInt(orderIdOrNumber, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(orderIdOrNumber);

  const params = [isNumeric ? numId : String(orderIdOrNumber).trim()];
  let storeCondition = '';
  if (storeId !== null && storeId !== undefined && String(storeId).trim() !== '') {
    const sId = parseInt(storeId, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        storeCondition = ' AND (o.store_id = 1 OR o.store_id IS NULL)';
      } else {
        storeCondition = ' AND o.store_id = ?';
        params.push(sId);
      }
    }
  }

  const hasTax = await checkHasTaxCols();

  const orderQuery = `
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.customer_email,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')), '') AS customer_phone,
      o.shipping_address,
      o.payment_method,
      o.payment_status,
      o.fulfillment_status,
      o.subtotal,
      o.discount_total,
      o.shipping_charge,
      ${hasTax ? 'COALESCE(o.tax_amount, 0) AS tax_amount, COALESCE(o.cgst_amount, 0) AS cgst_amount, COALESCE(o.sgst_amount, 0) AS sgst_amount, COALESCE(o.igst_amount, 0) AS igst_amount, COALESCE(o.shipping_method, "standard") AS shipping_method,' : '0 AS tax_amount, 0 AS cgst_amount, 0 AS sgst_amount, 0 AS igst_amount, "standard" AS shipping_method,'}
      o.total_price,
      o.coupon_code,
      o.courier,
      o.tracking_no,
      o.ship_date,
      o.ship_notes,
      COALESCE(o.store_id, 1) AS store_id,
      o.created_at,
      o.updated_at
    FROM orders o
    WHERE ${isNumeric ? 'o.id = ?' : 'o.order_number = ?'}${storeCondition}
    LIMIT 1
  `;

  const [orderRows] = await pool.execute(orderQuery, params);

  if (!orderRows || orderRows.length === 0) {
    return null;
  }

  const order = orderRows[0];
  const numOrderId = order.id;

  order.shipping_address = safeJsonParse(order.shipping_address, null);

  const isStore2 = parseInt(order.store_id, 10) === 2;
  const rawTotalPrice = parseInt(order.total_price, 10) || 0;
  const rawSubtotal = parseInt(order.subtotal, 10) || 0;
  const rawDiscount = parseInt(order.discount_total, 10) || 0;
  const rawShipping = parseInt(order.shipping_charge, 10) || 0;
  const rawTax = parseInt(order.tax_amount, 10) || 0;
  const rawCgst = parseInt(order.cgst_amount, 10) || 0;
  const rawSgst = parseInt(order.sgst_amount, 10) || 0;
  const rawIgst = parseInt(order.igst_amount, 10) || 0;

  order.total_price_rupees = isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice;
  order.subtotal_rupees = isStore2 ? Math.round(rawSubtotal / 100) : rawSubtotal;
  order.discount_total_rupees = isStore2 ? Math.round(rawDiscount / 100) : rawDiscount;
  order.shipping_charge_rupees = isStore2 ? Math.round(rawShipping / 100) : rawShipping;
  order.tax_amount = 0;
  order.cgst_amount = 0;
  order.sgst_amount = 0;
  order.igst_amount = 0;
  order.tax_amount_rupees = 0;
  order.cgst_amount_rupees = 0;
  order.sgst_amount_rupees = 0;
  order.igst_amount_rupees = 0;
  order.taxable_amount_rupees = order.total_price_rupees;
  order.shipping_method = order.shipping_method || 'standard';

  // Fetch Order Items with product image
  const hasMarshansProductCol = await checkHasMarshansOrderCol();
  const itemsQuery = `
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      ${hasMarshansProductCol ? 'oi.marshans_product_id,' : 'NULL AS marshans_product_id,'}
      oi.variant_id,
      oi.product_name,
      oi.sku,
      oi.variant_options,
      oi.unit_price,
      oi.quantity,
      oi.total_price,
      ${hasTax ? 'oi.hsn_code AS hsn_code, oi.tax_rate AS tax_rate, COALESCE(oi.tax_amount, 0) AS tax_amount,' : 'NULL AS hsn_code, NULL AS tax_rate, 0 AS tax_amount,'}
      oi.admin_product_id_snapshot,
      oi.production_status,
      oi.created_at,
      COALESCE(
        (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1),
        ${hasMarshansProductCol ? '(SELECT image_url FROM marshans_product_images WHERE product_id = oi.marshans_product_id ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1),' : ''}
        NULL
      ) AS product_image
    FROM order_items oi
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
  `;

  const [itemRows] = await pool.execute(itemsQuery, [numOrderId]);

  // Fetch any linked custom designs/artwork
  let customDesignsByItem = {};
  if (itemRows.length > 0) {
    try {
      const placeholders = itemRows.map(() => '?').join(',');
      const itemIds = itemRows.map(i => i.id);
      const [designRows] = await pool.execute(`
        SELECT id, order_item_id, file_role, storage_path, image_url, original_filename, verification_status
        FROM order_item_custom_designs
        WHERE order_item_id IN (${placeholders})
      `, itemIds);

      designRows.forEach(d => {
        if (!customDesignsByItem[d.order_item_id]) customDesignsByItem[d.order_item_id] = [];
        customDesignsByItem[d.order_item_id].push(d);
      });
    } catch (err) {
      // Ignore if table does not exist or empty
    }
  }

  order.items = itemRows.map(item => ({
    ...item,
    product_id: item.marshans_product_id || item.product_id,
    marshans_product_id: item.marshans_product_id || null,
    img: item.product_image || null,
    custom_designs: customDesignsByItem[item.id] || [],
    variant_options: safeJsonParse(item.variant_options, null),
    unit_price_rupees: isStore2 ? Math.round((parseInt(item.unit_price, 10) || 0) / 100) : (parseInt(item.unit_price, 10) || 0),
    total_price_rupees: isStore2 ? Math.round((parseInt(item.total_price, 10) || 0) / 100) : (parseInt(item.total_price, 10) || 0),
    // GST is inactive: tax rates and amounts are suppressed
    hsn_code: null,
    tax_rate: null,
    tax_amount: 0,
    tax_amount_rupees: 0,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0
  }));

  // Attach status history timeline
  order.status_history = await getOrderStatusHistory(numOrderId);

  return order;
};

/**
 * Update order fulfillment_status with strict validation and audit timeline
 */
const updateOrderStatus = async (id, status, options = {}) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid order ID format. Expected numeric BIGINT ID.');
  }

  const normalizedStatus = String(status || '').trim().toUpperCase();

  if (!ALLOWED_FULFILLMENT_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid fulfillment status. Allowed values: ${ALLOWED_FULFILLMENT_STATUSES.join(', ')}`);
  }

  const existing = await getOrderById(numId, options.store_id);
  if (!existing) {
    return null;
  }

  const query = 'UPDATE orders SET fulfillment_status = ? WHERE id = ?';
  await pool.execute(query, [normalizedStatus, numId]);

  if (normalizedStatus === 'CANCELLED') {
    try {
      await pool.execute(
        "UPDATE coupon_usage SET status = 'released' WHERE order_id = ? AND status = 'reserved'",
        [numId]
      );
    } catch (_) {}
  }

  // Record status history transition
  await recordOrderStatusHistory(numId, normalizedStatus, {
    changed_by: options.changed_by || 'Admin',
    note: options.note || `Status changed from ${existing.fulfillment_status} to ${normalizedStatus}`
  });

  return getOrderById(numId, options.store_id);
};

/**
 * Update order courier shipping tracking details
 */
const updateOrderShipping = async (id, shippingData = {}, storeId = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid order ID format. Expected numeric BIGINT ID.');
  }

  const existing = await getOrderById(numId, storeId);
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

  return getOrderById(numId, storeId);
};

/**
 * Helper to find or create customer record in users table linked to Firebase UID
 */
const upsertCustomerUser = async (firebaseUser, connection = pool) => {
  const { uid, email, name, phone } = firebaseUser;
  if (!uid) {
    throw new Error('Firebase UID is required to identify customer.');
  }

  const [existingRows] = await connection.execute(
    'SELECT id, firebase_uid, email FROM users WHERE firebase_uid = ? LIMIT 1',
    [uid]
  );

  if (existingRows && existingRows.length > 0) {
    return existingRows[0].id;
  }

  // Insert new user; support either name or full_name column seamlessly
  try {
    const [insertRes] = await connection.execute(
      'INSERT INTO users (firebase_uid, email, full_name, phone) VALUES (?, ?, ?, ?)',
      [uid, email || '', name || null, phone || null]
    );
    return insertRes.insertId;
  } catch (err) {
    if (err.message && (err.message.includes("Unknown column 'full_name'") || err.code === 'ER_BAD_FIELD_ERROR')) {
      const [fallbackRes] = await connection.execute(
        'INSERT INTO users (firebase_uid, email, name, phone) VALUES (?, ?, ?, ?)',
        [uid, email || '', name || null, phone || null]
      );
      return fallbackRes.insertId;
    }
    throw err;
  }
};

/**
 * Create a new customer order with atomic MySQL transaction & server-side validation
 */
const createCustomerOrder = async (orderPayload, firebaseUser) => {
  if (!firebaseUser || !firebaseUser.uid) {
    const err = new Error('Authentication required to place an order.');
    err.statusCode = 401;
    throw err;
  }

  const {
    items,
    shipping_address,
    coupon_code,
    payment_method = 'COD'
  } = orderPayload || {};

  // 1. Validate items array or cart_id
  if ((!items || !Array.isArray(items) || items.length === 0) && !orderPayload?.cart_id) {
    const err = new Error('Order must contain at least one item.');
    err.statusCode = 400;
    throw err;
  }

  // 2. Validate shipping address
  if (!shipping_address || typeof shipping_address !== 'object') {
    const err = new Error('Valid delivery address is required.');
    err.statusCode = 400;
    throw err;
  }

  const {
    name: recipientName,
    phone: recipientPhone,
    address: streetAddress,
    city,
    state,
    pincode,
    country = 'India'
  } = shipping_address;

  if (!recipientName || typeof recipientName !== 'string' || recipientName.trim().length < 2) {
    const err = new Error('Recipient name is required.');
    err.statusCode = 400;
    throw err;
  }

  const phoneValidation = normalizeIndianPhoneNumber(recipientPhone);
  if (!phoneValidation.valid) {
    const err = new Error('Valid 10-digit mobile phone number is required.');
    err.statusCode = 400;
    throw err;
  }
  const cleanPhone = phoneValidation.phone;

  if (!streetAddress || typeof streetAddress !== 'string' || streetAddress.trim().length < 5) {
    const err = new Error('Complete street address is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!city || typeof city !== 'string' || city.trim().length < 2) {
    const err = new Error('City is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!state || typeof state !== 'string' || state.trim().length < 2) {
    const err = new Error('State is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanPin = String(pincode || '').trim();
  if (!cleanPin || !/^\d{6}$/.test(cleanPin)) {
    const err = new Error('Valid 6-digit postal PIN code is required.');
    err.statusCode = 400;
    throw err;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 3. Upsert customer in users table
    const customerId = await upsertCustomerUser({
      uid: firebaseUser.uid,
      email: firebaseUser.email || shipping_address.email || '',
      name: recipientName.trim(),
      phone: cleanPhone
    }, connection);

    const activeStoreId = parseInt(orderPayload?.store_id, 10) === 2 ? 2 : 1;
    if (activeStoreId === 2 && !isMarshansHybridCatalogEnabled()) {
      const err = new Error('THE MARSHANS store catalog is currently unavailable.');
      err.statusCode = 400;
      throw err;
    }
    const isHybridMarshans = isMarshansHybridCatalogEnabled() && activeStoreId === 2;

    // GST identity first: without a valid registered supplier a tax snapshot would be wrong and unfixable later,
    // so the order is refused (503) instead of being written with invented supplier data.
    const taxProfile = await taxProfileService.getTaxProfile(activeStoreId);
    taxProfileService.assertCheckoutReady(taxProfile);
    const customerStateCode = core.resolveStateCode(state);
    if (taxProfile.gst_enabled && !customerStateCode) {
      const err = new Error('Please enter a valid Indian state or union territory for delivery (it decides how GST is applied).');
      err.statusCode = 400;
      throw err;
    }
    let recipientGstin = null;
    const rawRecipientGstin = orderPayload?.recipient_gstin || orderPayload?.gstin || shipping_address?.gstin;
    if (rawRecipientGstin) {
      const rg = taxUtils.validateGstin(String(rawRecipientGstin));
      if (!rg.valid) {
        const err = new Error(`Buyer GSTIN is not valid: ${rg.reason}`);
        err.statusCode = 400;
        throw err;
      }
      recipientGstin = rg.gstin;
    }
    const taxSupport = await getTaxSchemaSupport(connection);

    // Resolve items from cart if cart_id is provided and items is empty or omitted
    let orderItems = items;
    if ((!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) && orderPayload?.cart_id) {
      const numCartId = parseInt(orderPayload.cart_id, 10);
      if (isNaN(numCartId)) {
        const err = new Error('Invalid cart ID.');
        err.statusCode = 400;
        throw err;
      }

      // Verify cart existence and ownership
      const [cRows] = await connection.execute(
        'SELECT id, user_id, store_id, session_id, status FROM carts WHERE id = ? LIMIT 1',
        [numCartId]
      );
      if (!cRows || cRows.length === 0) {
        const err = new Error('Cart not found.');
        err.statusCode = 404;
        throw err;
      }

      const cartRec = cRows[0];
      if (cartRec.status !== 'active') {
        const err = new Error('Cart is no longer active.');
        err.statusCode = 400;
        throw err;
      }

      if (parseInt(cartRec.store_id, 10) !== activeStoreId) {
        const err = new Error('Cart does not belong to the active store.');
        err.statusCode = 400;
        throw err;
      }

      if (!cartRec.user_id || parseInt(cartRec.user_id, 10) !== parseInt(customerId, 10)) {
        const err = new Error("Access denied: Cannot checkout another customer's cart.");
        err.statusCode = 403;
        throw err;
      }

      const [cItems] = await connection.execute(
        'SELECT product_id, marshans_product_id, variant_id, quantity FROM cart_items WHERE cart_id = ?',
        [numCartId]
      );

      if (!cItems || cItems.length === 0) {
        const err = new Error('Cart is empty.');
        err.statusCode = 400;
        throw err;
      }

      // Enforce cart item invariants
      for (const ci of cItems) {
        if (isHybridMarshans) {
          if (ci.product_id !== null && ci.product_id !== undefined) {
            const err = new Error('Corrupt cart item: CHIPAKK product found in MARSHANS cart.');
            err.statusCode = 400;
            throw err;
          }
          if (!ci.marshans_product_id) {
            const err = new Error('Corrupt cart item: Missing MARSHANS product ID in cart item.');
            err.statusCode = 400;
            throw err;
          }
        } else {
          if (ci.marshans_product_id !== null && ci.marshans_product_id !== undefined) {
            const err = new Error('Corrupt cart item: MARSHANS product found in CHIPAKK cart.');
            err.statusCode = 400;
            throw err;
          }
          if (!ci.product_id) {
            const err = new Error('Corrupt cart item: Missing product ID in CHIPAKK cart item.');
            err.statusCode = 400;
            throw err;
          }
        }
      }

      orderItems = cItems.map(ci => ({
        product_id: isHybridMarshans ? ci.marshans_product_id : ci.product_id,
        variant_id: ci.variant_id,
        quantity: ci.quantity
      }));
    }

    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      const err = new Error('Order must contain at least one item.');
      err.statusCode = 400;
      throw err;
    }

    if (orderItems.length > MAX_ORDER_ITEMS) {
      const err = new Error(`Order cannot exceed ${MAX_ORDER_ITEMS} items.`);
      err.statusCode = 400;
      throw err;
    }

    // 4. Server-side validation of cart items & price lookup
    let subtotalPaise = 0;
    const validatedItems = [];

    for (const item of orderItems) {
      const rawQty = item.quantity !== undefined ? item.quantity : item.qty;
      const parsedQty = typeof rawQty === 'number'
        ? rawQty
        : (typeof rawQty === 'string' && /^\d+$/.test(rawQty.trim()) ? parseInt(rawQty.trim(), 10) : NaN);

      if (!Number.isInteger(parsedQty) || parsedQty < MIN_ITEM_QUANTITY || parsedQty > MAX_ITEM_QUANTITY) {
        const err = new Error(`Item quantity must be an integer between ${MIN_ITEM_QUANTITY} and ${MAX_ITEM_QUANTITY}.`);
        err.statusCode = 400;
        throw err;
      }
      const qty = parsedQty;

      // Support Custom Sticker Packs (print-on-demand)
      const isCustomItem = Boolean(item.is_custom || (!item.product_id && (item.name || item.product_name)));
      if (isCustomItem) {
        if (activeStoreId !== 1) {
          const err = new Error('Custom stickers are only available for CHIPAKK (Store 1).');
          err.statusCode = 400;
          throw err;
        }

        const customPrice = calculateAuthoritativeCustomStickerPrice(item.custom_design_data);
        const lineTotal = customPrice * qty;
        subtotalPaise += lineTotal;

        const spec = item.custom_design_data;
        const cutType = spec.cutType || 'Die Cut';
        const size = spec.size || '3" x 3"';
        const finish = spec.finish || 'Glossy';
        const packQty = parseInt(spec.quantity, 10);

        const customName = `Custom ${cutType} Stickers (${packQty} pcs)`;
        const customSku = `SKU-CUSTOM-${packQty}-${String(cutType).toUpperCase().replace(/[^A-Z0-9]/g, '-')}`;
        const customVariantOptions = JSON.stringify({
          cutType,
          size,
          finish,
          pack_quantity: packQty
        });

        validatedItems.push({
          product_id: null,
          marshans_product_id: null,
          variant_id: null,
          product_name: customName.slice(0, 255),
          sku: customSku.slice(0, 100),
          admin_product_id_snapshot: 'CUSTOM-POD',
          variant_options: customVariantOptions,
          unit_price: customPrice,
          quantity: qty,
          total_price: lineTotal,
          // custom stickers have no catalogue record: their HSN/rate come from explicit store settings, else unset
          tax_cfg: { hsn: taxProfile.custom_item_hsn || null, hsn_source: taxProfile.custom_item_hsn ? 'store_setting' : 'unset',
            rate: taxProfile.custom_item_gst_rate !== null && taxProfile.custom_item_gst_rate !== undefined ? taxProfile.custom_item_gst_rate : taxProfile.default_gst_rate,
            rate_source: taxProfile.custom_item_gst_rate !== null && taxProfile.custom_item_gst_rate !== undefined ? 'store_setting' : 'store_default' },
          custom_design_data: {
            storagePath: typeof spec.storagePath === 'string' ? spec.storagePath.slice(0, 255) : '',
            uploadedPreviewUrl: (typeof spec.uploadedPreviewUrl === 'string' && !spec.uploadedPreviewUrl.startsWith('data:')) ? spec.uploadedPreviewUrl.slice(0, 1024) : '',
            fileName: typeof spec.fileName === 'string' ? spec.fileName.slice(0, 255) : 'custom-artwork.png'
          }
        });
        continue;
      }

      const productId = parseInt(item.product_id || item.id, 10);

      if (isNaN(productId)) {
        const err = new Error('Invalid product ID in order items.');
        err.statusCode = 400;
        throw err;
      }

      let product;
      let unitPricePaise = 0;
      let itemSku = '';
      let variantId = null;
      let variantOptions = null;

      if (isHybridMarshans) {
        // Fetch active Store 2 product from marshans_products
        const mpCols = taxSupport.marshans_products ? ', p.hsn_code, p.gst_rate' : '';
        const mcCols = taxSupport.marshans_categories ? ', c.hsn_code AS category_hsn_code, c.gst_rate AS category_gst_rate' : '';
        const [prodRows] = (mpCols || mcCols)
          ? await connection.execute(
            `SELECT p.id, p.name, p.sku, p.price, p.active, p.admin_product_id${mpCols}${mcCols} FROM marshans_products p${mcCols ? ' LEFT JOIN marshans_categories c ON c.id = p.category_id' : ''} WHERE p.id = ? AND p.store_id = 2 LIMIT 1`,
            [productId]
          )
          : await connection.execute(
            'SELECT id, name, sku, price, active, admin_product_id FROM marshans_products WHERE id = ? AND store_id = 2 LIMIT 1',
            [productId]
          );

        if (!prodRows || prodRows.length === 0 || !prodRows[0].active) {
          const err = new Error(`Product #${productId} is invalid or no longer available in THE MARSHANS catalog.`);
          err.statusCode = 400;
          throw err;
        }

        product = prodRows[0];
        unitPricePaise = parseInt(product.price, 10) || 0;
        itemSku = product.sku;
      } else {
        // Fetch active Store 1 product from products
        const pCols = taxSupport.products ? ', p.hsn_code, p.gst_rate' : '';
        const cCols = taxSupport.categories ? ', c.hsn_code AS category_hsn_code, c.gst_rate AS category_gst_rate' : '';
        const [prodRows] = (pCols || cCols)
          ? await connection.execute(
            `SELECT p.id, p.name, p.sku, p.price, p.active, p.admin_product_id, p.store_id${pCols}${cCols} FROM products p${cCols ? ' LEFT JOIN categories c ON c.id = p.category_id' : ''} WHERE p.id = ? AND (p.store_id = 1 OR p.store_id IS NULL) LIMIT 1`,
            [productId]
          )
          : await connection.execute(
            'SELECT id, name, sku, price, active, admin_product_id, store_id FROM products WHERE id = ? AND (store_id = 1 OR store_id IS NULL) LIMIT 1',
            [productId]
          );

        if (!prodRows || prodRows.length === 0 || !prodRows[0].active) {
          const err = new Error(`Product #${productId} is invalid or no longer available.`);
          err.statusCode = 400;
          throw err;
        }

        product = prodRows[0];
        if (product.store_id && parseInt(product.store_id, 10) === 2) {
          const err = new Error(`Product #${productId} does not belong to CHIPAKK store.`);
          err.statusCode = 400;
          throw err;
        }

        unitPricePaise = parseInt(product.price, 10) || 0;
        itemSku = product.sku;

        // Validate variant if provided
        const rawVariantId = item.variant_id;
        if (rawVariantId) {
          const numVariantId = parseInt(rawVariantId, 10);
          if (!isNaN(numVariantId)) {
            const [variantRows] = await connection.execute(
              'SELECT id, product_id, sku, price, option_combination, active FROM product_variants WHERE id = ? AND product_id = ? LIMIT 1',
              [numVariantId, productId]
            );

            if (!variantRows || variantRows.length === 0 || !variantRows[0].active) {
              const err = new Error(`Variant #${numVariantId} is invalid or no longer available for product "${product.name}".`);
              err.statusCode = 400;
              throw err;
            }

            const variant = variantRows[0];
            variantId = variant.id;
            unitPricePaise = parseInt(variant.price, 10) || 0;
            if (variant.sku) itemSku = variant.sku;
            variantOptions = typeof variant.option_combination === 'string'
              ? variant.option_combination
              : JSON.stringify(variant.option_combination);
          }
        }
      }

      if (unitPricePaise <= 0) {
        const err = new Error(`Product #${productId} has an invalid price.`);
        err.statusCode = 400;
        throw err;
      }

      const lineTotalPaise = unitPricePaise * qty;
      subtotalPaise += lineTotalPaise;

      validatedItems.push({
        product_id: isHybridMarshans ? null : product.id,
        marshans_product_id: isHybridMarshans ? product.id : null,
        variant_id: variantId,
        product_name: product.name,
        sku: itemSku,
        admin_product_id_snapshot: product.admin_product_id || null,
        variant_options: variantOptions,
        unit_price: unitPricePaise,
        quantity: qty,
        total_price: lineTotalPaise,
        tax_cfg: taxProfileService.resolveLineTaxConfig(product, taxProfile)
      });
    }

    // 5. Server-side coupon validation (store-scoped) with row locking
    let discountPaise = 0;
    let validatedCoupon = null;

    if (coupon_code && String(coupon_code).trim()) {
      const codeStr = String(coupon_code).trim().toUpperCase();

      // Lock the coupon row FOR UPDATE within this active transaction to eliminate race conditions
      let lockedCoupon = null;
      try {
        const [lockedRows] = await connection.execute(
          'SELECT * FROM coupons WHERE UPPER(code) = ? AND (store_id = ? OR (store_id IS NULL AND ? = 1)) LIMIT 1 FOR UPDATE',
          [codeStr, activeStoreId, activeStoreId]
        );
        if (lockedRows && lockedRows.length > 0) lockedCoupon = lockedRows[0];
      } catch (lockErr) {
        // Falls back to an unlocked read (still validated below); make the degradation visible.
        console.warn('[Order] Coupon row lock unavailable, validating without FOR UPDATE:', lockErr.message);
      }

      const couponCheck = await couponService.validateCoupon(codeStr, subtotalPaise, activeStoreId, customerId, null, lockedCoupon);

      if (!couponCheck.valid) {
        const err = new Error(couponCheck.message || 'Invalid coupon code.');
        err.statusCode = 400;
        throw err;
      }

      validatedCoupon = couponCheck.coupon;
      discountPaise = activeStoreId === 2 ? (validatedCoupon.discount_paise || 0) : (validatedCoupon.discount_rupees !== undefined ? validatedCoupon.discount_rupees : (validatedCoupon.discount_value || 0));
    }

    // 6. Server-side shipping fee calculation (store-scoped)
    // CRITICAL COMMERCIAL RULE: Free shipping eligibility is based strictly on the
    // GROSS MERCHANDISE SUBTOTAL (subtotalPaise) BEFORE any coupon/product discounts.
    const shippingCheck = await shippingService.calculateShippingFee({
      subtotal: subtotalPaise,
      region: state.trim(),
      storeId: activeStoreId
    });
    const shippingChargePaise = shippingCheck.shipping_fee || 0;

    // 7. Server-side GST and total calculation
    const discountedSubtotalPaise = Math.max(0, subtotalPaise - discountPaise);
    const totalPricePaise = discountedSubtotalPaise + shippingChargePaise;

    const maxTotal = activeStoreId === 2 ? (MAX_ORDER_TOTAL_RUPEES * 100) : MAX_ORDER_TOTAL_RUPEES;
    if (totalPricePaise > maxTotal) {
      const err = new Error(`Order total cannot exceed ₹${MAX_ORDER_TOTAL_RUPEES}.`);
      err.statusCode = 400;
      throw err;
    }

    const safePaymentMethod = ALLOWED_PAYMENT_METHODS.includes(String(payment_method || '').toUpperCase())
      ? String(payment_method).toUpperCase()
      : 'COD';

    // 7.1 Authoritative GST (inclusive): per-line HSN + rate snapshot, discount allocated across lines, shipping taxed
    //     as a composite supply, CGST+SGST vs IGST from supplier state vs place of supply. The storefront runs the
    //     identical core (taxCore.js), so what the customer sees is what is stored.
    const orderTax = core.computeOrderTax({
      lines: validatedItems.map((it, idx) => ({ key: idx, gross: it.total_price, rate: it.tax_cfg.rate, hsn: it.tax_cfg.hsn })),
      discount: discountPaise,
      shipping: shippingChargePaise,
      gstEnabled: taxProfile.gst_enabled,
      defaultRate: taxProfile.default_gst_rate,
      sellerState: taxProfile.seller_state_code,
      customerState: state.trim()
    });
    if (orderTax.totals.total_value !== totalPricePaise ||
        (taxProfile.gst_enabled && orderTax.supply_type === 'UNDETERMINED') ||
        orderTax.totals.taxable_value + orderTax.totals.tax !== totalPricePaise) {
      console.error('[GST] Tax computation did not reconcile with the order total', { totalPricePaise, totals: orderTax.totals, supply: orderTax.supply_type });
      const err = new Error('We could not complete the tax calculation for this order. Please try again.');
      err.statusCode = 500;
      throw err;
    }
    validatedItems.forEach((it, idx) => { it.tax = orderTax.lines[idx]; });
    const placeOfSupplyName = core.stateNameFromCode(orderTax.place_of_supply_code) || state.trim();

    // 8. Generate order number (CHP for CHIPAKK, MRSH for THE MARSHANS)
    const timestampPart = Date.now().toString().slice(-6);
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const orderPrefix = activeStoreId === 2 ? 'MRSH' : 'CHP';
    const orderNumber = `${orderPrefix}-${timestampPart}${randomPart}`;

    // 9. Shipping address snapshot JSON
    const shippingSnapshot = {
      name: recipientName.trim(),
      phone: cleanPhone,
      email: firebaseUser.email || shipping_address.email || '',
      address: streetAddress.trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: cleanPin,
      country: country ? country.trim() : 'India'
    };

    // 10. Insert into orders table (check for columns dynamically)
    let hasPhoneCol = false;
    let hasStoreIdCol = true;
    let hasTaxCols = false;
    let hasShippingMethodCol = false;

    try {
      const [orderCols] = await connection.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'"
      );
      const colNames = (orderCols || []).map(c => c.COLUMN_NAME.toLowerCase());
      hasPhoneCol = colNames.includes('customer_phone');
      hasStoreIdCol = colNames.includes('store_id');
      hasTaxCols = colNames.includes('tax_amount');
      hasShippingMethodCol = colNames.includes('shipping_method');
    } catch (e) { }
    const hasSnapshotCols = taxSupport.orderSnapshot;

    const orderColumns = [
      'order_number', 'customer_id', 'customer_email', 'customer_name'
    ];
    const orderPlaceholders = ['?', '?', '?', '?'];
    const orderParams = [
      orderNumber,
      customerId,
      shippingSnapshot.email,
      shippingSnapshot.name
    ];

    if (hasStoreIdCol) {
      orderColumns.push('store_id');
      orderPlaceholders.push('?');
      orderParams.push(activeStoreId);
    }

    if (hasPhoneCol) {
      orderColumns.push('customer_phone');
      orderPlaceholders.push('?');
      orderParams.push(shippingSnapshot.phone);
    }

    orderColumns.push('shipping_address');
    orderPlaceholders.push('?');
    orderParams.push(JSON.stringify(shippingSnapshot));

    if (hasShippingMethodCol) {
      orderColumns.push('shipping_method');
      orderPlaceholders.push('?');
      orderParams.push('standard');
    }

    orderColumns.push('payment_method', 'payment_status', 'fulfillment_status', 'subtotal', 'discount_total', 'shipping_charge');
    orderPlaceholders.push('?', "'pending'", "'pending'", '?', '?', '?');
    orderParams.push(
      safePaymentMethod,
      subtotalPaise,
      discountPaise,
      shippingChargePaise
    );

    if (hasTaxCols) {
      orderColumns.push('tax_amount', 'cgst_amount', 'sgst_amount', 'igst_amount');
      orderPlaceholders.push('?', '?', '?', '?');
      orderParams.push(
        orderTax.totals.tax,
        orderTax.totals.cgst,
        orderTax.totals.sgst,
        orderTax.totals.igst
      );
    }

    if (hasSnapshotCols) {
      orderColumns.push('supplier_legal_name', 'supplier_trade_name', 'supplier_gstin', 'supplier_address', 'supplier_state', 'supplier_state_code',
        'place_of_supply', 'place_of_supply_code', 'tax_supply_type', 'tax_pricing_mode', 'recipient_gstin',
        'shipping_taxable_value', 'shipping_tax_rate', 'shipping_tax_amount', 'shipping_cgst_amount', 'shipping_sgst_amount', 'shipping_igst_amount');
      orderPlaceholders.push('?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?');
      orderParams.push(
        taxProfile.legal_supplier_name, taxProfile.trade_name, taxProfile.gstin, taxProfile.seller_address,
        taxProfile.seller_state, taxProfile.seller_state_code,
        placeOfSupplyName, orderTax.place_of_supply_code || null, orderTax.supply_type, orderTax.pricing_mode, recipientGstin,
        orderTax.shipping.taxable, orderTax.shipping.rate, orderTax.shipping.tax, orderTax.shipping.cgst, orderTax.shipping.sgst, orderTax.shipping.igst
      );
    }

    orderColumns.push('total_price', 'coupon_code');
    orderPlaceholders.push('?', '?');
    orderParams.push(
      totalPricePaise,
      validatedCoupon ? validatedCoupon.code : null
    );

    const orderInsertQuery = `INSERT INTO orders (${orderColumns.join(', ')}) VALUES (${orderPlaceholders.join(', ')})`;
    const [orderResult] = await connection.execute(orderInsertQuery, orderParams);
    const orderId = orderResult.insertId;

    // 11. Insert order items (Hybrid Architecture Bridge & Tax Snapshot)
    let hasMarshansProductCol = false;
    let hasItemTaxCols = false;

    try {
      const [colCheck] = await connection.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'"
      );
      const colNames = (colCheck || []).map(c => c.COLUMN_NAME.toLowerCase());
      hasMarshansProductCol = colNames.includes('marshans_product_id');
      hasItemTaxCols = colNames.includes('tax_amount');
    } catch (_) { }

    for (const it of validatedItems) {
      const itemTax = it.tax; // computed once for the whole order (line taxes sum exactly to the order tax)

      const itemCols = ['order_id', 'product_id'];
      const itemVals = ['?', '?'];
      const itemParams = [orderId, hasMarshansProductCol ? it.product_id : (it.product_id || it.marshans_product_id)];

      if (hasMarshansProductCol) {
        itemCols.push('marshans_product_id');
        itemVals.push('?');
        itemParams.push(it.marshans_product_id);
      }

      itemCols.push('variant_id', 'product_name', 'sku');
      itemVals.push('?', '?', '?');
      itemParams.push(it.variant_id, it.product_name, it.sku);

      if (hasItemTaxCols) {
        itemCols.push('hsn_code', 'tax_rate', 'tax_amount');
        itemVals.push('?', '?', '?');
        itemParams.push(it.tax_cfg.hsn, itemTax.rate, itemTax.tax);
      }

      if (taxSupport.itemSplit) {
        itemCols.push('discount_allocated', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount');
        itemVals.push('?', '?', '?', '?', '?');
        itemParams.push(itemTax.discount_allocated, itemTax.taxable, itemTax.cgst, itemTax.sgst, itemTax.igst);
      }

      itemCols.push('admin_product_id_snapshot', 'variant_options', 'unit_price', 'quantity', 'total_price');
      itemVals.push('?', '?', '?', '?', '?');
      itemParams.push(it.admin_product_id_snapshot, it.variant_options, it.unit_price, it.quantity, it.total_price);

      const itemInsertQuery = `INSERT INTO order_items (${itemCols.join(', ')}) VALUES (${itemVals.join(', ')})`;
      const [itemRes] = await connection.execute(itemInsertQuery, itemParams);

      if (it.custom_design_data && itemRes && itemRes.insertId) {
        try {
          await connection.execute(`
            INSERT INTO order_item_custom_designs (
              order_item_id, file_role, storage_path, image_url, original_filename, file_type, file_size_bytes, verification_status, uploaded_at
            ) VALUES (?, 'original_upload', ?, ?, ?, 'image/png', 0, 'PENDING', NOW())
          `, [
            itemRes.insertId,
            it.custom_design_data.storagePath || '',
            it.custom_design_data.uploadedPreviewUrl || '',
            it.custom_design_data.fileName || 'custom-artwork.png'
          ]);
        } catch (customErr) {
          console.warn('[OrderItemCustomDesign Insert Warning]', customErr.message);
        }
      }
    }

    // 12. Record coupon usage (lifecycle: reserved for online pending, consumed for COD)
    if (validatedCoupon) {
      const isCod = safePaymentMethod === 'COD';
      const initialUsageStatus = isCod ? 'consumed' : 'reserved';

      let hasUsageStatusCol = false;
      try {
        const [usageCols] = await connection.execute(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupon_usage' AND COLUMN_NAME = 'status'"
        );
        hasUsageStatusCol = usageCols && usageCols.length > 0;
      } catch (_) {}

      if (hasUsageStatusCol) {
        await connection.execute(
          'INSERT INTO coupon_usage (coupon_id, order_id, customer_id, discount_amount, status, reserved_at) VALUES (?, ?, ?, ?, ?, NOW())',
          [validatedCoupon.id, orderId, customerId, discountPaise, initialUsageStatus]
        );
      } else {
        await connection.execute(
          'INSERT INTO coupon_usage (coupon_id, order_id, customer_id, discount_amount) VALUES (?, ?, ?, ?)',
          [validatedCoupon.id, orderId, customerId, discountPaise]
        );
      }

      if (isCod) {
        await connection.execute(
          'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?',
          [validatedCoupon.id]
        );
      }
    }

    // 13. Record initial chronological status transition
    await recordOrderStatusHistory(orderId, 'ORDER PLACED', {
      changed_by: 'Customer',
      note: 'Order placed by customer checkout'
    }, connection);

    // 14. Convert & clear persistent cart atomically if order originated from a cart
    if (orderPayload?.cart_id) {
      const [convertedCart] = await connection.execute(
        'UPDATE carts SET status = "converted" WHERE id = ? AND user_id = ? AND store_id = ? AND status = "active"',
        [orderPayload.cart_id, customerId, activeStoreId]
      );
      if (!convertedCart.affectedRows) {
        const err = new Error('Cart could not be converted for this customer and store.');
        err.statusCode = 409;
        throw err;
      }
      await connection.execute('DELETE FROM cart_items WHERE cart_id = ?', [orderPayload.cart_id]);
    }

    await connection.commit();
    connection.release();

    return getOrderById(orderId, activeStoreId);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Fetch orders for a specific authenticated customer
 */
const getCustomerOrders = async (firebaseUid, { limit = 20, offset = 0 } = {}) => {
  if (!firebaseUid) return { total: 0, limit, offset, orders: [] };

  const [userRows] = await pool.execute(
    'SELECT id FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUid]
  );

  if (!userRows || userRows.length === 0) {
    return { total: 0, limit, offset, orders: [] };
  }

  const customerId = userRows[0].id;
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const countQuery = 'SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?';
  const [countRows] = await pool.execute(countQuery, [customerId]);
  const total = countRows[0]?.total || 0;

  const query = `
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.customer_email,
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')), '') AS customer_phone,
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
      o.created_at,
      COALESCE(o.store_id, 1) AS store_id,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    WHERE o.customer_id = ?
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.execute(query, [customerId, parsedLimit, parsedOffset]);

  let itemsByOrderId = {};
  if (rows.length > 0) {
    try {
      const hasMarshansProductCol = await checkHasMarshansOrderCol();
      const orderIds = rows.map(r => r.id);
      const placeholders = orderIds.map(() => '?').join(',');
      const [allItemRows] = await pool.execute(`
        SELECT
          oi.id,
          oi.order_id,
          oi.product_id,
          ${hasMarshansProductCol ? 'oi.marshans_product_id,' : 'NULL AS marshans_product_id,'}
          oi.variant_id,
          oi.product_name,
          oi.sku,
          oi.variant_options,
          oi.unit_price,
          oi.quantity,
          oi.total_price,
          COALESCE(
            (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1),
            ${hasMarshansProductCol ? '(SELECT image_url FROM marshans_product_images WHERE product_id = oi.marshans_product_id ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1),' : ''}
            NULL
          ) AS product_image
        FROM order_items oi
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.id ASC
      `, orderIds);

      for (const item of allItemRows) {
        if (!itemsByOrderId[item.order_id]) itemsByOrderId[item.order_id] = [];
        itemsByOrderId[item.order_id].push({
          ...item,
          product_id: item.marshans_product_id || item.product_id,
          marshans_product_id: item.marshans_product_id || null,
          img: item.product_image || null,
          variant_options: safeJsonParse(item.variant_options, null)
        });
      }
    } catch (itemErr) {
      console.warn('[orderService.getCustomerOrders] Could not fetch preview items:', itemErr.message);
    }
  }

  const orders = rows.map(r => {
    const isStore2 = parseInt(r.store_id, 10) === 2;
    const rawTotalPrice = parseInt(r.total_price, 10) || 0;
    const rawSubtotal = parseInt(r.subtotal, 10) || 0;
    const rawDiscount = parseInt(r.discount_total, 10) || 0;
    const rawShipping = parseInt(r.shipping_charge, 10) || 0;
    const orderItems = itemsByOrderId[r.id] || [];

    return {
      ...r,
      shipping_address: safeJsonParse(r.shipping_address, null),
      total_price_rupees: isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice,
      subtotal_rupees: isStore2 ? Math.round(rawSubtotal / 100) : rawSubtotal,
      discount_total_rupees: isStore2 ? Math.round(rawDiscount / 100) : rawDiscount,
      shipping_charge_rupees: isStore2 ? Math.round(rawShipping / 100) : rawShipping,
      items: orderItems.map(item => ({
        ...item,
        unit_price_rupees: isStore2 ? Math.round((parseInt(item.unit_price, 10) || 0) / 100) : (parseInt(item.unit_price, 10) || 0),
        total_price_rupees: isStore2 ? Math.round((parseInt(item.total_price, 10) || 0) / 100) : (parseInt(item.total_price, 10) || 0)
      }))
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
 * Fetch a single order by ID or order_number for an authenticated customer
 */
const getCustomerOrderById = async (orderIdOrNumber, firebaseUid) => {
  if (!orderIdOrNumber || !firebaseUid) return null;

  const order = await getOrderById(orderIdOrNumber);
  if (!order) return null;

  const [userRows] = await pool.execute(
    'SELECT id FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUid]
  );

  if (!userRows || userRows.length === 0) return null;

  const customerId = userRows[0].id;

  if (order.customer_id !== customerId) {
    return null;
  }

  return order;
};

module.exports = {
  ALLOWED_FULFILLMENT_STATUSES,
  getOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderShipping,
  createCustomerOrder,
  getCustomerOrders,
  getCustomerOrderById
};

