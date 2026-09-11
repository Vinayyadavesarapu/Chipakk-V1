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
    let [rows] = await pool.execute(
      'SELECT id, firebase_uid, email, role, active FROM admins WHERE (firebase_uid = ? OR (email IS NOT NULL AND LOWER(email) = LOWER(?))) AND active = 1 LIMIT 1',
      [req.user.uid, req.user.email || '']
    );

    // Bootstrap first admin if admins table is completely empty
    if (!rows || rows.length === 0) {
      const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM admins');
      if (countRows[0].total === 0 && req.user.email) {
        await pool.execute(
          'INSERT INTO admins (firebase_uid, email, role, active) VALUES (?, ?, "super_admin", 1)',
          [req.user.uid, req.user.email.toLowerCase()]
        );
        const [newAdmin] = await pool.execute('SELECT id, firebase_uid, email, role, active FROM admins WHERE firebase_uid = ? LIMIT 1', [req.user.uid]);
        rows = newAdmin;
      }
    }

    if (!rows || rows.length === 0) {
      return sendError(res, 'Access denied. Administrative privileges required.', 403);
    }

    // If admin matched by email but had a placeholder/pending UID, bind actual firebase_uid
    if (rows[0].firebase_uid !== req.user.uid) {
      await pool.execute('UPDATE admins SET firebase_uid = ? WHERE id = ?', [req.user.uid, rows[0].id]).catch(() => {});
      rows[0].firebase_uid = req.user.uid;
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
