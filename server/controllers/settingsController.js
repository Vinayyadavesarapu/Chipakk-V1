const settingsService = require('../services/settingsService');
const { pool } = require('../config/database');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Public Site Settings Handler (Customer Storefront)
 * GET /api/settings
 */
const getSettingsHandler = async (req, res, next) => {
  try {
    const settings = await settingsService.getSiteSettings();

    // Look up authoritative active shipping rule from shipping_rules table
    let activeShippingThreshold = settings.free_shipping_threshold || 49900;
    let activeShippingFee = settings.shipping_fee || 5000;

    try {
      const [rules] = await pool.execute(
        'SELECT free_shipping_threshold, standard_fee FROM shipping_rules WHERE is_enabled = 1 ORDER BY id DESC LIMIT 1'
      );
      if (rules.length > 0) {
        if (rules[0].free_shipping_threshold !== null && rules[0].free_shipping_threshold !== undefined) {
          activeShippingThreshold = parseInt(rules[0].free_shipping_threshold, 10);
        }
        if (rules[0].standard_fee !== null && rules[0].standard_fee !== undefined) {
          activeShippingFee = parseInt(rules[0].standard_fee, 10);
        }
      }
    } catch (ruleErr) {
      console.warn('[Settings Shipping Rule Warning]', ruleErr.message);
    }

    const freeShippingThresholdRupees = Math.round(activeShippingThreshold / 100);
    const shippingFeeRupees = Math.round(activeShippingFee / 100);

    // Filter to expose storefront-safe settings only
    const publicSettings = {
      store_name: settings.store_name || 'CHIPAKK',
      store_status: settings.store_status || 'OPEN',
      order_acceptance: settings.order_acceptance || 'ACCEPTING ORDERS',
      gst_pct: settings.gst_pct !== undefined ? settings.gst_pct : 18,
      gst_enabled: settings.gst_enabled !== undefined ? settings.gst_enabled : true,
      shipping_fee: activeShippingFee,
      shipping_fee_rupees: shippingFeeRupees,
      free_shipping_enabled: settings.free_shipping_enabled !== undefined ? settings.free_shipping_enabled : true,
      free_shipping_threshold: activeShippingThreshold,
      free_shipping_threshold_rupees: freeShippingThresholdRupees,
      free_shipping_calculation: settings.free_shipping_calculation || 'after_discounts',
      announcement_text: settings.announcement_text || '',
      announcement_active: settings.announcement_active || false,
      maintenance_active: settings.maintenance_active || false,
      maintenance_message: settings.maintenance_message || ''
    };

    return sendSuccess(res, {
      settings: publicSettings
    }, 'Site settings retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Admin Site Settings Handler
 * GET /api/admin/settings
 */
const getAdminSettingsHandler = async (req, res, next) => {
  try {
    const settings = await settingsService.getSiteSettings();

    return sendSuccess(res, {
      settings
    }, 'Admin site settings retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Admin Site Settings Handler
 * PUT /api/admin/settings
 */
const updateSettingsHandler = async (req, res, next) => {
  try {
    const settingsMap = req.body;

    if (!settingsMap || typeof settingsMap !== 'object' || Array.isArray(settingsMap)) {
      return sendError(res, 'Settings object payload is required.', 400);
    }

    let updatedSettings;
    try {
      updatedSettings = await settingsService.updateSiteSettings(settingsMap);
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
        'site_settings',
        'global',
        {
          updated_keys: Object.keys(settingsMap)
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, {
      settings: updatedSettings
    }, 'Site settings updated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getSettingsHandler,
  getAdminSettingsHandler,
  updateSettingsHandler
};
