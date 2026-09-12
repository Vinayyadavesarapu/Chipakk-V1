const storeBuilderService = require('../services/storeBuilderService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * Get Store Builder Configuration for Admin Panel
 * GET /api/admin/store-builder
 */
const getStoreBuilderAdminHandler = async (req, res, next) => {
  try {
    const data = await storeBuilderService.getStoreBuilderAdminData();
    return sendSuccess(res, data, 'Store Builder configuration retrieved successfully');
  } catch (error) {
    console.warn('[Store Builder Admin Handler Fallback]', error.message);
    return sendSuccess(res, {
      hero: {
        mode: 'fixed',
        eyebrow: 'New designs every week',
        titleLine1: 'STICK',
        titleLine2: 'YOUR',
        titleLine3: 'WORLD.',
        accentLine: 3,
        description: 'Premium waterproof vinyl stickers.',
        primaryButtonText: 'Shop Now →',
        primaryButtonLink: 'shop.html',
        secondaryButtonText: 'Custom Stickers',
        secondaryButtonLink: 'custom-stickers.html',
        image: '/assets/images/logo.png'
      },
      slides: [],
      banners: []
    }, 'Store builder admin fallback');
  }
};

/**
 * Update Store Builder Configuration Handler
 * PUT /api/admin/store-builder
 */
const updateStoreBuilderAdminHandler = async (req, res, next) => {
  try {
    const updatePayload = req.body;

    const updatedData = await storeBuilderService.updateStoreBuilderData(updatePayload);

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'store_builder.updated',
        'store_builder',
        'global',
        {
          sections_updated: Object.keys(updatePayload)
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedData, 'Store Builder configuration updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Public Store Builder Data Handler (Customer Storefront)
 * GET /api/store-builder
 */
const getPublicStoreBuilderHandler = async (req, res, next) => {
  try {
    const publicData = await storeBuilderService.getPublicStoreBuilderData();
    return sendSuccess(res, publicData, 'Public store builder data retrieved successfully');
  } catch (error) {
    console.warn('[Store Builder Public Handler Fallback]', error.message);
    return sendSuccess(res, {
      hero: {
        mode: 'fixed',
        eyebrow: 'New designs every week',
        titleLine1: 'STICK',
        titleLine2: 'YOUR',
        titleLine3: 'WORLD.',
        accentLine: 3,
        description: 'Premium waterproof vinyl stickers.',
        primaryButtonText: 'Shop Now →',
        primaryButtonLink: 'shop.html',
        secondaryButtonText: 'Custom Stickers',
        secondaryButtonLink: 'custom-stickers.html',
        image: 'assets/images/logo.png'
      },
      slides: [],
      banners: []
    }, 'Public store builder fallback');
  }
};

module.exports = {
  getStoreBuilderAdminHandler,
  updateStoreBuilderAdminHandler,
  getPublicStoreBuilderHandler
};
