const express = require('express');
const { getCategoriesHandler } = require('../controllers/categoryController');

const router = express.Router();

// Public category routes
router.get('/', getCategoriesHandler);

module.exports = router;
