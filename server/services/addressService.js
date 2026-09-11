const { pool } = require('../config/database');

/**
 * Validate customer address fields
 */
const validateAddressPayload = (data) => {
  const { full_name, phone, address_line, city, state, pincode } = data;

  if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
    const err = new Error('Full name is required and must be at least 2 characters.');
    err.statusCode = 400;
    throw err;
  }

  const cleanPhone = String(phone || '').replace(/^[\s\-\+910]+/, '').replace(/[\s\-]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    const err = new Error('Valid 10-digit mobile phone number is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!address_line || typeof address_line !== 'string' || address_line.trim().length < 5) {
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
};

/**
 * Fetch all addresses for a specific authenticated customer
 */
const getCustomerAddresses = async (firebaseUid) => {
  if (!firebaseUid) return [];

  const query = `
    SELECT 
      id,
      user_id,
      firebase_uid,
      full_name,
      phone,
      address_line,
      city,
      state,
      pincode,
      country,
      is_default,
      created_at,
      updated_at
    FROM customer_addresses
    WHERE firebase_uid = ?
    ORDER BY is_default DESC, id DESC
  `;

  const [rows] = await pool.execute(query, [firebaseUid]);
  return rows.map(r => ({
    ...r,
    is_default: Boolean(r.is_default)
  }));
};

/**
 * Fetch a single address by ID verifying ownership
 */
const getCustomerAddressById = async (id, firebaseUid) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId) || !firebaseUid) return null;

  const query = `
    SELECT 
      id,
      user_id,
      firebase_uid,
      full_name,
      phone,
      address_line,
      city,
      state,
      pincode,
      country,
      is_default,
      created_at,
      updated_at
    FROM customer_addresses
    WHERE id = ? AND firebase_uid = ?
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, [numId, firebaseUid]);
  if (!rows || rows.length === 0) return null;

  return {
    ...rows[0],
    is_default: Boolean(rows[0].is_default)
  };
};

/**
 * Create a new saved address for an authenticated customer
 */
const createCustomerAddress = async (firebaseUid, addressData) => {
  validateAddressPayload(addressData);

  const {
    full_name,
    phone,
    address_line,
    city,
    state,
    pincode,
    country = 'India',
    is_default = false
  } = addressData;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check if this is the user's first address
    const [countRows] = await connection.execute(
      'SELECT COUNT(*) AS total FROM customer_addresses WHERE firebase_uid = ?',
      [firebaseUid]
    );
    const isFirst = (countRows[0]?.total || 0) === 0;
    const shouldBeDefault = isFirst || Boolean(is_default);

    // If marked default, unset any existing default address
    if (shouldBeDefault) {
      await connection.execute(
        'UPDATE customer_addresses SET is_default = 0 WHERE firebase_uid = ?',
        [firebaseUid]
      );
    }

    // Look up user_id if users record exists
    let userId = null;
    const [userRows] = await connection.execute(
      'SELECT id FROM users WHERE firebase_uid = ? LIMIT 1',
      [firebaseUid]
    );
    if (userRows && userRows.length > 0) {
      userId = userRows[0].id;
    }

    const insertQuery = `
      INSERT INTO customer_addresses (
        user_id, firebase_uid, full_name, phone, address_line, city, state, pincode, country, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const cleanPhone = String(phone).replace(/^[\s\-\+910]+/, '').replace(/[\s\-]/g, '');

    const [result] = await connection.execute(insertQuery, [
      userId,
      firebaseUid,
      full_name.trim(),
      cleanPhone,
      address_line.trim(),
      city.trim(),
      state.trim(),
      String(pincode).trim(),
      country ? country.trim() : 'India',
      shouldBeDefault ? 1 : 0
    ]);

    await connection.commit();
    connection.release();

    return getCustomerAddressById(result.insertId, firebaseUid);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Update an existing saved address verifying ownership
 */
const updateCustomerAddress = async (id, firebaseUid, addressData) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    const err = new Error('Invalid address ID format.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await getCustomerAddressById(numId, firebaseUid);
  if (!existing) {
    return null;
  }

  validateAddressPayload({
    full_name: addressData.full_name !== undefined ? addressData.full_name : existing.full_name,
    phone: addressData.phone !== undefined ? addressData.phone : existing.phone,
    address_line: addressData.address_line !== undefined ? addressData.address_line : existing.address_line,
    city: addressData.city !== undefined ? addressData.city : existing.city,
    state: addressData.state !== undefined ? addressData.state : existing.state,
    pincode: addressData.pincode !== undefined ? addressData.pincode : existing.pincode
  });

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const isDefaultSetting = addressData.is_default !== undefined ? Boolean(addressData.is_default) : existing.is_default;

    if (isDefaultSetting && !existing.is_default) {
      await connection.execute(
        'UPDATE customer_addresses SET is_default = 0 WHERE firebase_uid = ? AND id != ?',
        [firebaseUid, numId]
      );
    }

    const updates = [];
    const params = [];

    if (addressData.full_name !== undefined) {
      updates.push('full_name = ?');
      params.push(addressData.full_name.trim());
    }

    if (addressData.phone !== undefined) {
      const cleanPhone = String(addressData.phone).replace(/^[\s\-\+910]+/, '').replace(/[\s\-]/g, '');
      updates.push('phone = ?');
      params.push(cleanPhone);
    }

    if (addressData.address_line !== undefined) {
      updates.push('address_line = ?');
      params.push(addressData.address_line.trim());
    }

    if (addressData.city !== undefined) {
      updates.push('city = ?');
      params.push(addressData.city.trim());
    }

    if (addressData.state !== undefined) {
      updates.push('state = ?');
      params.push(addressData.state.trim());
    }

    if (addressData.pincode !== undefined) {
      updates.push('pincode = ?');
      params.push(String(addressData.pincode).trim());
    }

    if (addressData.country !== undefined) {
      updates.push('country = ?');
      params.push(addressData.country ? addressData.country.trim() : 'India');
    }

    if (addressData.is_default !== undefined) {
      updates.push('is_default = ?');
      params.push(isDefaultSetting ? 1 : 0);
    }

    if (updates.length > 0) {
      const updateQuery = `UPDATE customer_addresses SET ${updates.join(', ')} WHERE id = ? AND firebase_uid = ?`;
      params.push(numId, firebaseUid);
      await connection.execute(updateQuery, params);
    }

    await connection.commit();
    connection.release();

    return getCustomerAddressById(numId, firebaseUid);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Delete a saved address verifying ownership.
 * If default address was deleted, promotes the next available address.
 */
const deleteCustomerAddress = async (id, firebaseUid) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    const err = new Error('Invalid address ID format.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await getCustomerAddressById(numId, firebaseUid);
  if (!existing) {
    return false;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      'DELETE FROM customer_addresses WHERE id = ? AND firebase_uid = ?',
      [numId, firebaseUid]
    );

    // If deleted address was default, promote next available address
    if (existing.is_default) {
      const [nextRows] = await connection.execute(
        'SELECT id FROM customer_addresses WHERE firebase_uid = ? ORDER BY id DESC LIMIT 1',
        [firebaseUid]
      );
      if (nextRows && nextRows.length > 0) {
        await connection.execute(
          'UPDATE customer_addresses SET is_default = 1 WHERE id = ?',
          [nextRows[0].id]
        );
      }
    }

    await connection.commit();
    connection.release();
    return true;
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

module.exports = {
  validateAddressPayload,
  getCustomerAddresses,
  getCustomerAddressById,
  createCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress
};
