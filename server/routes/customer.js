const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const {
  getAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler
} = require('../controllers/addressController');

const router = express.Router();

// Require authenticated customer session for all customer routes
router.use(verifyFirebaseToken);

// Customer Saved Delivery Addresses
router.get('/addresses', getAddressesHandler);
router.post('/addresses', createAddressHandler);
router.put('/addresses/:id', updateAddressHandler);
router.delete('/addresses/:id', deleteAddressHandler);

module.exports = router;
