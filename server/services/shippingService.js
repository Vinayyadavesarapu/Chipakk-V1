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

/**
 * Fetch list of shipping rules with pagination and filtering
 */
const getShippingRules = async ({
  is_enabled,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

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
    const thresholdPaise = parseInt(r.free_shipping_threshold, 10) || 0;
    const standardFeePaise = parseInt(r.standard_fee, 10) || 0;

    return {
      ...r,
      free_shipping_threshold_rupees: Math.round(thresholdPaise / 100),
      standard_fee_rupees: Math.round(standardFeePaise / 100),
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
const getShippingRuleById = async (ruleId) => {
  if (!ruleId) return null;

  const numId = parseInt(ruleId, 10);
  if (isNaN(numId)) return null;

  const query = `
    SELECT 
      sr.id,
      sr.name,
      sr.free_shipping_threshold,
      sr.standard_fee,
      sr.is_enabled,
      sr.regional_overrides,
      sr.created_at,
      sr.updated_at
    FROM shipping_rules sr
    WHERE sr.id = ?
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, [numId]);
  if (!rows || rows.length === 0) {
    return null;
  }

  const r = rows[0];
  const thresholdPaise = parseInt(r.free_shipping_threshold, 10) || 0;
  const standardFeePaise = parseInt(r.standard_fee, 10) || 0;

  return {
    ...r,
    free_shipping_threshold_rupees: Math.round(thresholdPaise / 100),
    standard_fee_rupees: Math.round(standardFeePaise / 100),
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
    regional_overrides = null
  } = ruleData;

  const ruleName = name && typeof name === 'string' && name.trim() ? name.trim() : 'Standard Shipping';
  const thresholdVal = Math.max(parseInt(free_shipping_threshold, 10) || 0, 0);
  const feeVal = Math.max(parseInt(standard_fee, 10) || 0, 0);

  const overridesJson = regional_overrides !== null && regional_overrides !== undefined
    ? JSON.stringify(regional_overrides)
    : null;

  const query = `
    INSERT INTO shipping_rules (
      name, free_shipping_threshold, standard_fee, is_enabled, regional_overrides
    ) VALUES (?, ?, ?, ?, ?)
  `;

  const params = [
    ruleName,
    thresholdVal,
    feeVal,
    is_enabled ? 1 : 0,
    overridesJson
  ];

  const [result] = await pool.execute(query, params);
  return getShippingRuleById(result.insertId);
};

/**
 * Update an existing shipping rule in MySQL
 */
const updateShippingRule = async (id, ruleData) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid shipping rule ID format.');
  }

  const existing = await getShippingRuleById(numId);
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
    const query = `UPDATE shipping_rules SET ${updates.join(', ')} WHERE id = ?`;
    params.push(numId);
    await pool.execute(query, params);
  }

  return getShippingRuleById(numId);
};

/**
 * Soft disable a shipping rule (setting is_enabled = 0)
 */
const deleteShippingRule = async (id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid shipping rule ID format.');
  }

  const [result] = await pool.execute('UPDATE shipping_rules SET is_enabled = 0 WHERE id = ?', [numId]);
  return result.affectedRows > 0;
};

/**
 * Calculate applicable shipping fee for a given order subtotal and optional region
 */
const calculateShippingFee = async ({ subtotal, region, rule_id } = {}) => {
  const parsedSubtotal = Math.max(parseInt(subtotal, 10) || 0, 0);

  let rule = null;
  if (rule_id) {
    rule = await getShippingRuleById(rule_id);
  }

  if (!rule) {
    const [rows] = await pool.execute(
      'SELECT * FROM shipping_rules WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1'
    );
    if (rows.length > 0) {
      const r = rows[0];
      rule = {
        ...r,
        regional_overrides: safeJsonParse(r.regional_overrides, null)
      };
    }
  }

  // Fallback defaults if no rule exists in database
  if (!rule) {
    rule = {
      id: null,
      name: 'Default Standard Shipping',
      free_shipping_threshold: 49900,
      standard_fee: 5000,
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

  return {
    subtotal: parsedSubtotal,
    subtotal_rupees: Math.round(parsedSubtotal / 100),
    shipping_fee: shippingFee,
    shipping_fee_rupees: Math.round(shippingFee / 100),
    is_free: isFree,
    free_shipping_threshold: effectiveThreshold,
    free_shipping_threshold_rupees: Math.round(effectiveThreshold / 100),
    applied_rule: {
      id: rule.id || null,
      name: rule.name || 'Standard Shipping',
      region_matched: regionMatched
    }
  };
};

module.exports = {
  getShippingRules,
  getShippingRuleById,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  calculateShippingFee
};
