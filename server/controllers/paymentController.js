const paymentService = require('../services/paymentService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * POST /api/payments/create
 * Authenticated Customer: Creates Razorpay payment order for a validated CHIPAKK order
 */
const createPaymentOrderHandler = async (req, res, next) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return sendError(res, 'Order ID is required to initiate payment.', 400);
    }

    const result = await paymentService.createPaymentOrder(order_id, req.user);
    return sendSuccess(res, result, 'Payment order created successfully', 200);
  } catch (err) {
    if (err.code === 'GATEWAY_NOT_CONFIGURED') {
      return sendError(res, err.message, 503, { code: 'GATEWAY_NOT_CONFIGURED' });
    }
    const status = err.status || err.statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(res, err.message, status);
    }
    next(err);
  }
};

/**
 * POST /api/payments/verify
 * Authenticated Customer: Verifies gateway signature after customer pays
 */
const verifyPaymentHandler = async (req, res, next) => {
  try {
    const { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!order_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return sendError(
        res,
        'Missing required payment verification parameters (order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature).',
        400
      );
    }

    const result = await paymentService.verifyPayment(req.body, req.user);
    return sendSuccess(res, result, 'Payment verified successfully', 200);
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(res, err.message, status);
    }
    next(err);
  }
};

/**
 * POST /api/payments/webhook
 * Unauthenticated Public Gateway Route: Called directly by Razorpay servers
 * Cryptographically verifies x-razorpay-signature against raw request body
 */
const webhookHandler = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!signature) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing x-razorpay-signature header.'
      });
    }

    const result = await paymentService.handleWebhook(rawBody, signature);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Payment Webhook Error]', err.message);
    return res.status(err.status || err.statusCode || 400).json({
      status: 'error',
      message: err.message
    });
  }
};

/**
 * GET /api/payments/status/:orderId
 * Authenticated Customer: Fetches authoritative status of an order's payment
 */
const getPaymentStatusHandler = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const result = await paymentService.getPaymentStatus(orderId, req.user);
    return sendSuccess(res, result, 'Payment status retrieved successfully', 200);
  } catch (err) {
    const status = err.status || err.statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(res, err.message, status);
    }
    next(err);
  }
};

module.exports = {
  createPaymentOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getPaymentStatusHandler
};
