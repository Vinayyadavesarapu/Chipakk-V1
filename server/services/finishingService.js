const { pool } = require('../config/database');

/**
 * Fetch finishing options list scoped by storeId
 */
const getFinishingOptions = async ({ storeId = 2, activeOnly = false } = {}) => {
  const conditions = [];
  const params = [];

  if (storeId) {
    conditions.push('fo.store_id = ?');
    params.push(storeId);
  }

  if (activeOnly) {
    conditions.push('fo.active = 1');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT 
      fo.id,
      fo.store_id,
      fo.name,
      fo.description,
      fo.price_modifier,
      fo.lead_time_days,
      fo.sort_order,
      fo.active,
      fo.created_at,
      fo.updated_at
    FROM finishing_options fo
    ${whereClause}
    ORDER BY fo.sort_order ASC, fo.id ASC
  `;

  const [rows] = await pool.execute(query, params);
  return rows.map(r => ({
    ...r,
    extra_cost: r.price_modifier,
    extra_price: r.price_modifier,
    lead_time: r.lead_time_days,
    is_active: r.active === 1,
    status: r.active === 1 ? 'active' : 'inactive'
  }));
};

const getFinishingOptionById = async (id) => {
  const query = `SELECT * FROM finishing_options WHERE id = ?`;
  const [rows] = await pool.execute(query, [id]);
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    extra_cost: r.price_modifier,
    extra_price: r.price_modifier,
    lead_time: r.lead_time_days,
    is_active: r.active === 1,
    status: r.active === 1 ? 'active' : 'inactive'
  };
};

const createFinishingOption = async ({
  store_id = 2,
  name,
  description = '',
  price_modifier,
  extra_cost,
  extra_price,
  lead_time_days,
  lead_time,
  sort_order = 0,
  active = 1,
  is_active,
  status
}) => {
  if (!name || !name.trim()) throw new Error('Finishing option name is required');

  const resolvedPrice = price_modifier !== undefined ? parseInt(price_modifier, 10) : (extra_price !== undefined ? parseInt(extra_price, 10) : (extra_cost !== undefined ? parseInt(extra_cost, 10) : 0));
  const resolvedLead = lead_time_days !== undefined ? parseInt(lead_time_days, 10) : (lead_time !== undefined ? parseInt(lead_time, 10) : 0);
  let resolvedActive = active !== undefined ? (active ? 1 : 0) : 1;
  if (is_active !== undefined) resolvedActive = is_active ? 1 : 0;
  if (status !== undefined) resolvedActive = (status === 'active' || status === 1 || status === '1') ? 1 : 0;

  const query = `
    INSERT INTO finishing_options
      (store_id, name, description, price_modifier, lead_time_days, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    store_id || 2,
    name.trim(),
    description || '',
    resolvedPrice,
    resolvedLead,
    parseInt(sort_order, 10) || 0,
    resolvedActive
  ];

  const [result] = await pool.execute(query, params);
  return getFinishingOptionById(result.insertId);
};

const updateFinishingOption = async (id, data) => {
  const existing = await getFinishingOptionById(id);
  if (!existing) throw new Error(`Finishing option #${id} not found`);

  const updates = [];
  const params = [];

  if (data.name !== undefined) { updates.push('`name` = ?'); params.push(data.name.trim()); }
  if (data.description !== undefined) { updates.push('`description` = ?'); params.push(data.description || ''); }

  const rawPrice = data.price_modifier !== undefined ? data.price_modifier : (data.extra_price !== undefined ? data.extra_price : data.extra_cost);
  if (rawPrice !== undefined) { updates.push('`price_modifier` = ?'); params.push(parseInt(rawPrice, 10) || 0); }

  const rawLead = data.lead_time_days !== undefined ? data.lead_time_days : data.lead_time;
  if (rawLead !== undefined) { updates.push('`lead_time_days` = ?'); params.push(parseInt(rawLead, 10) || 0); }

  if (data.sort_order !== undefined) { updates.push('`sort_order` = ?'); params.push(parseInt(data.sort_order, 10) || 0); }

  let rawActive = data.active;
  if (rawActive === undefined && data.is_active !== undefined) rawActive = data.is_active ? 1 : 0;
  if (rawActive === undefined && data.status !== undefined) rawActive = (data.status === 'active' || data.status === 1 || data.status === '1') ? 1 : 0;
  if (rawActive !== undefined) { updates.push('`active` = ?'); params.push(rawActive ? 1 : 0); }

  if (updates.length === 0) return existing;

  params.push(id);
  const query = `UPDATE finishing_options SET ${updates.join(', ')} WHERE id = ?`;
  await pool.execute(query, params);

  return getFinishingOptionById(id);
};

const deleteFinishingOption = async (id) => {
  const [result] = await pool.execute(`DELETE FROM finishing_options WHERE id = ?`, [id]);
  return result.affectedRows > 0;
};

module.exports = {
  getFinishingOptions,
  getFinishingOptionById,
  createFinishingOption,
  updateFinishingOption,
  deleteFinishingOption
};
