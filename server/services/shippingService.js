const { pool } = require('../config/database');

/**
 * Safe JSON parser helper
 */
const safeJsonParse = (val, fallback = null) => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
};

let hasStoreIdColumn = null;
const checkHasStoreId = async () => {
  if (hasStoreIdColumn !== null) return hasStoreIdColumn;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM shipping_rules LIKE 'store_id'");
    hasStoreIdColumn = cols && cols.length > 0;
  } catch (err) {
    hasStoreIdColumn = false;
  }
  return hasStoreIdColumn;
};

/**
 * Fetch list of shipping rules with pagination and filtering
 */
const getShippingRules = async ({
  is_enabled,
  storeId = null,
  limit = 50,
  offset = 0
} = {}) => {
  const hasStoreId = await checkHasStoreId();
  const conditions = [];
  const params = [];

  if (hasStoreId && storeId !== null && storeId !== undefined && String(storeId).trim() !== '') {
    const sId = parseInt(storeId, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        conditions.push('(sr.store_id = 1 OR sr.store_id IS NULL)');
      } else {
        conditions.push('sr.store_id = ?');
        params.push(sId);
      }
    }
  }

  if (is_enabled !== undefined && is_enabled !== null && is_enabled !== '') {
    conditions.push('sr.is_enabled = ?');
    params.push(is_enabled === 'true' || is_enabled === 1 || is_enabled === '1' ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM shipping_rules sr ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const query = `
    SELECT 
      sr.id,
      ${hasStoreId ? 'COALESCE(sr.store_id, 1) AS store_id,' : '1 AS store_id,'}
      sr.name,
      sr.free_shipping_threshold,
      sr.standard_fee,
      sr.is_enabled,
      sr.regional_overrides,
      sr.created_at,
      sr.updated_at
    FROM shipping_rules sr
    ${whereClause}
    ORDER BY sr.is_enabled DESC, sr.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const rules = rows.map(r => {
    const isStore2 = parseInt(r.store_id, 10) === 2;
    const thresholdVal = parseInt(r.free_shipping_threshold, 10) || 0;
    const standardFeeVal = parseInt(r.standard_fee, 10) || 0;

    return {
      ...r,
      free_shipping_threshold_rupees: isStore2 ? Math.round(thresholdVal / 100) : thresholdVal,
      standard_fee_rupees: isStore2 ? Math.round(standardFeeVal / 100) : standardFeeVal,
      regional_overrides: safeJsonParse(r.regional_overrides, null)
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    rules
  };
};

/**
 * Fetch a single shipping rule by numeric BIGINT ID
 */
const getShippingRuleById = async (ruleId, storeId = null) => {
  if (!ruleId) return null;

  const numId = parseInt(ruleId, 10);
  if (isNaN(numId)) return null;
  const hasStoreId = await checkHasStoreId();

  const params = [numId];
  let storeCond = '';
  if (hasStoreId && storeId !== null && storeId !== undefined && String(storeId).trim() !== '') {
    const sId = parseInt(storeId, 10);
    if (!isNaN(sId)) {
      if (sId === 1) {
        storeCond = ' AND (sr.store_id = 1 OR sr.store_id IS NULL)';
      } else {
        storeCond = ' AND sr.store_id = ?';
        params.push(sId);
      }
    }
  }

  const query = `
    SELECT 
      sr.id,
      ${hasStoreId ? 'COALESCE(sr.store_id, 1) AS store_id,' : '1 AS store_id,'}
      sr.name,
      sr.free_shipping_threshold,
      sr.standard_fee,
      sr.is_enabled,
      sr.regional_overrides,
      sr.created_at,
      sr.updated_at
    FROM shipping_rules sr
    WHERE sr.id = ?${storeCond}
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, params);
  if (!rows || rows.length === 0) {
    return null;
  }

  const r = rows[0];
  const isStore2 = parseInt(r.store_id, 10) === 2;
  const thresholdVal = parseInt(r.free_shipping_threshold, 10) || 0;
  const standardFeeVal = parseInt(r.standard_fee, 10) || 0;

  return {
    ...r,
    free_shipping_threshold_rupees: isStore2 ? Math.round(thresholdVal / 100) : thresholdVal,
    standard_fee_rupees: isStore2 ? Math.round(standardFeeVal / 100) : standardFeeVal,
    regional_overrides: safeJsonParse(r.regional_overrides, null)
  };
};

/**
 * Create a new shipping rule in MySQL
 */
