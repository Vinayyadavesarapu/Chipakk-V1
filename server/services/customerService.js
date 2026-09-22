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

module.exports = {
  resolveOrCreateCustomer,
  updateCustomerProfile
};
