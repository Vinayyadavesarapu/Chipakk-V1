const { pool } = require('../config/database');
const { normalizeIndianPhoneNumber } = require('../utils/phoneUtils');

/**
 * Resolve existing customer record or idempotently auto-provision a new row in users table.
 * Strictly binds Firebase UID <-> MySQL users.id relationship.
 *
 * @param {Object} firebaseUser - Authenticated user payload (from req.user or Firebase token)
 * @param {Object} extraData - Optional profile attributes (full_name, phone, etc.)
 * @param {Object} connection - MySQL pool or transaction connection
 * @returns {Promise<Object>} Authoritative customer database record
 */
const resolveOrCreateCustomer = async (firebaseUser, extraData = {}, connection = pool) => {
  const uid = firebaseUser?.uid;
  if (!uid || typeof uid !== 'string' || !uid.trim()) {
    const err = new Error('Valid Firebase UID is required to identify customer.');
    err.statusCode = 400;
    throw err;
  }

  const cleanUid = uid.trim();
  const rawEmail = (extraData.email || firebaseUser.email || '').trim().toLowerCase();
  const rawName = (extraData.full_name || extraData.name || (firebaseUser.token && (firebaseUser.token.name || firebaseUser.token.display_name)) || firebaseUser.displayName || firebaseUser.name || '').trim();
  const rawPhone = (extraData.phone || firebaseUser.phoneNumber || firebaseUser.phone || '').trim();

  let cleanPhone = null;
  if (rawPhone) {
    const phoneCheck = normalizeIndianPhoneNumber(rawPhone);
    cleanPhone = phoneCheck.valid ? phoneCheck.phone : rawPhone;
  }

  // 1. Primary Lookup by Firebase UID (authoritative unique invariant)
  const [uidRows] = await connection.execute(
    'SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = ? LIMIT 1',
    [cleanUid]
  ).catch(async (err) => {
    // Fallback if column is named 'name' instead of 'full_name'
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const [nameRows] = await connection.execute(
        'SELECT id, firebase_uid, email, name AS full_name, phone, created_at FROM users WHERE firebase_uid = ? LIMIT 1',
        [cleanUid]
      );
      return [nameRows];
    }
    throw err;
  });

  if (uidRows && uidRows.length > 0) {
    const customer = uidRows[0];
    // Enrich missing fields if new values are supplied
    const needsNameUpdate = rawName && (!customer.full_name || customer.full_name.trim().length === 0);
    const needsPhoneUpdate = cleanPhone && (!customer.phone || customer.phone.trim().length === 0);
    const needsEmailUpdate = rawEmail && (!customer.email || customer.email.trim().length === 0);

    if (needsNameUpdate || needsPhoneUpdate || needsEmailUpdate) {
      try {
        await connection.execute(
          'UPDATE users SET full_name = COALESCE(full_name, ?), phone = COALESCE(phone, ?), email = COALESCE(NULLIF(email, ""), ?) WHERE id = ?',
          [rawName || null, cleanPhone || null, rawEmail || null, customer.id]
        );
      } catch (upErr) {
        if (upErr.message && upErr.message.includes("Unknown column 'full_name'")) {
          await connection.execute(
            'UPDATE users SET name = COALESCE(name, ?), phone = COALESCE(phone, ?), email = COALESCE(NULLIF(email, ""), ?) WHERE id = ?',
            [rawName || null, cleanPhone || null, rawEmail || null, customer.id]
          ).catch(() => {});
        }
      }
      if (needsNameUpdate) customer.full_name = rawName;
      if (needsPhoneUpdate) customer.phone = cleanPhone;
      if (needsEmailUpdate) customer.email = rawEmail;
    }

    return {
      id: customer.id,
      firebase_uid: customer.firebase_uid,
      email: customer.email,
      full_name: customer.full_name || null,
      name: customer.full_name || null,
      phone: customer.phone || null,
      created_at: customer.created_at
    };
  }

  // 2. Secondary Lookup by Email (Links pre-existing records or guest orders)
  if (rawEmail) {
    const [emailRows] = await connection.execute(
      'SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE email IS NOT NULL AND LOWER(email) = LOWER(?) LIMIT 1',
      [rawEmail]
    ).catch(async (err) => {
      if (err.message && err.message.includes("Unknown column 'full_name'")) {
        const [nameRows] = await connection.execute(
          'SELECT id, firebase_uid, email, name AS full_name, phone, created_at FROM users WHERE email IS NOT NULL AND LOWER(email) = LOWER(?) LIMIT 1',
          [rawEmail]
        );
        return [nameRows];
      }
      throw err;
    });

    if (emailRows && emailRows.length > 0) {
      const existingUser = emailRows[0];
      // Bind this user's Firebase UID and update name/phone if missing
      try {
        await connection.execute(
          'UPDATE users SET firebase_uid = ?, full_name = COALESCE(full_name, ?), phone = COALESCE(phone, ?) WHERE id = ?',
          [cleanUid, rawName || null, cleanPhone || null, existingUser.id]
        );
      } catch (linkErr) {
        if (linkErr.message && linkErr.message.includes("Unknown column 'full_name'")) {
          await connection.execute(
            'UPDATE users SET firebase_uid = ?, name = COALESCE(name, ?), phone = COALESCE(phone, ?) WHERE id = ?',
            [cleanUid, rawName || null, cleanPhone || null, existingUser.id]
          ).catch(() => {});
        }
      }

      return {
        id: existingUser.id,
        firebase_uid: cleanUid,
        email: existingUser.email,
        full_name: rawName || existingUser.full_name || null,
        name: rawName || existingUser.full_name || null,
        phone: cleanPhone || existingUser.phone || null,
        created_at: existingUser.created_at
      };
    }
  }

  // 3. Auto-Provision New Record in users table
  try {
    const [insertResult] = await connection.execute(
      'INSERT INTO users (firebase_uid, email, full_name, phone) VALUES (?, ?, ?, ?)',
      [cleanUid, rawEmail || '', rawName || null, cleanPhone || null]
    );

    return {
      id: insertResult.insertId,
      firebase_uid: cleanUid,
      email: rawEmail || '',
      full_name: rawName || null,
      name: rawName || null,
      phone: cleanPhone || null,
      created_at: new Date()
    };
  } catch (err) {
    // Handle fallback if column is 'name'
    if (err.message && (err.message.includes("Unknown column 'full_name'") || err.code === 'ER_BAD_FIELD_ERROR')) {
      const [fallbackResult] = await connection.execute(
        'INSERT INTO users (firebase_uid, email, name, phone) VALUES (?, ?, ?, ?)',
        [cleanUid, rawEmail || '', rawName || null, cleanPhone || null]
      );
      return {
        id: fallbackResult.insertId,
        firebase_uid: cleanUid,
        email: rawEmail || '',
        full_name: rawName || null,
        name: rawName || null,
        phone: cleanPhone || null,
        created_at: new Date()
      };
    }
    // Handle race condition where another concurrent request already inserted this UID
    if (err.code === 'ER_DUP_ENTRY' || (err.message && err.message.includes('Duplicate entry'))) {
      const [retryRows] = await connection.execute(
        'SELECT id, firebase_uid, email, full_name, phone, created_at FROM users WHERE firebase_uid = ? LIMIT 1',
        [cleanUid]
      );
      if (retryRows && retryRows.length > 0) {
        return {
          id: retryRows[0].id,
          firebase_uid: retryRows[0].firebase_uid,
          email: retryRows[0].email,
          full_name: retryRows[0].full_name || null,
          name: retryRows[0].full_name || null,
          phone: retryRows[0].phone || null,
          created_at: retryRows[0].created_at
        };
      }
    }
    throw err;
  }
};

