const express = require('express');
const { getHealth, getDbHealth } = require('../controllers/healthController');

const router = express.Router();

// Public health check routes
router.get('/', getHealth);
router.get('/db', getDbHealth);

module.exports = router;
