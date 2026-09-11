const { pool } = require('../config/database');
const couponService = require('./couponService');
const shippingService = require('./shippingService');
const settingsService = require('./settingsService');

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
  const subtotalPaise = parseInt(order.subtotal, 10) || 0;
  const discountPaise = parseInt(order.discount_total, 10) || 0;
  const shippingPaise = parseInt(order.shipping_charge, 10) || 0;

  order.total_price_rupees = Math.round(totalPricePaise / 100);
  order.subtotal_rupees = Math.round(subtotalPaise / 100);
  order.discount_total_rupees = Math.round(discountPaise / 100);
  order.shipping_charge_rupees = Math.round(shippingPaise / 100);

  // Fetch Order Items with product image
  const itemsQuery = `
    SELECT 
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.variant_id,
      oi.product_name,
      oi.sku,
      oi.variant_options,
      oi.unit_price,
      oi.quantity,
      oi.total_price,
      oi.admin_product_id_snapshot,
      oi.production_status,
      oi.created_at,
      (SELECT image_url FROM product_images WHERE product_id = oi.product_id ORDER BY display_order ASC, id ASC LIMIT 1) AS product_image
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
    img: item.product_image || null,
    custom_designs: customDesignsByItem[item.id] || [],
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

  // 1. Validate items array
  if (!items || !Array.isArray(items) || items.length === 0) {
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

  if (!recipientName || recipientName.trim().length < 2) {
    const err = new Error('Recipient name is required.');
    err.statusCode = 400;
    throw err;
  }

  const cleanPhone = String(recipientPhone || '').replace(/^[\s\-\+910]+/, '').replace(/[\s\-]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    const err = new Error('Valid 10-digit mobile phone number is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!streetAddress || streetAddress.trim().length < 5) {
    const err = new Error('Complete street address is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!city || city.trim().length < 2) {
    const err = new Error('City is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!state || state.trim().length < 2) {
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

    // 4. Server-side validation of cart items & price lookup
    let subtotalPaise = 0;
    const validatedItems = [];

    for (const item of items) {
      const productId = parseInt(item.product_id || item.id, 10);
      const qty = Math.max(parseInt(item.quantity || item.qty, 10) || 1, 1);

      if (isNaN(productId)) {
        const err = new Error('Invalid product ID in order items.');
        err.statusCode = 400;
        throw err;
      }

      // Fetch active product from DB
      const [prodRows] = await connection.execute(
        'SELECT id, name, sku, price, active, admin_product_id FROM products WHERE id = ? LIMIT 1',
        [productId]
      );

      if (!prodRows || prodRows.length === 0 || !prodRows[0].active) {
        const err = new Error(`Product #${productId} is invalid or no longer available.`);
        err.statusCode = 400;
        throw err;
      }

      const product = prodRows[0];
      let unitPricePaise = parseInt(product.price, 10) || 0;
      let itemSku = product.sku;
      let variantId = null;
      let variantOptions = null;

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

      const lineTotalPaise = unitPricePaise * qty;
      subtotalPaise += lineTotalPaise;

      validatedItems.push({
        product_id: product.id,
        variant_id: variantId,
        product_name: product.name,
        sku: itemSku,
        admin_product_id_snapshot: product.admin_product_id || null,
        variant_options: variantOptions,
        unit_price: unitPricePaise,
        quantity: qty,
        total_price: lineTotalPaise
      });
    }

    // 5. Server-side coupon validation
    let discountPaise = 0;
    let validatedCoupon = null;

    if (coupon_code && String(coupon_code).trim()) {
      const codeStr = String(coupon_code).trim().toUpperCase();
      const couponCheck = await couponService.validateCoupon(codeStr, subtotalPaise);

      if (!couponCheck.valid) {
        const err = new Error(couponCheck.message || 'Invalid coupon code.');
        err.statusCode = 400;
        throw err;
      }

      validatedCoupon = couponCheck.coupon;
      discountPaise = validatedCoupon.discount_paise || 0;
    }

    // 6. Server-side shipping fee calculation
    const shippingCheck = await shippingService.calculateShippingFee({
      subtotal: Math.max(0, subtotalPaise - discountPaise),
      region: state.trim()
    });
    const shippingChargePaise = shippingCheck.shipping_fee || 0;

    // 7. Server-side GST and total calculation
    const discountedSubtotalPaise = Math.max(0, subtotalPaise - discountPaise);
    const totalPricePaise = discountedSubtotalPaise + shippingChargePaise;

    // 8. Generate order number
    const timestampPart = Date.now().toString().slice(-6);
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `CHP-${timestampPart}${randomPart}`;

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

    // 10. Insert into orders table (check for customer_phone column dynamically)
    let hasPhoneCol = false;
    try {
      const [orderCols] = await connection.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_phone'"
      );
      hasPhoneCol = orderCols && orderCols.length > 0;
    } catch (e) {}

    let orderInsertQuery;
    let orderParams;

    if (hasPhoneCol) {
      orderInsertQuery = `
        INSERT INTO orders (
          order_number, customer_id, customer_email, customer_name, customer_phone,
          shipping_address, payment_method, payment_status, fulfillment_status,
          subtotal, discount_total, shipping_charge, total_price, coupon_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?)
      `;
      orderParams = [
        orderNumber,
        customerId,
        shippingSnapshot.email,
        shippingSnapshot.name,
        shippingSnapshot.phone,
        JSON.stringify(shippingSnapshot),
        payment_method ? String(payment_method).toUpperCase() : 'COD',
        subtotalPaise,
        discountPaise,
        shippingChargePaise,
        totalPricePaise,
        validatedCoupon ? validatedCoupon.code : null
      ];
    } else {
      orderInsertQuery = `
        INSERT INTO orders (
          order_number, customer_id, customer_email, customer_name,
          shipping_address, payment_method, payment_status, fulfillment_status,
          subtotal, discount_total, shipping_charge, total_price, coupon_code
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?, ?)
      `;
      orderParams = [
        orderNumber,
        customerId,
        shippingSnapshot.email,
        shippingSnapshot.name,
        JSON.stringify(shippingSnapshot),
        payment_method ? String(payment_method).toUpperCase() : 'COD',
        subtotalPaise,
        discountPaise,
        shippingChargePaise,
        totalPricePaise,
        validatedCoupon ? validatedCoupon.code : null
      ];
    }

    const [orderResult] = await connection.execute(orderInsertQuery, orderParams);

    const orderId = orderResult.insertId;

    // 11. Insert order items
    const itemInsertQuery = `
      INSERT INTO order_items (
        order_id,
        product_id,
        variant_id,
        product_name,
        sku,
        admin_product_id_snapshot,
        variant_options,
        unit_price,
        quantity,
        total_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const it of validatedItems) {
      await connection.execute(itemInsertQuery, [
        orderId,
        it.product_id,
        it.variant_id,
        it.product_name,
        it.sku,
        it.admin_product_id_snapshot,
        it.variant_options,
        it.unit_price,
        it.quantity,
        it.total_price
      ]);
    }

    // 12. Record coupon usage if coupon applied
    if (validatedCoupon) {
      await connection.execute(
        'INSERT INTO coupon_usage (coupon_id, order_id, customer_id, discount_amount) VALUES (?, ?, ?, ?)',
        [validatedCoupon.id, orderId, customerId, discountPaise]
      );
      await connection.execute(
        'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?',
        [validatedCoupon.id]
      );
    }

    await connection.commit();
    connection.release();

    return getOrderById(orderId);
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
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    WHERE o.customer_id = ?
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.execute(query, [customerId, parsedLimit, parsedOffset]);

  const orders = rows.map(r => {
    const totalPricePaise = parseInt(r.total_price, 10) || 0;
    const subtotalPaise = parseInt(r.subtotal, 10) || 0;
    const discountPaise = parseInt(r.discount_total, 10) || 0;
    const shippingPaise = parseInt(r.shipping_charge, 10) || 0;

    return {
      ...r,
      shipping_address: safeJsonParse(r.shipping_address, null),
      total_price_rupees: Math.round(totalPricePaise / 100),
      subtotal_rupees: Math.round(subtotalPaise / 100),
      discount_total_rupees: Math.round(discountPaise / 100),
      shipping_charge_rupees: Math.round(shippingPaise / 100)
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

