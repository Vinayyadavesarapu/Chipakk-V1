const productService = require('../services/productService');
const marshansProductService = require('../services/marshansProductService');
const { isMarshansHybridCatalogEnabled } = require('../config/features');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Determine the effective product service based on active store and feature flag.
 * If MARSHANS_HYBRID_CATALOG_ENABLED is true and req.storeId === 2, uses marshansProductService.
 * Otherwise, preserves legacy productService (Store 1 and legacy Store 2).
 */
const getEffectiveProductService = (req) => {
  const storeId = req && req.storeId ? req.storeId : 1;
  if (isMarshansHybridCatalogEnabled() && storeId === 2) {
    return marshansProductService;
  }
  return productService;
};

/**
 * Get Product Catalog List Handler
 * GET /api/products
 * GET /api/admin/products
 */
const getProductsHandler = async (req, res, next) => {
  try {
    const { search, category_id, active, featured, is_best_seller, drop_status, limit, offset } = req.query;
    const store_id = req.storeId || null;
    const effectiveService = getEffectiveProductService(req);

    const result = await effectiveService.getProducts({
      search,
      category_id,
      active,
      featured,
      is_best_seller,
      drop_status,
      store_id,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Products retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Product by ID or Admin Product ID Handler
 * GET /api/products/:id
 * GET /api/admin/products/:id
 */
const getProductByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || !String(id).trim()) {
      return sendError(res, 'Product ID or Admin Product ID is required.', 400);
    }

    const effectiveService = getEffectiveProductService(req);
    let product = await effectiveService.getProductById(String(id).trim());

    if (!product) {
      return sendError(res, `Product '${id}' not found`, 404);
    }

    return sendSuccess(res, product, 'Product retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create Product Handler
 * POST /api/admin/products
 */
const createProductHandler = async (req, res, next) => {
  try {
    const productData = req.body;
    productData.store_id = req.storeId || 1;

    if (!productData.name || typeof productData.name !== 'string' || !productData.name.trim()) {
      return sendError(res, 'Product name is required', 400);
    }

    if (productData.price === undefined || isNaN(Number(productData.price))) {
      return sendError(res, 'Product price in paise is required', 400);
    }

    const effectiveService = getEffectiveProductService(req);
    const product = await effectiveService.createProduct(productData);

    // Write audit log if request is authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'product.created',
        'product',
        product.id,
        {
          admin_product_id: product.admin_product_id,
          name: product.name,
          sku: product.sku,
          price: product.price
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, product, 'Product created successfully', 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const isAdminId = error.message.includes('admin_product_id') || error.message.includes('admin_id');
      const msg = isAdminId ? 'A product with this Admin Product ID already exists' : 'A product with this SKU already exists';
      return sendError(res, msg, 400);
    }
    return next(error);
  }
};

/**
 * Update Product Handler
 * PUT /api/admin/products/:id
 */
const updateProductHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const productData = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid product ID format. Expected numeric BIGINT ID.', 400);
    }

    const effectiveService = getEffectiveProductService(req);
    const updatedProduct = await effectiveService.updateProduct(numId, productData);

    if (!updatedProduct) {
      return sendError(res, `Product with ID ${id} not found`, 404);
    }

    // Write audit log if request is authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'product.updated',
        'product',
        updatedProduct.id,
        {
          admin_product_id: updatedProduct.admin_product_id,
          name: updatedProduct.name,
          active: updatedProduct.active
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedProduct, 'Product updated successfully');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const isAdminId = error.message.includes('admin_product_id') || error.message.includes('admin_id');
      const msg = isAdminId ? 'A product with this Admin Product ID already exists' : 'A product with this SKU already exists';
      return sendError(res, msg, 400);
    }
    return next(error);
  }
};

/**
 * Delete / Deactivate Product Handler
 * DELETE /api/admin/products/:id
 */
const deleteProductHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid product ID format. Expected numeric BIGINT ID.', 400);
    }

    const effectiveService = getEffectiveProductService(req);
    const success = await effectiveService.deleteProduct(numId);

    if (!success) {
      return sendError(res, `Product with ID ${id} not found`, 404);
    }

    // Write audit log if request is authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'product.deactivated',
        'product',
        numId,
        { action: 'deactivated', active: 0 }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, { deactivated: true, id: numId }, 'Product deactivated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getEffectiveProductService,
  getProductsHandler,
  getProductByIdHandler,
  createProductHandler,
  updateProductHandler,
  deleteProductHandler
};
