const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  createPaymentOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getPaymentStatusHandler
} = require('../controllers/paymentController');

const router = express.Router();

// Middleware: Strictly enforce Store 2 (THE MARSHANS) for customer payment routes
const enforceMarshansStoreOnly = (req, res, next) => {
  const storeId = parseInt(req.storeId, 10);
  if (storeId !== 2) {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Razorpay payment routes are exclusively enabled for THE MARSHANS (Store 2).',
        statusCode: 403
      }
    });
  }
  next();
};

// 1. Gateway Webhook Endpoint (Called by Razorpay, signature verified in controller)
router.post('/webhook', webhookHandler);

// 2. Customer Endpoints (Protected by Firebase Authentication & strictly isolated to Store 2)
router.post('/create', verifyFirebaseToken, enforceMarshansStoreOnly, createPaymentOrderHandler);
router.post('/verify', verifyFirebaseToken, enforceMarshansStoreOnly, verifyPaymentHandler);
router.get('/status/:orderId', verifyFirebaseToken, enforceMarshansStoreOnly, getPaymentStatusHandler);

module.exports = router;
