const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  createCustomerOrderHandler,
  getCustomerOrdersHandler,
  getCustomerOrderByIdHandler,
  getCustomerOrderTrackingHandler,
  checkOrderServiceabilityHandler
} = require('../controllers/orderController');
const { getCustomerInvoiceHandler } = require('../controllers/taxController');

const router = express.Router();

// Require authenticated customer session for all customer order routes
router.use(verifyFirebaseToken);

// Customer Orders API
router.post('/', createCustomerOrderHandler);
router.post('/serviceability', checkOrderServiceabilityHandler);
router.get('/', getCustomerOrdersHandler);
router.get('/:id', getCustomerOrderByIdHandler);
router.get('/:id/tracking', getCustomerOrderTrackingHandler);
router.get('/:id/invoice', getCustomerInvoiceHandler);

module.exports = router;
