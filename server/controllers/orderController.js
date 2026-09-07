const orderService = require('../services/orderService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Orders List Handler
 * GET /api/admin/orders
 */
const getOrdersHandler = async (req, res, next) => {
  try {
    const { search, fulfillment_status, payment_status, limit, offset } = req.query;

    const result = await orderService.getOrders({
      search,
      fulfillment_status,
      payment_status,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Orders retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Order by ID or Order Number Handler
 * GET /api/admin/orders/:id
 */
const getOrderByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !String(id).trim()) {
      return sendError(res, 'Order ID or Order Number is required.', 400);
    }

    const order = await orderService.getOrderById(String(id).trim());

    if (!order) {
      return sendError(res, `Order '${id}' not found`, 404);
    }

    return sendSuccess(res, order, 'Order retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Order Fulfillment Status Handler
 * PUT /api/admin/orders/:id/status
 */
const updateOrderStatusHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, fulfillment_status } = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid order ID format. Expected numeric BIGINT ID.', 400);
    }

    const targetStatus = status || fulfillment_status;

    if (!targetStatus || typeof targetStatus !== 'string' || !targetStatus.trim()) {
      return sendError(res, 'Fulfillment status is required.', 400);
    }

    const rawStatus = targetStatus.trim();

    // Check if status strictly matches allowed uppercase machine status
    if (!orderService.ALLOWED_FULFILLMENT_STATUSES.includes(rawStatus)) {
      return sendError(
        res,
        `Invalid fulfillment status. Allowed values: ${orderService.ALLOWED_FULFILLMENT_STATUSES.join(', ')}`,
        400
      );
    }

    // Fetch existing order to capture previous status for audit log
    const existingOrder = await orderService.getOrderById(numId);
    if (!existingOrder) {
      return sendError(res, `Order with ID ${id} not found`, 404);
    }

    const previousStatus = existingOrder.fulfillment_status;

    const updatedOrder = await orderService.updateOrderStatus(numId, rawStatus);

    // Write audit log if request is authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'order.status_changed',
        'order',
        numId,
        {
          order_number: updatedOrder.order_number,
          old_status: previousStatus,
          new_status: rawStatus
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedOrder, 'Order status updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Order Shipping Details Handler
 * PUT /api/admin/orders/:id/shipping
 */
const updateOrderShippingHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { courier, tracking_no, ship_date, ship_notes } = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid order ID format. Expected numeric BIGINT ID.', 400);
    }

    const existingOrder = await orderService.getOrderById(numId);
    if (!existingOrder) {
      return sendError(res, `Order with ID ${id} not found`, 404);
    }

    const updatedOrder = await orderService.updateOrderShipping(numId, {
      courier,
      tracking_no,
      ship_date,
      ship_notes
    });

    // Write audit log if request is authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'order.shipping_updated',
        'order',
        numId,
        {
          order_number: updatedOrder.order_number,
          courier: updatedOrder.courier,
          tracking_no: updatedOrder.tracking_no,
          ship_date: updatedOrder.ship_date,
          ship_notes: updatedOrder.ship_notes
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedOrder, 'Order shipping details updated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getOrdersHandler,
  getOrderByIdHandler,
  updateOrderStatusHandler,
  updateOrderShippingHandler
};
