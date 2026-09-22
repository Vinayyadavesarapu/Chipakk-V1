const { testConnection } = require('../config/database');
const { describeUploads, getUploadDiagnostic } = require('../config/uploads');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Health Endpoint Handler
 * GET /api/health
 */
const getHealth = async (req, res) => {
  // GST readiness per store: booleans and field NAMES only (no GSTIN, no address) so it is safe on a public endpoint
  let tax = null;
  try {
    const taxProfileService = require('../services/taxProfileService');
    tax = {};
    for (const [code, id] of [['chipakk', 1], ['marshans', 2]]) tax[code] = taxProfileService.describeReadiness(await taxProfileService.getTaxProfile(id));
  } catch (_) { tax = null; }

  const data = {
    service: 'CHIPAKK API',
    status: 'online',
    environment: process.env.NODE_ENV || 'development',
    uploads: describeUploads(),
    tax
  };

  if (req.query.diagnostic === 'true' || req.query.file) {
    data.uploads_diagnostic = getUploadDiagnostic(req.query.file || 'product-1790105924962-447688971.png');
  }

  return sendSuccess(res, data, 'CHIPAKK API is operational');
};

const getUploadsDiagnosticHandler = (req, res) => {
  const targetFile = req.query.file || 'product-1790105924962-447688971.png';
  return sendSuccess(res, getUploadDiagnostic(targetFile), 'Upload storage diagnostic report');
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
  getDbHealth,
  getUploadsDiagnosticHandler
};
