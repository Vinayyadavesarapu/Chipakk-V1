const { pool } = require('../config/database');

/**
 * Default fallback site settings
 */
const DEFAULT_SETTINGS = {
  store_name: 'CHIPAKK',
  store_status: 'OPEN',
  order_acceptance: 'ACCEPTING ORDERS',
  gst_pct: 18,
  gst_rate: 18,
  gst_enabled: true,
  gstin: '07AAAAA0000A1Z5',
  shipping_fee: 5000,
  free_shipping_enabled: true,
  free_shipping_threshold: 49900,
  free_shipping_calculation: 'after_discounts',
  announcement_text: 'WELCOME TO CHIPAKK!',
  announcement_active: true,
  maintenance_active: false,
  maintenance_message: 'We are currently down for scheduled maintenance.'
};

/**
 * Allowed setting values for strict validation
 */
const ALLOWED_STORE_STATUSES = ['OPEN', 'MAINTENANCE', 'TEMPORARILY CLOSED'];
const ALLOWED_ORDER_ACCEPTANCE = ['ACCEPTING ORDERS', 'PAUSED'];

/**
 * Validate settings payload before database upsert
 */
const validateSettingsPayload = (settingsMap) => {
  if (!settingsMap || typeof settingsMap !== 'object' || Array.isArray(settingsMap)) {
    const err = new Error('Settings payload must be a key-value object.');
    err.statusCode = 400;
    throw err;
  }

  // Validate store_status if present
  if (settingsMap.store_status !== undefined && settingsMap.store_status !== null) {
    const status = String(settingsMap.store_status).trim().toUpperCase();
    if (!ALLOWED_STORE_STATUSES.includes(status)) {
      const err = new Error(`Invalid store status. Allowed values: ${ALLOWED_STORE_STATUSES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate order_acceptance if present
  if (settingsMap.order_acceptance !== undefined && settingsMap.order_acceptance !== null) {
    const acceptance = String(settingsMap.order_acceptance).trim().toUpperCase();
    if (!ALLOWED_ORDER_ACCEPTANCE.includes(acceptance)) {
      const err = new Error(`Invalid order acceptance. Allowed values: ${ALLOWED_ORDER_ACCEPTANCE.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate GST percentage / rate if present
  const gstVal = settingsMap.gst_pct !== undefined ? settingsMap.gst_pct : settingsMap.gst_rate;
  if (gstVal !== undefined && gstVal !== null && gstVal !== '') {
    const numGst = Number(gstVal);
    if (isNaN(numGst) || numGst < 0) {
      const err = new Error('GST percentage/rate must be a non-negative number.');
      err.statusCode = 400;
      throw err;
    }
  }
};

/**
 * Fetch global site settings as a key-value map merged with system defaults
 */
const getSiteSettings = async () => {
  const query = 'SELECT id, setting_key, setting_value, description, updated_at FROM site_settings';
  const [rows] = await pool.execute(query);
  
  const settingsMap = { ...DEFAULT_SETTINGS };
  rows.forEach(row => {
    let val = row.setting_value;
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch (e) { /* keep string */ }
    }
    settingsMap[row.setting_key] = val;
  });

  return settingsMap;
};

/**
 * Upsert site settings from a key-value object (Partial Update preserving existing settings)
 */
const updateSiteSettings = async (settingsMap) => {
  validateSettingsPayload(settingsMap);

  const keys = Object.keys(settingsMap);
  if (keys.length === 0) {
    return getSiteSettings();
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const upsertQuery = `
      INSERT INTO site_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
    `;

    for (const key of keys) {
      let value = settingsMap[key];

      // Normalize uppercase status strings & numeric GST values
      if (key === 'store_status' && typeof value === 'string') {
        value = value.trim().toUpperCase();
      }
      if (key === 'order_acceptance' && typeof value === 'string') {
        value = value.trim().toUpperCase();
      }
      if ((key === 'gst_pct' || key === 'gst_rate') && value !== null && value !== undefined && value !== '') {
        value = Number(value);
      }

      const jsonValue = JSON.stringify(value !== undefined ? value : null);
      await connection.execute(upsertQuery, [key, jsonValue]);
    }

    await connection.commit();
    connection.release();

    return getSiteSettings();
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

module.exports = {
  DEFAULT_SETTINGS,
  ALLOWED_STORE_STATUSES,
  ALLOWED_ORDER_ACCEPTANCE,
  getSiteSettings,
  updateSiteSettings,
  validateSettingsPayload
};
