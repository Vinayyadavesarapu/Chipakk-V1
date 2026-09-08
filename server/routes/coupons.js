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

    let subtotalPaise = parseInt(subtotal, 10) || 0;
    if (subtotal_in_rupees !== undefined) {
      subtotalPaise = Math.round(Number(subtotal_in_rupees) * 100);
    }

    const result = await couponService.validateCoupon(code, subtotalPaise);

    if (!result.valid) {
      return sendError(res, result.message, 400);
    }

    return sendSuccess(res, result.coupon, result.message);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
