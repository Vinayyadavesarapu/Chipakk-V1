const { pool } = require('../config/database');

let hasDensityColumn = null;
const checkHasDensity = async () => {
  if (hasDensityColumn !== null) return hasDensityColumn;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM materials LIKE 'density_g_cm3'");
    hasDensityColumn = cols && cols.length > 0;
  } catch (_) {
    hasDensityColumn = false;
  }
  return hasDensityColumn;
};

/**
 * Fetch materials list scoped by storeId
 */
const getMaterials = async ({ storeId = 2, activeOnly = false, search = null } = {}) => {
  const hasDensity = await checkHasDensity();
  const conditions = [];
  const params = [];

  if (storeId) {
    conditions.push('m.store_id = ?');
    params.push(storeId);
  }

  if (activeOnly) {
    conditions.push('m.active = 1');
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(m.name LIKE ? OR m.type LIKE ? OR m.color LIKE ?)');
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const densitySelect = hasDensity ? 'CAST(m.density_g_cm3 AS DOUBLE) AS density_g_cm3,' : '1.25 AS density_g_cm3,';

  const query = `
    SELECT 
      m.id,
      m.store_id,
      m.name,
      m.type,
      m.color,
      m.color_hex,
      ${densitySelect}
      CAST(m.stock AS DOUBLE) AS stock,
      m.unit,
      m.cost,
      CAST(m.safety_stock AS DOUBLE) AS safety_stock,
      m.active,
      m.created_at,
      m.updated_at
    FROM materials m
    ${whereClause}
    ORDER BY m.type ASC, m.name ASC
  `;

  const [rows] = await pool.execute(query, params);
  return rows.map(r => ({
    ...r,
    // Provide aliases for frontend and business logic compatibility
    material_type: r.type,
    color_name: r.color,
    hex_color: r.color_hex,
    density: r.density_g_cm3,
    cost_per_unit: r.cost,
    stock_threshold: r.safety_stock,
    min_stock_threshold: r.safety_stock,
    is_active: r.active === 1,
    status: r.active === 1 ? 'active' : 'inactive'
  }));
};

/**
 * Fetch a single material by ID, scoped to a store. `materials` is a genuinely multi-tenant table (CHIPAKK's
 * production-materials service scopes every query by store_id) -- omitting the scope here let any admin viewing
 * one store read/edit/zero-out the other store's material by guessing a sequential id. storeId is optional (kept
 * for callers like createMaterial's own return-what-I-just-inserted lookup that don't yet have an id-to-store
 * relationship to check) but every admin-route caller now passes it.
 */
const getMaterialById = async (id, storeId = null) => {
  const params = [id];
  let query = `SELECT * FROM materials WHERE id = ?`;
  if (storeId) {
    query += ' AND (store_id = ? OR store_id IS NULL)';
    params.push(storeId);
  }
  const [rows] = await pool.execute(query, params);
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    material_type: r.type,
    color_name: r.color,
    hex_color: r.color_hex,
    density_g_cm3: r.density_g_cm3 !== undefined ? parseFloat(r.density_g_cm3) : 1.25,
    density: r.density_g_cm3 !== undefined ? parseFloat(r.density_g_cm3) : 1.25,
    cost_per_unit: r.cost,
    stock_threshold: r.safety_stock,
    min_stock_threshold: r.safety_stock,
    is_active: r.active === 1,
    status: r.active === 1 ? 'active' : 'inactive'
  };
};

/**
 * Create a new flexible material
 */
const createMaterial = async ({
  store_id = 2,
  name,
  type,
  material_type,
  color,
  color_name,
  color_hex = '#000000',
  hex_color,
  density_g_cm3 = 1.25,
  density,
  stock = 0,
  unit = 'grams',
  cost = 0,
  cost_per_unit,
  safety_stock = 200,
  stock_threshold,
  min_stock_threshold,
  active = 1,
  is_active,
  status
}) => {
  const resolvedName = name ? name.trim() : '';
  const resolvedType = (type || material_type || '').trim().toUpperCase();
  const resolvedColor = (color || color_name || '').trim();
  const resolvedHex = color_hex || hex_color || '#000000';
  const resolvedCost = cost !== undefined ? parseInt(cost, 10) : (cost_per_unit !== undefined ? parseInt(cost_per_unit, 10) : 0);
  const resolvedSafety = safety_stock !== undefined ? parseFloat(safety_stock) : (stock_threshold !== undefined ? parseFloat(stock_threshold) : (min_stock_threshold !== undefined ? parseFloat(min_stock_threshold) : 200));
  const resolvedDensity = density_g_cm3 !== undefined ? parseFloat(density_g_cm3) : (density !== undefined ? parseFloat(density) : 1.25);
  let resolvedActive = active !== undefined ? (active ? 1 : 0) : 1;
  if (is_active !== undefined) resolvedActive = is_active ? 1 : 0;
  if (status !== undefined) resolvedActive = (status === 'active' || status === 1 || status === '1') ? 1 : 0;

  if (!resolvedName) throw new Error('Material name is required');
  if (!resolvedType) throw new Error('Material type is required');
  if (!resolvedColor) throw new Error('Material color is required');

  const hasDensity = await checkHasDensity();
  const fields = ['store_id', 'name', 'type', 'color', 'color_hex', 'stock', 'unit', 'cost', 'safety_stock', 'active'];
  const values = [
    store_id || 2,
    resolvedName,
    resolvedType,
    resolvedColor,
    resolvedHex,
    parseFloat(stock) || 0,
    unit || 'grams',
    resolvedCost,
    resolvedSafety,
    resolvedActive
  ];

  if (hasDensity) {
    fields.push('density_g_cm3');
    values.push(resolvedDensity);
  }

  const placeholders = fields.map(() => '?').join(', ');
  const query = `INSERT INTO materials (${fields.join(', ')}) VALUES (${placeholders})`;

  const [result] = await pool.execute(query, values);
  return getMaterialById(result.insertId);
};

