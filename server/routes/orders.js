const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  createCustomerOrderHandler,
  getCustomerOrdersHandler,
  getCustomerOrderByIdHandler
} = require('../controllers/orderController');

const router = express.Router();

// Require authenticated customer session for all customer order routes
router.use(verifyFirebaseToken);

// Customer Orders API
router.post('/', createCustomerOrderHandler);
router.get('/', getCustomerOrdersHandler);
router.get('/:id', getCustomerOrderByIdHandler);

module.exports = router;
