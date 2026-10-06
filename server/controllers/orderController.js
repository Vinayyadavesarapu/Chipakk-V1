const orderService = require('../services/orderService');
const velocityService = require('../services/velocityService');
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
      store_id: req.storeId || req.query.store_id || null,
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

    const order = await orderService.getOrderById(String(id).trim(), req.storeId);

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
    const { status, fulfillment_status, note } = req.body;

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

    // Fetch existing order to capture previous status for audit log (scoped to active store)
    const existingOrder = await orderService.getOrderById(numId, req.storeId);
    if (!existingOrder) {
      return sendError(res, `Order with ID ${id} not found`, 404);
    }

    const previousStatus = existingOrder.fulfillment_status;

    const updatedOrder = await orderService.updateOrderStatus(numId, rawStatus, {
      changed_by: (req.user && (req.user.email || req.user.name)) || 'Admin',
      note: note || `Status updated to ${rawStatus}`,
      store_id: req.storeId
    });

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

    const existingOrder = await orderService.getOrderById(numId, req.storeId);
    if (!existingOrder) {
      return sendError(res, `Order with ID ${id} not found`, 404);
    }

    const updatedOrder = await orderService.updateOrderShipping(numId, {
      courier,
      tracking_no,
      ship_date,
      ship_notes
    }, req.storeId);

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

/**
 * Create Customer Order Handler
 * POST /api/orders
 */
const createCustomerOrderHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to place an order.', 401);
    }

    const payload = {
      ...(req.body || {}),
      store_id: req.storeId || 1
    };

    const order = await orderService.createCustomerOrder(payload, req.user);
    return sendSuccess(res, order, 'Order placed successfully', 201);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

/**
 * Get Authenticated Customer Orders Handler
 * GET /api/orders
 */
const getCustomerOrdersHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to view orders.', 401);
    }

    const { limit, offset } = req.query;
    const result = await orderService.getCustomerOrders(req.user.uid, {
      limit,
      offset,
      store_id: req.storeId || 1
    });
    return sendSuccess(res, result, 'Customer orders retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Authenticated Customer Single Order Handler
 * GET /api/orders/:id
 */
const getCustomerOrderByIdHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to view order details.', 401);
    }

    const { id } = req.params;
    const order = await orderService.getCustomerOrderById(id, req.user.uid, req.storeId || 1);

    if (!order) {
      return sendError(res, 'Order not found or access denied.', 404);
    }

    return sendSuccess(res, order, 'Order retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Authenticated Customer Order Live Tracking Handler
 * GET /api/orders/:id/tracking
 */
const getCustomerOrderTrackingHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to track orders.', 401);
    }

    const { id } = req.params;
    const order = await orderService.getCustomerOrderById(id, req.user.uid, req.storeId || 1);

    if (!order) {
      return sendError(res, 'Order not found or access denied.', 404);
    }

    const trackingData = {
      order_id: order.id,
      order_number: order.order_number,
      fulfillment_status: order.fulfillment_status,
      payment_status: order.payment_status,
      courier: order.courier || null,
      tracking_no: order.tracking_no || null,
      current_status: order.fulfillment_status,
      activities: [],
      track_url: null,
      pickup_date: order.ship_date || null,
      delivered_date: null
    };

    // If order has an AWB / tracking number, belongs to Store 2 (THE MARSHANS), and Velocity is configured, query real-time tracking
    if (order.tracking_no && parseInt(order.store_id, 10) === 2 && velocityService.isConfigured()) {
      try {
        const velRes = await velocityService.trackShipment(order.tracking_no);
        const result = Array.isArray(velRes) ? velRes[0] : (velRes?.data?.[0] || velRes?.data || velRes);
        if (result && typeof result === 'object') {
          trackingData.current_status = result.status || result.current_status || order.fulfillment_status;
          trackingData.courier = result.courier || result.courier_name || order.courier;
          trackingData.track_url = result.track_url || result.tracking_url || null;
          trackingData.activities = Array.isArray(result.activities)
            ? result.activities
            : (Array.isArray(result.tracking_activities) ? result.tracking_activities : []);
          if (result.pickup_date) trackingData.pickup_date = result.pickup_date;
          if (result.delivered_date) trackingData.delivered_date = result.delivered_date;
        }
      } catch (velErr) {
        console.warn(`[Tracking Warning] Velocity tracking fetch failed for AWB ${order.tracking_no}:`, velErr.message);
      }
    }

    return sendSuccess(res, trackingData, 'Order tracking retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const SERVICEABILITY_MESSAGES = {
  serviceable: 'Delivery is available for this PIN code.',
  not_serviceable: 'Delivery is not available for this PIN code.',
  unavailable: 'Shipping serviceability is temporarily unavailable. Please try again later.'
};

/**
 * Check Order Pincode Serviceability Handler
 * POST /api/orders/serviceability
 *
 * Always answers with exactly one of three states (never assumes delivery is available):
 *   { status: 'serviceable',     serviceable: true,  carriers: [...] }  -> Velocity returned carriers
 *   { status: 'not_serviceable', serviceable: false, carriers: [] }     -> Velocity returned no carriers
 *   { status: 'unavailable',     serviceable: false, carriers: [] }     -> config missing / auth / network / API failure
 */
const checkOrderServiceabilityHandler = async (req, res, next) => {
  try {
    const storeId = parseInt(req.storeId, 10) || 1;
    if (storeId !== 2) {
      return sendError(res, 'Velocity shipping serviceability is exclusively enabled for THE MARSHANS (Store 2).', 403);
    }

    const { pincode, payment_mode } = req.body || {};
    const cleanPin = String(pincode || '').trim();

    if (!cleanPin || !/^\d{6}$/.test(cleanPin)) {
      return sendError(res, 'A valid 6-digit PIN code is required.', 400);
    }

    const paymentMode = String(payment_mode || '').toLowerCase() === 'cod' ? 'cod' : 'prepaid';
    const unavailable = () => sendSuccess(res, {
      status: 'unavailable',
      serviceable: false,
      carriers: [],
      pincode: cleanPin,
      payment_mode: paymentMode,
      message: SERVICEABILITY_MESSAGES.unavailable
    }, 'Serviceability check unavailable');

    if (!velocityService.isConfigured()) {
      console.warn('[Velocity Serviceability] VELOCITY_USERNAME / VELOCITY_PASSWORD are not configured.');
      return unavailable();
    }

    let result;
    try {
      result = await velocityService.checkServiceability({ to: cleanPin, payment_mode: paymentMode });
    } catch (velErr) {
      // Never forward Velocity internals to customers; log a safe summary for operators.
      console.warn(`[Velocity Serviceability] PIN ${cleanPin} unavailable: code=${velErr.code || '-'} status=${velErr.statusCode || '-'} ${velErr.message}`);
      return unavailable();
    }

    const status = result.serviceable ? 'serviceable' : 'not_serviceable';
    return sendSuccess(res, {
      status,
      serviceable: result.serviceable,
      carriers: result.carriers,
      pincode: cleanPin,
      payment_mode: paymentMode,
      message: SERVICEABILITY_MESSAGES[status]
    }, 'Serviceability checked successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getOrdersHandler,
  getOrderByIdHandler,
  updateOrderStatusHandler,
  updateOrderShippingHandler,
  createCustomerOrderHandler,
  getCustomerOrdersHandler,
  getCustomerOrderByIdHandler,
  getCustomerOrderTrackingHandler,
  checkOrderServiceabilityHandler
};

