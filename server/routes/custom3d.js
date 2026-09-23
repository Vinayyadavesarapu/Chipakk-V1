const express = require('express');
const {
  createCustomRequestHandler,
  getCustomRequestByIdHandler
} = require('../controllers/customRequestController');

const router = express.Router();

/**
 * Customer 3D Fabrication Request Submission
 * POST /api/custom-3d/request
 */
router.post('/request', createCustomRequestHandler);

/**
 * Customer 3D Fabrication Request Lookup by ID
 * GET /api/custom-3d/request/:id
 */
router.get('/request/:id', getCustomRequestByIdHandler);

module.exports = router;
