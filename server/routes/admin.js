const express = require('express');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/auth');
const { uploadProductImage, uploadCustomArtwork } = require('../middleware/upload');
const {
  getAdminDashboardHandler,
  getTeamMembersHandler,
  updateTeamMemberStatusHandler,
  createTeamMemberHandler,
  recordAdminLoginHandler,
  recordAdminLogoutHandler,
  getActiveSessionsHandler,
  recordAdminActivityHandler,
  terminateSessionHandler
} = require('../controllers/adminController');
const {
  getCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  deleteCategoryHandler,
  getAdminExperiencesHandler,
  setCategoryExperienceHandler,
  setCategoryMediaHandler
} = require('../controllers/categoryController');
const {
  getProductsHandler,
  getProductByIdHandler,
  createProductHandler,
  updateProductHandler,
  deleteProductHandler,
  deleteProductImageHandler
} = require('../controllers/productController');
const { getAdminSettingsHandler, updateSettingsHandler } = require('../controllers/settingsController');
const { getTaxProfileHandler, getLegalSupplierHandler, saveLegalSupplierHandler, issueInvoiceHandler, getInvoiceHandler } = require('../controllers/taxController');
const { getAuditLogsHandler } = require('../controllers/auditController');
const {
  getAdminNotificationsHandler,
  markNotificationReadHandler
} = require('../controllers/notificationController');
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
  calculateShippingFeeHandler,
  getStoreShippingConfigHandler,
  updateStoreShippingConfigHandler
} = require('../controllers/shippingController');
const {
  getMaterialsHandler,
  getMaterialByIdHandler,
  createMaterialHandler,
  updateMaterialHandler,
  adjustStockHandler,
  deleteMaterialHandler
} = require('../controllers/materialsController');
const {
  getFinishingOptionsHandler,
  getFinishingOptionByIdHandler,
  createFinishingOptionHandler,
  updateFinishingOptionHandler,
  deleteFinishingOptionHandler
} = require('../controllers/finishingController');
const {
  getProductionJobsHandler,
  getProductionJobByIdHandler,
  createProductionJobHandler,
  updateProductionJobStageHandler,
  advanceProductionJobStageHandler
} = require('../controllers/productionJobController');
const {
  getCustomRequestsHandler,
  getCustomRequestByIdHandler,
  createCustomRequestHandler,
  updateCustomRequestStatusHandler,
  setCustomRequestQuoteHandler,
  convertCustomRequestToOrderHandler
} = require('../controllers/customRequestController');
const {
  getReviewsHandler,
  getReviewByIdHandler,
  updateReviewHandler
} = require('../controllers/reviewController');

const router = express.Router();

// Allow beacon logout without blocking on token expiration
router.post('/auth/logout-event', recordAdminLogoutHandler);

// Apply Authentication and Admin Authorization Middleware to all protected admin routes
router.use(verifyFirebaseToken);
router.use(requireAdmin);

// Admin Auth Audit Events
router.post('/auth/login-event', recordAdminLoginHandler);

// Admin Dashboard Overview
router.get('/dashboard', getAdminDashboardHandler);

// Admin Notifications
router.get('/notifications', getAdminNotificationsHandler);
router.post('/notifications/mark-read', markNotificationReadHandler);

// Audit Logs Retrieval
router.get('/audit-logs', getAuditLogsHandler);

// Active Admin Sessions & Live Activity
router.get('/active-sessions', getActiveSessionsHandler);
router.post('/auth/activity', recordAdminActivityHandler);
router.post('/active-sessions/:id/terminate', terminateSessionHandler);

// Customer Reviews Management & Moderation
router.get('/reviews', getReviewsHandler);
router.get('/reviews/:id', getReviewByIdHandler);
router.put('/reviews/:id', updateReviewHandler);
router.patch('/reviews/:id/status', updateReviewHandler);

