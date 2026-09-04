const { getAuth } = require('../config/firebase');
const { pool } = require('../config/database');
const { sendError } = require('../utils/responseHandler');

/**
 * Middleware to verify Firebase ID Token in Authorization header
 * Header format: Authorization: Bearer <token>
 */
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 'Authorization token missing or malformed', 401);
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  if (!idToken) {
    return sendError(res, 'Bearer token value is empty', 401);
  }

  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    
    // Attach authenticated user information to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      emailVerified: decodedToken.email_verified || false,
      token: decodedToken
    };

    return next();
  } catch (error) {
    console.error('[Auth Middleware] Token verification failed:', error.message);
    return sendError(
      res,
      'Invalid or expired authentication token',
      401,
      process.env.NODE_ENV === 'production' ? null : error.message
    );
  }
};

/**
 * Middleware to enforce Admin authorization by checking MySQL admins table
 * Must be executed AFTER verifyFirebaseToken middleware.
 */
const requireAdmin = async (req, res, next) => {
  if (!req.user || !req.user.uid) {
    return sendError(res, 'Authentication required before admin verification', 401);
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, firebase_uid, email, role, active FROM admins WHERE firebase_uid = ? AND active = 1 LIMIT 1',
      [req.user.uid]
    );

    if (!rows || rows.length === 0) {
      return sendError(res, 'Access denied. Administrative privileges required.', 403);
    }

    // Attach verified admin record to request object
    req.admin = rows[0];
    return next();
  } catch (error) {
    console.error('[Admin Authorization Error] MySQL query failed:', error.message);
    return sendError(
      res,
      'Administrative authorization check failed',
      500,
      process.env.NODE_ENV === 'production' ? null : error.message
    );
  }
};

module.exports = {
  verifyFirebaseToken,
  requireAdmin
};
