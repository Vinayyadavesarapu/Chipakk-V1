const { pool } = require('../config/database');

/**
 * Approved File Roles
 */
const ALLOWED_FILE_ROLES = [
  'original_upload',
  'print_ready_file',
  'cut_contour_file',
  'proof_preview'
];

/**
 * Approved Verification Statuses
 */
const ALLOWED_VERIFICATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED'
];

/**
 * Fetch all artwork records belonging to an order item
 */
const getCustomDesignsByOrderItemId = async (orderItemId) => {
  const numOrderItemId = parseInt(orderItemId, 10);
  if (isNaN(numOrderItemId)) {
    return { orderItemExists: false, designs: [] };
  }

  // 1. Verify order item exists
  const [itemRows] = await pool.execute('SELECT id FROM order_items WHERE id = ? LIMIT 1', [numOrderItemId]);
  if (!itemRows || itemRows.length === 0) {
    return { orderItemExists: false, designs: [] };
  }

  // 2. Fetch custom design artwork records
  const query = `
    SELECT 
      id,
      order_item_id,
      file_role,
      storage_path,
      image_url,
      original_filename,
      file_type,
      file_size_bytes,
      verification_status,
      verification_notes,
      uploaded_at,
      verified_at,
      verified_by_admin_id
    FROM order_item_custom_designs
    WHERE order_item_id = ?
    ORDER BY uploaded_at DESC, id DESC
  `;

  const [rows] = await pool.execute(query, [numOrderItemId]);

  return {
    orderItemExists: true,
    designs: rows
  };
};

/**
 * Fetch a single custom design record by BIGINT ID
 */
const getCustomDesignById = async (designId) => {
  if (!designId) return null;

  const numDesignId = parseInt(designId, 10);
  if (isNaN(numDesignId)) return null;

  const query = `
    SELECT 
      id,
      order_item_id,
      file_role,
      storage_path,
      image_url,
      original_filename,
      file_type,
      file_size_bytes,
      verification_status,
      verification_notes,
      uploaded_at,
      verified_at,
      verified_by_admin_id
    FROM order_item_custom_designs
    WHERE id = ?
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, [numDesignId]);
  if (!rows || rows.length === 0) {
    return null;
  }

  return rows[0];
};

/**
 * Create a new custom design artwork record in MySQL
 */
const createCustomDesign = async ({
  order_item_id,
  file_role = 'original_upload',
  storage_path,
  image_url,
  original_filename,
  file_type,
  file_size_bytes
}) => {
  const numOrderItemId = parseInt(order_item_id, 10);
  if (isNaN(numOrderItemId)) {
    throw new Error('Invalid order item ID format.');
  }

  const safeFileRole = String(file_role || 'original_upload').trim().toLowerCase();
  if (!ALLOWED_FILE_ROLES.includes(safeFileRole)) {
    throw new Error(`Invalid file role. Allowed values: ${ALLOWED_FILE_ROLES.join(', ')}`);
  }

  // Verify order item exists before inserting
  const [itemRows] = await pool.execute('SELECT id FROM order_items WHERE id = ? LIMIT 1', [numOrderItemId]);
  if (!itemRows || itemRows.length === 0) {
    throw new Error(`Order item '${order_item_id}' not found`);
  }

  const query = `
    INSERT INTO order_item_custom_designs (
      order_item_id,
      file_role,
      storage_path,
      image_url,
      original_filename,
      file_type,
      file_size_bytes,
      verification_status,
      uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW())
  `;

  const params = [
    numOrderItemId,
    safeFileRole,
    storage_path,
    image_url,
    original_filename,
    file_type || null,
    parseInt(file_size_bytes, 10) || 0
  ];

  const [result] = await pool.execute(query, params);
  return getCustomDesignById(result.insertId);
};

/**
 * Update verification status of a custom design record
 */
const verifyCustomDesign = async (designId, { verification_status, verification_notes, admin_id }) => {
  const numDesignId = parseInt(designId, 10);
  if (isNaN(numDesignId)) {
    throw new Error('Invalid design ID format.');
  }

  const normalizedStatus = String(verification_status || '').trim().toUpperCase();

  if (!ALLOWED_VERIFICATION_STATUSES.includes(normalizedStatus)) {
    throw new Error(`Invalid verification status. Allowed values: ${ALLOWED_VERIFICATION_STATUSES.join(', ')}`);
  }

  const existing = await getCustomDesignById(numDesignId);
  if (!existing) {
    return null;
  }

  const safeNotes = verification_notes !== undefined && verification_notes !== null && String(verification_notes).trim()
    ? String(verification_notes).trim()
    : null;

  if (normalizedStatus === 'PENDING') {
    const query = `
      UPDATE order_item_custom_designs 
      SET verification_status = 'PENDING',
          verification_notes = ?,
          verified_at = NULL,
          verified_by_admin_id = NULL
      WHERE id = ?
    `;
    await pool.execute(query, [safeNotes, numDesignId]);
  } else {
    const query = `
      UPDATE order_item_custom_designs 
      SET verification_status = ?,
          verification_notes = ?,
          verified_at = NOW(),
          verified_by_admin_id = ?
      WHERE id = ?
    `;
    await pool.execute(query, [normalizedStatus, safeNotes, admin_id || null, numDesignId]);
  }

  return getCustomDesignById(numDesignId);
};

module.exports = {
  ALLOWED_FILE_ROLES,
  ALLOWED_VERIFICATION_STATUSES,
  getCustomDesignsByOrderItemId,
  getCustomDesignById,
  createCustomDesign,
  verifyCustomDesign
};
