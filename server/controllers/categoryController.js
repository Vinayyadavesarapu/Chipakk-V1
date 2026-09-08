const categoryService = require('../services/categoryService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Categories Handler
 * GET /api/categories
 */
const getCategoriesHandler = async (req, res, next) => {
  try {
    const categories = await categoryService.getCategories({ activeOnly: false });

    return sendSuccess(res, {
      count: categories.length,
      categories
    }, 'Categories retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create Category Handler
 * POST /api/admin/categories
 */
const createCategoryHandler = async (req, res, next) => {
  try {
    const { name, slug, description, active } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.image_url || null);

    if (!name || typeof name !== 'string' || !name.trim()) {
      return sendError(res, 'Category name is required', 400);
    }

    const category = await categoryService.createCategory({
      name,
      slug,
      description,
      image_url: imageUrl,
      active
    });

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'category.created',
        'category',
        category.id,
        { name: category.name, slug: category.slug }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, category, 'Category created successfully', 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A category with this name or slug already exists', 400);
    }
    return next(error);
  }
};

/**
 * Update Category Handler
 * PUT /api/admin/categories/:id
 */
const updateCategoryHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, active } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid category ID format', 400);
    }

    const updatedCategory = await categoryService.updateCategory(numId, {
      name,
      slug,
      description,
      image_url: imageUrl,
      active
    });

    if (!updatedCategory) {
      return sendError(res, `Category with ID ${id} not found`, 404);
    }

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'category.updated',
        'category',
        numId,
        { name: updatedCategory.name, active: updatedCategory.active }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedCategory, 'Category updated successfully');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'A category with this slug already exists', 400);
    }
    return next(error);
  }
};

/**
 * Delete Category Handler
 * DELETE /api/admin/categories/:id
 */
const deleteCategoryHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid category ID format', 400);
    }

    const success = await categoryService.deleteCategory(numId);

    if (!success) {
      return sendError(res, `Category with ID ${id} not found`, 404);
    }

    return sendSuccess(res, { deleted: true, id: numId }, 'Category deleted successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  deleteCategoryHandler
};
