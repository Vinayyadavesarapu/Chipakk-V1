const categoryService = require('../services/categoryService');
const marshansCategoryService = require('../services/marshansCategoryService');
const { isMarshansHybridCatalogEnabled } = require('../config/features');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Determine effective category service based on active store and feature flag.
 * If MARSHANS_HYBRID_CATALOG_ENABLED is true and req.storeId === 2, uses marshansCategoryService.
 * Otherwise, preserves legacy categoryService (Store 1 and legacy Store 2).
 */
const getEffectiveCategoryService = (req) => {
  const storeId = req && req.storeId ? req.storeId : 1;
  if (isMarshansHybridCatalogEnabled() && storeId === 2) {
    return marshansCategoryService;
  }
  return categoryService;
};

/**
 * Get Categories Handler
 * GET /api/categories
 */
const getCategoriesHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || null;
    const effectiveService = getEffectiveCategoryService(req);
    const categories = await effectiveService.getCategories({ activeOnly: false, storeId });

    return sendSuccess(res, {
      count: categories.length,
      categories
    }, 'Categories retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Category by Slug Handler (Customer Category Page API)
 * GET /api/categories/:slug
 */
const getCategoryBySlugHandler = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const storeId = req.storeId || null;
    const effectiveService = getEffectiveCategoryService(req);

    let data = await effectiveService.getCategoryBySlug(slug, storeId);
    if (!data) {
      return sendError(res, `Category '${slug}' not found`, 404);
    }

    return sendSuccess(res, data, 'Category details retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Category Experience Handler
 * GET /api/categories/:identifier/experience
 */
const getCategoryExperienceHandler = async (req, res, next) => {
  try {
    const { identifier } = req.params;
    const storeId = req.storeId || null;
    const effectiveService = getEffectiveCategoryService(req);

    let data = await effectiveService.getCategoryExperience(identifier, storeId);
    if (!data) {
      return sendError(res, `Category '${identifier}' not found`, 404);
    }

    return sendSuccess(res, data, 'Category experience retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Available Experiences Handler (Admin)
 * GET /api/admin/experiences
 */
const getAdminExperiencesHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 2;
    const effectiveService = getEffectiveCategoryService(req);
    const experiences = await effectiveService.getExperiences(storeId);
    return sendSuccess(res, experiences, 'Experiences retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Set Category Experience Handler (Admin)
 * POST/PUT /api/admin/categories/:id/experience
 */
const setCategoryExperienceHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { experience_id, experience_code, settings } = req.body;
    const effectiveService = getEffectiveCategoryService(req);

    const result = await effectiveService.setCategoryExperience(id, {
      experience_id,
      experience_code,
      settings
    });

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'category.experience_updated',
        'category',
        id,
        { experience_id: result.experience_id }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, result, 'Category experience updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Set Category Media Handler (Admin)
 * POST /api/admin/categories/:id/media
 */
const setCategoryMediaHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { media_type, metadata } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;

    if (!media_type || !imageUrl) {
      return sendError(res, 'media_type and image_url (or file upload) are required', 400);
    }

    const effectiveService = getEffectiveCategoryService(req);
    const result = await effectiveService.setCategoryMedia(id, media_type, imageUrl, metadata);

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'category.media_updated',
        'category',
        id,
        { media_type, image_url: imageUrl }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, result, 'Category media updated successfully');
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
    const {
      name,
      slug,
      description,
      active,
      experience_id,
      experience_code,
      experience_settings,
      media,
      hero_light,
      hero_dark
    } = req.body;

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : (req.body.image_url || null);
    const storeId = req.storeId || 1;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return sendError(res, 'Category name is required', 400);
    }

    const effectiveService = getEffectiveCategoryService(req);
    const category = await effectiveService.createCategory({
      name,
      slug,
      description,
      image_url: imageUrl,
      active,
      store_id: storeId,
      experience_id,
      experience_code,
      experience_settings,
      media,
      hero_light,
      hero_dark
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
    const {
      name,
      slug,
      description,
      active,
      experience_id,
      experience_code,
      experience_settings,
      media,
      hero_light,
      hero_dark
    } = req.body;

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : req.body.image_url;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid category ID format', 400);
    }

    const effectiveService = getEffectiveCategoryService(req);
    const updatedCategory = await effectiveService.updateCategory(numId, {
      name,
      slug,
      description,
      image_url: imageUrl,
      active,
      experience_id,
      experience_code,
      experience_settings,
      media,
      hero_light,
      hero_dark
    }, req.storeId || 1);

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

    const effectiveService = getEffectiveCategoryService(req);
    const success = await effectiveService.deleteCategory(numId, req.storeId || 1);

    if (!success) {
      return sendError(res, `Category with ID ${id} not found`, 404);
    }

    return sendSuccess(res, { deleted: true, id: numId }, 'Category deleted successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getEffectiveCategoryService,
  getCategoriesHandler,
  getCategoryBySlugHandler,
  getCategoryExperienceHandler,
  getAdminExperiencesHandler,
  setCategoryExperienceHandler,
  setCategoryMediaHandler,
  createCategoryHandler,
  updateCategoryHandler,
  deleteCategoryHandler
};
