/**
 * Alert Feed In-Memory Rate Limiter
 * Guards the polling endpoint against runaway loops, abusive clients, and brute force attacks.
 *
 * Normal polling: ~8 seconds = ~7.5 requests / min.
 * Default allowance: 120 requests / min per IP or device key.
 */

const { sendError } = require('../utils/responseHandler');

const WINDOW_MS = 60 * 1000; // 1 minute sliding window
const DEFAULT_LIMIT = 120; // Maximum allowed requests per window

const requestCounts = new Map();

// Periodic cleanup of stale tracking entries every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now - record.windowStart > WINDOW_MS * 2) {
      requestCounts.delete(key);
    }
  }
}, 2 * 60 * 1000).unref();

const alertRateLimiter = (req, res, next) => {
  // Allow disabling in tests if explicitly flagged
  if (process.env.ALERT_RATE_LIMIT_DISABLED === 'true') {
    return next();
  }

  const limit = parseInt(process.env.ALERT_RATE_LIMIT_PER_MINUTE, 10) || DEFAULT_LIMIT;

  // Track by IP address or custom device token signature
  const clientIdentifier =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown-client';

  const now = Date.now();
  let record = requestCounts.get(clientIdentifier);

  if (!record || now - record.windowStart >= WINDOW_MS) {
    record = { windowStart: now, count: 1 };
    requestCounts.set(clientIdentifier, record);
    return next();
  }

  record.count += 1;

  if (record.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.windowStart + WINDOW_MS - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return sendError(
      res,
      'Too many requests to alert feed. Please slow down polling.',
      429,
      'ALERT_RATE_LIMITED'
    );
  }

  return next();
};

/**
 * Resets rate limiter map (useful for test runs)
 */
function resetRateLimiter() {
  requestCounts.clear();
}

module.exports = {
  alertRateLimiter,
  resetRateLimiter
};
