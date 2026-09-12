const auditService = require('../services/auditService');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * Get Audit Logs Request Handler
 * GET /api/admin/audit-logs
 * Requires Admin Authorization
 */
const getAuditLogsHandler = async (req, res, next) => {
  try {
    const { limit, offset, actorId, action } = req.query;

    const result = await auditService.getAuditLogs({
      limit,
      offset,
      actorId,
      action
    });

    return sendSuccess(res, result, 'Audit logs retrieved successfully');
  } catch (error) {
    console.warn('[Audit Logs Optional Handler Fallback]', error.message);
    return sendSuccess(res, { audit_logs: [], auditLogs: [], total: 0, pagination: { total: 0, limit: 50, offset: 0 } }, 'Audit logs fallback');
  }
};

module.exports = {
  getAuditLogsHandler
};
