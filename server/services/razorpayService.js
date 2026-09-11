const crypto = require('crypto');

/**
 * CHIPAKK — Razorpay Gateway Service
 * 
 * Implements official Razorpay REST API order creation and cryptographic
 * HMAC SHA-256 signature verification using Node.js built-ins (fetch & crypto).
 * Zero external dependencies required.
 * 
 * SECURITY RULES:
 * - Secrets strictly loaded from environment variables (RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET).
 * - Secrets NEVER logged, never exposed to clients, never sent in responses.
 * - Timing-safe equality used for all signature comparisons to prevent timing attacks.
 */

const getKeyId = () => process.env.RAZORPAY_KEY_ID || '';
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
const getWebhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || '';

/**
 * Check if Razorpay credentials are fully provisioned
 */
const isConfigured = () => {
  const keyId = getKeyId();
  const secret = getKeySecret();
  return Boolean(keyId && secret && keyId.trim() && secret.trim());
};

/**
 * Check if Razorpay Webhook secret is provisioned
 */
const isWebhookConfigured = () => {
  const ws = getWebhookSecret();
  return Boolean(ws && ws.trim());
};

/**
 * Create a Razorpay Payment Order via official REST API
 * 
 * @param {Object} params
 * @param {number} params.amountPaise - Grand total in paise (authoritative from DB)
 * @param {string} params.receipt - Internal order number (e.g. CHP-20260911-XXXX)
 * @param {Object} [params.notes] - Safe correlation metadata
 * @returns {Promise<Object>} Razorpay Order Object
 */
const createRazorpayOrder = async ({ amountPaise, receipt, notes = {} }) => {
  if (!isConfigured()) {
    const err = new Error('Payment gateway credentials are not configured on the server. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    err.code = 'GATEWAY_NOT_CONFIGURED';
    throw err;
  }

  const keyId = getKeyId();
  const keySecret = getKeySecret();
  const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const payload = {
    amount: parseInt(amountPaise, 10),
    currency: 'INR',
    receipt: String(receipt).slice(0, 40),
    notes: {
      platform: 'CHIPAKK',
      ...notes
    }
  };

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    const errMsg = data?.error?.description || data?.error?.message || 'Failed to create payment order with gateway.';
    const err = new Error(errMsg);
    err.code = data?.error?.code || 'RAZORPAY_API_ERROR';
    err.status = response.status;
    throw err;
  }

  return {
    gateway_order_id: data.id,
    amount: data.amount,
    currency: data.currency,
    receipt: data.receipt,
    status: data.status,
    created_at: data.created_at
  };
};

/**
 * Verify Razorpay Checkout Payment Signature
 * Formula: HMAC_SHA256(order_id + "|" + payment_id, secret)
 * 
 * @param {Object} params
 * @param {string} params.razorpay_order_id
 * @param {string} params.razorpay_payment_id
 * @param {string} params.razorpay_signature
 * @returns {boolean}
 */
const verifyPaymentSignature = ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
  if (!isConfigured()) {
    const err = new Error('Payment gateway credentials are not configured on the server.');
    err.code = 'GATEWAY_NOT_CONFIGURED';
    throw err;
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return false;
  }

  const secret = getKeySecret();
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const actualBuf = Buffer.from(String(razorpay_signature), 'utf8');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
};

/**
 * Verify Razorpay Webhook Signature
 * Formula: HMAC_SHA256(rawBody, webhook_secret)
 * 
 * @param {Object} params
 * @param {string} params.rawBody - Exact unparsed request payload string
 * @param {string} params.signature - Value of 'x-razorpay-signature' header
 * @returns {boolean}
 */
const verifyWebhookSignature = ({ rawBody, signature }) => {
  if (!isWebhookConfigured()) {
    const err = new Error('Razorpay webhook secret is not configured on the server.');
    err.code = 'WEBHOOK_SECRET_NOT_CONFIGURED';
    throw err;
  }

  if (!rawBody || !signature) {
    return false;
  }

  const webhookSecret = getWebhookSecret();
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  const actualBuf = Buffer.from(String(signature), 'utf8');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
};

module.exports = {
  getKeyId,
  isConfigured,
  isWebhookConfigured,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature
};
