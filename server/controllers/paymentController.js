const paymentService = require('../services/paymentService');

/**
 * POST /api/payments/create
 * Authenticated Customer: Creates Razorpay payment order for a validated CHIPAKK order
 */
const createPaymentOrderHandler = async (req, res, next) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({
        success: false,
        error: 'Order ID is required to initiate payment.'
      });
    }

    const result = await paymentService.createPaymentOrder(order_id, req.user);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.code === 'GATEWAY_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        code: 'GATEWAY_NOT_CONFIGURED',
        error: err.message
      });
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
      return res.status(400).json({
        success: false,
        error: 'Missing required payment verification parameters (order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature).'
      });
    }

    const result = await paymentService.verifyPayment(req.body, req.user);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.status === 400 || err.status === 403 || err.status === 404) {
      return res.status(err.status).json({
        success: false,
        error: err.message
      });
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
    res.status(200).json(result);
  } catch (err) {
    console.error('[Payment Webhook Error]', err.message);
    res.status(err.status || 400).json({
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
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.status === 400 || err.status === 403 || err.status === 404) {
      return res.status(err.status).json({
        success: false,
        error: err.message
      });
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
