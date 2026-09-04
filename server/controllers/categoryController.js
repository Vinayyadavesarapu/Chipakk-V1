const categoryService = require('../services/categoryService');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * Get Categories Handler
 * GET /api/categories
 */
const getCategoriesHandler = async (req, res, next) => {
  try {
    const categories = await categoryService.getCategories({ activeOnly: true });

    return sendSuccess(res, {
      count: categories.length,
      categories
    }, 'Categories retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCategoriesHandler
};
