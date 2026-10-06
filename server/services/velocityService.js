/**
 * THE MARSHANS & CHIPAKK — Velocity Shipping Integration Service
 * 
 * Official Velocity Custom API implementation based on Velocity Shipping documentation:
 * - Base URL: https://shazam.velocity.in/ (configurable via VELOCITY_BASE_URL)
 * - Auth Token: POST /custom/api/v1/auth-token (24-hour cache & automatic renewal)
 * - Serviceability: POST /custom/api/v1/serviceability
 * - Forward Order Orchestration: POST /custom/api/v1/forward-order-orchestration
 * - Tracking: POST /custom/api/v1/order-tracking
 * - Cancellation: POST /custom/api/v1/cancel-order
 * - Reverse Order Orchestration: POST /custom/api/v1/reverse-order-orchestration
 * 
 * SECURITY RULES:
 * - Credentials (VELOCITY_USERNAME, VELOCITY_PASSWORD) loaded exclusively server-side.
 * - Credentials and auth tokens are NEVER sent to clients or logged.
 * - Tokens are cached in-memory server-side and renewed before expiry.
 */

// In-memory token cache
let cachedToken = null;
let tokenExpiresAt = 0;
let pendingAuthPromise = null;

const getBaseUrl = () => {
  const url = process.env.VELOCITY_BASE_URL || 'https://shazam.velocity.in';
  return url.replace(/\/+$/, '');
};

const getUsername = () => process.env.VELOCITY_USERNAME || '';
const getPassword = () => process.env.VELOCITY_PASSWORD || '';
const getDefaultPickupPincode = () => {
  const pin = process.env.MARSHANS_PICKUP_PINCODE;
  if (!pin || !/^\d{6}$/.test(String(pin).trim())) {
    const err = new Error('Pickup pincode is not configured. Please set MARSHANS_PICKUP_PINCODE in environment variables.');
    err.code = 'MARSHANS_PICKUP_PINCODE_MISSING';
    err.statusCode = 500;
    throw err;
  }
  return String(pin).trim();
};

/**
 * Check if Velocity credentials are fully provisioned
 */
const isConfigured = () => {
  const user = getUsername();
  const pass = getPassword();
  return Boolean(user && pass && user.trim() && pass.trim());
};

/**
 * Reset token cache (useful for testing or credentials change)
 */
const resetTokenCache = () => {
  cachedToken = null;
  tokenExpiresAt = 0;
  pendingAuthPromise = null;
};

/**
 * Server-Side Token Manager
 * Obtains and caches a 24-hour JWT token from Velocity API.
 * Automatically renews when expired or within 30 minutes of expiration.
 */
const getAuthToken = async () => {
  if (!isConfigured()) {
    const err = new Error('Velocity Shipping credentials are not configured on the server. Please set VELOCITY_USERNAME and VELOCITY_PASSWORD.');
    err.code = 'VELOCITY_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }

  const now = Date.now();
  // Buffer: renew 30 minutes before 24-hour expiry
  if (cachedToken && tokenExpiresAt > now + 30 * 60 * 1000) {
    return cachedToken;
  }

  if (pendingAuthPromise) {
    return pendingAuthPromise;
  }

  pendingAuthPromise = (async () => {
    try {
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/custom/api/v1/auth-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          username: getUsername(),
          password: getPassword()
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        const msg = data?.message || data?.error || `Velocity auth failed with status ${response.status}`;
        const err = new Error(msg);
        err.code = 'VELOCITY_AUTH_FAILED';
        err.statusCode = response.status || 502;
        throw err;
      }

      // Extract token according to Velocity response format (token, access_token, or nested data.token)
      const token = data.token || data.access_token || data.data?.token || data.data?.access_token;
      if (!token || typeof token !== 'string') {
        const err = new Error('Velocity auth response did not contain a valid authorization token.');
        err.code = 'VELOCITY_INVALID_TOKEN';
        err.statusCode = 502;
        throw err;
      }

      // Documentation specifies 24-hour validity (24 * 60 * 60 * 1000 ms)
      cachedToken = token;
      tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000; // cache for 23 hours safely
      return token;
    } finally {
      pendingAuthPromise = null;
    }
  })();

  return pendingAuthPromise;
};

/**
 * Generic authorized request wrapper for Velocity endpoints
 */