// Consolidated Store Shipping Management
router.get('/shipping/config', getStoreShippingConfigHandler);
router.put('/shipping/config', updateStoreShippingConfigHandler);
router.get('/shipping-rules', getShippingRulesHandler);
router.get('/shipping-rules/:id', getShippingRuleByIdHandler);
router.post('/shipping-rules', createShippingRuleHandler);
router.put('/shipping-rules/:id', updateShippingRuleHandler);
router.delete('/shipping-rules/:id', deleteShippingRuleHandler);
router.post('/shipping-rules/calculate', calculateShippingFeeHandler);

// Flexible Materials Management (THE MARSHANS)
router.get('/materials', getMaterialsHandler);
router.get('/materials/:id', getMaterialByIdHandler);
router.post('/materials', createMaterialHandler);
router.put('/materials/:id', updateMaterialHandler);
router.patch('/materials/:id/stock', adjustStockHandler);
router.delete('/materials/:id', deleteMaterialHandler);

// Finishing Options Management (THE MARSHANS)
router.get('/finishing-options', getFinishingOptionsHandler);
router.get('/finishing-options/:id', getFinishingOptionByIdHandler);
router.post('/finishing-options', createFinishingOptionHandler);
router.put('/finishing-options/:id', updateFinishingOptionHandler);
router.delete('/finishing-options/:id', deleteFinishingOptionHandler);

// Production Jobs V1 7-Stage Workflow (THE MARSHANS)
router.get('/production-jobs', getProductionJobsHandler);
router.get('/production-jobs/:id', getProductionJobByIdHandler);
router.post('/production-jobs', createProductionJobHandler);
router.put('/production-jobs/:id/stage', updateProductionJobStageHandler);
router.patch('/production-jobs/:id/stage', updateProductionJobStageHandler);
router.post('/production-jobs/:id/advance', advanceProductionJobStageHandler);

// Custom 3D Requests 5-Stage Workflow (THE MARSHANS)
router.get('/custom-requests', getCustomRequestsHandler);
router.get('/custom-requests/:id', getCustomRequestByIdHandler);
router.post('/custom-requests', createCustomRequestHandler);
router.put('/custom-requests/:id/status', updateCustomRequestStatusHandler);
router.patch('/custom-requests/:id/status', updateCustomRequestStatusHandler);
router.put('/custom-requests/:id/quote', setCustomRequestQuoteHandler);
router.post('/custom-requests/:id/convert-to-order', convertCustomRequestToOrderHandler);

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
router.get('/categories', getCategoriesHandler);
router.get('/experiences', getAdminExperiencesHandler);
router.post('/categories', uploadProductImage.single('image'), createCategoryHandler);
router.put('/categories/:id', uploadProductImage.single('image'), updateCategoryHandler);
router.delete('/categories/:id', deleteCategoryHandler);
router.post('/categories/:id/experience', setCategoryExperienceHandler);
router.put('/categories/:id/experience', setCategoryExperienceHandler);
router.post('/categories/:id/media', uploadProductImage.single('image'), setCategoryMediaHandler);

// Product Management CRUD
router.get('/products', getProductsHandler);
router.get('/products/:id', getProductByIdHandler);
router.post('/products', uploadProductImage.single('image'), createProductHandler);
router.put('/products/:id', uploadProductImage.single('image'), updateProductHandler);
router.delete('/products/:id', deleteProductHandler);
router.delete('/products/:productId/images/:imageId', deleteProductImageHandler);

// GST: shared legal supplier, resolved tax profile, invoices
router.get('/tax-profile', getTaxProfileHandler);
router.get('/legal-supplier', getLegalSupplierHandler);
router.put('/legal-supplier', saveLegalSupplierHandler);
router.post('/orders/:id/invoice', issueInvoiceHandler);
router.get('/orders/:id/invoice', getInvoiceHandler);

// Site Settings Management
router.get('/settings', getAdminSettingsHandler);
router.put('/settings', updateSettingsHandler);

module.exports = router;
