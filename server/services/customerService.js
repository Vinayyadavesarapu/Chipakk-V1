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

  const isStore2 = store_id !== null && store_id !== undefined && parseInt(store_id, 10) === 2;

  const conditions = [];
  const params = [];

  if (search && String(search).trim()) {
    const term = `%${String(search).trim().toLowerCase()}%`;
    conditions.push('(LOWER(COALESCE(u.full_name, "")) LIKE ? OR LOWER(COALESCE(u.email, "")) LIKE ? OR COALESCE(u.phone, "") LIKE ?)');
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
    if (isStore2) {
      const countSql = `
        SELECT COUNT(DISTINCT u.id) AS total
        FROM users u
        INNER JOIN orders o ON (o.customer_id = u.id OR o.customer_id = u.firebase_uid OR (o.customer_email IS NOT NULL AND LOWER(o.customer_email) = LOWER(u.email)))
        WHERE o.store_id = 2 ${whereClause ? 'AND ' + conditions.join(' AND ') : ''}
      `;
      const [countRows] = await pool.execute(countSql, params);
      total = countRows[0]?.total || 0;
    } else {
      const countSql = `SELECT COUNT(*) AS total FROM users u ${whereClause}`;
      const [countRows] = await pool.execute(countSql, params);
      total = countRows[0]?.total || 0;
    }
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const fallbackCountSql = whereClause.replace(/u\.full_name/g, 'u.name');
      const [countRows] = await pool.execute(fallbackCountSql, params);
      total = countRows[0]?.total || 0;
    } else {
      console.warn('[getCustomers count error]', err.message);
    }
  }

  // Store 2 only displays customers with Store 2 orders
  const havingClause = isStore2 ? 'HAVING COUNT(o.id) > 0' : '';

  // Query customers with aggregated order metrics (zero u.name references)
  const listSql = `
    SELECT
      u.id,
      u.firebase_uid,
      COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(MAX(o.customer_name)), ''), 'Customer') AS name,
      COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(MAX(o.customer_name)), ''), 'Customer') AS full_name,
      COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(MAX(o.customer_name)), ''), 'Customer') AS customer_name,
      COALESCE(NULLIF(TRIM(u.email), ''), NULLIF(TRIM(MAX(o.customer_email)), ''), '') AS email,
      COALESCE(NULLIF(TRIM(u.phone), ''), NULLIF(TRIM(MAX(o.customer_phone)), ''), NULLIF(TRIM(MAX(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')))), ''), '') AS phone,
      u.created_at,
      COUNT(o.id) AS total_orders,
      SUM(CASE WHEN UPPER(o.fulfillment_status) IN ('DELIVERED', 'COMPLETED') THEN 1 ELSE 0 END) AS completed_orders,
      COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total_price ELSE 0 END), 0) AS total_spent,
      MAX(o.created_at) AS last_order
    FROM users u
    LEFT JOIN orders o ON (o.customer_id = u.id OR o.customer_id = u.firebase_uid OR (o.customer_email IS NOT NULL AND LOWER(o.customer_email) = LOWER(u.email)))${orderStoreCondition}
    ${whereClause}
    GROUP BY u.id, u.firebase_uid, u.email, u.phone, u.full_name, u.created_at
    ${havingClause}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ? OFFSET ?
  `;

  let customers = [];
  try {
    const queryParams = [...orderStoreParams, ...params, parsedLimit, parsedOffset];
    const [rows] = await pool.execute(listSql, queryParams);
    customers = rows.map(r => {
      const completedCount = parseInt(r.completed_orders !== undefined ? r.completed_orders : r.delivered_orders, 10) || 0;
      const tier = calculateCustomerTier(completedCount);
      const rawSpent = parseInt(r.total_spent, 10) || 0;
      const spendRupees = isStore2 ? Math.round(rawSpent / 100) : rawSpent;
      const lastOrderVal = r.last_order ? (r.last_order instanceof Date ? r.last_order.toISOString() : String(r.last_order)) : null;

      return {
        id: r.id,
        firebase_uid: r.firebase_uid || null,
        name: r.name || 'Customer',
        full_name: r.name || 'Customer',
        customer_name: r.name || 'Customer',
        email: r.email || '',
        phone: r.phone || '',
        total_orders: parseInt(r.total_orders, 10) || 0,
        completed_orders: completedCount,
        delivered_orders: completedCount,
        total_spend: spendRupees,
        total_spent: spendRupees,
        total_spend_rupees: spendRupees,
        last_order: lastOrderVal,
        status: tier,
        loyalty_tier: tier,
        created_at: r.created_at
      };
    });

    // Check if any guest/unlinked orders exist that match the store filter
    if (isStore2 || store_id !== null) {
      try {
        const existingEmails = new Set(customers.map(c => (c.email || '').toLowerCase()).filter(Boolean));
        const guestOrderSql = `
          SELECT
            o.customer_email,
            o.customer_name,
            o.customer_phone,
            o.shipping_address,
            o.fulfillment_status,
            o.payment_status,
            o.total_price,
            o.created_at
          FROM orders o
          WHERE (o.customer_id IS NULL OR o.customer_id NOT IN (SELECT id FROM users))
            ${orderStoreCondition}
          ORDER BY o.created_at DESC
        `;
        const [guestRows] = await pool.execute(guestOrderSql, orderStoreParams);
        if (guestRows && guestRows.length > 0) {
          const guestMap = new Map();
          for (const go of guestRows) {
            const emailKey = (go.customer_email || '').toLowerCase().trim();
            const key = emailKey || (go.customer_name || '').toLowerCase().trim();
            if (!key || existingEmails.has(emailKey)) continue;

            if (!guestMap.has(key)) {
              let parsedPhone = go.customer_phone || '';
              if (!parsedPhone && go.shipping_address) {
                try {
                  const parsedAddr = typeof go.shipping_address === 'string' ? JSON.parse(go.shipping_address) : go.shipping_address;
                  parsedPhone = parsedAddr.phone || '';
                } catch (_) {}
              }
              guestMap.set(key, {
                id: `guest_${key}`,
                firebase_uid: null,
                name: go.customer_name || 'Customer',
                email: go.customer_email || '',
                phone: parsedPhone || '',
                total_orders: 0,
                completed_orders: 0,
                raw_spent: 0,
                last_order: go.created_at,
                created_at: go.created_at
              });
            }

            const item = guestMap.get(key);
            item.total_orders += 1;
            if (['DELIVERED', 'COMPLETED'].includes(String(go.fulfillment_status || '').toUpperCase())) {
              item.completed_orders += 1;
            }
            if (String(go.payment_status || '').toLowerCase() === 'paid') {
              item.raw_spent += parseInt(go.total_price, 10) || 0;
            }
            if (new Date(go.created_at) > new Date(item.last_order)) {
              item.last_order = go.created_at;
            }
          }

          for (const gCust of guestMap.values()) {
            const spendRupees = isStore2 ? Math.round(gCust.raw_spent / 100) : gCust.raw_spent;
            const tier = calculateCustomerTier(gCust.completed_orders);
            customers.push({
              id: gCust.id,
              firebase_uid: null,
              name: gCust.name,
              full_name: gCust.name,
              customer_name: gCust.name,
              email: gCust.email,
              phone: gCust.phone,
              total_orders: gCust.total_orders,
              completed_orders: gCust.completed_orders,
              delivered_orders: gCust.completed_orders,
              total_spend: spendRupees,
              total_spent: spendRupees,
              total_spend_rupees: spendRupees,
              last_order: gCust.last_order instanceof Date ? gCust.last_order.toISOString() : String(gCust.last_order),
              status: tier,
              loyalty_tier: tier,
              created_at: gCust.created_at
            });
            total += 1;
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const fallbackListSql = listSql.replace(/u\.full_name/g, 'u.name');
      const queryParams = [...orderStoreParams, ...params, parsedLimit, parsedOffset];
      const [rows] = await pool.execute(fallbackListSql, queryParams);
      customers = rows.map(r => {
        const completedCount = parseInt(r.completed_orders !== undefined ? r.completed_orders : r.delivered_orders, 10) || 0;
        const tier = calculateCustomerTier(completedCount);
        const rawSpent = parseInt(r.total_spent, 10) || 0;
        const spendRupees = isStore2 ? Math.round(rawSpent / 100) : rawSpent;
        const lastOrderVal = r.last_order ? (r.last_order instanceof Date ? r.last_order.toISOString() : String(r.last_order)) : null;

        return {
          id: r.id,
          firebase_uid: r.firebase_uid || null,
          name: r.name || 'Customer',
          full_name: r.name || 'Customer',
          customer_name: r.name || 'Customer',
          email: r.email || '',
          phone: r.phone || '',
          total_orders: parseInt(r.total_orders, 10) || 0,
          completed_orders: completedCount,
          delivered_orders: completedCount,
          total_spend: spendRupees,
          total_spent: spendRupees,
          total_spend_rupees: spendRupees,
          last_order: lastOrderVal,
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
      `SELECT id, firebase_uid, COALESCE(full_name, 'Customer') AS name, full_name, email, phone, created_at FROM users u WHERE ${whereCol} = ? LIMIT 1`,
      [val]
    );
    if (rows && rows.length > 0) user = rows[0];
  } catch (err) {
    if (err.message && err.message.includes("Unknown column 'full_name'")) {
      const [rows] = await pool.execute(
        `SELECT id, firebase_uid, COALESCE(name, 'Customer') AS name, name AS full_name, email, phone, created_at FROM users u WHERE ${whereCol} = ? LIMIT 1`,
        [val]
      );
      if (rows && rows.length > 0) user = rows[0];
    } else {
      throw err;
    }
  }

  const isStore2 = store_id !== null && store_id !== undefined && parseInt(store_id, 10) === 2;

  if (user) {
    let orderStoreCondition = '';
    const orderParams = [user.id, user.firebase_uid, user.email || ''];
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
      `SELECT id, order_number, customer_name, customer_email, customer_phone, fulfillment_status, payment_status, total_price, created_at FROM orders WHERE (customer_id = ? OR customer_id = ? OR (customer_email IS NOT NULL AND LOWER(customer_email) = LOWER(?)))${orderStoreCondition} ORDER BY created_at DESC LIMIT 20`,
      orderParams
    );

    const totalOrders = orderRows.length;
    const completedOrders = orderRows.filter(o => ['DELIVERED', 'COMPLETED'].includes(String(o.fulfillment_status || '').toUpperCase())).length;
    const rawTotalSpent = orderRows
      .filter(o => String(o.payment_status || '').toLowerCase() === 'paid')
      .reduce((sum, o) => sum + (parseInt(o.total_price, 10) || 0), 0);
    const totalSpentRupees = isStore2 ? Math.round(rawTotalSpent / 100) : rawTotalSpent;
    const tier = calculateCustomerTier(completedOrders);

    const resolvedName = (user.name && user.name !== 'Customer') ? user.name : (orderRows[0]?.customer_name || user.name || 'Customer');
    const resolvedEmail = user.email || orderRows[0]?.customer_email || '';
    const resolvedPhone = user.phone || orderRows[0]?.customer_phone || '';
    const lastOrderDate = orderRows[0] ? orderRows[0].created_at : null;

    return {
      id: user.id,
      firebase_uid: user.firebase_uid,
      name: resolvedName,
      full_name: resolvedName,
      customer_name: resolvedName,
      email: resolvedEmail,
      phone: resolvedPhone,
      created_at: user.created_at,
      total_orders: totalOrders,
      completed_orders: completedOrders,
      delivered_orders: completedOrders,
      total_spend: totalSpentRupees,
      total_spent: totalSpentRupees,
      total_spend_rupees: totalSpentRupees,
      last_order: lastOrderDate,
      status: tier,
      loyalty_tier: tier,
      recent_orders: orderRows.map(o => ({
        ...o,
        total_price_rupees: isStore2 ? Math.round((parseInt(o.total_price, 10) || 0) / 100) : (parseInt(o.total_price, 10) || 0)
      }))
    };
  }

  // Fallback: check if customer exists in orders table (guest or order id)
  let orderLookupSql = `SELECT id, order_number, customer_id, customer_name, customer_email, customer_phone, shipping_address, fulfillment_status, payment_status, total_price, created_at FROM orders WHERE `;
  const orderLookupParams = [];
  if (isNumeric) {
    orderLookupSql += `(id = ? OR customer_id = ?)`;
    orderLookupParams.push(val, val);
  } else {
    orderLookupSql += `(LOWER(customer_email) = LOWER(?) OR customer_id = ?)`;
    orderLookupParams.push(val, val);
  }
  if (store_id !== null && store_id !== undefined && String(store_id).trim() !== '') {
    const sId = parseInt(store_id, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        orderLookupSql += ' AND (store_id = 1 OR store_id IS NULL)';
      } else {
        orderLookupSql += ' AND store_id = ?';
        orderLookupParams.push(sId);
      }
    }
  }
  orderLookupSql += ' ORDER BY created_at DESC LIMIT 20';

  try {
    const [guestOrderRows] = await pool.execute(orderLookupSql, orderLookupParams);
    if (!guestOrderRows || guestOrderRows.length === 0) return null;

    const firstOrder = guestOrderRows[0];
    const totalOrders = guestOrderRows.length;
    const completedOrders = guestOrderRows.filter(o => ['DELIVERED', 'COMPLETED'].includes(String(o.fulfillment_status || '').toUpperCase())).length;
    const rawSpent = guestOrderRows
      .filter(o => String(o.payment_status || '').toLowerCase() === 'paid')
      .reduce((sum, o) => sum + (parseInt(o.total_price, 10) || 0), 0);
    const totalSpentRupees = isStore2 ? Math.round(rawSpent / 100) : rawSpent;
    const tier = calculateCustomerTier(completedOrders);

    return {
      id: firstOrder.customer_id || firstOrder.id,
      firebase_uid: null,
      name: firstOrder.customer_name || 'Customer',
      full_name: firstOrder.customer_name || 'Customer',
      customer_name: firstOrder.customer_name || 'Customer',
      email: firstOrder.customer_email || '',
      phone: firstOrder.customer_phone || '',
      created_at: firstOrder.created_at,
      total_orders: totalOrders,
      completed_orders: completedOrders,
      delivered_orders: completedOrders,
      total_spend: totalSpentRupees,
      total_spent: totalSpentRupees,
      total_spend_rupees: totalSpentRupees,
      last_order: firstOrder.created_at,
      status: tier,
      loyalty_tier: tier,
      recent_orders: guestOrderRows.map(o => ({
        ...o,
        total_price_rupees: isStore2 ? Math.round((parseInt(o.total_price, 10) || 0) / 100) : (parseInt(o.total_price, 10) || 0)
      }))
    };
  } catch (_) {
    return null;
  }
};

module.exports = {
  resolveOrCreateCustomer,
  updateCustomerProfile,
  getCustomers,
  getCustomerById,
  calculateCustomerTier
};
