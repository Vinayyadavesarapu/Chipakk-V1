const { pool } = require('../config/database');

/**
 * Store 1 (CHIPAKK) Default Settings Profile
 * Low shipping fee, free shipping enabled for merchandise orders >= ₹300
 */
const STORE_1_DEFAULTS = {
  store_name: 'CHIPAKK Stickers',
  store_status: 'OPEN',
  order_acceptance: 'ACCEPTING ORDERS',
  gst_pct: 18,
  gst_rate: 18,
  gst_enabled: true,
  gstin: '07AAAAA0000A1Z5',
  shipping_fee: 50,
  free_shipping_enabled: true,
  free_shipping_threshold: 300,
  free_shipping_calculation: 'after_discounts',
  announcement_text: 'WELCOME TO CHIPAKK! GET 10% OFF ON YOUR FIRST ORDER',
  announcement_active: true,
  maintenance_active: false,
  maintenance_message: 'CHIPAKK is currently undergoing scheduled maintenance.',
  support_email: 'support@chipakk.shop',
  support_phone: '+91 98765 00000'
};

/**
 * Store 2 (THE MARSHANS) Default Settings Profile
 * Heavy parcel shipping fee (₹100), strictly NO free shipping, 3D printing & quotation parameters
 */
const STORE_2_DEFAULTS = {
  store_name: 'THE MARSHANS',
  store_status: 'OPEN',
  order_acceptance: 'ACCEPTING ORDERS',
  gst_pct: 18,
  gst_rate: 18,
  gst_enabled: true,
  gstin: '07AAAAA0000A1Z5',
  shipping_fee: 10000,
  free_shipping_enabled: false, // STRICTLY NO FREE SHIPPING for 3D manufacturing
  free_shipping_threshold: 0,
  free_shipping_calculation: 'after_discounts',
  announcement_text: 'PRECISION 3D PRINTING & CUSTOM ON-DEMAND MANUFACTURING',
  announcement_active: true,
  maintenance_active: false,
  maintenance_message: 'THE MARSHANS workshop is currently offline for calibration.',
  support_email: 'support@themarshans.shop',
  support_phone: '+91 98765 00000',
  material_settings: {
    default_infill: 20,
    allow_custom_filaments: true,
    min_wall_thickness_mm: 1.2
  },
  production_settings: {
    auto_assign_printers: false,
    qa_inspection_required: true
  },
  quotation_settings: {
    auto_quote_multiplier: 2.5,
    quote_validity_days: 14,
    rush_fee_pct: 30
  }
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
 * Fetch store-specific settings as a key-value map merged with store defaults
 * @param {number} storeId - 1 for CHIPAKK, 2 for THE MARSHANS
 */
const getStoreSettings = async (storeId = 1) => {
  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const baseDefaults = numericStoreId === 2 ? STORE_2_DEFAULTS : STORE_1_DEFAULTS;

  let rows = [];

  try {
    // 1. Try querying store_settings table
    const query = 'SELECT setting_key, setting_value FROM store_settings WHERE store_id = ?';
    [rows] = await pool.execute(query, [numericStoreId]);
  } catch (dbErr) {
    // Fallback: If store_settings does not exist yet (pre-migration), check legacy site_settings
    if (numericStoreId === 1) {
      try {
        const [legacyRows] = await pool.execute('SELECT setting_key, setting_value FROM site_settings');
        rows = legacyRows;
      } catch (legErr) {
        rows = [];
      }
    }
  }

  const settingsMap = { ...baseDefaults };
  if (Array.isArray(rows)) {
    rows.forEach(row => {
      let val = row.setting_value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) { /* keep string */ }
      }
      settingsMap[row.setting_key] = val;
    });
  }

  return settingsMap;
};

/**
 * Upsert store settings for a specific store_id (Partial Update preserving existing settings)
 * @param {number} storeId - 1 for CHIPAKK, 2 for THE MARSHANS
 * @param {object} settingsMap - Key-value map of updated settings
 */
const updateStoreSettings = async (storeId = 1, settingsMap = {}) => {
  validateSettingsPayload(settingsMap);

  const numericStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const keys = Object.keys(settingsMap);
  if (keys.length === 0) {
    return getStoreSettings(numericStoreId);
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let storeSettingsTableExists = true;

    try {
      const upsertStoreQuery = `
        INSERT INTO store_settings (store_id, setting_key, setting_value)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP
      `;

      for (const key of keys) {
        let value = settingsMap[key];

        // Normalize uppercase status strings & numeric values
        if (key === 'store_status' && typeof value === 'string') {
          value = value.trim().toUpperCase();
        }
        if (key === 'order_acceptance' && typeof value === 'string') {
          value = value.trim().toUpperCase();
        }
        if ((key === 'gst_pct' || key === 'gst_rate') && value !== null && value !== undefined && value !== '') {
          value = Number(value);
        }
        if ((key === 'shipping_fee' || key === 'free_shipping_threshold') && value !== null && value !== undefined && value !== '') {
          value = Number(value);
        }

        const jsonValue = JSON.stringify(value !== undefined ? value : null);
        await connection.execute(upsertStoreQuery, [numericStoreId, key, jsonValue]);
      }
    } catch (storeErr) {
      if (storeErr.message.includes("Table 'store_settings' doesn't exist")) {
        storeSettingsTableExists = false;
      } else {
        throw storeErr;
      }
    }

    // Mirror to legacy site_settings if Store 1 for backward compatibility
    if (numericStoreId === 1) {
      try {
        const upsertLegacyQuery = `
          INSERT INTO site_settings (setting_key, setting_value)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
        `;
        for (const key of keys) {
          let value = settingsMap[key];
          const jsonValue = JSON.stringify(value !== undefined ? value : null);
          await connection.execute(upsertLegacyQuery, [key, jsonValue]);
        }
      } catch (legErr) {
        // Ignore if site_settings table is not present
      }
    }

    await connection.commit();
    connection.release();

    return getStoreSettings(numericStoreId);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Backward compatibility aliases for existing codebase
 */
const getSiteSettings = async (storeId = 1) => getStoreSettings(storeId);
const updateSiteSettings = async (settingsMap, storeId = 1) => updateStoreSettings(storeId, settingsMap);

module.exports = {
  STORE_1_DEFAULTS,
  STORE_2_DEFAULTS,
  DEFAULT_SETTINGS: STORE_1_DEFAULTS,
  ALLOWED_STORE_STATUSES,
  ALLOWED_ORDER_ACCEPTANCE,
  getStoreSettings,
  updateStoreSettings,
  getSiteSettings,
  updateSiteSettings,
  validateSettingsPayload
};