const createShippingRule = async (ruleData) => {
  const {
    name = 'Standard Shipping',
    free_shipping_threshold = 0,
    standard_fee = 0,
    is_enabled = 1,
    regional_overrides = null,
    store_id = 1
  } = ruleData;

  const hasStoreId = await checkHasStoreId();
  const activeStoreId = parseInt(store_id, 10) === 2 ? 2 : 1;
  const ruleName = name && typeof name === 'string' && name.trim() ? name.trim() : 'Standard Shipping';
  const thresholdVal = Math.max(parseInt(free_shipping_threshold, 10) || 0, 0);
  const feeVal = Math.max(parseInt(standard_fee, 10) || 0, 0);

  const overridesJson = regional_overrides !== null && regional_overrides !== undefined
    ? JSON.stringify(regional_overrides)
    : null;

  const query = hasStoreId ? `
    INSERT INTO shipping_rules (
      name, store_id, free_shipping_threshold, standard_fee, is_enabled, regional_overrides
    ) VALUES (?, ?, ?, ?, ?, ?)
  ` : `
    INSERT INTO shipping_rules (
      name, free_shipping_threshold, standard_fee, is_enabled, regional_overrides
    ) VALUES (?, ?, ?, ?, ?)
  `;

  const params = hasStoreId ? [
    ruleName,
    activeStoreId,
    thresholdVal,
    feeVal,
    is_enabled ? 1 : 0,
    overridesJson
  ] : [
    ruleName,
    thresholdVal,
    feeVal,
    is_enabled ? 1 : 0,
    overridesJson
  ];

  const [result] = await pool.execute(query, params);
  return getShippingRuleById(result.insertId, activeStoreId);
};

/**
 * Update an existing shipping rule in MySQL
 */
const updateShippingRule = async (id, ruleData, storeId = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid shipping rule ID format.');
  }

  const existing = await getShippingRuleById(numId, storeId);
  if (!existing) {
    return null;
  }

  const {
    name,
    free_shipping_threshold,
    standard_fee,
    is_enabled,
    regional_overrides
  } = ruleData;

  const updates = [];
  const params = [];

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Shipping rule name cannot be empty');
    }
    updates.push('name = ?');
    params.push(name.trim());
  }

  if (free_shipping_threshold !== undefined) {
    const thresholdVal = Math.max(parseInt(free_shipping_threshold, 10) || 0, 0);
    updates.push('free_shipping_threshold = ?');
    params.push(thresholdVal);
  }

  if (standard_fee !== undefined) {
    const feeVal = Math.max(parseInt(standard_fee, 10) || 0, 0);
    updates.push('standard_fee = ?');
    params.push(feeVal);
  }

  if (is_enabled !== undefined) {
    updates.push('is_enabled = ?');
    params.push(is_enabled ? 1 : 0);
  }

  if (regional_overrides !== undefined) {
    updates.push('regional_overrides = ?');
    params.push(regional_overrides !== null ? JSON.stringify(regional_overrides) : null);
  }

  if (updates.length > 0) {
    const query = hasStoreId && storeId !== null && storeId !== undefined
      ? `UPDATE shipping_rules SET ${updates.join(', ')} WHERE id = ? AND (store_id = ? OR (store_id IS NULL AND ? = 1))`
      : `UPDATE shipping_rules SET ${updates.join(', ')} WHERE id = ?`;
    params.push(numId);
    if (hasStoreId && storeId !== null && storeId !== undefined) {
      const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
      params.push(activeStoreId, activeStoreId);
    }
    await pool.execute(query, params);
  }

  return getShippingRuleById(numId, storeId);
};

/**
 * Soft disable a shipping rule (setting is_enabled = 0)
 */
const deleteShippingRule = async (id, storeId = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid shipping rule ID format.');
  }

  const existing = await getShippingRuleById(numId, storeId);
  if (!existing) {
    return false;
  }

  const hasStoreId = await checkHasStoreId();
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const deleteQuery = hasStoreId && storeId !== null && storeId !== undefined
    ? 'UPDATE shipping_rules SET is_enabled = 0 WHERE id = ? AND (store_id = ? OR (store_id IS NULL AND ? = 1))'
    : 'UPDATE shipping_rules SET is_enabled = 0 WHERE id = ?';
  const deleteParams = hasStoreId && storeId !== null && storeId !== undefined
    ? [numId, activeStoreId, activeStoreId]
    : [numId];
  const [result] = await pool.execute(deleteQuery, deleteParams);
  return result.affectedRows > 0;
};

/**
 * Calculate applicable shipping fee for a given order subtotal and optional region
 */
