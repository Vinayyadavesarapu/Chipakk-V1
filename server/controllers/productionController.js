const productionService = require('../services/productionService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get POD Production Queue Items Handler
 * GET /api/admin/production/queue
 */
const getProductionQueueHandler = async (req, res, next) => {
  try {
    const { search, production_status, limit, offset } = req.query;

    const result = await productionService.getProductionQueue({
      search,
      production_status,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Production queue retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Production Status of an Order Item Handler
 * PUT /api/admin/production/queue/items/:itemId/status
 */
const updateProductionStatusHandler = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { production_status, status } = req.body;

    const numItemId = parseInt(itemId, 10);
    if (isNaN(numItemId)) {
      return sendError(res, 'Invalid order item ID format. Expected numeric BIGINT ID.', 400);
    }

    const targetStatus = production_status || status;

    if (!targetStatus || typeof targetStatus !== 'string' || !targetStatus.trim()) {
      return sendError(res, 'Production status is required.', 400);
    }

    const rawStatus = targetStatus.trim();

    // Verify status is one of the 8 allowed uppercase machine statuses
    if (!productionService.ALLOWED_PRODUCTION_STATUSES.includes(rawStatus)) {
      return sendError(
        res,
        `Invalid production status. Allowed values: ${productionService.ALLOWED_PRODUCTION_STATUSES.join(', ')}`,
        400
      );
    }

    // Read current production item to verify existence & record previous status
    const existingItem = await productionService.getProductionItemById(numItemId);
    if (!existingItem) {
      return sendError(res, `Production order item with ID ${itemId} not found`, 404);
    }

    const previousStatus = existingItem.production_status;

    const updatedItem = await productionService.updateProductionStatus(numItemId, rawStatus);

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'production.status_changed',
        'order_item',
        numItemId,
        {
          order_item_id: numItemId,
          order_number: updatedItem.order_number,
          product_name: updatedItem.product_name,
          previous_production_status: previousStatus,
          new_production_status: updatedItem.production_status
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    const responsePayload = {
      id: numItemId,
      previous_status: previousStatus,
      new_status: updatedItem.production_status,
      order_number: updatedItem.order_number,
      product_name: updatedItem.product_name
    };

    return sendSuccess(res, responsePayload, 'Production status updated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getProductionQueueHandler,
  updateProductionStatusHandler
};
