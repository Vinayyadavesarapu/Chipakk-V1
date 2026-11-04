const customForgeService = require('../services/customForgeService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Customer: Get Lady Justice Product & Variants
 * GET /api/custom-forge/products/lady-justice
 */
const getLadyJusticeProductHandler = async (req, res, next) => {
  try {
    if (req.storeId && parseInt(req.storeId, 10) !== 2) {
      return sendError(res, 'Custom Forge is exclusively supported on Store 2 (THE MARSHANS).', 403);
    }
    const product = await customForgeService.getLadyJusticeProduct();
    return sendSuccess(res, product, 'Lady Justice product details retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Customer: Create Custom Forge Order
 * POST /api/custom-forge/orders
 */
const createCustomerOrderHandler = async (req, res, next) => {
  try {
    const order = await customForgeService.createCustomForgeOrder(
      req.body,
      req.user,
      req.storeId || 2
    );
    return sendSuccess(res, order, 'Custom Forge order placed successfully', 201);
  } catch (error) {
    return next(error);
  }
};

/**
 * Customer: Get Custom Forge Order by ID
 * GET /api/custom-forge/orders/:id
 */
const getCustomerOrderByIdHandler = async (req, res, next) => {
  try {
    if (req.storeId && parseInt(req.storeId, 10) !== 2) {
      return sendError(res, 'Custom Forge is exclusively supported on Store 2 (THE MARSHANS).', 403);
    }
    const { id } = req.params;
    if (!id || !String(id).trim()) {
      return sendError(res, 'Order ID is required', 400);
    }

    const order = await customForgeService.getCustomerOrderById(id, req.user);
    return sendSuccess(res, order, 'Custom Forge order retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin: Get Custom Forge Orders List
 * GET /api/admin/custom-forge/orders
 */
const getAdminCustomForgeOrdersHandler = async (req, res, next) => {
  try {
    const { status, search, limit, offset } = req.query;
    const result = await customForgeService.getAdminCustomForgeOrders({
      status,
      search,
      limit,
      offset
    });
    return sendSuccess(res, result, 'Custom Forge orders retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin: Get Custom Forge Order by ID
 * GET /api/admin/custom-forge/orders/:id
 */
const getAdminCustomForgeOrderByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || !String(id).trim()) {
      return sendError(res, 'Order ID is required', 400);
    }

    const order = await customForgeService.getAdminCustomForgeOrderById(id);
    if (!order) {
      return sendError(res, 'Custom Forge order not found', 404);
    }

    return sendSuccess(res, order, 'Custom Forge order retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin: Update Custom Forge Production Status
 * PATCH /api/admin/custom-forge/orders/:id/status
 */
const updateAdminCustomForgeOrderStatusHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note, notes } = req.body || {};

    if (!id || !String(id).trim()) {
      return sendError(res, 'Order ID is required', 400);
    }

    if (!status) {
      return sendError(res, 'Production status is required', 400);
    }

    const adminActor = req.admin || req.user || { name: 'Admin' };
    const order = await customForgeService.updateCustomForgeOrderStatus(
      id,
      { status, note: note || notes },
      adminActor
    );

    return sendSuccess(res, order, 'Custom Forge order status updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin: Get Unread / Unacknowledged Custom Forge Orders Count
 * GET /api/admin/custom-forge/orders/unread-count
 */
const getAdminCustomForgeUnreadCountHandler = async (req, res, next) => {
  try {
    const storeId = req.headers['x-store-id'] || req.storeId || 2;
    if (parseInt(storeId, 10) !== 2) {
      return sendError(res, 'Custom Forge is exclusively supported on Store 2 (THE MARSHANS).', 403);
    }
    const result = await customForgeService.getUnreadCustomForgeOrdersCount(storeId);
    return sendSuccess(res, result, 'Custom Forge unread order count retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin: Acknowledge Custom Forge Orders
 * POST /api/admin/custom-forge/orders/acknowledge
 */
const acknowledgeAdminCustomForgeOrdersHandler = async (req, res, next) => {
  try {
    const storeId = req.headers['x-store-id'] || req.storeId || 2;
    if (parseInt(storeId, 10) !== 2) {
      return sendError(res, 'Custom Forge is exclusively supported on Store 2 (THE MARSHANS).', 403);
    }
    const { order_ids } = req.body || {};
    const adminActor = req.admin || req.user || { name: 'Admin' };
    const result = await customForgeService.acknowledgeCustomForgeOrders(order_ids, adminActor, storeId);
    return sendSuccess(res, result, 'Custom Forge orders acknowledged successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getLadyJusticeProductHandler,
  createCustomerOrderHandler,
  getCustomerOrderByIdHandler,
  getAdminCustomForgeOrdersHandler,
  getAdminCustomForgeOrderByIdHandler,
  updateAdminCustomForgeOrderStatusHandler,
  getAdminCustomForgeUnreadCountHandler,
  acknowledgeAdminCustomForgeOrdersHandler
};