/**
 * Update existing material
 */
const updateMaterial = async (id, data, storeId = null) => {
  const existing = await getMaterialById(id, storeId);
  if (!existing) throw new Error(`Material #${id} not found`);

  const hasDensity = await checkHasDensity();
  const updates = [];
  const params = [];

  const rawType = data.type || data.material_type;
  if (rawType !== undefined) { updates.push('`type` = ?'); params.push(rawType.trim().toUpperCase()); }

  const rawColor = data.color || data.color_name;
  if (rawColor !== undefined) { updates.push('`color` = ?'); params.push(rawColor.trim()); }

  const rawHex = data.color_hex || data.hex_color;
  if (rawHex !== undefined) { updates.push('`color_hex` = ?'); params.push(rawHex.trim()); }

  if (data.name !== undefined) { updates.push('`name` = ?'); params.push(data.name.trim()); }
  if (data.stock !== undefined) { updates.push('`stock` = ?'); params.push(parseFloat(data.stock) || 0); }
  if (data.unit !== undefined) { updates.push('`unit` = ?'); params.push(data.unit.trim()); }

  const rawCost = data.cost !== undefined ? data.cost : data.cost_per_unit;
  if (rawCost !== undefined) { updates.push('`cost` = ?'); params.push(parseInt(rawCost, 10) || 0); }

  const rawSafety = data.safety_stock !== undefined ? data.safety_stock : (data.stock_threshold !== undefined ? data.stock_threshold : data.min_stock_threshold);
  if (rawSafety !== undefined) { updates.push('`safety_stock` = ?'); params.push(parseFloat(rawSafety) || 0); }

  const rawDensity = data.density_g_cm3 !== undefined ? data.density_g_cm3 : data.density;
  if (hasDensity && rawDensity !== undefined) { updates.push('`density_g_cm3` = ?'); params.push(parseFloat(rawDensity) || 1.25); }

  let rawActive = data.active;
  if (rawActive === undefined && data.is_active !== undefined) rawActive = data.is_active ? 1 : 0;
  if (rawActive === undefined && data.status !== undefined) rawActive = (data.status === 'active' || data.status === 1 || data.status === '1') ? 1 : 0;
  if (rawActive !== undefined) { updates.push('`active` = ?'); params.push(rawActive ? 1 : 0); }

  if (updates.length === 0) return existing;

  params.push(id);
  let query = `UPDATE materials SET ${updates.join(', ')} WHERE id = ?`;
  if (storeId) { query += ' AND (store_id = ? OR store_id IS NULL)'; params.push(storeId); }
  await pool.execute(query, params);

  return getMaterialById(id, storeId);
};

/**
 * Adjust material stock by delta
 */
const adjustStock = async (id, deltaUnits, storeId = null) => {
  let query = `UPDATE materials SET stock = GREATEST(0, stock + ?) WHERE id = ?`;
  const params = [parseFloat(deltaUnits) || 0, id];
  if (storeId) { query += ' AND (store_id = ? OR store_id IS NULL)'; params.push(storeId); }
  await pool.execute(query, params);
  return getMaterialById(id, storeId);
};

/**
 * Deactivate a material (soft delete preserving material_stock_movements and historical jobs)
 */
const deleteMaterial = async (id, storeId = 2) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid material ID');

  const existing = await getMaterialById(numId);
  if (!existing) return false;

  const targetStoreId = parseInt(storeId, 10) || 2;
  const [result] = await pool.execute(
    'UPDATE materials SET active = 0 WHERE id = ? AND (store_id = ? OR store_id IS NULL)',
    [numId, targetStoreId]
  );
  return result.affectedRows > 0;
};

module.exports = {
  getMaterials,
  getMaterialById,
  createMaterial,
  updateMaterial,
  adjustStock,
  deleteMaterial
};
