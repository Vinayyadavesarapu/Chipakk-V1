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
      return 'API ROUTING ERROR — The Admin Panel could not reach the CHIPAKK API.';
    }
    return data;
  }
  if (typeof data.message === 'string' && data.message.trim().startsWith('<')) {
    return 'API ROUTING ERROR — The Admin Panel could not reach the CHIPAKK API.';
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
 * Core Request Wrapper
 */
async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  const headers = { ...(options.headers || {}) };

  // Attach Firebase ID Token if user is logged in
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Set default JSON header if not uploading FormData
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    ...options,
    headers
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
    console.error(`[API Client Error] ${options.method || 'GET'} ${endpoint}:`, err.message);
    throw err;
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

  upload: (endpoint, formData) => {
    return request(endpoint, {
      method: 'POST',
      body: formData
    });
  },

  getBaseUrl: () => API_BASE_URL,
  baseUrl: API_BASE_URL
};

export default apiClient;
