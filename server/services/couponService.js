const { pool } = require('../config/database');
const { isMarshansHybridCatalogEnabled } = require('../config/features');

// The `users` table names its display column `full_name` (schema.sql) but very old installs used
// `name`. Selecting a column that does not exist raised ER_BAD_FIELD_ERROR for EVERY existing
// coupon code (unknown codes returned before that query), which customers saw as
// "An internal error occurred". Detect the real column once instead of guessing.
let usersNameColumn;
const getUsersNameColumn = async () => {
  if (usersNameColumn !== undefined) return usersNameColumn;
  try {
    const [cols] = await pool.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('full_name', 'name')");
    const names = (cols || []).map(c => c.COLUMN_NAME);
    usersNameColumn = names.includes('full_name') ? 'full_name' : (names.includes('name') ? 'name' : null);
  } catch (err) {
    console.warn('[Coupon Service] users name-column lookup failed:', err.message);
    usersNameColumn = null;
  }
  return usersNameColumn;
};

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

let hasPerCustomerLimitCol = null;
const checkHasPerCustomerLimit = async () => {
  if (hasPerCustomerLimitCol !== null) return hasPerCustomerLimitCol;
  try {
    const [cols] = await pool.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'");
    hasPerCustomerLimitCol = cols && cols.length > 0;
  } catch (e) {
    hasPerCustomerLimitCol = false;
  }
  return hasPerCustomerLimitCol;
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
  const hasPerCust = await checkHasPerCustomerLimit();
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
      ${hasPerCust ? 'COALESCE(c.per_customer_limit, 1) AS per_customer_limit,' : '1 AS per_customer_limit,'}
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
      per_customer_limit: r.per_customer_limit !== undefined ? (parseInt(r.per_customer_limit, 10) || 1) : 1,
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
const getCouponById = async (couponIdOrCode, store_id = null, { includeUsages = true } = {}) => {
  if (!couponIdOrCode) return null;

  const numId = parseInt(couponIdOrCode, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(couponIdOrCode);
  const hasStoreId = await checkHasStoreId();
  const hasPerCust = await checkHasPerCustomerLimit();

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
      ${hasPerCust ? 'COALESCE(c.per_customer_limit, 1) AS per_customer_limit,' : '1 AS per_customer_limit,'}
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
  coupon.per_customer_limit = coupon.per_customer_limit !== undefined ? (parseInt(coupon.per_customer_limit, 10) || 1) : 1;

  const isStore2 = parseInt(coupon.store_id, 10) === 2;
  const minOrderVal = parseInt(coupon.min_order_value, 10) || 0;
  const maxDiscountVal = coupon.max_discount_amount !== null ? (parseInt(coupon.max_discount_amount, 10) || 0) : null;
  const discountVal = parseInt(coupon.discount_value, 10) || 0;

  coupon.min_order_value_rupees = isStore2 ? Math.round(minOrderVal / 100) : minOrderVal;
  coupon.max_discount_amount_rupees = maxDiscountVal !== null ? (isStore2 ? Math.round(maxDiscountVal / 100) : maxDiscountVal) : null;
  coupon.discount_value_rupees = coupon.discount_type === 'fixed' ? (isStore2 ? Math.round(discountVal / 100) : discountVal) : null;

  // Fetch recent usages safely if requested
  coupon.recent_usages = [];
  if (includeUsages) {
    try {
      const nameCol = await getUsersNameColumn();
      const usageQuery = `
        SELECT
          cu.id AS usage_id,
          cu.order_id,
          o.order_number,
          cu.customer_id,
          ${nameCol ? `COALESCE(u.${nameCol}, '')` : "''"} AS customer_name,
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
      if (Array.isArray(usageRows)) {
        coupon.recent_usages = usageRows.map(u => ({
          ...u,
          discount_amount_rupees: Math.round((parseInt(u.discount_amount, 10) || 0) / 100)
        }));
      }
    } catch (usageErr) {
      console.warn('[Coupon Service] Recent usages lookup notice:', usageErr.message);
      coupon.recent_usages = [];
    }
  }

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
    per_customer_limit = 1,
    active = 1,
    store_id = 1
  } = couponData;

  const hasStoreId = await checkHasStoreId();
  const hasPerCust = await checkHasPerCustomerLimit();
  const activeStoreId = parseInt(store_id, 10) === 2 ? 2 : 1;

  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new Error('Coupon code is required');
  }

  const normalizedCode = code.trim().toUpperCase();

  const type = String(discount_type || '').trim().toLowerCase();
  if (type !== 'percent' && type !== 'fixed') {
    throw new Error("Discount type must be either 'percent' or 'fixed'.");
  }

  let parsedVal = parseInt(discount_value, 10);
  if (isNaN(parsedVal) || parsedVal < 0) {
    throw new Error('Discount value is required and must be non-negative.');
  }

  if (type === 'percent' && (parsedVal < 1 || parsedVal > 100)) {
    throw new Error('Percentage discount value must be between 1 and 100.');
  }

  // Store 2 fixed discount unit normalization (preserves paise internally while supporting rupees input):
  if (activeStoreId === 2 && type === 'fixed') {
    if (couponData.discount_value_rupees !== undefined) {
      parsedVal = Math.round(Number(couponData.discount_value_rupees) * 100);
    } else if (couponData.is_paise === true) {
      parsedVal = Math.round(parsedVal);
    } else {
      parsedVal = Math.round(parsedVal * 100);
    }
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

  const columns = ['code'];
  const valuesPlaceholders = ['?'];
  const params = [normalizedCode];

  if (hasStoreId) {
    columns.push('store_id');
    valuesPlaceholders.push('?');
    params.push(activeStoreId);
  }

  if (hasPerCust) {
    columns.push('per_customer_limit');
    valuesPlaceholders.push('?');
    params.push(Math.max(parseInt(per_customer_limit, 10) || 1, 1));
  }

  columns.push('discount_type', 'discount_value', 'min_order_value', 'max_discount_amount', 'start_date', 'end_date', 'usage_limit', 'active');
  valuesPlaceholders.push('?', '?', '?', '?', '?', '?', '?', '?');
  params.push(
    type,
    parsedVal,
    parseInt(min_order_value, 10) || 0,
    max_discount_amount !== null && max_discount_amount !== undefined ? (parseInt(max_discount_amount, 10) || null) : null,
    safeStartDate,
    safeEndDate,
    usage_limit !== null && usage_limit !== undefined ? (parseInt(usage_limit, 10) || null) : null,
    active ? 1 : 0
  );

  const query = `INSERT INTO coupons (${columns.join(', ')}) VALUES (${valuesPlaceholders.join(', ')})`;
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
  const hasPerCust = await checkHasPerCustomerLimit();

  const {
    code,
    discount_type,
    discount_value,
    min_order_value,
    max_discount_amount,
    start_date,
    end_date,
    usage_limit,
    per_customer_limit,
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
    let parsedVal = parseInt(discount_value, 10);
    if (isNaN(parsedVal) || parsedVal < 0) {
      throw new Error('Discount value must be non-negative.');
    }
    if (type === 'percent' && (parsedVal < 1 || parsedVal > 100)) {
      throw new Error('Percentage discount value must be between 1 and 100.');
    }
    const effStoreId = parseInt(store_id || existing.store_id, 10) === 2 ? 2 : 1;
    if (effStoreId === 2 && type === 'fixed') {
      if (couponData.discount_value_rupees !== undefined) {
        parsedVal = Math.round(Number(couponData.discount_value_rupees) * 100);
      } else if (couponData.is_paise === true) {
        parsedVal = Math.round(parsedVal);
      } else {
        parsedVal = Math.round(parsedVal * 100);
      }
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

  if (per_customer_limit !== undefined && hasPerCust) {
    updates.push('per_customer_limit = ?');
    params.push(Math.max(parseInt(per_customer_limit, 10) || 1, 1));
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
const validateCoupon = async (code, subtotalPaise = 0, store_id = null, customer_id = null, current_order_id = null, preloadedCoupon = null) => {
  if (!code || typeof code !== 'string' || !code.trim()) {
    return { valid: false, message: 'Coupon code is required.' };
  }

  const normalizedCode = code.trim().toUpperCase();
  const coupon = preloadedCoupon || await getCouponById(normalizedCode, store_id, { includeUsages: false });

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

  // Active reservations within the last 15 minutes hold spots against global usage limit
  let activeReservedCount = 0;
  try {
    const [resRows] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ? AND status = 'reserved' AND reserved_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND (? IS NULL OR order_id != ?)",
      [coupon.id, current_order_id, current_order_id]
    );
    activeReservedCount = resRows[0]?.cnt || 0;
  } catch (err) {
    console.warn('[Coupon Service] reservation count unavailable (coupon_usage.status/reserved_at missing?):', err.message);
  }

  const effectiveGlobalUsage = (parseInt(coupon.usage_count, 10) || 0) + activeReservedCount;
  if (coupon.usage_limit && effectiveGlobalUsage >= coupon.usage_limit) {
    return { valid: false, message: 'This coupon usage limit has been reached.' };
  }

  // Per-customer redemption limit check
  const custLimit = coupon.per_customer_limit !== undefined && coupon.per_customer_limit !== null
    ? parseInt(coupon.per_customer_limit, 10)
    : 1;

  if (customer_id && custLimit > 0) {
    let customerUsageCount = 0;
    try {
      const [custRows] = await pool.execute(
        "SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ? AND customer_id = ? AND (status = 'consumed' OR (status = 'reserved' AND reserved_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND (? IS NULL OR order_id != ?)))",
        [coupon.id, customer_id, current_order_id, current_order_id]
      );
      customerUsageCount = custRows[0]?.cnt || 0;
    } catch (err) {
      console.warn('[Coupon Service] per-customer status query failed, using legacy count:', err.message);
      const [custRowsLegacy] = await pool.execute(
        "SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = ? AND customer_id = ?",
        [coupon.id, customer_id]
      );
      customerUsageCount = custRowsLegacy[0]?.cnt || 0;
    }

    if (customerUsageCount >= custLimit) {
      return { valid: false, message: 'You have already reached the redemption limit for this coupon.' };
    }
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
      min_order_value_rupees: isStore2 ? Math.round(minOrderRequired / 100) : minOrderRequired,
      max_discount_amount: maxDiscount,
      max_discount_amount_rupees: maxDiscount !== null ? (isStore2 ? Math.round(maxDiscount / 100) : maxDiscount) : null,
      per_customer_limit: custLimit,
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