const velocityFetch = async (endpoint, options = {}) => {
  const token = await getAuthToken();
  const baseUrl = getBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  const response = await fetch(`${baseUrl}${cleanEndpoint}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.message || data?.error?.description || data?.error || `Velocity API error (${response.status})`;
    const err = new Error(errorMsg);
    err.statusCode = response.status;
    err.data = data;
    throw err;
  }

  return data;
};

/**
 * B3. Shipping Serviceability Check
 * 
 * @param {Object} params
 * @param {string} [params.from] - Origin / Pickup PIN code (defaults to MARSHANS warehouse PIN 500090)
 * @param {string} params.to - Customer delivery PIN code (6 digits)
 * @param {string} [params.payment_mode='prepaid'] - 'prepaid' | 'cod'
 * @param {string} [params.shipment_type='forward'] - 'forward' | 'reverse'
 * @returns {Promise<Object>} Eligible carriers and serviceability status
 */
const checkServiceability = async ({
  from,
  to,
  payment_mode = 'prepaid',
  shipment_type = 'forward'
}) => {
  const pickupPin = String(from || getDefaultPickupPincode()).trim();
  const destPin = String(to || '').trim();

  if (!/^\d{6}$/.test(destPin)) {
    const err = new Error('A valid 6-digit destination PIN code is required for serviceability.');
    err.statusCode = 400;
    throw err;
  }

  const payload = {
    from: pickupPin,
    to: destPin,
    payment_mode: String(payment_mode).toLowerCase() === 'cod' ? 'cod' : 'prepaid',
    shipment_type: shipment_type || 'forward'
  };

  return velocityFetch('/custom/api/v1/serviceability', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

/**
 * B5. Create Forward Shipment (Order Orchestration)
 * 
 * Manifests forward shipment with Velocity and assigns carrier.
 * 
 * @param {Object} payload - Authoritative shipment payload
 * @returns {Promise<Object>} Velocity order ID, shipment ID, AWB, courier name, tracking URL
 */
const createForwardShipment = async (payload) => {
  if (!payload || !payload.order_id) {
    const err = new Error('Order details are required to orchestrate shipment.');
    err.statusCode = 400;
    throw err;
  }

  const { length, breadth, height, weight, warehouse_id } = payload;
  const numLength = parseFloat(length);
  const numBreadth = parseFloat(breadth);
  const numHeight = parseFloat(height);
  const numWeight = parseFloat(weight);

  if (
    isNaN(numLength) || numLength <= 0 ||
    isNaN(numBreadth) || numBreadth <= 0 ||
    isNaN(numHeight) || numHeight <= 0 ||
    isNaN(numWeight) || numWeight <= 0 ||
    warehouse_id === undefined || warehouse_id === null || String(warehouse_id).trim() === ''
  ) {
    const err = new Error('Package dimensions (length, breadth, height > 0), weight (> 0), and warehouse_id are required to orchestrate shipment.');
    err.statusCode = 422;
    err.code = 'INVALID_SHIPMENT_SPECIFICATIONS';
    throw err;
  }

  return velocityFetch('/custom/api/v1/forward-order-orchestration', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

/**
 * B7. Order Tracking
 * 
 * Fetches real-time shipment tracking details for one or more AWBs.
 * 
 * @param {string|string[]} awbs - Air Waybill number(s)
 * @returns {Promise<Object>} Tracking details including status, courier, activities timeline, track URL
 */
const trackShipment = async (awbs) => {
  const awbList = Array.isArray(awbs)
    ? awbs.map(a => String(a).trim()).filter(Boolean)
    : [String(awbs || '').trim()].filter(Boolean);

  if (awbList.length === 0) {
    const err = new Error('At least one AWB number is required to track shipment.');
    err.statusCode = 400;
    throw err;
  }

  return velocityFetch('/custom/api/v1/order-tracking', {
    method: 'POST',
    body: JSON.stringify({ awbs: awbList })
  });
};

/**
 * B9. Cancel Order / Shipment
 * 
 * @param {string|string[]} awbs - Air Waybill number(s) to cancel
 * @returns {Promise<Object>} Cancellation status
 */
const cancelShipment = async (awbs) => {
  const awbList = Array.isArray(awbs)
    ? awbs.map(a => String(a).trim()).filter(Boolean)
    : [String(awbs || '').trim()].filter(Boolean);

  if (awbList.length === 0) {
    const err = new Error('At least one AWB number is required to cancel shipment.');
    err.statusCode = 400;
    throw err;
  }

  return velocityFetch('/custom/api/v1/cancel-order', {
    method: 'POST',
    body: JSON.stringify({ awbs: awbList })
  });
};

/**
 * B10. Reverse Order Orchestration (Return Pickup Adapter)
 * 
 * Prepared adapter for return shipments when requested by business workflows.
 * 
 * @param {Object} payload - Reverse shipment details
 * @returns {Promise<Object>} Reverse pickup confirmation
 */
const createReverseShipment = async (payload) => {
  if (!payload || !payload.order_id) {
    const err = new Error('Order details are required for reverse pickup.');
    err.statusCode = 400;
    throw err;
  }

  return velocityFetch('/custom/api/v1/reverse-order-orchestration', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

module.exports = {
  isConfigured,
  resetTokenCache,
  getAuthToken,
  checkServiceability,
  createForwardShipment,
  trackShipment,
  cancelShipment,
  createReverseShipment
};
