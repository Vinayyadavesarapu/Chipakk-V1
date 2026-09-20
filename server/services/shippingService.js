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

  const hasStoreId = await checkHasStoreId();

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
 * Built-in shipping defaults (money in each store's native unit).
 *  - CHIPAKK (store 1): whole rupees  => < ₹300 pays ₹50, >= ₹300 ships free
 *  - THE MARSHANS (store 2): paise    => flat heavy-parcel fee, effectively never free
 */
const SHIPPING_DEFAULTS = {
  1: { name: 'Default Standard Shipping', free_shipping_threshold: 300, standard_fee: 50 },
  2: { name: 'Default Marshans 3D Shipping', free_shipping_threshold: 99999900, standard_fee: 8000 }
};

/**
 * THE single place that decides which shipping rule applies to a store.
 * Used by BOTH the order calculation and the public /api/settings response, so what a
 * customer is shown can never differ from what an order is charged.
 */
const resolveShippingRule = async ({ storeId = 1, rule_id = null } = {}) => {
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;

  let rule = null;
  if (rule_id) {
    rule = await getShippingRuleById(rule_id, activeStoreId);
  }

  if (!rule) {
    try {
      const hasStoreId = await checkHasStoreId();
      let query = 'SELECT * FROM shipping_rules WHERE is_enabled = 1';
      if (hasStoreId) {
        query += activeStoreId === 2 ? ' AND store_id = 2' : ' AND (store_id = 1 OR store_id IS NULL)';
      }
      query += ' ORDER BY id DESC LIMIT 1';
      const [rows] = await pool.execute(query, []);
      if (rows && rows.length > 0) {
        rule = { ...rows[0], regional_overrides: safeJsonParse(rows[0].regional_overrides, null) };
      }
    } catch (err) {
      console.warn('[Shipping] Rule lookup failed, using built-in defaults:', err.message);
    }
  }

  if (!rule) {
    const d = SHIPPING_DEFAULTS[activeStoreId];
    rule = { id: null, name: d.name, free_shipping_threshold: d.free_shipping_threshold, standard_fee: d.standard_fee, is_enabled: 1, regional_overrides: null };
  }
  return { rule, storeId: activeStoreId };
};

/**
 * Public shipping policy for a store: what customers are shown and what orders are charged.
 */
const getShippingPolicy = async (storeId = 1) => {
  const { rule, storeId: sid } = await resolveShippingRule({ storeId });
  const isStore2 = sid === 2;
  const fee = Math.max(parseInt(rule.standard_fee, 10) || 0, 0);
  const threshold = Math.max(parseInt(rule.free_shipping_threshold, 10) || 0, 0);
  return {
    store_id: sid,
    source: rule.id ? 'rule' : 'default',
    rule_id: rule.id || null,
    standard_fee: fee,
    standard_fee_rupees: isStore2 ? Math.round(fee / 100) : fee,
    free_shipping_threshold: isStore2 ? 0 : threshold,
    free_shipping_threshold_rupees: isStore2 ? 0 : threshold,
    // THE MARSHANS never inherits CHIPAKK's free-shipping rule
    free_shipping_enabled: !isStore2 && threshold > 0
  };
};

/**
 * Calculate applicable shipping fee for a given order subtotal and optional region.
 * `subtotal` MUST be the gross merchandise subtotal (before any coupon/product discount):
 * discounts never reduce free-shipping eligibility.
 */
const calculateShippingFee = async ({ subtotal, region, rule_id, storeId = 1 } = {}) => {
  const parsedSubtotal = Math.max(parseInt(subtotal, 10) || 0, 0);
  const { rule, storeId: activeStoreId } = await resolveShippingRule({ storeId, rule_id });

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
  // Reports the policy that is actually charged (rule > built-in default), not a second copy of it.
  const policy = await getShippingPolicy(storeId);
  const rulesResult = await getShippingRules({ storeId, limit: 20 });
  return {
    store_id: policy.store_id,
    source: policy.source,
    standard_fee: policy.standard_fee,
    standard_fee_rupees: policy.standard_fee_rupees,
    free_shipping_enabled: policy.free_shipping_enabled,
    free_shipping_threshold: policy.store_id === 2 ? 0 : policy.free_shipping_threshold,
    free_shipping_threshold_rupees: policy.free_shipping_threshold_rupees,
    rules: rulesResult.rules || []
  };
};

/**
 * Keep the enforced shipping rule in step with what an admin saves in Settings.
 * Order totals are charged from the shipping rule (see resolveShippingRule), so a fee/threshold
 * edited in the Settings screen must update that rule or it would silently do nothing.
 * Amounts are in the store's native unit (rupees for CHIPAKK, paise for THE MARSHANS).
 */
const syncDefaultRuleFromSettings = async (storeId, { shipping_fee, free_shipping_threshold } = {}) => {
  const sid = parseInt(storeId, 10) === 2 ? 2 : 1;
  const hasFee = shipping_fee !== undefined && shipping_fee !== null && shipping_fee !== '' && !isNaN(Number(shipping_fee));
  const hasThr = free_shipping_threshold !== undefined && free_shipping_threshold !== null && free_shipping_threshold !== '' && !isNaN(Number(free_shipping_threshold));
  if (!hasFee && !hasThr) return null;

  const { rule } = await resolveShippingRule({ storeId: sid });
  const fee = hasFee ? Math.max(Math.round(Number(shipping_fee)), 0) : parseInt(rule.standard_fee, 10) || 0;
  const thr = hasThr ? Math.max(Math.round(Number(free_shipping_threshold)), 0) : parseInt(rule.free_shipping_threshold, 10) || 0;

  if (rule.id) {
    return updateShippingRule(rule.id, { standard_fee: fee, free_shipping_threshold: thr }, sid);
  }
  return createShippingRule({ name: 'Standard Shipping', standard_fee: fee, free_shipping_threshold: thr, is_enabled: 1, store_id: sid });
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
  SHIPPING_DEFAULTS,
  resolveShippingRule,
  getShippingPolicy,
  getShippingRules,
  getShippingRuleById,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  calculateShippingFee,
  getStoreShippingConfig,
  syncDefaultRuleFromSettings,
  updateStoreShippingConfig
};
