const { pool } = require('../config/database');

const STORE_ID = 1; // Strict multi-store isolation: CHIPAKK

const VALID_MOVEMENT_TYPES = ['PURCHASE', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'RETURN'];

/**
 * List all CHIPAKK production materials with filtering & stock status
 */
const listMaterials = async ({ search = null, type = null, activeOnly = false, lowStockOnly = false } = {}) => {
  const conditions = ['m.store_id = ?'];
  const params = [STORE_ID];

  if (activeOnly) {
    conditions.push('m.active = 1');
  }

  if (type && String(type).trim()) {
    conditions.push('m.type = ?');
    params.push(String(type).trim());
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(m.name LIKE ? OR m.sku LIKE ? OR m.supplier LIKE ? OR m.type LIKE ?)');
    params.push(term, term, term, term);
  }

  if (lowStockOnly) {
    conditions.push('m.stock <= m.safety_stock');
  }

  const query = `
    SELECT
      m.id,
      m.store_id,
      m.name,
      m.sku,
      m.type,
      m.color,
      CAST(m.stock AS DOUBLE) AS stock,
      m.unit,
      m.cost,
      CAST(m.safety_stock AS DOUBLE) AS safety_stock,
      CAST(m.reorder_quantity AS DOUBLE) AS reorder_quantity,
      m.supplier,
      m.active,
      m.created_at,
      m.updated_at
    FROM materials m
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.type ASC, m.name ASC
  `;

  const [rows] = await pool.execute(query, params);

  return rows.map(r => {
    const stock = Number(r.stock) || 0;
    const safetyStock = Number(r.safety_stock) || 0;
    const isLowStock = stock <= safetyStock;
    return {
      ...r,
      stock,
      safety_stock: safetyStock,
      reorder_quantity: Number(r.reorder_quantity) || 0,
      cost: Number(r.cost) || 0,
      cost_rupees: ((Number(r.cost) || 0) / 100).toFixed(2),
      is_low_stock: isLowStock,
      is_active: r.active === 1,
      status: r.active === 1 ? 'active' : 'inactive'
    };
  });
};

/**
 * Fetch a single material by ID for Store 1
 */
const getMaterialById = async (id) => {
  const query = `
    SELECT
      m.id,
      m.store_id,
      m.name,
      m.sku,
      m.type,
      m.color,
      CAST(m.stock AS DOUBLE) AS stock,
      m.unit,
      m.cost,
      CAST(m.safety_stock AS DOUBLE) AS safety_stock,
      CAST(m.reorder_quantity AS DOUBLE) AS reorder_quantity,
      m.supplier,
      m.active,
      m.created_at,
      m.updated_at
    FROM materials m
    WHERE m.id = ? AND m.store_id = ?
  `;
  const [rows] = await pool.execute(query, [id, STORE_ID]);
  if (!rows || rows.length === 0) return null;

  const r = rows[0];
  const stock = Number(r.stock) || 0;
  const safetyStock = Number(r.safety_stock) || 0;
  return {
    ...r,
    stock,
    safety_stock: safetyStock,
    reorder_quantity: Number(r.reorder_quantity) || 0,
    cost: Number(r.cost) || 0,
    cost_rupees: ((Number(r.cost) || 0) / 100).toFixed(2),
    is_low_stock: stock <= safetyStock,
    is_active: r.active === 1,
    status: r.active === 1 ? 'active' : 'inactive'
  };
};

/**
 * Create a new CHIPAKK production material
 */
