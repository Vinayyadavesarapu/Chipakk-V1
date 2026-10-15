const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  createPaymentOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getPaymentStatusHandler
} = require('../controllers/paymentController');

const router = express.Router();

// Middleware: Enforce supported stores (Store 1: CHIPAKK, Store 2: THE MARSHANS)
const enforceSupportedStore = (req, res, next) => {
  const storeId = parseInt(req.storeId, 10) || 1;
  if (storeId !== 1 && storeId !== 2) {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Razorpay payment routes are enabled for Store 1 and Store 2 only.',
        statusCode: 403
      }
    });
  }
  next();
};

// 1. Gateway Webhook Endpoint (Called by Razorpay, signature verified in controller)
router.post('/webhook', webhookHandler);

// 2. Customer Endpoints (Protected by Firebase Authentication & isolated to Store 1 and Store 2)
router.post('/create', verifyFirebaseToken, enforceSupportedStore, createPaymentOrderHandler);
router.post('/verify', verifyFirebaseToken, enforceSupportedStore, verifyPaymentHandler);
router.get('/status/:orderId', verifyFirebaseToken, enforceSupportedStore, getPaymentStatusHandler);

module.exports = router;
