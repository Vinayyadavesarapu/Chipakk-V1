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

    // Bootstrap the FIRST admin if the admins table is completely empty. This must be an explicit, deliberate
    // action (ALLOW_ADMIN_BOOTSTRAP=true), never something ordinary request traffic can trigger on its own:
    // without this gate, ANY authenticated Firebase user (a customer, an attacker who just signed up) who hits an
    // admin route while the table happens to be empty (a fresh deploy, an accidental DELETE) would be silently
    // promoted to super_admin. Customer authentication must never automatically grant admin access.
    if ((!rows || rows.length === 0) && process.env.ALLOW_ADMIN_BOOTSTRAP === 'true') {
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

/**
 * Middleware to enforce an active, server-verified administrator session
 * from the admin_sessions table.
 * Must be executed AFTER verifyFirebaseToken and requireAdmin.
 */
const requireAdminSession = async (req, res, next) => {
  // Allow login event to establish or register a fresh session
  if (req.path === '/auth/login-event') {
    return next();
  }

  // Header (and body, for the POST endpoints that already send it there) only: a session credential must
  // never be accepted from a URL query string, since query strings end up in server access logs, browser
  // history and the Referer header sent to third-party resources.
  const sessionId = req.headers['x-session-id'] || req.headers['X-Session-ID'] || req.body?.session_id;

  if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
    return sendError(
      res,
      'Admin session ID missing. Please authenticate as administrator.',
      401,
      'ADMIN_SESSION_REQUIRED'
    );
  }

  try {
    const cleanSessionId = sessionId.trim();
    const adminUid = req.admin?.firebase_uid || req.user?.uid;

    if (!adminUid) {
      return sendError(res, 'Authentication required before session verification', 401);
    }

    const [sessions] = await pool.execute(
      'SELECT id, session_id, firebase_uid, email, role, status, expires_at FROM admin_sessions WHERE session_id = ? AND firebase_uid = ? LIMIT 1',
      [cleanSessionId, adminUid]
    );

    if (!sessions || sessions.length === 0) {
      return sendError(
        res,
        'Admin session invalid or not found. Please log in again.',
        401,
        'ADMIN_SESSION_INVALID'
      );
    }

    const session = sessions[0];

    if (session.status !== 'active') {
      return sendError(
        res,
        `Admin session has ended (${session.status}). Please log in again.`,
        401,
        'ADMIN_SESSION_TERMINATED'
      );
    }

    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    if (expiresAt <= now) {
      await pool.execute(
        'UPDATE admin_sessions SET status = "expired", updated_at = NOW() WHERE id = ?',
        [session.id]
      ).catch(() => {});

      return sendError(
        res,
        'Admin session has expired due to inactivity. Please log in again.',
        401,
        'ADMIN_SESSION_EXPIRED'
      );
    }

    // Slide expiration window on active request
    await pool.execute(
      'UPDATE admin_sessions SET last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
      [session.id]
    ).catch(() => {});

    req.adminSession = session;
    return next();
  } catch (error) {
    console.error('[Admin Session Middleware Error]:', error.message);
    return sendError(
      res,
      'Admin session verification failed',
      500,
      process.env.NODE_ENV === 'production' ? null : error.message
    );
  }
};

module.exports = {
  verifyFirebaseToken,
  requireAdmin,
  requireAdminSession
};
