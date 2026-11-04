const { pool } = require('../config/database');
const shippingService = require('./shippingService');
const taxProfileService = require('./taxProfileService');
const taxCore = require('../utils/taxCore');
const { normalizeIndianPhoneNumber } = require('../utils/phoneUtils');

/**
 * Custom Forge Business Constants
 */
const ALLOWED_NAMEPLATE_MATERIALS = ['Plastic', 'MDF'];
const MAX_CUSTOMER_NAME_LENGTH = 35;
const MAX_DESIGNATION_LENGTH = 50;

const ALLOWED_PRODUCTION_STATUSES = [
  'order_placed',
  '3d_printing',
  'post_processing',
  'nameplate_fabrication',
  'quality_check',
  'ready_to_ship',
  'shipped',
  'delivered',
  'cancelled'
];

/**
 * Hardcoded fallback for Lady Justice product & variants if database migration is not yet executed
 */
const FALLBACK_LADY_JUSTICE = {
  id: 1,
  store_id: 2,
  slug: 'lady-justice',
  name: 'Lady Justice',
  tagline: 'Symbol of Impartial Justice — Precision Crafted',
  description: 'Exquisite additive manufacturing sculpture of Lady Justice, featuring precision balance scales and optional personalized legal nameplate.',
  base_model_sku: 'MRSH-CF-LJ',
  active: 1,
  variants: [
    {
      id: 1,
      variant_sku: 'MRSH-CF-LJ-6IN',
      size_label: '6 inches',
      height_mm: 152,
      price: 160000,
      price_rupees: 1600,
      custom_mode_allowed: 0,
      display_order: 1,
      active: 1
    },
    {
      id: 2,
      variant_sku: 'MRSH-CF-LJ-1FT',
      size_label: '1 foot',
      height_mm: 305,
      price: 350000,
      price_rupees: 3500,
      custom_mode_allowed: 1,
      display_order: 2,
      active: 1
    },
    {
      id: 3,
      variant_sku: 'MRSH-CF-LJ-2FT',
      size_label: '2 feet',
      height_mm: 610,
      price: 560000,
      price_rupees: 5600,
      custom_mode_allowed: 1,
      display_order: 3,
      active: 1
    }
  ]
};

/**
 * Helper to check whether custom_forge_products table exists in MySQL
 */
let hasCustomForgeTablesCached = null;
const checkCustomForgeTablesExist = async (connection = pool) => {
  if (hasCustomForgeTablesCached !== null) return hasCustomForgeTablesCached;
  try {
    const [rows] = await connection.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_forge_products'"
    );
    hasCustomForgeTablesCached = rows && rows.length > 0;
  } catch (_) {
    hasCustomForgeTablesCached = false;
  }
  return hasCustomForgeTablesCached;
};

/**
 * Helper: Find or create customer record in users table linked to Firebase UID
 */
const upsertCustomerUser = async (firebaseUser, connection = pool) => {
  const { uid, email, name, phone } = firebaseUser;
  if (!uid) {
    const err = new Error('Authentication required: Firebase UID is missing.');
    err.statusCode = 401;
    throw err;
  }

  const [existingRows] = await connection.execute(
    'SELECT id, firebase_uid, email FROM users WHERE firebase_uid = ? LIMIT 1',
    [uid]
  );

  if (existingRows && existingRows.length > 0) {
    return existingRows[0].id;
  }

  // Insert new customer user profile
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
 * Collision-safe Order Number Generator: CF-MRSH-YYYY-XXXX
 */
const generateUniqueOrderNumber = async (connection) => {
  const year = new Date().getFullYear();
  const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const MAX_RETRIES = 10;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    const candidate = `CF-MRSH-${year}-${suffix}`;

    try {
      const [rows] = await connection.execute(
        'SELECT id FROM custom_forge_orders WHERE order_number = ? LIMIT 1',
        [candidate]
      );
      if (!rows || rows.length === 0) {
        return candidate;
      }
    } catch (e) {
      // If table does not exist during tests/pre-migration, return candidate
      return candidate;
    }
  }

  // Fallback timestamp-based suffix if all 10 random attempts collided
  const timeSuffix = Date.now().toString().slice(-4);
  return `CF-MRSH-${year}-${timeSuffix}`;
};

