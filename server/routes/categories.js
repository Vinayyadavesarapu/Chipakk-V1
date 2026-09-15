const express = require('express');
const {
  getCategoriesHandler,
  getCategoryBySlugHandler,
  getCategoryExperienceHandler
} = require('../controllers/categoryController');

const router = express.Router();

// Public category routes
router.get('/', getCategoriesHandler);
router.get('/:identifier/experience', getCategoryExperienceHandler);
router.get('/:slug', getCategoryBySlugHandler);

module.exports = router;
