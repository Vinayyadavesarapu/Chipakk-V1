const { testConnection } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Health Endpoint Handler
 * GET /api/health
 */
const getHealth = (req, res) => {
  return sendSuccess(res, {
    service: 'CHIPAKK API',
    status: 'online',
    environment: process.env.NODE_ENV || 'development'
  }, 'CHIPAKK API is operational');
};

/**
 * Database Health Check Handler
 * GET /api/health/db
 */
const getDbHealth = async (req, res) => {
  const dbStatus = await testConnection();

  if (dbStatus.connected) {
    return sendSuccess(res, {
      service: 'CHIPAKK API Database',
      database: dbStatus.database,
      connected: true
    }, dbStatus.message);
  }

  return sendError(res, dbStatus.message, 503, dbStatus.error);
};

module.exports = {
  getHealth,
  getDbHealth
};