/**
 * Retrieve Lady Justice Product & Variants
 * GET /api/custom-forge/products/lady-justice
 */
const getLadyJusticeProduct = async () => {
  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    return FALLBACK_LADY_JUSTICE;
  }

  try {
    const [products] = await pool.execute(
      'SELECT id, store_id, slug, name, tagline, description, base_model_sku, hero_image_url, active FROM custom_forge_products WHERE slug = "lady-justice" AND store_id = 2 AND active = 1 LIMIT 1'
    );

    if (!products || products.length === 0) {
      return FALLBACK_LADY_JUSTICE;
    }

    const product = products[0];
    const [variants] = await pool.execute(
      'SELECT id, variant_sku, size_label, height_mm, price, custom_mode_allowed, display_order, active FROM custom_forge_product_variants WHERE product_id = ? AND active = 1 ORDER BY display_order ASC, id ASC',
      [product.id]
    );

    return {
      ...product,
      variants: variants.map(v => ({
        ...v,
        price_rupees: Math.round(Number(v.price) / 100)
      }))
    };
  } catch (err) {
    console.warn('[CustomForgeService] DB query failed, using verified fallback:', err.message);
    return FALLBACK_LADY_JUSTICE;
  }
};

/**
 * Validate Custom Mode & Personalization Specifications
 */
const validateCustomization = (variant, customMode, customization) => {
  const isCustomModeEnabled = Boolean(customMode);

  // 1. Variant rule: 6-inch cannot be customized
  if (variant.custom_mode_allowed === 0 && isCustomModeEnabled) {
    const err = new Error('Customization is not available for the 6-inch variant.');
    err.statusCode = 400;
    throw err;
  }

  // 2. Custom mode disabled: customization fields are not required
  if (!isCustomModeEnabled) {
    return {
      custom_mode_enabled: 0,
      customer_name: null,
      customer_designation: null,
      nameplate_material: null
    };
  }

  // 3. Custom mode enabled on 1-foot or 2-feet: enforce strict field rules
  if (!customization || typeof customization !== 'object') {
    const err = new Error('Customization details are required when Custom Mode is enabled.');
    err.statusCode = 400;
    throw err;
  }

  const { name, designation, material } = customization;

  // Name validation: required, non-empty, max 35 chars
  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Name on custom nameplate is required.');
    err.statusCode = 400;
    throw err;
  }
  const cleanName = name.trim();
  if (cleanName.length > MAX_CUSTOMER_NAME_LENGTH) {
    const err = new Error(`Customer name on nameplate cannot exceed ${MAX_CUSTOMER_NAME_LENGTH} characters.`);
    err.statusCode = 400;
    throw err;
  }

  // Designation validation: required, max 50 chars; literal 'NIL' accepted
  if (designation === undefined || designation === null || typeof designation !== 'string') {
    const err = new Error('Designation on custom nameplate is required (or "NIL").');
    err.statusCode = 400;
    throw err;
  }
  const cleanDesignation = designation.trim();
  if (!cleanDesignation) {
    const err = new Error('Designation on custom nameplate cannot be empty (enter "NIL" if none).');
    err.statusCode = 400;
    throw err;
  }
  if (cleanDesignation.length > MAX_DESIGNATION_LENGTH) {
    const err = new Error(`Designation on nameplate cannot exceed ${MAX_DESIGNATION_LENGTH} characters.`);
    err.statusCode = 400;
    throw err;
  }
  const normalizedDesignation = cleanDesignation.toUpperCase() === 'NIL' ? 'NIL' : cleanDesignation;

  // Nameplate material validation: exactly 'Plastic' or 'MDF'
  if (!material || typeof material !== 'string' || !ALLOWED_NAMEPLATE_MATERIALS.includes(material.trim())) {
    const err = new Error(`Nameplate material must be exactly 'Plastic' or 'MDF'. Received: '${material}'.`);
    err.statusCode = 400;
    throw err;
  }
  const cleanMaterial = material.trim();

  return {
    custom_mode_enabled: 1,
    customer_name: cleanName,
    customer_designation: normalizedDesignation,
    nameplate_material: cleanMaterial
  };
};

