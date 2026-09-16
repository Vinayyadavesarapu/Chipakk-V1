const { pool } = require('../config/database');
const { isMarshansHybridCatalogEnabled } = require('../config/features');

let hasStoreIdCol = null;
const checkHasStoreId = async () => {
  if (hasStoreIdCol !== null) return hasStoreIdCol;
  try {
    const [cols] = await pool.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'");
    hasStoreIdCol = cols && cols.length > 0;
  } catch (e) {
    hasStoreIdCol = false;
  }
  return hasStoreIdCol;
};

/**
 * Fetch list of coupons with pagination and filtering
 */
const getCoupons = async ({
  search,
  active,
  store_id = null,
  limit = 50,
  offset = 0
} = {}) => {
  const hasStoreId = await checkHasStoreId();
  const conditions = [];
  const params = [];

  if (hasStoreId && store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        conditions.push('(c.store_id = 1 OR c.store_id IS NULL)');
      } else {
        conditions.push('c.store_id = ?');
        params.push(sId);
      }
    }
  }

  if (active !== undefined && active !== null && active !== '') {
    conditions.push('c.active = ?');
    params.push(active === 'true' || active === 1 || active === '1' ? 1 : 0);
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('c.code LIKE ?');
    params.push(term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM coupons c ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const query = `
    SELECT 
      c.id,
      ${hasStoreId ? 'COALESCE(c.store_id, 1) AS store_id,' : '1 AS store_id,'}
      c.code,
      c.discount_type,
      c.discount_value,
      c.min_order_value,
      c.max_discount_amount,
      c.start_date,
      c.end_date,
      c.usage_limit,
      c.usage_count,
      c.active,
      c.created_at,
      c.updated_at
    FROM coupons c
    ${whereClause}
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const coupons = rows.map(r => {
    const isStore2 = parseInt(r.store_id, 10) === 2;
    const minOrderVal = parseInt(r.min_order_value, 10) || 0;
    const maxDiscountVal = r.max_discount_amount !== null ? (parseInt(r.max_discount_amount, 10) || 0) : null;
    const discountVal = parseInt(r.discount_value, 10) || 0;

    return {
      ...r,
      code: String(r.code).toUpperCase(),
      min_order_value_rupees: isStore2 ? Math.round(minOrderVal / 100) : minOrderVal,
      max_discount_amount_rupees: maxDiscountVal !== null ? (isStore2 ? Math.round(maxDiscountVal / 100) : maxDiscountVal) : null,
      discount_value_rupees: r.discount_type === 'fixed' ? (isStore2 ? Math.round(discountVal / 100) : discountVal) : null
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    coupons
  };
};

/**
 * Fetch a single coupon by numeric BIGINT ID or uppercase code string, including recent redemption usages
 */
const getCouponById = async (couponIdOrCode, store_id = null) => {
  if (!couponIdOrCode) return null;

  const numId = parseInt(couponIdOrCode, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(couponIdOrCode);
  const hasStoreId = await checkHasStoreId();

  const params = [isNumeric ? numId : String(couponIdOrCode).trim().toUpperCase()];
  let storeCond = '';
  if (hasStoreId && store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        storeCond = ' AND (c.store_id = 1 OR c.store_id IS NULL)';
      } else {
        storeCond = ' AND c.store_id = ?';
        params.push(sId);
      }
    }
  }

  const couponQuery = `
    SELECT 
      c.id,
      ${hasStoreId ? 'COALESCE(c.store_id, 1) AS store_id,' : '1 AS store_id,'}
      c.code,
      c.discount_type,
      c.discount_value,
      c.min_order_value,
      c.max_discount_amount,
      c.start_date,
      c.end_date,
      c.usage_limit,
      c.usage_count,
      c.active,
      c.created_at,
      c.updated_at
    FROM coupons c
    WHERE (${isNumeric ? 'c.id = ?' : 'UPPER(c.code) = ?'})${storeCond}
    LIMIT 1
  `;

  const [couponRows] = await pool.execute(couponQuery, params);

  if (!couponRows || couponRows.length === 0) {
    return null;
  }

  const coupon = couponRows[0];
  const numCouponId = coupon.id;
  coupon.code = String(coupon.code).toUpperCase();

  const isStore2 = parseInt(coupon.store_id, 10) === 2;
  const minOrderVal = parseInt(coupon.min_order_value, 10) || 0;
  const maxDiscountVal = coupon.max_discount_amount !== null ? (parseInt(coupon.max_discount_amount, 10) || 0) : null;
  const discountVal = parseInt(coupon.discount_value, 10) || 0;

  coupon.min_order_value_rupees = isStore2 ? Math.round(minOrderVal / 100) : minOrderVal;
  coupon.max_discount_amount_rupees = maxDiscountVal !== null ? (isStore2 ? Math.round(maxDiscountVal / 100) : maxDiscountVal) : null;
  coupon.discount_value_rupees = coupon.discount_type === 'fixed' ? (isStore2 ? Math.round(discountVal / 100) : discountVal) : null;

  // Fetch recent usages
  const usageQuery = `
    SELECT 
      cu.id AS usage_id,
      cu.order_id,
      o.order_number,
      cu.customer_id,
      u.name AS customer_name,
      u.email AS customer_email,
      cu.discount_amount,
      cu.used_at
    FROM coupon_usage cu
    JOIN orders o ON cu.order_id = o.id
    LEFT JOIN users u ON cu.customer_id = u.id
    WHERE cu.coupon_id = ?
    ORDER BY cu.used_at DESC, cu.id DESC
    LIMIT 20
  `;

  const [usageRows] = await pool.execute(usageQuery, [numCouponId]);

  coupon.recent_usages = usageRows.map(u => ({
    ...u,
    discount_amount_rupees: Math.round((parseInt(u.discount_amount, 10) || 0) / 100)
  }));

  return coupon;
};

/**
 * Create a new coupon code in MySQL
 */
const createCoupon = async (couponData) => {
  const {
    code,
    discount_type,
    discount_value,
    min_order_value = 0,
    max_discount_amount = null,
    start_date = null,
    end_date = null,
    usage_limit = null,
    active = 1,
    store_id = 1
  } = couponData;

  const hasStoreId = await checkHasStoreId();
  const activeStoreId = parseInt(store_id, 10) === 2 ? 2 : 1;

  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new Error('Coupon code is required');
  }

  const normalizedCode = code.trim().toUpperCase();

  const type = String(discount_type || '').trim().toLowerCase();
  if (type !== 'percent' && type !== 'fixed') {
    throw new Error("Discount type must be either 'percent' or 'fixed'.");
  }

  const parsedVal = parseInt(discount_value, 10);
  if (isNaN(parsedVal) || parsedVal < 0) {
    throw new Error('Discount value is required and must be non-negative.');
  }

  if (type === 'percent' && (parsedVal < 1 || parsedVal > 100)) {
    throw new Error('Percentage discount value must be between 1 and 100.');
  }

  let safeStartDate = null;
  if (start_date) {
    const sDate = new Date(start_date);
    if (!isNaN(sDate.getTime())) {
      safeStartDate = sDate.toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  let safeEndDate = null;
  if (end_date) {
    const eDate = new Date(end_date);
    if (!isNaN(eDate.getTime())) {
      safeEndDate = eDate.toISOString().slice(0, 19).replace('T', ' ');
    }
  }

  if (safeStartDate && safeEndDate && new Date(safeEndDate) < new Date(safeStartDate)) {
    throw new Error('End date cannot be earlier than start date.');
  }

  // Coupon codes are unique within each store when the bridge column exists.
  const dupQuery = hasStoreId
    ? 'SELECT id FROM coupons WHERE UPPER(code) = ? AND store_id = ? LIMIT 1'
    : 'SELECT id FROM coupons WHERE UPPER(code) = ? LIMIT 1';
  const dupParams = hasStoreId
    ? [normalizedCode, activeStoreId]
    : [normalizedCode];

  const [dupRows] = await pool.execute(dupQuery, dupParams);
  if (dupRows.length > 0) {
    throw new Error(`A coupon with code '${normalizedCode}' already exists.`);
  }

  const query = hasStoreId ? `
    INSERT INTO coupons (
      code, store_id, discount_type, discount_value, min_order_value, max_discount_amount, start_date, end_date, usage_limit, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ` : `
    INSERT INTO coupons (
      code, discount_type, discount_value, min_order_value, max_discount_amount, start_date, end_date, usage_limit, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = hasStoreId ? [
    normalizedCode,
    activeStoreId,
    type,
    parsedVal,
    parseInt(min_order_value, 10) || 0,
    max_discount_amount !== null && max_discount_amount !== undefined ? (parseInt(max_discount_amount, 10) || null) : null,
    safeStartDate,
    safeEndDate,
    usage_limit !== null && usage_limit !== undefined ? (parseInt(usage_limit, 10) || null) : null,
    active ? 1 : 0
  ] : [
    normalizedCode,
    type,
    parsedVal,
    parseInt(min_order_value, 10) || 0,
    max_discount_amount !== null && max_discount_amount !== undefined ? (parseInt(max_discount_amount, 10) || null) : null,
    safeStartDate,
    safeEndDate,
    usage_limit !== null && usage_limit !== undefined ? (parseInt(usage_limit, 10) || null) : null,
    active ? 1 : 0
  ];

  const [result] = await pool.execute(query, params);
  return getCouponById(result.insertId, activeStoreId);
};

/**
 * Update an existing coupon code in MySQL
 */
const updateCoupon = async (id, couponData, store_id = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid coupon ID format.');
  }

  const existing = await getCouponById(numId, store_id);
  if (!existing) {
    return null;
  }

  const hasStoreId = await checkHasStoreId();

  const {
    code,
    discount_type,
    discount_value,
    min_order_value,
    max_discount_amount,
    start_date,
    end_date,
    usage_limit,
    active
  } = couponData;

  const updates = [];
  const params = [];

  if (code !== undefined) {
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new Error('Coupon code cannot be empty');
    }
    const normalizedCode = code.trim().toUpperCase();
    const effectiveStoreId = store_id || existing.store_id || 1;
    const dupQuery = hasStoreId
      ? 'SELECT id FROM coupons WHERE UPPER(code) = ? AND store_id = ? AND id != ? LIMIT 1'
      : 'SELECT id FROM coupons WHERE UPPER(code) = ? AND id != ? LIMIT 1';
    const dupParams = hasStoreId
      ? [normalizedCode, effectiveStoreId, numId]
      : [normalizedCode, numId];

    const [dupRows] = await pool.execute(dupQuery, dupParams);
    if (dupRows.length > 0) {
      throw new Error(`A coupon with code '${normalizedCode}' already exists.`);
    }
    updates.push('code = ?');
    params.push(normalizedCode);
  }

  const type = discount_type !== undefined ? String(discount_type).trim().toLowerCase() : existing.discount_type;
  if (discount_type !== undefined) {
    if (type !== 'percent' && type !== 'fixed') {
      throw new Error("Discount type must be either 'percent' or 'fixed'.");
    }
    updates.push('discount_type = ?');
    params.push(type);
  }

  if (discount_value !== undefined) {
    const parsedVal = parseInt(discount_value, 10);
    if (isNaN(parsedVal) || parsedVal < 0) {
      throw new Error('Discount value must be non-negative.');
    }
    if (type === 'percent' && (parsedVal < 1 || parsedVal > 100)) {
      throw new Error('Percentage discount value must be between 1 and 100.');
    }
    updates.push('discount_value = ?');
    params.push(parsedVal);
  }

  if (min_order_value !== undefined) {
    updates.push('min_order_value = ?');
    params.push(parseInt(min_order_value, 10) || 0);
  }

  if (max_discount_amount !== undefined) {
    updates.push('max_discount_amount = ?');
    params.push(max_discount_amount !== null && max_discount_amount !== '' ? (parseInt(max_discount_amount, 10) || null) : null);
  }

  let finalStart = existing.start_date;
  let finalEnd = existing.end_date;

  if (start_date !== undefined) {
    if (start_date) {
      const sDate = new Date(start_date);
      if (isNaN(sDate.getTime())) throw new Error('Invalid start_date format');
      finalStart = sDate.toISOString().slice(0, 19).replace('T', ' ');
    } else {
      finalStart = null;
    }
    updates.push('start_date = ?');
    params.push(finalStart);
  }

  if (end_date !== undefined) {
    if (end_date) {
      const eDate = new Date(end_date);
      if (isNaN(eDate.getTime())) throw new Error('Invalid end_date format');
      finalEnd = eDate.toISOString().slice(0, 19).replace('T', ' ');
    } else {
      finalEnd = null;
    }
    updates.push('end_date = ?');
    params.push(finalEnd);
  }

  if (finalStart && finalEnd && new Date(finalEnd) < new Date(finalStart)) {
    throw new Error('End date cannot be earlier than start date.');
  }

  if (usage_limit !== undefined) {
    updates.push('usage_limit = ?');
    params.push(usage_limit !== null && usage_limit !== '' ? (parseInt(usage_limit, 10) || null) : null);
  }

  if (active !== undefined) {
    updates.push('active = ?');
    params.push(active ? 1 : 0);
  }

  if (updates.length > 0) {
    const query = `UPDATE coupons SET ${updates.join(', ')} WHERE id = ?`;
    params.push(numId);
    await pool.execute(query, params);
  }

  return getCouponById(numId, store_id);
};

/**
 * Soft deactivate a coupon (preserves coupon_usage historical redemption records)
 */
const deleteCoupon = async (id, store_id = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid coupon ID format.');
  }

  const existing = await getCouponById(numId, store_id);
  if (!existing) {
    return false;
  }

  const [result] = await pool.execute('UPDATE coupons SET active = 0 WHERE id = ?', [numId]);
  return result.affectedRows > 0;
};