/**
 * Update Customer Profile (name, phone) in MySQL users table.
 *
 * @param {string} firebaseUid - Authenticated customer Firebase UID
 * @param {Object} profileData - { full_name, phone }
 * @param {Object} connection - MySQL pool or transaction connection
 * @returns {Promise<Object>} Updated customer profile
 */
const updateCustomerProfile = async (firebaseUid, profileData = {}, connection = pool) => {
  if (!firebaseUid) {
    const err = new Error('Authentication required to update profile.');
    err.statusCode = 401;
    throw err;
  }

  // Ensure customer exists
  await resolveOrCreateCustomer({ uid: firebaseUid }, profileData, connection);

  const updates = [];
  const params = [];

  if (profileData.full_name !== undefined || profileData.name !== undefined) {
    const targetName = (profileData.full_name !== undefined ? profileData.full_name : profileData.name);
    const cleanName = typeof targetName === 'string' ? targetName.trim() : '';
    if (cleanName.length < 2) {
      const err = new Error('Display name must be at least 2 characters.');
      err.statusCode = 400;
      throw err;
    }
    updates.push('full_name = ?');
    params.push(cleanName);
  }

  if (profileData.phone !== undefined) {
    const rawPhone = String(profileData.phone || '').trim();
    if (rawPhone.length > 0) {
      const phoneValidation = normalizeIndianPhoneNumber(rawPhone);
      if (!phoneValidation.valid) {
        const err = new Error('Please enter a valid 10-digit Indian mobile number.');
        err.statusCode = 400;
        throw err;
      }
      updates.push('phone = ?');
      params.push(phoneValidation.phone);
    } else {
      updates.push('phone = NULL');
    }
  }

  if (updates.length > 0) {
    params.push(firebaseUid);
    try {
      await connection.execute(
        `UPDATE users SET ${updates.join(', ')} WHERE firebase_uid = ?`,
        params
      );
    } catch (err) {
      if (err.message && err.message.includes("Unknown column 'full_name'")) {
        const fallbackUpdates = updates.map(u => u.replace('full_name', 'name'));
        await connection.execute(
          `UPDATE users SET ${fallbackUpdates.join(', ')} WHERE firebase_uid = ?`,
          params
        );
      } else {
        throw err;
      }
    }
  }

  return resolveOrCreateCustomer({ uid: firebaseUid }, {}, connection);
};