const calculateShippingFee = async ({ subtotal, region, rule_id, storeId = 1 } = {}) => {
  const parsedSubtotal = Math.max(parseInt(subtotal, 10) || 0, 0);
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;

  let rule = null;
  if (rule_id) {
    rule = await getShippingRuleById(rule_id, activeStoreId);
  }

  if (!rule) {
    try {
      const hasStoreId = await checkHasStoreId();
      let query = 'SELECT * FROM shipping_rules WHERE is_enabled = 1';
      const params = [];
      if (hasStoreId) {
        if (activeStoreId === 2) {
          query += ' AND store_id = 2';
        } else {
          query += ' AND (store_id = 1 OR store_id IS NULL)';
        }
      }
      query += ' ORDER BY id DESC LIMIT 1';
      const [rows] = await pool.execute(query, params);
      if (rows && rows.length > 0) {
        const r = rows[0];
        rule = {
          ...r,
          regional_overrides: safeJsonParse(r.regional_overrides, null)
        };
      }
    } catch (_) {
      // Fall back gracefully to store defaults if database is unreachable
    }
  }

  // Fallback defaults if no rule exists in database
  if (!rule) {
    const isMarshans = activeStoreId === 2;
    rule = {
      id: null,
      name: isMarshans ? 'Default Marshans 3D Shipping' : 'Default Standard Shipping',
      free_shipping_threshold: isMarshans ? 99999900 : 499,
      standard_fee: isMarshans ? 8000 : 50,
      is_enabled: 1,
      regional_overrides: null
    };
  }

  let effectiveStandardFee = parseInt(rule.standard_fee, 10) || 0;
  let effectiveThreshold = parseInt(rule.free_shipping_threshold, 10) || 0;
  let regionMatched = null;

  if (region && String(region).trim() && rule.regional_overrides) {
    const targetRegion = String(region).trim().toUpperCase();
    const overrides = rule.regional_overrides;

    if (typeof overrides === 'object' && !Array.isArray(overrides)) {
      const matchKey = Object.keys(overrides).find(
        k => k.toUpperCase() === targetRegion
      );
      if (matchKey) {
        const regionalConfig = overrides[matchKey];
        regionMatched = targetRegion;
        if (regionalConfig.standard_fee !== undefined) {
          effectiveStandardFee = parseInt(regionalConfig.standard_fee, 10) || 0;
        }
        if (regionalConfig.free_shipping_threshold !== undefined) {
          effectiveThreshold = parseInt(regionalConfig.free_shipping_threshold, 10) || 0;
        }
      }
    } else if (Array.isArray(overrides)) {
      const match = overrides.find(
        item => item.region && String(item.region).toUpperCase() === targetRegion
      );
      if (match) {
        regionMatched = targetRegion;
        if (match.standard_fee !== undefined) {
          effectiveStandardFee = parseInt(match.standard_fee, 10) || 0;
        }
        if (match.free_shipping_threshold !== undefined) {
          effectiveThreshold = parseInt(match.free_shipping_threshold, 10) || 0;
        }
      }
    }
  }

  const isFree = parsedSubtotal >= effectiveThreshold;
  const shippingFee = isFree ? 0 : effectiveStandardFee;
  const isStore2 = activeStoreId === 2;

  return {
    subtotal: parsedSubtotal,
    subtotal_rupees: isStore2 ? Math.round(parsedSubtotal / 100) : parsedSubtotal,
    shipping_fee: shippingFee,
    shipping_fee_rupees: isStore2 ? Math.round(shippingFee / 100) : shippingFee,
    is_free: isFree,
    free_shipping_threshold: effectiveThreshold,
    free_shipping_threshold_rupees: isStore2 ? Math.round(effectiveThreshold / 100) : effectiveThreshold,
    applied_rule: {
      id: rule.id || null,
      name: rule.name || 'Standard Shipping',
      region_matched: regionMatched
    }
  };
};

/**
 * Unified store shipping config (fees, policy, thresholds)
 */
const getStoreShippingConfig = async (storeId = 1) => {
  const settingsService = require('./settingsService');
  const settings = await settingsService.getStoreSettings(storeId);
  const rulesResult = await getShippingRules({ storeId, limit: 20 });
  const isStore2 = parseInt(storeId, 10) === 2;
  const defaultFee = isStore2 ? 8000 : 50;
  const defaultThreshold = isStore2 ? 99999900 : 499;
  const rawFee = settings.shipping_fee !== undefined ? settings.shipping_fee : defaultFee;
  const rawThreshold = settings.free_shipping_threshold !== undefined ? settings.free_shipping_threshold : defaultThreshold;
  return {
    store_id: storeId,
    standard_fee: rawFee,
    standard_fee_rupees: isStore2 ? Math.round(rawFee / 100) : rawFee,
    free_shipping_enabled: settings.free_shipping_enabled !== false,
    free_shipping_threshold: rawThreshold,
    free_shipping_threshold_rupees: isStore2 ? Math.round(rawThreshold / 100) : rawThreshold,
    rules: rulesResult.rules || []
  };
};

const updateStoreShippingConfig = async (storeId = 1, { standard_fee, free_shipping_enabled, free_shipping_threshold }) => {
  const settingsService = require('./settingsService');
  const payload = {};
  if (standard_fee !== undefined) payload.shipping_fee = parseInt(standard_fee, 10);
  if (free_shipping_enabled !== undefined) payload.free_shipping_enabled = free_shipping_enabled === true || free_shipping_enabled === 'true';
  if (free_shipping_threshold !== undefined) payload.free_shipping_threshold = parseInt(free_shipping_threshold, 10);

  await settingsService.updateStoreSettings(storeId, payload);
  return getStoreShippingConfig(storeId);
};

module.exports = {
  getShippingRules,
  getShippingRuleById,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  calculateShippingFee,
  getStoreShippingConfig,
  updateStoreShippingConfig
};
