const notificationService = require('../services/notificationService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Admin Notifications Handler
 * GET /api/admin/notifications
 */
const getAdminNotificationsHandler = async (req, res, next) => {
  try {
    const limit = req.query.limit || 20;
    const result = await notificationService.getAdminNotifications({ limit });
    return sendSuccess(res, result, 'Admin notifications retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Mark Notification Read Handler
 * POST /api/admin/notifications/mark-read
 */
const markNotificationReadHandler = async (req, res, next) => {
  try {
    const { id, all } = req.body || {};
    if (all) {
      await notificationService.markAllNotificationsRead();
      return sendSuccess(res, { all_marked: true }, 'All notifications marked as read');
    }
    if (!id) {
      return sendError(res, 'Notification ID is required', 400);
    }
    await notificationService.markNotificationRead(id);
    return sendSuccess(res, { id, marked: true }, 'Notification marked as read');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getAdminNotificationsHandler,
  markNotificationReadHandler
};
