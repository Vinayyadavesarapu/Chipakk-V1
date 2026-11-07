import { auth } from './firebase-config.js';

/**
 * CHIPAKK Centralized API Client
 * Configurable Base URL for Hostinger Node.js Express Backend
 */
function resolveApiBaseUrl() {
  if (typeof window !== 'undefined') {
    if (window.API_BASE_URL) return window.API_BASE_URL;
    try {
      const stored = localStorage.getItem('chipakk_api_base_url');
      if (stored) return stored;
    } catch (_) {}

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) {
      const currentPort = window.location.port;
      if (currentPort === '3000') {
        return `${window.location.origin}/api`;
      }
      return 'http://localhost:3000/api';
    }
  }
  return 'https://api.chipakk.shop/api';
}

const API_BASE_URL = resolveApiBaseUrl();

/**
 * Format structured error response into human-readable string
 */
function extractErrorMessage(data, status) {
  if (!data) return `HTTP ${status} Request Failed`;
  if (typeof data === 'string') {
    if (data.trim().startsWith('<')) {
      if (status === 403) return 'HTTP 403 Forbidden — Security or CDN challenge blocked the request.';
      if (status === 401) return 'HTTP 401 Unauthorized — Session expired or authentication required.';
      if (status === 404) return 'HTTP 404 Not Found — API endpoint resource does not exist.';
      if (status === 500) return 'HTTP 500 Internal Server Error — Server failed to process request.';
      return `HTTP ${status} — Server returned HTML response instead of JSON.`;
    }
    return data;
  }
  if (typeof data.message === 'string' && data.message.trim().startsWith('<')) {
    if (status === 403) return 'HTTP 403 Forbidden — Security or CDN challenge blocked the request.';
    if (status === 401) return 'HTTP 401 Unauthorized — Session expired or authentication required.';
    if (status === 404) return 'HTTP 404 Not Found — API endpoint resource does not exist.';
    if (status === 500) return 'HTTP 500 Internal Server Error — Server failed to process request.';
    return `HTTP ${status} — Server returned HTML response instead of JSON.`;
  }

  if (data.error) {
    if (typeof data.error === 'string') return data.error;
    if (typeof data.error === 'object') {
      if (typeof data.error.message === 'string') return data.error.message;
      if (typeof data.error.error === 'string') return data.error.error;
      if (typeof data.error.details === 'string') return data.error.details;
      if (Array.isArray(data.error.details) && data.error.details.length > 0) {
        return data.error.details.map(d => (typeof d === 'string' ? d : d.message || JSON.stringify(d))).join(', ');
      }
      try {
        const str = JSON.stringify(data.error);
        if (str && str !== '{}') return str;
      } catch (_) {}
    }
  }

  if (data.message) {
    if (typeof data.message === 'string') return data.message;
    if (typeof data.message === 'object') {
      if (typeof data.message.message === 'string') return data.message.message;
      try {
        const str = JSON.stringify(data.message);
        if (str && str !== '{}') return str;
      } catch (_) {}
    }
  }

  if (typeof data.details === 'string') return data.details;

  return `HTTP ${status} Request Failed`;
}

/**
 * Helper to get current Firebase Auth ID Token
 */
async function getAuthToken() {
  if (auth && auth.currentUser) {
    try {
      return await auth.currentUser.getIdToken();
    } catch (err) {
      console.warn('[API Client] Error fetching Firebase ID Token:', err.message);
    }
  }
  return null;
}

/**
 * Safely resolves an endpoint or URL into a fully-qualified URL string
 */
function resolveFullUrl(endpoint) {
  if (typeof endpoint !== 'string') return API_BASE_URL;
  const trimmed = endpoint.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    const protocol = typeof window !== 'undefined' && window.location && window.location.protocol
      ? window.location.protocol
      : 'https:';
    return `${protocol}${trimmed}`;
  }
  const sep = trimmed.startsWith('/') ? '' : '/';
  return `${API_BASE_URL}${sep}${trimmed}`;
}

/**
 * Checks whether the resolved request URL has the exact same origin as API_BASE_URL
 */
function isSameOriginAsApi(targetUrl) {
  try {
    const defaultOrigin = typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : 'http://localhost:3000';
    const targetObj = new URL(targetUrl, defaultOrigin);
    const apiObj = new URL(API_BASE_URL, defaultOrigin);
    return targetObj.origin.toLowerCase() === apiObj.origin.toLowerCase();
  } catch (_) {
    return false;
  }
}

