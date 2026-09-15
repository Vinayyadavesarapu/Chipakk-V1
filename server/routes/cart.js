const express = require('express');
const { getAuth } = require('../config/firebase');
const { sendError } = require('../utils/responseHandler');
const {
  getCartHandler,
  addItemHandler,
  updateItemHandler,
  removeItemHandler,
  clearCartHandler
} = require('../controllers/cartController');

const router = express.Router();

/**
 * Optional authentication middleware:
 * Populates req.user if a valid Bearer token is provided.
 * If no token is provided, request continues with session ID.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1]?.trim();
    if (token) {
      try {
        const auth = getAuth();
        const decoded = await auth.verifyIdToken(token);
        req.user = {
          uid: decoded.uid,
          email: decoded.email || null,
          emailVerified: decoded.email_verified || false,
          token: decoded
        };
      } catch (err) {
        return sendError(res, 'Invalid or expired authentication token', 401);
      }
    }
  }
  return next();
};

router.use(optionalAuth);

// Cart REST Endpoints
router.get('/', getCartHandler);
router.post('/items', addItemHandler);
router.patch('/items/:id', updateItemHandler);
router.delete('/items/:id', removeItemHandler);
router.delete('/', clearCartHandler);

module.exports = router;
