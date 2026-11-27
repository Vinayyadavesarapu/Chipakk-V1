/**
 * Alert Routes
 * Dedicated endpoints for the standalone order alert companion application.
 *
 * Base route: /api/alerts
 * Security: Dedicated alert-device authentication via requireAlertAuth + rate limiting.
 */

const express = require('express');
const router = express.Router();

const { requireAlertAuth } = require('../middleware/alertAuth');
const { alertRateLimiter } = require('../middleware/alertRateLimiter');
const {
  getAlertFeedHandler,
  acknowledgeAlertsHandler,
  getAlertHealthHandler
} = require('../controllers/alertController');

// All alert endpoints require dedicated device credentials and rate limiting
router.use(alertRateLimiter);
router.use(requireAlertAuth);

// GET /api/alerts/feed - Poll or fetch new orders with cursor pagination
router.get('/feed', getAlertFeedHandler);

// POST /api/alerts/acknowledge - Mark orders as acknowledged
router.post('/acknowledge', acknowledgeAlertsHandler);

// GET /api/alerts/health - Lightweight connectivity & credential check
router.get('/health', getAlertHealthHandler);

module.exports = router;
