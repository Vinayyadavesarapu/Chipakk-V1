const categoryService = require('../services/categoryService');
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

    if (!name || typeof name !== 'string' || !name.trim()) {
      return sendError(res, 'Category name is required', 400);
    }

    const category = await categoryService.createCategory({ name, slug, description, active });
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

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid category ID format', 400);
    }

    const updatedCategory = await categoryService.updateCategory(numId, { name, slug, description, active });

    if (!updatedCategory) {
      return sendError(res, `Category with ID ${id} not found`, 404);
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
