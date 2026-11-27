/**
 * WhatsApp Controller
 * server/controllers/whatsappController.js
 *
 * Exposes safe diagnostic and notification status endpoints for the Admin Panel.
 */

const { sendSuccess, sendError } = require('../utils/responseHandler');
const {
  getWhatsAppStatus,
  processDueFeedbackNotifications
} = require('../services/whatsappNotificationService');
const { pool } = require('../config/database');

/**
 * GET /api/admin/whatsapp/status
 * Returns safe status and diagnostic information for the Admin Panel without exposing secrets.
 */
const getWhatsAppStatusHandler = async (req, res) => {
  try {
    const status = await getWhatsAppStatus();
    return sendSuccess(res, status, 'WhatsApp integration status retrieved successfully');
  } catch (error) {
    console.error('[WhatsApp Controller] Error in getWhatsAppStatusHandler:', error);
    return sendError(
      res,
      'Failed to retrieve WhatsApp status',
      500,
      process.env.NODE_ENV === 'development' ? error.stack : null
    );
  }
};

/**
 * GET /api/admin/orders/:id/notifications
 * Returns notification logs for a specific order (masked phone, zero secrets).
 */
const getOrderNotificationHistoryHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const isCustomForge = req.query.is_custom_forge === 'true' || req.query.is_custom_forge === '1';
    const numId = parseInt(id, 10);

    if (isNaN(numId)) {
      return sendError(res, 'Invalid order ID format', 400);
    }

    const [rows] = await pool.execute(`
      SELECT
        id, store_id, order_number, is_custom_forge, event_type,
        CONCAT(SUBSTRING(recipient_phone, 1, 4), '****', SUBSTRING(recipient_phone, 9)) AS masked_phone,
        customer_name, template_name, status, error_message, scheduled_at, sent_at, created_at
      FROM whatsapp_notification_logs
      WHERE order_id = ? AND is_custom_forge = ?
      ORDER BY id DESC
    `, [numId, isCustomForge ? 1 : 0]).catch(() => [[]]);

    return sendSuccess(res, { notifications: rows || [] }, 'Order notification history retrieved');
  } catch (error) {
    console.error('[WhatsApp Controller] Error in getOrderNotificationHistoryHandler:', error);
    return sendError(res, 'Failed to retrieve order notification history', 500);
  }
};

/**
 * POST /api/admin/whatsapp/process-due-feedback
 * Manual or scheduled trigger to process due 24h customer feedback notifications.
 */
const processDueFeedbackHandler = async (req, res) => {
  try {
    const result = await processDueFeedbackNotifications();
    return sendSuccess(res, result, 'Due feedback notifications processed successfully');
  } catch (error) {
    console.error('[WhatsApp Controller] Error in processDueFeedbackHandler:', error);
    return sendError(res, 'Failed to process feedback notifications', 500);
  }
};

module.exports = {
  getWhatsAppStatusHandler,
  getOrderNotificationHistoryHandler,
  processDueFeedbackHandler
};
