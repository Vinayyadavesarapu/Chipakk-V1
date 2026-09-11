const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  createPaymentOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getPaymentStatusHandler
} = require('../controllers/paymentController');

const router = express.Router();

// 1. Gateway Webhook Endpoint (Called by Razorpay, signature verified in controller)
router.post('/webhook', webhookHandler);

// 2. Customer Endpoints (Protected by Firebase Authentication)
router.post('/create', verifyFirebaseToken, createPaymentOrderHandler);
router.post('/verify', verifyFirebaseToken, verifyPaymentHandler);
router.get('/status/:orderId', verifyFirebaseToken, getPaymentStatusHandler);

module.exports = router;
