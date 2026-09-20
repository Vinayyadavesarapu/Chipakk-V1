const settingsService = require('../services/settingsService');
const shippingService = require('../services/shippingService');
const taxProfileService = require('../services/taxProfileService');
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

    // Shipping shown to customers comes from the SAME resolver that prices orders
    // (shippingService.getShippingPolicy), so display and charge cannot disagree.
    const policy = await shippingService.getShippingPolicy(storeId);
    const activeShippingFee = policy.standard_fee;
    const activeShippingThreshold = policy.free_shipping_threshold;
    const isFreeShippingEnabled = policy.free_shipping_enabled;
    const shippingFeeRupees = policy.standard_fee_rupees;
    const freeShippingThresholdRupees = policy.free_shipping_threshold_rupees;

    // GST facts come from the same resolver the order service uses (never a second, drifting copy)
    let tax = null;
    try { tax = await taxProfileService.getTaxProfile(storeId, { settings }); } catch (taxErr) { console.warn('[Settings] tax profile unavailable:', taxErr.message); }

    // Filter to expose storefront-safe settings only
    const publicSettings = {
      store_id: storeId,
      store_code: req.storeCode || (storeId === 2 ? 'marshans' : 'chipakk'),
      store_name: settings.store_name || (storeId === 2 ? 'THE MARSHANS' : 'CHIPAKK'),
      store_status: settings.store_status || 'OPEN',
      order_acceptance: settings.order_acceptance || 'ACCEPTING ORDERS',
      gst_pct: tax ? tax.default_gst_rate : (settings.gst_pct !== undefined ? settings.gst_pct : 18),
      gst_rate: tax ? tax.default_gst_rate : (settings.gst_pct !== undefined ? settings.gst_pct : 18),
      gst_enabled: tax ? tax.gst_enabled : (settings.gst_enabled !== undefined ? settings.gst_enabled : true),
      tax_pricing_mode: 'inclusive', // displayed prices already contain GST; it is never added on top
      trade_name: tax ? tax.trade_name : (storeId === 2 ? 'THE MARSHANS' : 'CHIPAKK'),
      // supplier identity is public information (it is printed on every invoice); shown only when it is real
      legal_supplier_name: tax ? tax.legal_supplier_name : null,
      gstin: tax ? tax.gstin : null,
      // false = the legal supplier is not configured yet, so the API will refuse to create GST orders
      checkout_tax_ready: tax ? tax.checkout_ready : true,
      shipping_fee: activeShippingFee,
      shipping_fee_rupees: shippingFeeRupees,
      free_shipping_enabled: isFreeShippingEnabled,
      free_shipping_threshold: activeShippingThreshold,
      free_shipping_threshold_rupees: freeShippingThresholdRupees,
      free_shipping_calculation: 'gross_subtotal',
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
        shipping_fee: isMarshans ? 10000 : 50,
        shipping_fee_rupees: isMarshans ? 100 : 50,
        free_shipping_enabled: !isMarshans,
        free_shipping_threshold: isMarshans ? 0 : 300,
        free_shipping_threshold_rupees: isMarshans ? 0 : 300,
        free_shipping_calculation: 'gross_subtotal',
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
        shipping_fee: isMarshans ? 10000 : 50,
        free_shipping_enabled: !isMarshans,
        free_shipping_threshold: isMarshans ? 0 : 300
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
