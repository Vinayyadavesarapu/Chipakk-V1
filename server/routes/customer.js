const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const { pool } = require('../config/database');
const { sendSuccess } = require('../utils/responseHandler');
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
 * Resolve Customer Identity & Enforce Admin Isolation
 * GET /api/customer/me
 */
router.get('/me', async (req, res, next) => {
  try {
    const firebaseUid = req.user.uid;
    const email = req.user.email || '';

    // Check if authenticated Firebase user is an Administrator
    const [adminRows] = await pool.execute(
      'SELECT id, role FROM admins WHERE (firebase_uid = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?))) AND active = 1 LIMIT 1',
      [firebaseUid, email]
    );

    if (adminRows && adminRows.length > 0) {
      return sendSuccess(res, { is_admin: true, is_customer: false }, 'Authenticated user is an administrator.');
    }

    // Resolve customer profile
    let customer = null;
    const [userRows] = await pool.execute(
      'SELECT id, firebase_uid, name, email, phone FROM users WHERE firebase_uid = ? LIMIT 1',
      [firebaseUid]
    );

    if (userRows && userRows.length > 0) {
      customer = userRows[0];
    } else {
      customer = {
        firebase_uid: firebaseUid,
        email: email,
        name: req.user.token?.name || null
      };
    }

    return sendSuccess(res, { is_admin: false, is_customer: true, customer }, 'Customer identity resolved successfully.');
  } catch (error) {
    return next(error);
  }
});

// Customer Saved Delivery Addresses
router.get('/addresses', getAddressesHandler);
router.post('/addresses', createAddressHandler);
router.put('/addresses/:id', updateAddressHandler);
router.delete('/addresses/:id', deleteAddressHandler);

module.exports = router;
