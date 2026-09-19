const express = require('express');
const couponService = require('../services/couponService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const router = express.Router();

/**
 * Public Coupon Validation Route
 * POST /api/coupons/validate
 * Body: { code: string, subtotal: number (in paise or rupees) }
 */
router.post('/validate', async (req, res, next) => {
  try {
    const { code, subtotal, subtotal_in_rupees } = req.body;

    if (!code || typeof code !== 'string') {
      return sendError(res, 'Coupon code is required.', 400);
    }

    const activeStoreId = req.storeId ? parseInt(req.storeId, 10) : 1;
    let subtotalAmount = 0;
    if (subtotal_in_rupees !== undefined) {
      const rupees = Math.max(0, Math.round(Number(subtotal_in_rupees)));
      subtotalAmount = activeStoreId === 2 ? (rupees * 100) : rupees;
    } else if (subtotal !== undefined) {
      subtotalAmount = parseInt(subtotal, 10) || 0;
    }

    const result = await couponService.validateCoupon(code, subtotalAmount, activeStoreId);

    if (!result.valid) {
      return sendError(res, result.message, 400);
    }

    return sendSuccess(res, result.coupon, result.message);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
