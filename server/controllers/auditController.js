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
    return next(error);
  }
};

module.exports = {
  getAuditLogsHandler
};