/**
 * Validate coupon code against subtotal for customer checkout
 */
const validateCoupon = async (code, subtotalPaise = 0, store_id = null) => {
  if (!code || typeof code !== 'string' || !code.trim()) {
    return { valid: false, message: 'Coupon code is required.' };
  }

  const normalizedCode = code.trim().toUpperCase();
  const coupon = await getCouponById(normalizedCode, store_id);

  if (!coupon || !coupon.active) {
    return { valid: false, message: 'Invalid or inactive coupon code.' };
  }

  const now = new Date();
  if (coupon.start_date && new Date(coupon.start_date) > now) {
    return { valid: false, message: 'This coupon is not active yet.' };
  }

  if (coupon.end_date && new Date(coupon.end_date) < now) {
    return { valid: false, message: 'This coupon has expired.' };
  }

  if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
    return { valid: false, message: 'This coupon usage limit has been reached.' };
  }

  const isStore2 = parseInt(store_id || coupon.store_id, 10) === 2;
  const parsedSubtotal = Math.max(parseInt(subtotalPaise, 10) || 0, 0);
  const minOrderRequired = parseInt(coupon.min_order_value, 10) || 0;

  if (parsedSubtotal < minOrderRequired) {
    const minDisplay = isStore2 ? Math.round(minOrderRequired / 100) : minOrderRequired;
    return { valid: false, message: `Minimum order value of ₹${minDisplay} required for this coupon.` };
  }

  let discountAmount = 0;
  if (coupon.discount_type === 'percent') {
    discountAmount = Math.round((parsedSubtotal * coupon.discount_value) / 100);
  } else {
    discountAmount = parseInt(coupon.discount_value, 10) || 0;
  }

  const maxDiscount = coupon.max_discount_amount !== null ? parseInt(coupon.max_discount_amount, 10) : null;
  if (maxDiscount !== null && discountAmount > maxDiscount) {
    discountAmount = maxDiscount;
  }

  if (discountAmount > parsedSubtotal) {
    discountAmount = parsedSubtotal;
  }

  const discountRupees = isStore2 ? Math.round(discountAmount / 100) : discountAmount;
  const discountPaise = isStore2 ? discountAmount : discountAmount * 100;
  const canonicalDiscount = isStore2 ? Math.round(discountAmount / 100) : discountAmount;

  return {
    valid: true,
    message: 'Coupon code applied successfully.',
    coupon: {
      id: coupon.id,
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      min_order_value: minOrderRequired,
      max_discount_amount: maxDiscount,
      discount: canonicalDiscount,
      discount_amount: canonicalDiscount,
      discount_paise: discountPaise,
      discount_rupees: discountRupees
    }
  };
};

module.exports = {
  getCoupons,
  getCouponById,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  validateCoupon
};