/**
 * Core Request Wrapper
 */
async function request(endpoint, options = {}) {
  const url = resolveFullUrl(endpoint);
  const headers = { ...(options.headers || {}) };

  // Attach Firebase ID Token and Client Session ID ONLY when target URL shares origin with API_BASE_URL
  const isTrustedApiOrigin = isSameOriginAsApi(url);

  if (isTrustedApiOrigin) {
    // Attach Firebase ID Token if user is logged in
    const token = await getAuthToken();
    if (token) {
      Object.keys(headers).forEach(k => {
        if (k.toLowerCase() === 'authorization' && k !== 'Authorization') {
          delete headers[k];
        }
      });
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Attach persistent Client Session ID if available
    try {
      const sessionId = typeof localStorage !== 'undefined' ? localStorage.getItem('chipakk_admin_session_id') : null;
      if (sessionId) {
        Object.keys(headers).forEach(k => {
          if (k.toLowerCase() === 'x-session-id' && k !== 'X-Session-ID') {
            delete headers[k];
          }
        });
        headers['X-Session-ID'] = sessionId;
      }
    } catch (_) {}
  } else {
    // Cross-origin request: strictly strip any caller-supplied Authorization or X-Session-ID headers case-insensitively
    Object.keys(headers).forEach(k => {
      const lower = k.toLowerCase();
      if (lower === 'authorization' || lower === 'x-session-id') {
        delete headers[k];
      }
    });
  }

  // Attach active Store ID (1 for CHIPAKK, 2 for THE MARSHANS)
  try {
    const activeStoreId = typeof localStorage !== 'undefined' ? (localStorage.getItem('admin_active_store_id') || '1') : '1';
    headers['X-Store-ID'] = activeStoreId;
  } catch (_) {}

  // Set default JSON header if not uploading FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Default 30-second timeout to prevent requests from hanging indefinitely
  const timeoutMs = typeof options.timeout === 'number' ? options.timeout : 30000;
  let timeoutId = null;
  let internalController = null;

  if (typeof AbortController !== 'undefined' && !options.signal) {
    internalController = new AbortController();
    timeoutId = setTimeout(() => {
      internalController.abort(new Error(`Request timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  }

  const config = {
    ...options,
    headers,
    signal: options.signal || (internalController ? internalController.signal : undefined)
  };

  try {
    const response = await fetch(url, config);
    const contentType = response.headers.get('content-type') || '';

    let data = null;
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => '');
      data = { message: text };
    }

    if (!response.ok) {
      const errorMessage = extractErrorMessage(data, response.status);
      const error = new Error(errorMessage);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-api-activity', {
        detail: {
          method: (options.method || 'GET').toUpperCase(),
          endpoint: endpoint || ''
        }
      }));
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('timed out')) {
      const timeoutErr = new Error(`Request timed out after ${timeoutMs / 1000} seconds. Please check your network and retry.`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    console.error(`[API Client Error] ${options.method || 'GET'} ${endpoint}:`, err.message);
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Exported API Methods
 */
export const apiClient = {
  get: (endpoint, params = {}) => {
    const cleanParams = {};
    Object.keys(params || {}).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        cleanParams[k] = params[k];
      }
    });
    const queryString = new URLSearchParams(cleanParams).toString();
    const fullEndpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
    return request(fullEndpoint, { method: 'GET' });
  },

  post: (endpoint, body = {}) => {
    return request(endpoint, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  put: (endpoint, body = {}) => {
    return request(endpoint, {
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  patch: (endpoint, body = {}) => {
    return request(endpoint, {
      method: 'PATCH',
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  },

  delete: (endpoint) => {
    return request(endpoint, { method: 'DELETE' });
  },

  deleteProductImage: (productId, imageId) => {
    return request(`/admin/products/${productId}/images/${imageId}`, { method: 'DELETE' });
  },

  upload: (endpoint, formData) => {
    return request(endpoint, {
      method: 'POST',
      body: formData
    });
  },

  getActiveStoreId: () => {
    try {
      return parseInt(localStorage.getItem('admin_active_store_id') || '1', 10);
    } catch (_) {
      return 1;
    }
  },
  setActiveStoreId: (storeId) => {
    try {
      localStorage.setItem('admin_active_store_id', String(storeId));
    } catch (_) {}
  },
  getBaseUrl: () => API_BASE_URL,
  baseUrl: API_BASE_URL,
  isSameOrigin: isSameOriginAsApi
};

export default apiClient;
