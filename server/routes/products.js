const express = require('express');
const { getProductsHandler, getProductByIdHandler } = require('../controllers/productController');

const router = express.Router();

// Public product routes
router.get('/', getProductsHandler);
router.get('/:id', getProductByIdHandler);

module.exports = router;
