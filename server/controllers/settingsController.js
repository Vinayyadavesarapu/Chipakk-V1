const settingsService = require('../services/settingsService');
const { pool } = require('../config/database');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Public Store Settings Handler (Customer Storefront)
 * GET /api/settings
 * Resolves settings strictly for the requesting storefront (chipakk.shop vs themarshans.shop)
 */
const getSettingsHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 1;
    const settings = await settingsService.getStoreSettings(storeId);

    // Look up authoritative active shipping rule from shipping_rules table if present
    let activeShippingThreshold = settings.free_shipping_threshold !== undefined ? settings.free_shipping_threshold : (storeId === 2 ? 0 : 49900);
    let activeShippingFee = settings.shipping_fee || (storeId === 2 ? 10000 : 5000);
    let isFreeShippingEnabled = settings.free_shipping_enabled !== undefined ? Boolean(settings.free_shipping_enabled) : (storeId === 1);

    // If Store 2 (THE MARSHANS), strictly enforce NO free shipping
    if (storeId === 2) {
      isFreeShippingEnabled = false;
      activeShippingThreshold = 0;
    }

    try {
      // Check for store-specific shipping rule
      const [rules] = await pool.execute(
        'SELECT free_shipping_threshold, standard_fee FROM shipping_rules WHERE is_enabled = 1 AND (store_id = ? OR store_id IS NULL) ORDER BY store_id DESC, id DESC LIMIT 1',
        [storeId]
      );
      if (rules.length > 0) {
        if (storeId === 1 && rules[0].free_shipping_threshold !== null && rules[0].free_shipping_threshold !== undefined) {
          activeShippingThreshold = parseInt(rules[0].free_shipping_threshold, 10);
        }
        if (rules[0].standard_fee !== null && rules[0].standard_fee !== undefined) {
          activeShippingFee = parseInt(rules[0].standard_fee, 10);
        }
      }
    } catch (ruleErr) {
      // Non-blocking fallback
    }

    const freeShippingThresholdRupees = Math.round(activeShippingThreshold / 100);
    const shippingFeeRupees = Math.round(activeShippingFee / 100);

    // Filter to expose storefront-safe settings only
    const publicSettings = {
      store_id: storeId,
      store_code: req.storeCode || (storeId === 2 ? 'marshans' : 'chipakk'),
      store_name: settings.store_name || (storeId === 2 ? 'THE MARSHANS' : 'CHIPAKK'),
      store_status: settings.store_status || 'OPEN',
      order_acceptance: settings.order_acceptance || 'ACCEPTING ORDERS',
      gst_pct: settings.gst_pct !== undefined ? settings.gst_pct : 18,
      gst_enabled: settings.gst_enabled !== undefined ? settings.gst_enabled : true,
      shipping_fee: activeShippingFee,
      shipping_fee_rupees: shippingFeeRupees,
      free_shipping_enabled: isFreeShippingEnabled,
      free_shipping_threshold: activeShippingThreshold,
      free_shipping_threshold_rupees: freeShippingThresholdRupees,
      free_shipping_calculation: settings.free_shipping_calculation || 'after_discounts',
      announcement_text: settings.announcement_text || '',
      announcement_active: settings.announcement_active || false,
      maintenance_active: settings.maintenance_active || false,
      maintenance_message: settings.maintenance_message || '',
      support_email: settings.support_email || (storeId === 2 ? 'support@themarshans.shop' : 'support@chipakk.shop'),
      support_phone: settings.support_phone || '+91 98765 00000'
    };

    // Include 3D specific settings if MARSHANS
    if (storeId === 2 && settings.material_settings) {
      publicSettings.material_settings = settings.material_settings;
    }

    return sendSuccess(res, {
      settings: publicSettings
    }, 'Store settings retrieved successfully');
  } catch (error) {
    console.warn('[Settings Public Handler Fallback]', error.message);
    const fallbackStoreId = req.storeId || 1;
    const isMarshans = fallbackStoreId === 2;

    return sendSuccess(res, {
      settings: {
        store_id: fallbackStoreId,
        store_code: isMarshans ? 'marshans' : 'chipakk',
        store_name: isMarshans ? 'THE MARSHANS' : 'CHIPAKK',
        store_status: 'OPEN',
        order_acceptance: 'ACCEPTING ORDERS',
        gst_pct: 18,
        gst_enabled: true,
        shipping_fee: isMarshans ? 10000 : 5000,
        shipping_fee_rupees: isMarshans ? 100 : 50,
        free_shipping_enabled: !isMarshans,
        free_shipping_threshold: isMarshans ? 0 : 49900,
        free_shipping_threshold_rupees: isMarshans ? 0 : 499,
        free_shipping_calculation: 'after_discounts',
        announcement_text: isMarshans ? 'PRECISION 3D PRINTING & RAPID PROTOTYPING' : 'WELCOME TO CHIPAKK!',
        announcement_active: true,
        maintenance_active: false,
        maintenance_message: '',
        support_email: isMarshans ? 'support@themarshans.shop' : 'support@chipakk.shop',
        support_phone: '+91 98765 00000'
      }
    }, 'Public store settings fallback');
  }
};

/**
 * Get Admin Store Settings Handler
 * GET /api/admin/settings
 * Scoped to the currently selected store in Admin Panel
 */
const getAdminSettingsHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 1;
    const settings = await settingsService.getStoreSettings(storeId);

    return sendSuccess(res, {
      store_id: storeId,
      store_code: req.storeCode || (storeId === 2 ? 'marshans' : 'chipakk'),
      settings
    }, 'Admin store settings retrieved successfully');
  } catch (error) {
    console.warn('[Settings Admin Handler Fallback]', error.message);
    const fallbackStoreId = req.storeId || 1;
    const isMarshans = fallbackStoreId === 2;

    return sendSuccess(res, {
      store_id: fallbackStoreId,
      store_code: isMarshans ? 'marshans' : 'chipakk',
      settings: {
        store_name: isMarshans ? 'THE MARSHANS' : 'CHIPAKK',
        store_status: 'OPEN',
        order_acceptance: 'ACCEPTING ORDERS',
        gst_pct: 18,
        shipping_fee: isMarshans ? 10000 : 5000,
        free_shipping_enabled: !isMarshans,
        free_shipping_threshold: isMarshans ? 0 : 49900
      }
    }, 'Admin store settings fallback');
  }
};

/**
 * Update Admin Store Settings Handler
 * PUT /api/admin/settings
 * Updates settings strictly for req.storeId
 */
const updateSettingsHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 1;
    const settingsMap = req.body;

    if (!settingsMap || typeof settingsMap !== 'object' || Array.isArray(settingsMap)) {
      return sendError(res, 'Settings object payload is required.', 400);
    }

    let updatedSettings;
    try {
      updatedSettings = await settingsService.updateStoreSettings(storeId, settingsMap);
    } catch (valErr) {
      if (valErr.statusCode === 400 || valErr.message.includes('Invalid') || valErr.message.includes('GST')) {
        return sendError(res, valErr.message, 400);
      }
      throw valErr;
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'settings.updated',
        'store_settings',
        String(storeId),
        {
          store_id: storeId,
          store_code: req.storeCode || (storeId === 2 ? 'marshans' : 'chipakk'),
          updated_keys: Object.keys(settingsMap)
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, {
      store_id: storeId,
      store_code: req.storeCode || (storeId === 2 ? 'marshans' : 'chipakk'),
      settings: updatedSettings
    }, 'Store settings updated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getSettingsHandler,
  getAdminSettingsHandler,
  updateSettingsHandler
};
