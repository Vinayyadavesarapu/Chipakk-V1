const { pool } = require('../config/database');

const REQUEST_STATUSES = [
  'Upload',
  'Review',
  'Quotation',
  'Approval',
  'Order',
  'Rejected'
];

/**
 * Fetch custom 3D requests
 */
const getCustomRequests = async ({ storeId = 2, status = null, search = null } = {}) => {
  const conditions = [];
  const params = [];

  if (storeId) {
    conditions.push('cr.store_id = ?');
    params.push(storeId);
  }

  if (status && status !== 'ALL') {
    conditions.push('cr.status = ?');
    params.push(status);
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(cr.request_number LIKE ? OR cr.guest_name LIKE ? OR cr.guest_email LIKE ? OR cr.file_name LIKE ?)');
    params.push(term, term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT 
      cr.id,
      cr.store_id,
      cr.request_number,
      cr.customer_id,
      cr.guest_name,
      cr.guest_email,
      cr.guest_phone,
      cr.file_url,
      cr.file_name,
      cr.file_format,
      cr.file_size_bytes,
      cr.preferred_material,
      cr.preferred_finishing,
      cr.quantity,
      cr.customer_notes,
      cr.admin_notes,
      cr.status,
      cr.quote_amount,
      cr.quote_lead_days,
      cr.quote_valid_until,
      cr.converted_order_id,
      cr.created_at,
      cr.updated_at
    FROM custom_3d_requests cr
    ${whereClause}
    ORDER BY cr.id DESC
  `;

  const [rows] = await pool.execute(query, params);
  return rows;
};

/** Scoped to a store: custom_3d_requests is multi-tenant (getCustomRequests filters by store_id), so an unscoped
 * by-id lookup let any admin viewing one store read/quote/convert the other store's request by guessing a
 * sequential id. storeId is optional (kept for the create-then-return-what-I-just-inserted case, and for the
 * internal call inside convertCustomRequestToOrder which re-derives it from the already-scoped row). */
const getCustomRequestById = async (id, storeId = null) => {
  const params = [id];
  let query = `SELECT * FROM custom_3d_requests WHERE id = ?`;
  if (storeId) { query += ' AND (store_id = ? OR store_id IS NULL)'; params.push(storeId); }
  const [rows] = await pool.execute(query, params);
  return rows[0] || null;
};

const createCustomRequest = async ({
  store_id = 2,
  customer_id = null,
  guest_name,
  guest_email,
  guest_phone = '',
  file_url,
  file_name,
  file_format = 'STL',
  file_size_bytes = 0,
  preferred_material = 'PLA',
  preferred_finishing = 'Raw Print',
  quantity = 1,
  customer_notes = ''
}) => {
  if (!guest_name || !guest_name.trim()) throw new Error('Customer name is required');
  if (!guest_email || !guest_email.trim()) throw new Error('Customer email is required');
  if (!file_url) throw new Error('3D model file URL is required');

  const requestNumber = `REQ-3D-${Date.now().toString().slice(-6)}`;
  const query = `
    INSERT INTO custom_3d_requests
      (store_id, request_number, customer_id, guest_name, guest_email, guest_phone, file_url, file_name, file_format, file_size_bytes, preferred_material, preferred_finishing, quantity, customer_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Upload')
  `;
  const params = [
    store_id || 2,
    requestNumber,
    customer_id || null,
    guest_name.trim(),
    guest_email.trim(),
    guest_phone || '',
    file_url,
    file_name || 'model.stl',
    (file_format || 'STL').toUpperCase(),
    parseInt(file_size_bytes, 10) || 0,
    preferred_material || 'PLA',
    preferred_finishing || 'Raw Print',
    parseInt(quantity, 10) || 1,
    customer_notes || ''
  ];

  const [result] = await pool.execute(query, params);
  return getCustomRequestById(result.insertId);
};

const updateCustomRequestStatus = async (id, status, admin_notes = null, storeId = null) => {
  if (!REQUEST_STATUSES.includes(status)) {
    throw new Error(`Invalid status: '${status}'. Allowed: ${REQUEST_STATUSES.join(', ')}`);
  }

  let extra = '';
  const params = [status];
  if (admin_notes !== null && admin_notes !== undefined) {
    extra += ', admin_notes = ?';
    params.push(admin_notes);
  }
  params.push(id);

  let query = `UPDATE custom_3d_requests SET status = ? ${extra} WHERE id = ?`;
  if (storeId) { query += ' AND (store_id = ? OR store_id IS NULL)'; params.push(storeId); }
  await pool.execute(query, params);
  return getCustomRequestById(id, storeId);
};

const setCustomRequestQuote = async (id, { quote_amount, quote_lead_days = 3, admin_notes = '' }, storeId = null) => {
  if (quote_amount === undefined || isNaN(Number(quote_amount))) {
    throw new Error('Quote amount in paise is required');
  }

  let query = `
    UPDATE custom_3d_requests
    SET
      quote_amount = ?,
      quote_lead_days = ?,
      quote_valid_until = DATE_ADD(NOW(), INTERVAL 14 DAY),
      admin_notes = ?,
      status = 'Quotation'
    WHERE id = ?
  `;
  const params = [
    parseInt(quote_amount, 10),
    parseInt(quote_lead_days, 10) || 3,
    admin_notes || 'Quotation prepared',
    id
  ];
  if (storeId) { query += ' AND (store_id = ? OR store_id IS NULL)'; params.push(storeId); }
  await pool.execute(query, params);

  return getCustomRequestById(id, storeId);
};

const convertCustomRequestToOrder = async (id, storeId = null) => {
  const req = await getCustomRequestById(id, storeId);
  if (!req) throw new Error(`Custom request #${id} not found`);

  // Update status to Order
  const query = `UPDATE custom_3d_requests SET status = 'Order' WHERE id = ?`;
  await pool.execute(query, [id]);

  // Auto-generate Production Job for this custom request
  const productionJobService = require('./productionJobService');
  const job = await productionJobService.createProductionJob({
    store_id: req.store_id || 2,
    custom_request_id: req.id,
    product_name: `Custom Print (${req.file_name})`,
    material_name: req.preferred_material || 'PLA',
    finishing_name: req.preferred_finishing || 'Raw Print',
    stage_notes: `Initiated from Custom Request ${req.request_number}`
  });

  return { request: await getCustomRequestById(id), production_job: job };
};

module.exports = {
  REQUEST_STATUSES,
  getCustomRequests,
  getCustomRequestById,
  createCustomRequest,
  updateCustomRequestStatus,
  setCustomRequestQuote,
  convertCustomRequestToOrder
};
