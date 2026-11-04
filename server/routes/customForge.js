const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  getLadyJusticeProductHandler,
  createCustomerOrderHandler,
  getCustomerOrderByIdHandler
} = require('../controllers/customForgeController');

const router = express.Router();

/**
 * Public: Get Lady Justice Custom Forge Catalog Details
 * GET /api/custom-forge/products/lady-justice
 */
router.get('/products/lady-justice', getLadyJusticeProductHandler);

/**
 * Authenticated Customer: Place Custom Forge Order
 * POST /api/custom-forge/orders
 */
router.post('/orders', verifyFirebaseToken, createCustomerOrderHandler);

/**
 * Authenticated Customer: Get Custom Forge Order by ID
 * GET /api/custom-forge/orders/:id
 */
router.get('/orders/:id', verifyFirebaseToken, getCustomerOrderByIdHandler);

module.exports = router;