/**
 * Create a Custom Forge Order (Atomic Transaction)
 * POST /api/custom-forge/orders
 */
const createCustomForgeOrder = async (orderPayload, firebaseUser, requestStoreId = 2) => {
  // 1. Mandatory authenticated customer identity (Guest checkout strictly prohibited)
  if (!firebaseUser || !firebaseUser.uid) {
    const err = new Error('Authentication required: Guest checkout is not permitted for Custom Forge orders.');
    err.statusCode = 401;
    throw err;
  }

  // 2. Strict Store 2 isolation check
  const activeStoreId = parseInt(requestStoreId, 10);
  if (activeStoreId !== 2) {
    const err = new Error('Custom Forge ordering is exclusively supported for Store 2 (THE MARSHANS).');
    err.statusCode = 403;
    throw err;
  }

  const {
    variant_id,
    custom_mode,
    customization,
    shipping_address,
    customer_notes,
    payment_method
  } = orderPayload || {};

  // Explicitly reject COD on the server
  if (payment_method && String(payment_method).trim().toUpperCase() === 'COD') {
    const err = new Error('Cash on Delivery (COD) is not supported for Custom Forge orders. Online payment only.');
    err.statusCode = 400;
    throw err;
  }
  if (payment_method && !['ONLINE', 'RAZORPAY'].includes(String(payment_method).trim().toUpperCase())) {
    const err = new Error(`Unsupported payment method '${payment_method}'. Custom Forge requires online payment.`);
    err.statusCode = 400;
    throw err;
  }

  // 3. Validate variant ID
  const numVariantId = parseInt(variant_id, 10);
  if (isNaN(numVariantId) || numVariantId <= 0) {
    const err = new Error('Valid Custom Forge product variant ID is required.');
    err.statusCode = 400;
    throw err;
  }

  // 4. Validate shipping address
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
    const err = new Error('Recipient name is required (min 2 characters).');
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

    // 5. Check if custom_forge tables exist
    const tablesExist = await checkCustomForgeTablesExist(connection);
    if (!tablesExist) {
      const err = new Error('Custom Forge ordering system database migration is pending.');
      err.statusCode = 503;
      throw err;
    }

    // 6. Authoritative Variant Lookup from Database (Ignore any client-submitted prices)
    const [variantRows] = await connection.execute(
      `SELECT v.id, v.product_id, v.variant_sku, v.size_label, v.height_mm, v.price, v.custom_mode_allowed, v.active,
              p.name AS product_name, p.store_id
       FROM custom_forge_product_variants v
       JOIN custom_forge_products p ON v.product_id = p.id
       WHERE v.id = ? AND v.active = 1 AND p.active = 1 AND p.store_id = 2
       LIMIT 1`,
      [numVariantId]
    );

    if (!variantRows || variantRows.length === 0) {
      const err = new Error(`Variant #${numVariantId} is invalid or no longer available for Custom Forge.`);
      err.statusCode = 400;
      throw err;
    }

    const variant = variantRows[0];
    const authoritativePricePaise = parseInt(variant.price, 10);
    if (isNaN(authoritativePricePaise) || authoritativePricePaise <= 0) {
      const err = new Error(`Variant #${numVariantId} has an invalid configured price.`);
      err.statusCode = 500;
      throw err;
    }

    // 7. Validate Custom Mode and Customization details
    const validatedCustomization = validateCustomization(variant, custom_mode, customization);

    // 8. Calculate shipping using existing Marshans shipping logic
    const shippingCheck = await shippingService.calculateShippingFee({
      subtotal: authoritativePricePaise,
      region: state.trim(),
      storeId: 2
    });
    const shippingChargePaise = shippingCheck.shipping_fee || 0;
    const subtotalPaise = authoritativePricePaise;
    const totalPricePaise = subtotalPaise + shippingChargePaise;

    // 8.1 Server-side GST (inclusive) following existing Marshans tax profile & composite shipping rules
    let taxAmountPaise = 0;
    let cgstAmountPaise = 0;
    let sgstAmountPaise = 0;
    let igstAmountPaise = 0;

    try {
      const taxProfile = await taxProfileService.getTaxProfile(2, { db: connection });
      if (taxProfile && taxProfile.gst_enabled && taxProfile.default_gst_rate > 0) {
        const orderTax = taxCore.computeOrderTax({
          lines: [{
            key: 0,
            gross: subtotalPaise,
            rate: taxProfile.default_gst_rate,
            hsn: null
          }],
          discount: 0,
          shipping: shippingChargePaise,
          gstEnabled: true,
          defaultRate: taxProfile.default_gst_rate,
          sellerState: taxProfile.seller_state_code,
          customerState: state.trim()
        });

        taxAmountPaise = orderTax.totals.tax || 0;
        cgstAmountPaise = orderTax.totals.cgst || 0;
        sgstAmountPaise = orderTax.totals.sgst || 0;
        igstAmountPaise = orderTax.totals.igst || 0;
      }
    } catch (taxErr) {
      console.warn('[CustomForgeService] Tax profile calculation fallback:', taxErr.message);
    }

    // 9. Upsert customer in users table (linked to Firebase UID)
    const customerId = await upsertCustomerUser({
      uid: firebaseUser.uid,
      email: firebaseUser.email || shipping_address.email || '',
      name: recipientName.trim(),
      phone: cleanPhone
    }, connection);

    // 10. Generate collision-safe unique order number
    const orderNumber = await generateUniqueOrderNumber(connection);

    // 11. Prepare shipping address snapshot
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

    // 12. Insert into custom_forge_orders
    const [orderRes] = await connection.execute(
      `INSERT INTO custom_forge_orders (
         store_id, order_number, customer_id, customer_email, customer_name, customer_phone,
         shipping_address, shipping_charge, subtotal, tax_amount, cgst_amount, sgst_amount, igst_amount,
         total_price, payment_method, payment_status, production_status, customer_notes
       ) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', 'pending', 'order_placed', ?)`,
      [
        orderNumber,
        customerId,
        shippingSnapshot.email,
        shippingSnapshot.name,
        shippingSnapshot.phone,
        JSON.stringify(shippingSnapshot),
        shippingChargePaise,
        subtotalPaise,
        taxAmountPaise,
        cgstAmountPaise,
        sgstAmountPaise,
        igstAmountPaise,
        totalPricePaise,
        customer_notes ? String(customer_notes).trim() : null
      ]
    );
    const orderId = orderRes.insertId;

    // 13. Insert into custom_forge_order_items (immutable variant & price snapshots)
    const [itemRes] = await connection.execute(
      `INSERT INTO custom_forge_order_items (
         order_id, product_id, variant_id, product_name_snapshot, variant_sku_snapshot,
         size_label_snapshot, height_mm_snapshot, unit_price, quantity, total_price
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        orderId,
        variant.product_id,
        variant.id,
        variant.product_name,
        variant.variant_sku,
        variant.size_label,
        variant.height_mm,
        authoritativePricePaise,
        authoritativePricePaise
      ]
    );
    const orderItemId = itemRes.insertId;

    // 14. Insert into custom_forge_order_customizations
    await connection.execute(
      `INSERT INTO custom_forge_order_customizations (
         order_item_id, custom_mode_enabled, customer_name, customer_designation, nameplate_material, verification_status
       ) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [
        orderItemId,
        validatedCustomization.custom_mode_enabled,
        validatedCustomization.customer_name,
        validatedCustomization.customer_designation,
        validatedCustomization.nameplate_material
      ]
    );

    // 15. Record initial status history transition
    await connection.execute(
      `INSERT INTO custom_forge_order_status_history (
         order_id, previous_status, new_status, changed_by, note
       ) VALUES (?, NULL, 'order_placed', 'Customer', 'Custom Forge order placed via storefront')`,
      [orderId]
    );

    await connection.commit();

    return getCustomForgeOrderByIdInternal(orderId, connection);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Internal Order Retrieval Helper
 */
const getCustomForgeOrderByIdInternal = async (orderId, connection = pool) => {
  const [orders] = await connection.execute(
    `SELECT o.id, o.store_id, o.order_number, o.customer_id, o.customer_email, o.customer_name, o.customer_phone,
            o.shipping_address, o.shipping_charge, o.subtotal, o.tax_amount, o.cgst_amount, o.sgst_amount, o.igst_amount,
            o.total_price, o.payment_method, o.payment_status, o.production_status, o.customer_notes, o.admin_notes,
            o.gateway_order_id, o.created_at, o.updated_at
     FROM custom_forge_orders o
     WHERE o.id = ? AND o.store_id = 2
     LIMIT 1`,
    [orderId]
  );

  if (!orders || orders.length === 0) {
    return null;
  }

  const order = orders[0];

  const [items] = await connection.execute(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.product_name_snapshot,
            oi.variant_sku_snapshot, oi.size_label_snapshot, oi.height_mm_snapshot,
            oi.unit_price, oi.quantity, oi.total_price,
            oc.custom_mode_enabled, oc.customer_name AS engraved_name,
            oc.customer_designation AS engraved_designation, oc.nameplate_material,
            oc.verification_status
     FROM custom_forge_order_items oi
     LEFT JOIN custom_forge_order_customizations oc ON oc.order_item_id = oi.id
     WHERE oi.order_id = ?`,
    [order.id]
  );

  const [history] = await connection.execute(
    `SELECT id, order_id, previous_status, new_status, changed_by, note, created_at
     FROM custom_forge_order_status_history
     WHERE order_id = ?
     ORDER BY created_at ASC, id ASC`,
    [order.id]
  );

  let parsedAddress = order.shipping_address;
  if (typeof parsedAddress === 'string') {
    try {
      parsedAddress = JSON.parse(parsedAddress);
    } catch (_) {}
  }

  return {
    ...order,
    shipping_address: parsedAddress,
    subtotal_rupees: Math.round(Number(order.subtotal) / 100),
    shipping_charge_rupees: Math.round(Number(order.shipping_charge) / 100),
    total_price_rupees: Math.round(Number(order.total_price) / 100),
    items: items.map(it => ({
      ...it,
      unit_price_rupees: Math.round(Number(it.unit_price) / 100),
      total_price_rupees: Math.round(Number(it.total_price) / 100),
      customization: it.custom_mode_enabled ? {
        name: it.engraved_name,
        designation: it.engraved_designation,
        material: it.nameplate_material,
        status: it.verification_status
      } : null
    })),
    status_history: history
  };
};

/**
 * Customer Order Lookup by ID with Strict Ownership Verification
 * GET /api/custom-forge/orders/:id
 */
const getCustomerOrderById = async (orderId, firebaseUser) => {
  if (!firebaseUser || !firebaseUser.uid) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    const err = new Error('Custom Forge system is not yet initialized.');
    err.statusCode = 503;
    throw err;
  }

  const numId = parseInt(orderId, 10);
  const isNumeric = !isNaN(numId) && numId > 0;

  const [orders] = await pool.execute(
    `SELECT o.id, o.customer_id, o.customer_email
     FROM custom_forge_orders o
     WHERE (o.id = ? OR o.order_number = ?) AND o.store_id = 2
     LIMIT 1`,
    [isNumeric ? numId : 0, String(orderId).trim()]
  );

  if (!orders || orders.length === 0) {
    const err = new Error('Custom Forge order not found.');
    err.statusCode = 404;
    throw err;
  }

  const orderMeta = orders[0];

  // Verify ownership
  const [userRows] = await pool.execute(
    'SELECT id, email FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUser.uid]
  );
  const user = userRows && userRows.length > 0 ? userRows[0] : null;

  const isOwner = (user && orderMeta.customer_id && Number(user.id) === Number(orderMeta.customer_id)) ||
                  (orderMeta.customer_email && firebaseUser.email && orderMeta.customer_email.toLowerCase() === firebaseUser.email.toLowerCase());

  if (!isOwner) {
    const err = new Error('Access denied: You do not have permission to view this Custom Forge order.');
    err.statusCode = 403;
    throw err;
  }

  return getCustomForgeOrderByIdInternal(orderMeta.id);
};

/**
 * Admin: Get Custom Forge Orders List with Pagination & Filters
 * GET /api/admin/custom-forge/orders
 */
const getAdminCustomForgeOrders = async ({
  status,
  search,
  limit = 50,
  offset = 0
} = {}) => {
  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    return {
      orders: [],
      pagination: { total: 0, limit: 50, offset: 0, returned: 0 },
      is_initialized: false
    };
  }

  const conditions = ['o.store_id = 2'];
  const params = [];

  if (status && status !== 'ALL' && String(status).trim()) {
    conditions.push('o.production_status = ?');
    params.push(String(status).trim().toLowerCase());
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ?)');
    params.push(term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM custom_forge_orders o ${whereClause}`,
    params
  );
  const total = countRows[0].total || 0;

  const query = `
    SELECT
      o.id, o.store_id, o.order_number, o.customer_name, o.customer_email, o.customer_phone,
      o.total_price, o.payment_status, o.production_status, o.created_at,
      oi.size_label_snapshot, oi.variant_sku_snapshot,
      oc.custom_mode_enabled, oc.customer_name AS engraved_name,
      oc.customer_designation AS engraved_designation, oc.nameplate_material
    FROM custom_forge_orders o
    LEFT JOIN custom_forge_order_items oi ON oi.order_id = o.id
    LEFT JOIN custom_forge_order_customizations oc ON oc.order_item_id = oi.id
    ${whereClause}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ? OFFSET ?
  `;

  const [rows] = await pool.execute(query, [...params, parsedLimit, parsedOffset]);

  return {
    orders: rows.map(r => ({
      ...r,
      total_price_rupees: Math.round(Number(r.total_price) / 100),
      customization: r.custom_mode_enabled ? {
        name: r.engraved_name,
        designation: r.engraved_designation,
        material: r.nameplate_material
      } : null
    })),
    pagination: {
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      returned: rows.length
    },
    is_initialized: true
  };
};

/**
 * Admin: Get Custom Forge Order Detail by ID
 * GET /api/admin/custom-forge/orders/:id
 */
const getAdminCustomForgeOrderById = async (orderId) => {
  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    const err = new Error('Custom Forge system database tables are not yet created.');
    err.statusCode = 503;
    throw err;
  }

  const numId = parseInt(orderId, 10);
  const isNumeric = !isNaN(numId) && numId > 0;

  const [orders] = await pool.execute(
    'SELECT id FROM custom_forge_orders WHERE (id = ? OR order_number = ?) AND store_id = 2 LIMIT 1',
    [isNumeric ? numId : 0, String(orderId).trim()]
  );

  if (!orders || orders.length === 0) {
    return null;
  }

  return getCustomForgeOrderByIdInternal(orders[0].id);
};

