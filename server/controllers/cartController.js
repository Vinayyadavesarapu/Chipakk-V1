const cartService = require('../services/cartService');
const { pool } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Resolve database user.id from authenticated Firebase user (if present)
 */
const resolveDbUserId = async (req) => {
  if (!req.user || !req.user.uid) return null;
  try {
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE firebase_uid = ? LIMIT 1',
      [req.user.uid]
    );
    if (rows && rows.length > 0) {
      return rows[0].id;
    }
  } catch (_) {}
  return null;
};

/**
 * Helper to extract identity & store context
 * Store context is strictly resolved server-side from req.storeId (never trust body/query override)
 */
const extractCartContext = async (req) => {
  const userId = await resolveDbUserId(req);
  const sessionId = req.headers['x-session-id'] || null;
  const storeId = req.storeId ? parseInt(req.storeId, 10) : 1;
  return { userId, sessionId, storeId };
};

/**
 * GET /api/cart
 */
const getCartHandler = async (req, res, next) => {
  try {
    const { userId, sessionId, storeId } = await extractCartContext(req);
    if (!userId && !sessionId) {
      return sendError(res, 'Authentication token or X-Session-ID header is required to access the cart.', 400);
    }

    const cart = await cartService.getCart({ userId, sessionId, storeId });
    return sendSuccess(res, cart, 'Cart retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /api/cart/items
 */
const addItemHandler = async (req, res, next) => {
  try {
    const { userId, sessionId, storeId } = await extractCartContext(req);
    if (!userId && !sessionId) {
      return sendError(res, 'Authentication token or X-Session-ID header is required to add items to the cart.', 400);
    }

    const { product_id, id, variant_id, quantity, options } = req.body || {};
    const targetProductId = product_id || id;

    if (!targetProductId) {
      return sendError(res, 'Product ID (product_id) is required.', 400);
    }

    const cart = await cartService.addItem({
      userId,
      sessionId,
      storeId,
      productId: targetProductId,
      variantId: variant_id || null,
      quantity: quantity || 1,
      options: options || null
    });

    return sendSuccess(res, cart, 'Item added to cart successfully', 201);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

/**
 * PATCH /api/cart/items/:id
 */
const updateItemHandler = async (req, res, next) => {
  try {
    const { userId, sessionId, storeId } = await extractCartContext(req);
    const { id } = req.params;
    const { quantity } = req.body || {};

    if (quantity === undefined) {
      return sendError(res, 'Quantity is required.', 400);
    }

    const cart = await cartService.updateItem({
      userId,
      sessionId,
      storeId,
      itemId: id,
      quantity
    });

    return sendSuccess(res, cart, 'Cart item updated successfully');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

/**
 * DELETE /api/cart/items/:id
 */
const removeItemHandler = async (req, res, next) => {
  try {
    const { userId, sessionId, storeId } = await extractCartContext(req);
    const { id } = req.params;

    const cart = await cartService.removeItem({
      userId,
      sessionId,
      storeId,
      itemId: id
    });

    return sendSuccess(res, cart, 'Cart item removed successfully');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

/**
 * DELETE /api/cart
 */
const clearCartHandler = async (req, res, next) => {
  try {
    const { userId, sessionId, storeId } = await extractCartContext(req);
    const result = await cartService.clearCart({
      userId,
      sessionId,
      storeId
    });

    return sendSuccess(res, result, 'Cart cleared successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCartHandler,
  addItemHandler,
  updateItemHandler,
  removeItemHandler,
  clearCartHandler
};
