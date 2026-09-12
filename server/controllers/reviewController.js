const reviewService = require('../services/reviewService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Reviews List Handler
 * GET /api/admin/reviews
 */
const getReviewsHandler = async (req, res, next) => {
  try {
    const { search, status, product_id, rating, limit, offset } = req.query;

    const result = await reviewService.getReviews({
      search,
      status,
      product_id,
      rating,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Reviews retrieved successfully');
  } catch (error) {
    console.warn('[Reviews Optional Handler Fallback]', error.message);
    return sendSuccess(res, { reviews: [], total: 0, pagination: { total: 0, limit: 50, offset: 0 } }, 'Reviews fallback');
  }
};

/**
 * Get Review by ID Handler
 * GET /api/admin/reviews/:id
 */
const getReviewByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid review ID format. Expected numeric BIGINT ID.', 400);
    }

    const review = await reviewService.getReviewById(numId);

    if (!review) {
      return sendError(res, `Review '${id}' not found`, 404);
    }

    return sendSuccess(res, review, 'Review retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Review Handler (Rating, Comment, Status)
 * PUT /api/admin/reviews/:id
 */
const updateReviewHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating, comment, status } = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid review ID format. Expected numeric BIGINT ID.', 400);
    }

    if (status !== undefined) {
      const rawStatus = String(status || '').trim().toLowerCase();
      if (!reviewService.ALLOWED_REVIEW_STATUSES.includes(rawStatus)) {
        return sendError(
          res,
          `Invalid status. Allowed values: ${reviewService.ALLOWED_REVIEW_STATUSES.join(', ')}`,
          400
        );
      }
    }

    if (rating !== undefined) {
      const numRating = parseInt(rating, 10);
      if (isNaN(numRating) || numRating < 1 || numRating > 5) {
        return sendError(res, 'Rating must be an integer between 1 and 5.', 400);
      }
    }

    const existingReview = await reviewService.getReviewById(numId);
    if (!existingReview) {
      return sendError(res, `Review with ID ${id} not found`, 404);
    }

    const previousStatus = existingReview.status;
    const previousRating = existingReview.rating;

    const updatedReview = await reviewService.updateReview(numId, {
      rating,
      comment,
      status
    });

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'review.updated',
        'review',
        numId,
        {
          review_id: numId,
          product_id: existingReview.product_id,
          old_status: previousStatus,
          new_status: updatedReview.status,
          old_rating: previousRating,
          new_rating: updatedReview.rating
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedReview, 'Review updated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getReviewsHandler,
  getReviewByIdHandler,
  updateReviewHandler
};
