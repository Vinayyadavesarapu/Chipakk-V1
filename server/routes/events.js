const express = require('express');
const eventService = require('../services/eventService');
const { sendSuccess } = require('../utils/responseHandler');

const router = express.Router();

/**
 * Public Promotional Events Route
 * GET /api/events
 * Returns active live events for customer storefront
 */
router.get('/', async (req, res, next) => {
  try {
    const { status = 'live', limit = 20 } = req.query;

    const result = await eventService.getEvents({
      active: 1,
      status: status,
      limit: parseInt(limit, 10) || 20
    });

    return sendSuccess(res, result, 'Active promotional events retrieved successfully');
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
