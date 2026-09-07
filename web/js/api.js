import { auth } from './firebase-config.js';

/**
 * CHIPAKK Centralized API Client
 * Configurable Base URL for Hostinger Node.js Express Backend
 */
const API_BASE_URL = window.API_BASE_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api'
);

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
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
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
      const errorMessage = (data && (data.error || data.message)) || `HTTP ${response.status} Request Failed`;
      const error = new Error(errorMessage);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-api-activity'));
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

  getBaseUrl: () => API_BASE_URL
};

export default apiClient;
