const express = require('express');
const couponService = require('../services/couponService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const router = express.Router();

/**
 * Public Coupon Validation Route
 * POST /api/coupons/validate
 * Body: { code: string, subtotal: number (in paise or rupees) }
 */
router.post('/validate', async (req, res) => {
  try {
    const { code, subtotal, subtotal_in_rupees } = req.body || {};

    if (!code || typeof code !== 'string' || !code.trim()) {
      return sendError(res, 'Please enter a coupon code.', 400);
    }
    if (code.trim().length > 50) {
      return sendError(res, 'That coupon code is not valid.', 400);
    }

    const activeStoreId = req.storeId ? parseInt(req.storeId, 10) : 1;
    let subtotalAmount = 0;
    if (subtotal_in_rupees !== undefined) {
      const rupees = Math.max(0, Math.round(Number(subtotal_in_rupees)) || 0);
      subtotalAmount = activeStoreId === 2 ? (rupees * 100) : rupees;
    } else if (subtotal !== undefined) {
      subtotalAmount = parseInt(subtotal, 10) || 0;
    }

    const result = await couponService.validateCoupon(code, subtotalAmount, activeStoreId);

    // Business rejections (invalid / expired / not started / minimum order / usage limit) carry
    // customer-safe messages written in couponService.
    if (!result.valid) {
      return sendError(res, result.message, 400);
    }

    return sendSuccess(res, result.coupon, result.message);
  } catch (error) {
    // Unexpected failure (database, schema drift, ...). Log the detail server-side only and give the
    // customer a generic message: never SQL text, column names, stack traces or paths.
    console.error('[Coupon Validate] Unexpected error:', error && error.stack ? error.stack : error);
    return sendError(res, "We couldn't check that code right now. Please try again in a moment.", 500);
  }
});

module.exports = router;
