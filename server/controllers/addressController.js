const addressService = require('../services/addressService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Saved Customer Addresses
 * GET /api/customer/addresses
 */
const getAddressesHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to retrieve saved addresses.', 401);
    }

    const addresses = await addressService.getCustomerAddresses(req.user.uid);
    return sendSuccess(res, addresses, 'Customer addresses retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create New Saved Address
 * POST /api/customer/addresses
 */
const createAddressHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to save address.', 401);
    }

    const address = await addressService.createCustomerAddress(req.user.uid, req.body || {});
    return sendSuccess(res, address, 'Address saved successfully', 201);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

/**
 * Update Existing Saved Address
 * PUT /api/customer/addresses/:id
 */
const updateAddressHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to update address.', 401);
    }

    const { id } = req.params;
    const address = await addressService.updateCustomerAddress(id, req.user.uid, req.body || {});

    if (!address) {
      return sendError(res, 'Address not found or access denied.', 404);
    }

    return sendSuccess(res, address, 'Address updated successfully');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

/**
 * Delete Saved Address
 * DELETE /api/customer/addresses/:id
 */
const deleteAddressHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) {
      return sendError(res, 'Authentication required to delete address.', 401);
    }

    const { id } = req.params;
    const deleted = await addressService.deleteCustomerAddress(id, req.user.uid);

    if (!deleted) {
      return sendError(res, 'Address not found or access denied.', 404);
    }

    return sendSuccess(res, { deleted: true, id }, 'Address deleted successfully');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
};

module.exports = {
  getAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler
};
