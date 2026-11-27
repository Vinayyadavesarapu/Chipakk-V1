/**
 * Alert Device Authentication Middleware
 * Validates dedicated, revocable alert-device credentials for order feed consumers.
 *
 * Header support:
 * - Authorization: Bearer <ALERT_DEVICE_KEY>
 * - X-Alert-Device-Key: <ALERT_DEVICE_KEY>
 *
 * Security guarantees:
 * - Constant-time comparison via crypto.timingSafeEqual on SHA-256 digests.
 * - Supports zero-downtime rotation via comma-separated ALERT_DEVICE_KEYS.
 * - Narrowly scoped: does NOT grant admin privileges or attach req.admin.
 */

const crypto = require('crypto');
const { sendError } = require('../utils/responseHandler');

/**
 * Validates a candidate token against configured alert keys.
 * Uses SHA-256 digests to ensure fixed 32-byte buffers for timingSafeEqual.
 */
function verifyAlertKey(providedToken) {
  if (!providedToken || typeof providedToken !== 'string') {
    return false;
  }

  const rawConfig = process.env.ALERT_DEVICE_KEYS || process.env.ALERT_DEVICE_KEY;
  if (!rawConfig || typeof rawConfig !== 'string') {
    return false;
  }

  const validKeys = rawConfig
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  if (validKeys.length === 0) {
    return false;
  }

  const cleanProvided = providedToken.trim();
  if (!cleanProvided) {
    return false;
  }

  const providedHash = crypto.createHash('sha256').update(cleanProvided).digest();

  for (let i = 0; i < validKeys.length; i++) {
    const keyHash = crypto.createHash('sha256').update(validKeys[i]).digest();
    if (crypto.timingSafeEqual(providedHash, keyHash)) {
      return { valid: true, keyIndex: i };
    }
  }

  return false;
}

/**
 * Express middleware requiring a valid alert device credential.
 */
const requireAlertAuth = (req, res, next) => {
  const rawConfig = process.env.ALERT_DEVICE_KEYS || process.env.ALERT_DEVICE_KEY;
  if (!rawConfig || !rawConfig.trim()) {
    console.error('[Alert Auth] ALERT_DEVICE_KEYS is not configured on the server.');
    return sendError(
      res,
      'Alert feed service is not configured with device keys.',
      503,
      'ALERT_AUTH_UNCONFIGURED'
    );
  }

  let token = null;

  // 1. Check Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (!authHeader.includes(' ')) {
      token = authHeader.trim();
    }
  }

  // 2. Check X-Alert-Device-Key header fallback
  if (!token) {
    const customHeader = req.headers['x-alert-device-key'];
    if (customHeader && typeof customHeader === 'string') {
      token = customHeader.trim();
    }
  }

  if (!token) {
    return sendError(
      res,
      'Alert device authorization credential missing or malformed.',
      401,
      'ALERT_AUTH_REQUIRED'
    );
  }

  const result = verifyAlertKey(token);
  if (!result || !result.valid) {
    return sendError(
      res,
      'Invalid or revoked alert device credential.',
      401,
      'ALERT_AUTH_INVALID'
    );
  }

  // Attach narrowly scoped device context
  req.alertDevice = {
    authenticated: true,
    keyIndex: result.keyIndex,
    authenticatedAt: new Date().toISOString()
  };

  return next();
};

module.exports = {
  requireAlertAuth,
  verifyAlertKey
};
