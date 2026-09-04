const express = require('express');
const { getSettingsHandler } = require('../controllers/settingsController');

const router = express.Router();

// Public site settings route
router.get('/', getSettingsHandler);

module.exports = router;
