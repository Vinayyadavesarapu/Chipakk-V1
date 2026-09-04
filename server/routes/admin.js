const express = require('express');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/auth');
const { uploadProductImage } = require('../middleware/upload');
const { getAdminDashboardHandler, adminPlaceholderHandler } = require('../controllers/adminController');

const router = express.Router();

// Apply Authentication and Admin Authorization Middleware to all admin routes
router.use(verifyFirebaseToken);
router.use(requireAdmin);

// Admin dashboard overview
router.get('/dashboard', getAdminDashboardHandler);

// Admin product CRUD placeholders (with multer file upload foundation for future POST)
router.post('/products', uploadProductImage.single('image'), adminPlaceholderHandler);
router.put('/products/:id', uploadProductImage.single('image'), adminPlaceholderHandler);
router.delete('/products/:id', adminPlaceholderHandler);

// Admin category & settings placeholders
router.post('/categories', adminPlaceholderHandler);
router.put('/categories/:id', adminPlaceholderHandler);
router.put('/settings', adminPlaceholderHandler);

module.exports = router;
