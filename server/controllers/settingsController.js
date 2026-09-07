const settingsService = require('../services/settingsService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Public Site Settings Handler (Customer Storefront)
 * GET /api/settings
 */
const getSettingsHandler = async (req, res, next) => {
  try {
    const settings = await settingsService.getSiteSettings();

    // Filter to expose storefront-safe settings only
    const publicSettings = {
      store_name: settings.store_name || 'CHIPAKK',
      store_status: settings.store_status || 'OPEN',
      order_acceptance: settings.order_acceptance || 'ACCEPTING ORDERS',
      gst_pct: settings.gst_pct !== undefined ? settings.gst_pct : 18,
      gst_enabled: settings.gst_enabled !== undefined ? settings.gst_enabled : true,
      shipping_fee: settings.shipping_fee || 5000,
      free_shipping_enabled: settings.free_shipping_enabled !== undefined ? settings.free_shipping_enabled : true,
      free_shipping_threshold: settings.free_shipping_threshold || 49900,
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
