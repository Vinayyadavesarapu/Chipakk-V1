const productService = require('../services/productService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Product Catalog List Handler
 * GET /api/products
 */
const getProductsHandler = async (req, res, next) => {
  try {
    const { category_id, active, featured, limit, offset } = req.query;

    const products = await productService.getProducts({
      category_id,
      active: active !== undefined ? active === 'true' || active === '1' : 1,
      featured: featured !== undefined ? featured === 'true' || featured === '1' : undefined,
      limit,
      offset
    });

    return sendSuccess(res, {
      count: products.length,
      products
    }, 'Products retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Product by ID Handler
 * GET /api/products/:id
 */
const getProductByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate BIGINT ID
    const numId = parseInt(id, 10);
    if (isNaN(numId) || numId.toString() !== id) {
      return sendError(
        res,
        'Invalid product ID format. MySQL requires numeric BIGINT IDs.',
        400,
        'Firestore string IDs (e.g. prod_1) must be mapped to numeric MySQL IDs before querying.'
      );
    }

    const product = await productService.getProductById(numId);

    if (!product) {
      return sendError(res, `Product with ID ${id} not found`, 404);
    }

    return sendSuccess(res, product, 'Product retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getProductsHandler,
  getProductByIdHandler
};
