const express = require('express');
const { getHealth, getDbHealth, getUploadsDiagnosticHandler } = require('../controllers/healthController');

const router = express.Router();

// Public health check routes
router.get('/', getHealth);
router.get('/db', getDbHealth);
router.get('/diagnostic', getUploadsDiagnosticHandler);

module.exports = router;
