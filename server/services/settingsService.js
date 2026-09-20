const { pool } = require('../config/database');

/**
 * Store 1 (CHIPAKK) Default Settings Profile
 * Low shipping fee, free shipping enabled for merchandise orders >= ₹300
 */
const STORE_1_DEFAULTS = {
  store_name: 'CHIPAKK Stickers',
  store_status: 'OPEN',
  order_acceptance: 'ACCEPTING ORDERS',
  // Tax: prices are GST-inclusive. The registered supplier (legal name, GSTIN, address, state) is NOT a store
  // setting: it is one shared record (legal_suppliers), so it cannot drift between CHIPAKK and THE MARSHANS.
  trade_name: 'CHIPAKK',
  gst_pct: 18,
  gst_rate: 18,
  gst_enabled: true,
  tax_pricing_mode: 'inclusive',
  invoice_prefix: 'CHP',
  shipping_fee: 50,
  free_shipping_enabled: true,
  free_shipping_threshold: 300,
  free_shipping_calculation: 'gross_subtotal',
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
  trade_name: 'THE MARSHANS',
  gst_pct: 18,
  gst_rate: 18,
  gst_enabled: true,
  tax_pricing_mode: 'inclusive',
  invoice_prefix: 'MRS',
  shipping_fee: 10000,
  free_shipping_enabled: false, // STRICTLY NO FREE SHIPPING for 3D manufacturing
  free_shipping_threshold: 0,
  free_shipping_calculation: 'gross_subtotal',
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
const SUPPLIER_IDENTITY_KEYS = ['gstin', 'legal_supplier_name', 'seller_address', 'seller_state', 'seller_state_code', 'store_state'];

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
  for (const key of ['gst_pct', 'gst_rate', 'default_gst_rate']) {
    const gstVal = settingsMap[key];
    if (gstVal !== undefined && gstVal !== null && gstVal !== '') {
      const numGst = Number(gstVal);
      if (isNaN(numGst) || numGst < 0 || numGst > 100) {
        const err = new Error('GST percentage/rate must be a number between 0 and 100.');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Supplier identity is ONE shared record for both stores; refuse to store a second copy per store.
  const supplierKeys = SUPPLIER_IDENTITY_KEYS.filter((k) => settingsMap[k] !== undefined);
  if (supplierKeys.length) {
    const err = new Error(`GST supplier details (${supplierKeys.join(', ')}) are managed once for both stores under Business & Tax -> Legal supplier, not as store settings.`);
    err.statusCode = 400;
    throw err;
  }

  // Optional HSN / rate for custom-sticker lines (they have no catalogue record). Empty = unset.
  if (settingsMap.custom_sticker_hsn_code !== undefined && settingsMap.custom_sticker_hsn_code !== null && settingsMap.custom_sticker_hsn_code !== '' &&
      !/^\d{4}(\d{2}(\d{2})?)?$/.test(String(settingsMap.custom_sticker_hsn_code).trim())) {
    const err = new Error('Custom sticker HSN code must be 4, 6 or 8 digits.');
    err.statusCode = 400;
    throw err;
  }
  if (settingsMap.custom_sticker_gst_rate !== undefined && settingsMap.custom_sticker_gst_rate !== null && settingsMap.custom_sticker_gst_rate !== '') {
    const n = Number(settingsMap.custom_sticker_gst_rate);
    if (!isFinite(n) || n < 0 || n > 100) {
      const err = new Error('Custom sticker GST rate must be a number between 0 and 100.');
      err.statusCode = 400;
      throw err;
    }
  }

  // Only GST-inclusive pricing exists: GST is never added on top of a displayed price.
  if (settingsMap.tax_pricing_mode !== undefined && settingsMap.tax_pricing_mode !== null &&
      String(settingsMap.tax_pricing_mode).trim().toLowerCase() !== 'inclusive') {
    const err = new Error('Only GST-inclusive pricing (tax_pricing_mode = "inclusive") is supported.');
    err.statusCode = 400;
    throw err;
  }

  // Invoice series prefix: 1-3 letters/digits so "<PREFIX>/25-26/000001" stays within the 16-character invoice limit.
  if (settingsMap.invoice_prefix !== undefined && settingsMap.invoice_prefix !== null) {
    if (!/^[A-Za-z0-9]{1,3}$/.test(String(settingsMap.invoice_prefix).trim())) {
      const err = new Error('Invoice prefix must be 1-3 letters or digits (e.g. CHP).');
      err.statusCode = 400;
      throw err;
    }
  }

  // Shipping eligibility is decided on the GROSS merchandise subtotal, never after discounts.
  if (settingsMap.free_shipping_calculation !== undefined && settingsMap.free_shipping_calculation !== null &&
      String(settingsMap.free_shipping_calculation).trim() !== 'gross_subtotal') {
    const err = new Error('free_shipping_calculation must be "gross_subtotal": coupons never reduce free-shipping eligibility.');
    err.statusCode = 400;
    throw err;
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
  // gst_pct, gst_rate and default_gst_rate are ONE value under three historical names: keep them in step on write.
  settingsMap = { ...settingsMap };
  const rateAlias = ['default_gst_rate', 'gst_pct', 'gst_rate'].find((k) => settingsMap[k] !== undefined && settingsMap[k] !== null && settingsMap[k] !== '');
  if (rateAlias) {
    const v = Number(settingsMap[rateAlias]);
    settingsMap.gst_pct = v; settingsMap.gst_rate = v; settingsMap.default_gst_rate = v;
  }

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
        if ((key === 'gst_pct' || key === 'gst_rate' || key === 'default_gst_rate') && value !== null && value !== undefined && value !== '') {
          value = Number(value);
        }
        if (key === 'invoice_prefix' && typeof value === 'string') {
          value = value.trim().toUpperCase();
        }
        if (key === 'tax_pricing_mode' && typeof value === 'string') {
          value = value.trim().toLowerCase();
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

    // Orders are charged from the shipping rule: keep it in step with the saved fee/threshold
    if (settingsMap.shipping_fee !== undefined || settingsMap.free_shipping_threshold !== undefined) {
      try {
        await require('./shippingService').syncDefaultRuleFromSettings(numericStoreId, {
          shipping_fee: settingsMap.shipping_fee,
          free_shipping_threshold: settingsMap.free_shipping_threshold
        });
      } catch (syncErr) {
        console.error('[Settings] Saved settings but could not sync the shipping rule:', syncErr.message);
      }
    }

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
  SUPPLIER_IDENTITY_KEYS,
  getStoreSettings,
  updateStoreSettings,
  getSiteSettings,
  updateSiteSettings,
  validateSettingsPayload
};
