/**
 * Alert Controller
 * Handles incoming HTTP requests for the order alert feed, acknowledgment, and health checks.
 */

const { sendSuccess, sendError } = require('../utils/responseHandler');
const { getAlertFeed, acknowledgeAlertOrders, parseCursor } = require('../services/alertFeedService');

/**
 * GET /api/alerts/feed
 * Returns cursor-paginated orders across CHIPAKK and THE MARSHANS for alert polling.
 */
const getAlertFeedHandler = async (req, res) => {
  try {
    const { cursor, since, limit, store_id, category } = req.query;

    if (cursor && typeof cursor === 'string' && !parseCursor(cursor)) {
      return sendError(res, 'Malformed or invalid pagination cursor.', 400, 'ALERT_CURSOR_MALFORMED');
    }

    const result = await getAlertFeed({
      cursor,
      since,
      limit,
      store_id,
      category
    });

    return sendSuccess(res, result, 'Alert feed retrieved successfully');
  } catch (error) {
    console.error('[Alert Controller] Error in getAlertFeedHandler:', error);
    return sendError(
      res,
      error.message || 'Failed to retrieve alert feed',
      error.statusCode || 500,
      process.env.NODE_ENV === 'development' ? error.stack : null
    );
  }
};

/**
 * POST /api/alerts/acknowledge
 * Acknowledges one or more orders from the alert dashboard without modifying production status.
 */
const acknowledgeAlertsHandler = async (req, res) => {
  try {
    const { feed_ids, order_ids, category, actor } = req.body || {};

    const result = await acknowledgeAlertOrders({
      feed_ids,
      order_ids,
      category,
      actor: actor || 'Alert Companion Service'
    });

    return sendSuccess(res, result, 'Orders acknowledged successfully');
  } catch (error) {
    console.error('[Alert Controller] Error in acknowledgeAlertsHandler:', error);
    return sendError(
      res,
      error.message || 'Failed to acknowledge orders',
      error.statusCode || 500,
      process.env.NODE_ENV === 'development' ? error.stack : null
    );
  }
};

/**
 * GET /api/alerts/health
 * Lightweight health check for the local companion service to verify credentials and connectivity.
 */
const getAlertHealthHandler = async (req, res) => {
  try {
    return sendSuccess(res, {
      status: 'online',
      service: 'marshans-order-alert-feed',
      store_isolation: {
        chipakk_store_id: 1,
        marshans_store_id: 2
      },
      authenticated_device: true
    }, 'Alert feed service is operational');
  } catch (error) {
    return sendError(res, 'Alert feed health check failed', 500);
  }
};

module.exports = {
  getAlertFeedHandler,
  acknowledgeAlertsHandler,
  getAlertHealthHandler
};