/**
 * Admin: Update Custom Forge Production Status
 * PATCH /api/admin/custom-forge/orders/:id/status
 */
const updateCustomForgeOrderStatus = async (orderId, { status, note } = {}, adminActor = {}) => {
  if (!status || !ALLOWED_PRODUCTION_STATUSES.includes(String(status).trim().toLowerCase())) {
    const err = new Error(`Invalid Custom Forge status. Allowed values: ${ALLOWED_PRODUCTION_STATUSES.join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }

  const cleanStatus = String(status).trim().toLowerCase();
  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    const err = new Error('Custom Forge database tables are pending creation.');
    err.statusCode = 503;
    throw err;
  }

  const numId = parseInt(orderId, 10);
  const isNumeric = !isNaN(numId) && numId > 0;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orders] = await connection.execute(
      'SELECT id, production_status, payment_status FROM custom_forge_orders WHERE (id = ? OR order_number = ?) AND store_id = 2 LIMIT 1 FOR UPDATE',
      [isNumeric ? numId : 0, String(orderId).trim()]
    );

    if (!orders || orders.length === 0) {
      const err = new Error('Custom Forge order not found.');
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];
    const previousStatus = order.production_status;

    if (previousStatus === cleanStatus) {
      await connection.rollback();
      return getCustomForgeOrderByIdInternal(order.id, connection);
    }

    // STRICT PAYMENT-TO-PRODUCTION ENFORCEMENT:
    // Any production or fulfillment stage requires verified payment (payment_status === 'paid').
    // An unpaid order (pending, failed, refunded) CANNOT enter production.
    const PRODUCTION_STAGES = [
      '3d_printing',
      'post_processing',
      'nameplate_fabrication',
      'quality_check',
      'ready_to_ship',
      'shipped',
      'delivered'
    ];

    if (PRODUCTION_STAGES.includes(cleanStatus)) {
      if (order.payment_status !== 'paid') {
        const err = new Error(
          `Cannot advance unpaid Custom Forge order to '${cleanStatus}'. Current payment status is '${order.payment_status}'. Only paid orders can enter production.`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // Update production status. Notice payment_status is untouched — cancellation NEVER marks an unpaid order as paid.
    await connection.execute(
      'UPDATE custom_forge_orders SET production_status = ?, updated_at = NOW() WHERE id = ?',
      [cleanStatus, order.id]
    );

    // Record transition audit history
    const actorName = adminActor.email || adminActor.name || (adminActor.role ? `Admin (${adminActor.role})` : 'Admin');
    await connection.execute(
      `INSERT INTO custom_forge_order_status_history (
         order_id, previous_status, new_status, changed_by, note
       ) VALUES (?, ?, ?, ?, ?)`,
      [order.id, previousStatus, cleanStatus, actorName, note ? String(note).trim() : null]
    );

    await connection.commit();
    return getCustomForgeOrderByIdInternal(order.id, connection);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Record Successful Payment for a Custom Forge Order
 * Called when Razorpay signature is cryptographically verified
 */
const recordCustomForgePaymentSuccess = async ({
  orderId,
  gatewayOrderId,
  gatewayPaymentId,
  gatewaySignature,
  amountPaise,
  method = 'card',
  actor = 'Gateway Verification'
}) => {
  const numId = parseInt(orderId, 10);
  const isNumeric = !isNaN(numId) && numId > 0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [orders] = await connection.execute(
      'SELECT id, order_number, total_price, payment_status FROM custom_forge_orders WHERE (id = ? OR order_number = ?) AND store_id = 2 LIMIT 1 FOR UPDATE',
      [isNumeric ? numId : 0, String(orderId).trim()]
    );

    if (!orders || orders.length === 0) {
      const err = new Error('Custom Forge order not found for payment recording.');
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];

    // Record in custom_forge_payments ledger
    await connection.execute(
      `INSERT INTO custom_forge_payments (
         order_id, provider, gateway_order_id, gateway_payment_id, gateway_signature, amount, currency, status, method
       ) VALUES (?, 'razorpay', ?, ?, ?, ?, 'INR', 'captured', ?)`,
      [
        order.id,
        gatewayOrderId,
        gatewayPaymentId,
        gatewaySignature,
        amountPaise || order.total_price,
        method
      ]
    );

    // Update order payment status
    await connection.execute(
      'UPDATE custom_forge_orders SET payment_status = "paid", gateway_order_id = ?, updated_at = NOW() WHERE id = ?',
      [gatewayOrderId, order.id]
    );

    // Record audit history note
    await connection.execute(
      `INSERT INTO custom_forge_order_status_history (
         order_id, previous_status, new_status, changed_by, note
       ) VALUES (?, 'order_placed', 'order_placed', ?, ?)`,
      [
        order.id,
        actor,
        `Payment verified & captured via Razorpay (${gatewayPaymentId || gatewayOrderId}). Order authorized for production.`
      ]
    );

    await connection.commit();
    return getCustomForgeOrderByIdInternal(order.id, connection);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/**
 * Admin: Get Count and IDs of Paid, Unacknowledged Custom Forge Orders
 * Strict isolation: Store 2 only, payment_status = 'paid' only.
 * Unacknowledged = no status history record with note = 'ORDER_ACKNOWLEDGED'.
 * Exposes zero customer PII.
 */
const getUnreadCustomForgeOrdersCount = async (requestStoreId = 2) => {
  const activeStoreId = parseInt(requestStoreId, 10);
  if (activeStoreId !== 2) {
    const err = new Error('Custom Forge ordering is exclusively supported for Store 2 (THE MARSHANS).');
    err.statusCode = 403;
    throw err;
  }

  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    return { unread_count: 0, order_ids: [] };
  }

  const [rows] = await pool.execute(`
    SELECT o.id
    FROM custom_forge_orders o
    WHERE o.store_id = 2
      AND o.payment_status = 'paid'
      AND o.production_status = 'order_placed'
      AND NOT EXISTS (
        SELECT 1
        FROM custom_forge_order_status_history h
        WHERE h.order_id = o.id
          AND h.note = 'ORDER_ACKNOWLEDGED'
      )
    ORDER BY o.id ASC
  `);

  const orderIds = (rows || []).map(r => r.id);
  return {
    unread_count: orderIds.length,
    order_ids: orderIds
  };
};

/**
 * Admin: Acknowledge Paid Custom Forge Orders
 * Creates an explicit ORDER_ACKNOWLEDGED marker in custom_forge_order_status_history.
 * Safe against duplicates: only acknowledges orders not already marked ORDER_ACKNOWLEDGED.
 */
const acknowledgeCustomForgeOrders = async (orderIds = [], adminActor = {}, requestStoreId = 2) => {
  const activeStoreId = parseInt(requestStoreId, 10);
  if (activeStoreId !== 2) {
    const err = new Error('Custom Forge ordering is exclusively supported for Store 2 (THE MARSHANS).');
    err.statusCode = 403;
    throw err;
  }

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { acknowledged_count: 0, acknowledged_ids: [] };
  }

  const cleanIds = orderIds
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id) && id > 0);

  if (cleanIds.length === 0) {
    return { acknowledged_count: 0, acknowledged_ids: [] };
  }

  const tablesExist = await checkCustomForgeTablesExist();
  if (!tablesExist) {
    return { acknowledged_count: 0, acknowledged_ids: [] };
  }

  const actorName = adminActor.email || adminActor.name || (adminActor.role ? `Admin (${adminActor.role})` : 'Admin');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const placeholders = cleanIds.map(() => '?').join(', ');
    const [ordersToAcknowledge] = await connection.execute(`
      SELECT o.id, o.production_status
      FROM custom_forge_orders o
      WHERE o.id IN (${placeholders})
        AND o.store_id = 2
        AND o.payment_status = 'paid'
        AND o.production_status = 'order_placed'
        AND NOT EXISTS (
          SELECT 1
          FROM custom_forge_order_status_history h
          WHERE h.order_id = o.id
            AND h.note = 'ORDER_ACKNOWLEDGED'
        )
      FOR UPDATE
    `, cleanIds);

    const acknowledgedIds = [];
    for (const ord of ordersToAcknowledge) {
      await connection.execute(`
        INSERT INTO custom_forge_order_status_history (
          order_id, previous_status, new_status, changed_by, note
        ) VALUES (?, ?, ?, ?, ?)
      `, [ord.id, ord.production_status, ord.production_status, actorName, 'ORDER_ACKNOWLEDGED']);
      acknowledgedIds.push(ord.id);
    }

    await connection.commit();

    return {
      acknowledged_count: acknowledgedIds.length,
      acknowledged_ids: acknowledgedIds
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  ALLOWED_NAMEPLATE_MATERIALS,
  ALLOWED_PRODUCTION_STATUSES,
  FALLBACK_LADY_JUSTICE,
  validateCustomization,
  generateUniqueOrderNumber,
  getLadyJusticeProduct,
  createCustomForgeOrder,
  getCustomerOrderById,
  getAdminCustomForgeOrders,
  getAdminCustomForgeOrderById,
  updateCustomForgeOrderStatus,
  recordCustomForgePaymentSuccess,
  checkCustomForgeTablesExist,
  getUnreadCustomForgeOrdersCount,
  acknowledgeCustomForgeOrders
};
