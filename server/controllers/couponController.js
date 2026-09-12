const couponService = require('../services/couponService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Coupons List Handler
 * GET /api/admin/coupons
 */
const getCouponsHandler = async (req, res, next) => {
  try {
    const { search, active, limit, offset } = req.query;

    const result = await couponService.getCoupons({
      search,
      active,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Coupons retrieved successfully');
  } catch (error) {
    console.warn('[Coupons Optional Handler Fallback]', error.message);
    return sendSuccess(res, { coupons: [], total: 0, pagination: { total: 0, limit: 50, offset: 0 } }, 'Coupons fallback');
  }
};

/**
 * Get Coupon by ID or Code Handler
 * GET /api/admin/coupons/:id
 */
const getCouponByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !String(id).trim()) {
      return sendError(res, 'Coupon ID or Coupon Code is required.', 400);
    }

    const coupon = await couponService.getCouponById(String(id).trim());

    if (!coupon) {
      return sendError(res, `Coupon '${id}' not found`, 404);
    }

    return sendSuccess(res, coupon, 'Coupon retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create Coupon Handler
 * POST /api/admin/coupons
 */
const createCouponHandler = async (req, res, next) => {
  try {
    const couponData = req.body;

    if (!couponData.code || typeof couponData.code !== 'string' || !couponData.code.trim()) {
      return sendError(res, 'Coupon code is required.', 400);
    }

    if (!couponData.discount_type || !['percent', 'fixed'].includes(String(couponData.discount_type).trim().toLowerCase())) {
      return sendError(res, "Discount type must be either 'percent' or 'fixed'.", 400);
    }

    if (couponData.discount_value === undefined || isNaN(Number(couponData.discount_value))) {
      return sendError(res, 'Discount value is required.', 400);
    }

    const coupon = await couponService.createCoupon(couponData);

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'coupon.created',
        'coupon',
        coupon.id,
        {
          code: coupon.code,
          discount_type: coupon.discount_type,
          discount_value: coupon.discount_value,
          active: coupon.active
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, coupon, 'Coupon created successfully', 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.message.includes('already exists')) {
      const codeStr = req.body && req.body.code ? String(req.body.code).trim().toUpperCase() : '';
      return sendError(res, `A coupon with code '${codeStr}' already exists`, 400);
    }
    return next(error);
  }
};

/**
 * Update Coupon Handler
 * PUT /api/admin/coupons/:id
 */
const updateCouponHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const couponData = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid coupon ID format. Expected numeric BIGINT ID.', 400);
    }

    const updatedCoupon = await couponService.updateCoupon(numId, couponData);

    if (!updatedCoupon) {
      return sendError(res, `Coupon with ID ${id} not found`, 404);
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'coupon.updated',
        'coupon',
        numId,
        {
          code: updatedCoupon.code,
          active: updatedCoupon.active,
          discount_type: updatedCoupon.discount_type
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedCoupon, 'Coupon updated successfully');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.message.includes('already exists')) {
      const codeStr = req.body && req.body.code ? String(req.body.code).trim().toUpperCase() : '';
      return sendError(res, `A coupon with code '${codeStr}' already exists`, 400);
    }
    return next(error);
  }
};

/**
 * Delete / Deactivate Coupon Handler
 * DELETE /api/admin/coupons/:id
 */
const deleteCouponHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid coupon ID format. Expected numeric BIGINT ID.', 400);
    }

    const success = await couponService.deleteCoupon(numId);

    if (!success) {
      return sendError(res, `Coupon with ID ${id} not found`, 404);
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'coupon.deactivated',
        'coupon',
        numId,
        { action: 'deactivated', active: 0 }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, { deactivated: true, id: numId }, 'Coupon deactivated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCouponsHandler,
  getCouponByIdHandler,
  createCouponHandler,
  updateCouponHandler,
  deleteCouponHandler
};
