const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Admin Dashboard Overview
 * GET /api/admin/dashboard
 */
const getAdminDashboardHandler = async (req, res, next) => {
  try {
    return sendSuccess(res, {
      admin: {
        id: req.admin.id,
        email: req.admin.email,
        role: req.admin.role,
        firebase_uid: req.admin.firebase_uid
      },
      status: 'authenticated',
      message: 'Admin authorization verified successfully'
    }, 'Admin dashboard data');
  } catch (error) {
    return next(error);
  }
};

/**
 * Admin CRUD Endpoint Placeholder
 * Used for future POST, PUT, DELETE operations on products/categories/orders
 */
const adminPlaceholderHandler = (req, res) => {
  return sendError(
    res,
    `Admin write operation '${req.method} ${req.originalUrl}' is not implemented yet. Backend foundation is in place.`,
    501
  );
};

module.exports = {
  getAdminDashboardHandler,
  adminPlaceholderHandler
};