/**
 * Calculate loyalty tier based on delivered orders count
 */
const calculateCustomerTier = (deliveredOrders = 0) => {
  const count = parseInt(deliveredOrders, 10) || 0;
  if (count >= 5) return 'ELITE';
  if (count >= 2) return 'VIP';
  if (count >= 1) return 'REGULAR';
  return 'NEW';
};

/**
 * Get paginated list of customers with computed order metrics
 */
const getCustomers = async ({ search = '', limit = 50, offset = 0, store_id = null } = {}) => {
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const conditions = [];
  const params = [];

  if (search && String(search).trim()) {
    const term = `%${String(search).trim().toLowerCase()}%`;
    conditions.push('(LOWER(COALESCE(u.full_name, u.name, "")) LIKE ? OR LOWER(COALESCE(u.email, "")) LIKE ? OR COALESCE(u.phone, "") LIKE ?)');
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Store filter for orders join
  let orderStoreCondition = '';
  const orderStoreParams = [];
  if (store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        orderStoreCondition = ' AND (o.store_id = 1 OR o.store_id IS NULL)';
      } else {
        orderStoreCondition = ' AND o.store_id = ?';
        orderStoreParams.push(sId);
      }
    }
  }

  // Count query
  let total = 0;
  try {
    const countSql = `SELECT COUNT(*) AS total FROM users u ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    total = countRows[0]?.total || 0;
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const fallbackCountSql = whereClause.replace(/u\.full_name/g, 'u.name');
      const [countRows] = await pool.execute(fallbackCountSql, params);
      total = countRows[0]?.total || 0;
    } else {
      console.warn('[getCustomers count error]', err.message);
    }
  }

  // Query customers with aggregated order metrics
  const listSql = `
    SELECT
      u.id,
      u.firebase_uid,
      COALESCE(u.full_name, u.name, 'Customer') AS name,
      COALESCE(u.full_name, u.name, 'Customer') AS full_name,
      u.email,
      u.phone,
      u.created_at,
      COUNT(o.id) AS total_orders,
      SUM(CASE WHEN o.fulfillment_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_orders,
      COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total_price ELSE 0 END), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON (o.customer_id = u.firebase_uid OR (o.customer_email IS NOT NULL AND LOWER(o.customer_email) = LOWER(u.email)))${orderStoreCondition}
    ${whereClause}
    GROUP BY u.id, u.firebase_uid, u.email, u.phone, u.created_at
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ? OFFSET ?
  `;

  let customers = [];
  try {
    const queryParams = [...orderStoreParams, ...params, parsedLimit, parsedOffset];
    const [rows] = await pool.execute(listSql, queryParams);
    customers = rows.map(r => {
      const deliveredCount = parseInt(r.delivered_orders, 10) || 0;
      const tier = calculateCustomerTier(deliveredCount);
      return {
        id: r.id,
        firebase_uid: r.firebase_uid,
        name: r.name,
        full_name: r.name,
        email: r.email || '',
        phone: r.phone || '',
        total_orders: parseInt(r.total_orders, 10) || 0,
        delivered_orders: deliveredCount,
        total_spent: parseInt(r.total_spent, 10) || 0,
        status: tier,
        loyalty_tier: tier,
        created_at: r.created_at
      };
    });
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const fallbackListSql = listSql.replace(/u\.full_name/g, 'u.name');
      const queryParams = [...orderStoreParams, ...params, parsedLimit, parsedOffset];
      const [rows] = await pool.execute(fallbackListSql, queryParams);
      customers = rows.map(r => {
        const deliveredCount = parseInt(r.delivered_orders, 10) || 0;
        const tier = calculateCustomerTier(deliveredCount);
        return {
          id: r.id,
          firebase_uid: r.firebase_uid,
          name: r.name,
          full_name: r.name,
          email: r.email || '',
          phone: r.phone || '',
          total_orders: parseInt(r.total_orders, 10) || 0,
          delivered_orders: deliveredCount,
          total_spent: parseInt(r.total_spent, 10) || 0,
          status: tier,
          loyalty_tier: tier,
          created_at: r.created_at
        };
      });
    } else {
      console.error('[getCustomers error]', err.message);
      throw err;
    }
  }

  return {
    customers,
    total,
    pagination: {
      total,
      limit: parsedLimit,
      offset: parsedOffset
    }
  };
};

/**
 * Get single customer by ID or Firebase UID with recent orders
 */
const getCustomerById = async (idOrUid, store_id = null) => {
  const isNumeric = /^\d+$/.test(String(idOrUid).trim());
  const whereCol = isNumeric ? 'u.id' : 'u.firebase_uid';
  const val = isNumeric ? parseInt(idOrUid, 10) : String(idOrUid).trim();

  let user = null;
  try {
    const [rows] = await pool.execute(
      `SELECT id, firebase_uid, COALESCE(full_name, name, 'Customer') AS name, email, phone, created_at FROM users u WHERE ${whereCol} = ? LIMIT 1`,
      [val]
    );
    if (!rows || rows.length === 0) return null;
    user = rows[0];
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const [rows] = await pool.execute(
        `SELECT id, firebase_uid, COALESCE(name, 'Customer') AS name, email, phone, created_at FROM users u WHERE ${whereCol} = ? LIMIT 1`,
        [val]
      );
      if (!rows || rows.length === 0) return null;
      user = rows[0];
    } else {
      throw err;
    }
  }

  // Fetch customer's orders
  let orderStoreCondition = '';
  const orderParams = [user.firebase_uid, user.email || ''];
  if (store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        orderStoreCondition = ' AND (store_id = 1 OR store_id IS NULL)';
      } else {
        orderStoreCondition = ' AND store_id = ?';
        orderParams.push(sId);
      }
    }
  }

  const [orderRows] = await pool.execute(
    `SELECT id, order_number, fulfillment_status, payment_status, total_price, created_at FROM orders WHERE (customer_id = ? OR (customer_email IS NOT NULL AND LOWER(customer_email) = LOWER(?)))${orderStoreCondition} ORDER BY created_at DESC LIMIT 20`,
    orderParams
  );

  const totalOrders = orderRows.length;
  const deliveredOrders = orderRows.filter(o => o.fulfillment_status === 'DELIVERED').length;
  const totalSpent = orderRows
    .filter(o => o.payment_status === 'paid')
    .reduce((sum, o) => sum + (parseInt(o.total_price, 10) || 0), 0);
  const tier = calculateCustomerTier(deliveredOrders);

  return {
    ...user,
    total_orders: totalOrders,
    delivered_orders: deliveredOrders,
    total_spent: totalSpent,
    status: tier,
    loyalty_tier: tier,
    recent_orders: orderRows
  };
};

module.exports = {
  resolveOrCreateCustomer,
  updateCustomerProfile,
  getCustomers,
  getCustomerById,
  calculateCustomerTier
};
