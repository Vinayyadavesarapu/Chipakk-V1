const customerService = require('../services/customerService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Customers List Handler
 * GET /api/admin/customers
 */
const getCustomersHandler = async (req, res, next) => {
  try {
    const { search, limit, offset } = req.query;

    const result = await customerService.getCustomers({
      search,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Customers retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Customer Detail Handler by BIGINT ID or Firebase UID
 * GET /api/admin/customers/:id
 */
const getCustomerByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !String(id).trim()) {
      return sendError(res, 'Customer ID or Firebase UID is required.', 400);
    }

    const customer = await customerService.getCustomerById(String(id).trim());

    if (!customer) {
      return sendError(res, `Customer '${id}' not found`, 404);
    }

    return sendSuccess(res, customer, 'Customer retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCustomersHandler,
  getCustomerByIdHandler
};
