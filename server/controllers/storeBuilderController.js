const storeBuilderService = require('../services/storeBuilderService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * Resolves effective storeId from request context (middleware, query, header, or body)
 */
const resolveEffectiveStoreId = (req) => {
  if (req.storeId) {
    const parsed = parseInt(req.storeId, 10);
    if (parsed === 1 || parsed === 2) return parsed;
  }
  const headerStore = req.headers['x-store-id'] || req.headers['x-store'];
  if (headerStore) {
    const parsed = parseInt(headerStore, 10);
    if (parsed === 1 || parsed === 2) return parsed;
  }
  if (req.query && (req.query.store_id || req.query.store)) {
    const q = String(req.query.store_id || req.query.store).toLowerCase();
    if (q === '2' || q === 'marshans' || q === 'themarshans') return 2;
    if (q === '1' || q === 'chipakk') return 1;
  }
  if (req.body && req.body.store_id) {
    const parsed = parseInt(req.body.store_id, 10);
    if (parsed === 1 || parsed === 2) return parsed;
  }
  return 1;
};

/**
 * Get Store Builder Configuration for Admin Panel (Scoped by Store ID)
 * GET /api/admin/store-builder
 */
const getStoreBuilderAdminHandler = async (req, res, next) => {
  try {
    const storeId = resolveEffectiveStoreId(req);
    const data = await storeBuilderService.getStoreBuilderAdminData(storeId);
    return sendSuccess(res, data, `Store Builder configuration for Store ${storeId} retrieved successfully`);
  } catch (error) {
    console.warn('[Store Builder Admin Handler Fallback]', error.message);
    const storeId = resolveEffectiveStoreId(req);
    const isMarshans = storeId === 2;
    return sendSuccess(res, {
      store_id: storeId,
      hero_config: isMarshans ? storeBuilderService.STORE_2_HERO_DEFAULT : storeBuilderService.STORE_1_HERO_DEFAULT,
      announcement_bar: isMarshans ? storeBuilderService.STORE_2_ANNOUNCEMENT_DEFAULT : storeBuilderService.STORE_1_ANNOUNCEMENT_DEFAULT,
      hero_groups: [],
      promo_banners: [],
      content_sections: []
    }, 'Store builder admin fallback');
  }
};

/**
 * Update Store Builder Configuration Handler (Scoped by Store ID)
 * PUT /api/admin/store-builder
 */
const updateStoreBuilderAdminHandler = async (req, res, next) => {
  try {
    const storeId = resolveEffectiveStoreId(req);
    const updatePayload = req.body || {};

    const updatedData = await storeBuilderService.updateStoreBuilderData(updatePayload, storeId);

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'store_builder.updated',
        'store_builder',
        `store_${storeId}`,
        {
          store_id: storeId,
          sections_updated: Object.keys(updatePayload)
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedData, `Store Builder configuration for Store ${storeId} updated successfully`);
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Public Store Builder Data Handler (Customer Storefront, Scoped by Store ID)
 * GET /api/store-builder
 */
const getPublicStoreBuilderHandler = async (req, res, next) => {
  try {
    const storeId = resolveEffectiveStoreId(req);
    const publicData = await storeBuilderService.getPublicStoreBuilderData(storeId);
    return sendSuccess(res, publicData, `Public store builder data for Store ${storeId} retrieved successfully`);
  } catch (error) {
    console.warn('[Store Builder Public Handler Fallback]', error.message);
    const storeId = resolveEffectiveStoreId(req);
    const isMarshans = storeId === 2;
    return sendSuccess(res, {
      store_id: storeId,
      announcement_bar: isMarshans ? storeBuilderService.STORE_2_ANNOUNCEMENT_DEFAULT : storeBuilderService.STORE_1_ANNOUNCEMENT_DEFAULT,
      hero: {
        mode: 'fixed',
        enabled: true,
        image_url: 'assets/images/hero-fallback.svg',
        show_eyebrow: true,
        eyebrow: isMarshans ? 'Precision On-Demand Manufacturing' : 'New designs every week',
        show_title: true,
        title: isMarshans ? 'ENGINEERED IN 3D.' : 'STICK YOUR WORLD.',
        show_description: true,
        description: isMarshans ? 'Industrial grade 3D printing in PLA, PETG, ABS & Resin.' : 'Premium stickers for a bolder, brighter, more you.',
        show_primary_btn: true,
        primary_btn_text: isMarshans ? 'Explore 3D Catalog →' : 'Shop Now →',
        primary_btn_url: 'shop.html',
        show_secondary_btn: true,
        secondary_btn_text: isMarshans ? 'Custom 3D Request' : 'Custom Stickers',
        secondary_btn_url: isMarshans ? 'custom-print.html' : 'custom-stickers.html'
      },
      promo_banners: [],
      content_sections: [],
      store_info: {
        store_name: isMarshans ? 'THE MARSHANS' : 'CHIPAKK',
        announcement_text: isMarshans ? storeBuilderService.STORE_2_ANNOUNCEMENT_DEFAULT.text : storeBuilderService.STORE_1_ANNOUNCEMENT_DEFAULT.text,
        announcement_active: true,
        maintenance_active: false,
        free_shipping_threshold: isMarshans ? 0 : 300,
        free_shipping_threshold_rupees: isMarshans ? 0 : 300
      }
    }, 'Public store builder fallback');
  }
};

module.exports = {
  getStoreBuilderAdminHandler,
  updateStoreBuilderAdminHandler,
  getPublicStoreBuilderHandler
};
