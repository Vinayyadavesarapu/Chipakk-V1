const express = require('express');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/auth');
const { uploadProductImage, uploadCustomArtwork } = require('../middleware/upload');
const {
  getAdminDashboardHandler,
  getTeamMembersHandler,
  updateTeamMemberStatusHandler,
  createTeamMemberHandler
} = require('../controllers/adminController');
const { createCategoryHandler, updateCategoryHandler, deleteCategoryHandler } = require('../controllers/categoryController');
const {
  getProductsHandler,
  getProductByIdHandler,
  createProductHandler,
  updateProductHandler,
  deleteProductHandler
} = require('../controllers/productController');
const { getAdminSettingsHandler, updateSettingsHandler } = require('../controllers/settingsController');
const { getAuditLogsHandler } = require('../controllers/auditController');
const {
  getOrdersHandler,
  getOrderByIdHandler,
  updateOrderStatusHandler,
  updateOrderShippingHandler
} = require('../controllers/orderController');
const {
  getProductionQueueHandler,
  updateProductionStatusHandler
} = require('../controllers/productionController');
const {
  getCustomDesignsByOrderItemHandler,
  uploadCustomDesignHandler,
  verifyCustomDesignHandler,
  downloadCustomDesignFileHandler
} = require('../controllers/customDesignController');
const {
  getCustomersHandler,
  getCustomerByIdHandler
} = require('../controllers/customerController');
const {
  getEventsHandler,
  getEventByIdHandler,
  createEventHandler,
  updateEventHandler,
  deleteEventHandler
} = require('../controllers/eventController');
const {
  getCouponsHandler,
  getCouponByIdHandler,
  createCouponHandler,
  updateCouponHandler,
  deleteCouponHandler
} = require('../controllers/couponController');
const {
  getShippingRulesHandler,
  getShippingRuleByIdHandler,
  createShippingRuleHandler,
  updateShippingRuleHandler,
  deleteShippingRuleHandler,
  calculateShippingFeeHandler
} = require('../controllers/shippingController');
const {
  getStoreBuilderAdminHandler,
  updateStoreBuilderAdminHandler
} = require('../controllers/storeBuilderController');
const {
  getReviewsHandler,
  getReviewByIdHandler,
  updateReviewHandler
} = require('../controllers/reviewController');

const router = express.Router();

// Apply Authentication and Admin Authorization Middleware to all admin routes
router.use(verifyFirebaseToken);
router.use(requireAdmin);

// Admin Dashboard Overview
router.get('/dashboard', getAdminDashboardHandler);

// Audit Logs Retrieval
router.get('/audit-logs', getAuditLogsHandler);

// Customer Reviews Management & Moderation
router.get('/reviews', getReviewsHandler);
router.get('/reviews/:id', getReviewByIdHandler);
router.put('/reviews/:id', updateReviewHandler);
router.patch('/reviews/:id/status', updateReviewHandler);

// Shipping Rules & Rates Management
router.get('/shipping-rules', getShippingRulesHandler);
router.get('/shipping-rules/:id', getShippingRuleByIdHandler);
router.post('/shipping-rules', createShippingRuleHandler);
router.put('/shipping-rules/:id', updateShippingRuleHandler);
router.delete('/shipping-rules/:id', deleteShippingRuleHandler);
router.post('/shipping-rules/calculate', calculateShippingFeeHandler);

// Store Builder Management (Admin)
router.get('/store-builder', getStoreBuilderAdminHandler);
router.put('/store-builder', updateStoreBuilderAdminHandler);

// Promotional Events & Sales Management
router.get('/events', getEventsHandler);
router.get('/events/:id', getEventByIdHandler);
router.post('/events', createEventHandler);
router.put('/events/:id', updateEventHandler);
router.delete('/events/:id', deleteEventHandler);

// Coupons & Promotional Code Management
router.get('/coupons', getCouponsHandler);
router.get('/coupons/:id', getCouponByIdHandler);
router.post('/coupons', createCouponHandler);
router.put('/coupons/:id', updateCouponHandler);
router.delete('/coupons/:id', deleteCouponHandler);

// Customer Management & Derived Loyalty Metrics
router.get('/customers', getCustomersHandler);
router.get('/customers/:id', getCustomerByIdHandler);

// POD Production Queue Management
router.get('/production/queue', getProductionQueueHandler);
router.get('/production-queue', getProductionQueueHandler);
router.put('/production/queue/items/:itemId/status', updateProductionStatusHandler);
router.patch('/production/queue/items/:itemId/status', updateProductionStatusHandler);
router.patch('/production-queue/items/:itemId/status', updateProductionStatusHandler);

// Custom Print Artwork Management
router.get('/custom-designs/items/:orderItemId', getCustomDesignsByOrderItemHandler);
router.post('/custom-designs/items/:orderItemId', uploadCustomArtwork.single('file'), uploadCustomDesignHandler);
router.put('/custom-designs/:designId/verify', verifyCustomDesignHandler);
router.patch('/custom-designs/:designId/verify', verifyCustomDesignHandler);
router.get('/custom-designs/file/:filename', downloadCustomDesignFileHandler);

// Order & Shipping Tracking Management
router.get('/orders', getOrdersHandler);
router.get('/orders/:id', getOrderByIdHandler);
router.put('/orders/:id/status', updateOrderStatusHandler);
router.patch('/orders/:id/status', updateOrderStatusHandler);
router.put('/orders/:id/shipping', updateOrderShippingHandler);
router.post('/orders/:id/ship', updateOrderShippingHandler);

// Generic Admin File Upload (Hostinger Storage)
router.post('/upload', (req, res, next) => {
  uploadProductImage.fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }])(req, res, (err) => {
    if (err) return next(err);
    const uploadedFile = (req.files && req.files.file && req.files.file[0]) || (req.files && req.files.image && req.files.image[0]);
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${uploadedFile.filename}`;
    return res.status(200).json({
      success: true,
      data: {
        filename: uploadedFile.filename,
        url: fileUrl,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      },
      message: 'File uploaded successfully'
    });
  });
});

// Team Members Management
router.get('/team', getTeamMembersHandler);
router.post('/team', createTeamMemberHandler);
router.put('/team/:id/status', updateTeamMemberStatusHandler);
router.patch('/team/:id/status', updateTeamMemberStatusHandler);

// Category Management CRUD
router.post('/categories', uploadProductImage.single('image'), createCategoryHandler);
router.put('/categories/:id', uploadProductImage.single('image'), updateCategoryHandler);
router.delete('/categories/:id', deleteCategoryHandler);

// Product Management CRUD
router.get('/products', getProductsHandler);
router.get('/products/:id', getProductByIdHandler);
router.post('/products', uploadProductImage.single('image'), createProductHandler);
router.put('/products/:id', uploadProductImage.single('image'), updateProductHandler);
router.delete('/products/:id', deleteProductHandler);

// Site Settings Management
router.get('/settings', getAdminSettingsHandler);
router.put('/settings', updateSettingsHandler);

module.exports = router;