const createMaterial = async (data, adminUid = null) => {
  const name = String(data.name || '').trim();
  const type = String(data.type || 'Vinyl').trim();
  const unit = String(data.unit || 'units').trim();

  if (!name) {
    const error = new Error('Material name is required');
    error.statusCode = 400;
    throw error;
  }
  if (!type) {
    const error = new Error('Material type is required');
    error.statusCode = 400;
    throw error;
  }
  if (!unit) {
    const error = new Error('Material measurement unit is required');
    error.statusCode = 400;
    throw error;
  }

  // SKU handling: default if omitted, or validate uniqueness
  let sku = data.sku ? String(data.sku).trim().toUpperCase() : null;
  if (!sku) {
    sku = `CHP-MAT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  } else {
    // Check uniqueness for Store 1
    const [existing] = await pool.execute(
      'SELECT id FROM materials WHERE store_id = ? AND sku = ?',
      [STORE_ID, sku]
    );
    if (existing && existing.length > 0) {
      const error = new Error(`Material SKU "${sku}" already exists for CHIPAKK`);
      error.statusCode = 409;
      throw error;
    }
  }

  const color = data.color ? String(data.color).trim() : null;
  const initialStock = Math.max(0, Number(data.stock) || 0);
  const costPaise = Math.max(0, Math.round(Number(data.cost) || 0));
  const safetyStock = Math.max(0, Number(data.safety_stock) || 0);
  const reorderQty = Math.max(0, Number(data.reorder_quantity) || 0);
  const supplier = data.supplier ? String(data.supplier).trim() : null;
  const active = data.active === false || data.active === 0 ? 0 : 1;

  // Insert material
  const insertSql = `
    INSERT INTO materials (
      store_id, name, sku, type, color, stock, unit, cost, safety_stock, reorder_quantity, supplier, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(insertSql, [
    STORE_ID, name, sku, type, color, initialStock, unit, costPaise, safetyStock, reorderQty, supplier, active
  ]);

  const newId = result.insertId;

  // If initial stock was provided > 0, log an initial stock movement
  if (initialStock > 0) {
    await pool.execute(
      `INSERT INTO material_stock_movements (
        material_id, store_id, type, quantity, previous_stock, resulting_stock, cost_per_unit, reference_id, notes, created_by
      ) VALUES (?, ?, 'PURCHASE', ?, 0, ?, ?, ?, 'Initial inventory stock upon creation', ?)`,
      [newId, STORE_ID, initialStock, initialStock, costPaise, 'INITIAL-SETUP', adminUid || 'admin']
    );
  }

  return getMaterialById(newId);
};

/**
 * Update an existing CHIPAKK material's metadata
 * Note: Stock quantity cannot be directly overwritten here; it must go through recordStockMovement()
 */
const updateMaterial = async (id, data, adminUid = null) => {
  const existing = await getMaterialById(id);
  if (!existing) {
    const error = new Error(`Material with ID ${id} not found in CHIPAKK`);
    error.statusCode = 404;
    throw error;
  }

  const name = data.name !== undefined ? String(data.name).trim() : existing.name;
  const type = data.type !== undefined ? String(data.type).trim() : existing.type;
  const unit = data.unit !== undefined ? String(data.unit).trim() : existing.unit;
  const color = data.color !== undefined ? (data.color ? String(data.color).trim() : null) : existing.color;
  const costPaise = data.cost !== undefined ? Math.max(0, Math.round(Number(data.cost) || 0)) : existing.cost;
  const safetyStock = data.safety_stock !== undefined ? Math.max(0, Number(data.safety_stock) || 0) : existing.safety_stock;
  const reorderQty = data.reorder_quantity !== undefined ? Math.max(0, Number(data.reorder_quantity) || 0) : existing.reorder_quantity;
  const supplier = data.supplier !== undefined ? (data.supplier ? String(data.supplier).trim() : null) : existing.supplier;
  const active = data.active !== undefined ? (data.active ? 1 : 0) : existing.active;

  let sku = existing.sku;
  if (data.sku !== undefined && String(data.sku).trim().toUpperCase() !== existing.sku) {
    sku = String(data.sku).trim().toUpperCase();
    const [dup] = await pool.execute(
      'SELECT id FROM materials WHERE store_id = ? AND sku = ? AND id != ?',
      [STORE_ID, sku, id]
    );
    if (dup && dup.length > 0) {
      const error = new Error(`Material SKU "${sku}" already exists for CHIPAKK`);
      error.statusCode = 409;
      throw error;
    }
  }

  const updateSql = `
    UPDATE materials SET
      name = ?,
      sku = ?,
      type = ?,
      color = ?,
      unit = ?,
      cost = ?,
      safety_stock = ?,
      reorder_quantity = ?,
      supplier = ?,
      active = ?,
      updated_at = NOW()
    WHERE id = ? AND store_id = ?
  `;

  await pool.execute(updateSql, [
    name, sku, type, color, unit, costPaise, safetyStock, reorderQty, supplier, active, id, STORE_ID
  ]);

  return getMaterialById(id);
};

/**
 * Soft delete or reactivate a material
 */
const setMaterialActive = async (id, active) => {
  const existing = await getMaterialById(id);
  if (!existing) {
    const error = new Error(`Material with ID ${id} not found in CHIPAKK`);
    error.statusCode = 404;
    throw error;
  }

  const flag = active ? 1 : 0;
  await pool.execute(
    'UPDATE materials SET active = ?, updated_at = NOW() WHERE id = ? AND store_id = ?',
    [flag, id, STORE_ID]
  );

  return getMaterialById(id);
};

/**
 * Record a stock movement with ACID transaction and strict negative-stock protection
 */
const recordStockMovement = async ({
  materialId,
  type,
  quantity,
  direction = 'add', // Used for ADJUSTMENT ('add', 'subtract', 'set')
  costPerUnit = null,
  referenceId = null,
  notes = null,
  createdBy = null
}) => {
  const upperType = String(type || '').trim().toUpperCase();
  if (!VALID_MOVEMENT_TYPES.includes(upperType)) {
    const error = new Error(`Invalid movement type "${type}". Allowed: ${VALID_MOVEMENT_TYPES.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const numQty = Number(quantity);
  if (isNaN(numQty) || numQty <= 0) {
    const error = new Error('Movement quantity must be a positive number greater than 0');
    error.statusCode = 400;
    throw error;
  }

  // Acquire dedicated transaction connection
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock material row
    const [rows] = await conn.execute(
      'SELECT id, name, sku, unit, stock, cost, safety_stock FROM materials WHERE id = ? AND store_id = ? FOR UPDATE',
      [materialId, STORE_ID]
    );

    if (!rows || rows.length === 0) {
      const error = new Error(`Material ID ${materialId} not found in CHIPAKK`);
      error.statusCode = 404;
      throw error;
    }

    const mat = rows[0];
    const previousStock = Number(mat.stock) || 0;
    let resultingStock = previousStock;

    if (upperType === 'PURCHASE' || upperType === 'RETURN') {
      resultingStock = previousStock + numQty;
    } else if (upperType === 'CONSUMPTION' || upperType === 'WASTE') {
      resultingStock = previousStock - numQty;
      if (resultingStock < 0) {
        const error = new Error(
          `Insufficient stock for "${mat.name}". Current: ${previousStock} ${mat.unit}, attempted deduction: ${numQty} ${mat.unit}. Stock cannot become negative.`
        );
        error.statusCode = 400;
        throw error;
      }
    } else if (upperType === 'ADJUSTMENT') {
      if (direction === 'subtract') {
        resultingStock = previousStock - numQty;
        if (resultingStock < 0) {
          const error = new Error(
            `Adjustment results in negative stock for "${mat.name}". Current: ${previousStock} ${mat.unit}, attempted deduction: ${numQty} ${mat.unit}.`
          );
          error.statusCode = 400;
          throw error;
        }
      } else if (direction === 'set') {
        resultingStock = numQty;
        if (resultingStock < 0) {
          const error = new Error('Target stock cannot be negative');
          error.statusCode = 400;
          throw error;
        }
      } else {
        // default add
        resultingStock = previousStock + numQty;
      }
    }

    // Round to 2 decimal places
    resultingStock = Math.round(resultingStock * 100) / 100;

    // Determine cost per unit
    const unitCostPaise = costPerUnit !== null && !isNaN(Number(costPerUnit))
      ? Math.round(Number(costPerUnit))
      : Number(mat.cost) || 0;

    // If PURCHASE has a new cost per unit, update material's baseline cost
    const updateMaterialSql = (upperType === 'PURCHASE' && costPerUnit !== null)
      ? 'UPDATE materials SET stock = ?, cost = ?, updated_at = NOW() WHERE id = ? AND store_id = ?'
      : 'UPDATE materials SET stock = ?, updated_at = NOW() WHERE id = ? AND store_id = ?';

    const updateParams = (upperType === 'PURCHASE' && costPerUnit !== null)
      ? [resultingStock, unitCostPaise, mat.id, STORE_ID]
      : [resultingStock, mat.id, STORE_ID];

    await conn.execute(updateMaterialSql, updateParams);

    // Record movement
    const insertMovementSql = `
      INSERT INTO material_stock_movements (
        material_id, store_id, type, quantity, previous_stock, resulting_stock, cost_per_unit, reference_id, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [mvResult] = await conn.execute(insertMovementSql, [
      mat.id,
      STORE_ID,
      upperType,
      numQty,
      previousStock,
      resultingStock,
      unitCostPaise,
      referenceId ? String(referenceId).trim() : null,
      notes ? String(notes).trim() : null,
      createdBy ? String(createdBy).trim() : 'admin'
    ]);

    await conn.commit();

    return {
      success: true,
      movement_id: mvResult.insertId,
      movement: {
        id: mvResult.insertId,
        material_id: mat.id,
        material_name: mat.name,
        material_sku: mat.sku,
        unit: mat.unit,
        type: upperType,
        quantity: numQty,
        previous_stock: previousStock,
        resulting_stock: resultingStock,
        cost_per_unit: unitCostPaise,
        reference_id: referenceId,
        notes,
        created_by: createdBy
      },
      material: {
        id: mat.id,
        name: mat.name,
        stock: resultingStock,
        unit: mat.unit,
        is_low_stock: resultingStock <= Number(mat.safety_stock)
      }
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

/**
 * Fetch movement history with optional material or type filter
 */
const getStockMovements = async ({ materialId = null, type = null, limit = 50, offset = 0 } = {}) => {
  const conditions = ['msm.store_id = ?'];
  const params = [STORE_ID];

  if (materialId) {
    conditions.push('msm.material_id = ?');
    params.push(materialId);
  }

  if (type && String(type).trim()) {
    conditions.push('msm.type = ?');
    params.push(String(type).trim().toUpperCase());
  }

  const query = `
    SELECT
      msm.id,
      msm.material_id,
      msm.store_id,
      msm.type,
      CAST(msm.quantity AS DOUBLE) AS quantity,
      CAST(msm.previous_stock AS DOUBLE) AS previous_stock,
      CAST(msm.resulting_stock AS DOUBLE) AS resulting_stock,
      msm.cost_per_unit,
      msm.reference_id,
      msm.notes,
      msm.created_by,
      msm.created_at,
      m.name AS material_name,
      m.sku AS material_sku,
      m.unit AS material_unit
    FROM material_stock_movements msm
    INNER JOIN materials m ON m.id = msm.material_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY msm.created_at DESC, msm.id DESC
    LIMIT ? OFFSET ?
  `;

  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

  params.push(parsedLimit, parsedOffset);

  const [rows] = await pool.execute(query, params);

  // Total count for pagination
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM material_stock_movements msm
    WHERE ${conditions.slice(0, conditions.length).join(' AND ')}
  `;
  const [countRows] = await pool.execute(countQuery, params.slice(0, params.length - 2));

  return {
    total: countRows[0] ? Number(countRows[0].total) : 0,
    limit: parsedLimit,
    offset: parsedOffset,
    movements: rows.map(r => ({
      ...r,
      quantity: Number(r.quantity),
      previous_stock: Number(r.previous_stock),
      resulting_stock: Number(r.resulting_stock),
      cost_rupees: r.cost_per_unit ? (Number(r.cost_per_unit) / 100).toFixed(2) : null
    }))
  };
};

/**
 * Get active materials currently at or below safety stock threshold
 */
const getLowStockAlerts = async () => {
  const query = `
    SELECT
      m.id,
      m.store_id,
      m.name,
      m.sku,
      m.type,
      CAST(m.stock AS DOUBLE) AS stock,
      m.unit,
      CAST(m.safety_stock AS DOUBLE) AS safety_stock,
      CAST(m.reorder_quantity AS DOUBLE) AS reorder_quantity,
      m.supplier
    FROM materials m
    WHERE m.store_id = ? AND m.active = 1 AND m.stock <= m.safety_stock
    ORDER BY (m.stock / NULLIF(m.safety_stock, 0)) ASC
  `;

  const [rows] = await pool.execute(query, [STORE_ID]);
  return rows.map(r => ({
    ...r,
    stock: Number(r.stock) || 0,
    safety_stock: Number(r.safety_stock) || 0,
    reorder_quantity: Number(r.reorder_quantity) || 0,
    deficit: Math.max(0, (Number(r.safety_stock) || 0) - (Number(r.stock) || 0))
  }));
};

/**
 * Get distinct material types used in CHIPAKK
 */
const getMaterialTypes = async () => {
  const [rows] = await pool.execute(
    'SELECT DISTINCT type FROM materials WHERE store_id = ? ORDER BY type ASC',
    [STORE_ID]
  );
  const types = rows.map(r => r.type).filter(Boolean);
  const defaults = ['Vinyl', 'Paper', 'Lamination', 'Packaging', 'Transfer Tape', 'Ink'];
  return Array.from(new Set([...defaults, ...types]));
};

module.exports = {
  STORE_ID,
  VALID_MOVEMENT_TYPES,
  listMaterials,
  getMaterialById,
  createMaterial,
  updateMaterial,
  setMaterialActive,
  recordStockMovement,
  getStockMovements,
  getLowStockAlerts,
  getMaterialTypes
};
