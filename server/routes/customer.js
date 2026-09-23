const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const { pool } = require('../config/database');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const customerService = require('../services/customerService');
const {
  getAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler
} = require('../controllers/addressController');

const router = express.Router();

// Require authenticated customer session for all customer routes
router.use(verifyFirebaseToken);

/**
 * Resolve Customer Identity
 * Auto-provisions customer in MySQL users table if not yet created.
 * GET /api/customer/me
 *
 * One Firebase identity can hold BOTH roles. is_admin only reports that the identity also appears in `admins`
 * (so the UI can offer an "Open Admin Panel" link); it never replaces or blocks the customer account, and it grants
 * nothing here -- every admin API is still gated separately by requireAdmin.
 */
router.get('/me', async (req, res, next) => {
  try {
    const firebaseUid = req.user.uid;
    const email = req.user.email || '';

    const [adminRows] = await pool.execute(
      'SELECT id, role FROM admins WHERE (firebase_uid = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?))) AND active = 1 LIMIT 1',
      [firebaseUid, email]
    );
    const isAdmin = !!(adminRows && adminRows.length > 0);

    // Resolve or auto-provision customer record in users table (admins included)
    const customer = await customerService.resolveOrCreateCustomer(req.user);

    return sendSuccess(res, { is_admin: isAdmin, is_customer: true, customer }, 'Customer identity resolved successfully.');
  } catch (error) {
    return next(error);
  }
});

/**
 * Update Customer Profile (name, phone)
 * PUT /api/customer/me (alias: PUT /api/customer/profile)
 */
router.put(['/me', '/profile'], async (req, res, next) => {
  try {
    const firebaseUid = req.user.uid;
    const updatedCustomer = await customerService.updateCustomerProfile(firebaseUid, req.body || {});
    return sendSuccess(res, { customer: updatedCustomer }, 'Customer profile updated successfully.');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    return next(error);
  }
});

// Customer Saved Delivery Addresses
router.get('/addresses', getAddressesHandler);
router.post('/addresses', createAddressHandler);
router.put('/addresses/:id', updateAddressHandler);
router.delete('/addresses/:id', deleteAddressHandler);

module.exports = router;
