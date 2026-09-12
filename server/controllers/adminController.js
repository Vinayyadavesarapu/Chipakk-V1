const { pool } = require('../config/database');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { getAuth } = require('../config/firebase');

/**
 * Get Admin Dashboard Overview Metrics
 * GET /api/admin/dashboard
 */
const getAdminDashboardHandler = async (req, res, next) => {
  try {
    // 1. Total Products Count
    const [prodRows] = await pool.execute('SELECT COUNT(*) AS total FROM products');
    const totalProducts = prodRows[0].total || 0;

    // 2. Total Categories Count
    const [catRows] = await pool.execute('SELECT COUNT(*) AS total FROM categories');
    const totalCategories = catRows[0].total || 0;

    // 3. Total Orders Count & Revenue Sum (in paise)
    const [orderRows] = await pool.execute('SELECT COUNT(*) AS total, COALESCE(SUM(total_price), 0) AS total_revenue FROM orders');
    const totalOrders = orderRows[0].total || 0;
    const totalRevenuePaise = parseInt(orderRows[0].total_revenue, 10) || 0;
    const totalRevenueRupees = Math.round(totalRevenuePaise / 100);
    const averageOrderValueRupees = totalOrders > 0 ? Math.round(totalRevenueRupees / totalOrders) : 0;

    // 4. Total Registered Users Count
    const [userRows] = await pool.execute('SELECT COUNT(*) AS total FROM users');
    const totalUsers = userRows[0].total || 0;

    // 5. Low Stock Count (stock <= 10)
    const [stockRows] = await pool.execute('SELECT COUNT(*) AS total FROM inventory WHERE stock <= 10');
    const lowStockCount = stockRows[0].total || 0;

    // 6. Monthly historical sales and order volume (last 6 months chronological)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const monthlyStats = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
      monthlyStats.push({
        monthKey,
        month: monthNames[m],
        year: y,
        label: `${monthNames[m]} ${y}`,
        revenue: 0,
        orders: 0
      });
    }

    try {
      const [monthlyRows] = await pool.execute(`
        SELECT 
          DATE_FORMAT(created_at, '%Y-%m') AS month_key,
          COALESCE(SUM(CASE WHEN fulfillment_status != 'cancelled' THEN total_price ELSE 0 END), 0) AS revenue_paise,
          COUNT(CASE WHEN fulfillment_status != 'cancelled' THEN 1 ELSE NULL END) AS order_count
        FROM orders
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        GROUP BY month_key
        ORDER BY month_key ASC
      `);

      monthlyRows.forEach(row => {
        const match = monthlyStats.find(s => s.monthKey === row.month_key);
        if (match) {
          const revPaise = parseInt(row.revenue_paise, 10) || 0;
          match.revenue = Math.round(revPaise / 100);
          match.orders = parseInt(row.order_count, 10) || 0;
        }
      });
    } catch (chartErr) {
      console.warn('[Dashboard Monthly Stats Warning]', chartErr.message);
    }

    return sendSuccess(res, {
      admin: {
        id: req.admin.id,
        email: req.admin.email,
        role: req.admin.role,
        firebase_uid: req.admin.firebase_uid
      },
      metrics: {
        totalProducts,
        totalCategories,
        totalOrders,
        totalRevenue: totalRevenueRupees,
        averageOrderWorth: averageOrderValueRupees,
        totalUsers,
        lowStockCount,
        monthlyStats
      },
      status: 'authenticated',
      message: 'Admin authorization verified successfully'
    }, 'Admin dashboard data');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Team Members Handler
 * GET /api/admin/team
 */
const getTeamMembersHandler = async (req, res, next) => {
  try {
    let [rows] = await pool.execute(`
      SELECT id, firebase_uid, email, role, active, created_at, updated_at
      FROM admins
      ORDER BY id ASC
    `);

    // If authenticated admin is calling, ensure their record exists in MySQL admins table
    if (req.user && req.user.uid && req.user.email) {
      const selfUid = req.user.uid;
      const selfEmail = req.user.email.toLowerCase();
      const existingSelf = rows.find(r => r.firebase_uid === selfUid || r.email.toLowerCase() === selfEmail);
      if (!existingSelf) {
        const isFirstAdmin = rows.length === 0;
        await pool.execute(
          'INSERT INTO admins (firebase_uid, email, role, active) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE email = VALUES(email)',
          [selfUid, selfEmail, isFirstAdmin ? 'super_admin' : 'admin']
        ).catch(() => {});

        const [refreshedRows] = await pool.execute(`
          SELECT id, firebase_uid, email, role, active, created_at, updated_at
          FROM admins
          ORDER BY id ASC
        `);
        rows = refreshedRows;
      }
    }

    // Connect to Firebase Authentication if available to discover team members without overwriting
    try {
      const auth = getAuth();
      if (auth && typeof auth.listUsers === 'function') {
        const listResult = await auth.listUsers(100);
        let insertedAny = false;
        for (const u of listResult.users) {
          if (!u.email) continue;
          const userEmail = u.email.toLowerCase();
          const match = rows.find(r => r.firebase_uid === u.uid || r.email.toLowerCase() === userEmail);
          if (!match) {
            await pool.execute(
              'INSERT INTO admins (firebase_uid, email, role, active) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE email = VALUES(email)',
              [u.uid, userEmail, 'admin']
            ).catch(() => {});
            insertedAny = true;
          }
        }
        if (insertedAny) {
          const [mergedRows] = await pool.execute(`
            SELECT id, firebase_uid, email, role, active, created_at, updated_at
            FROM admins
            ORDER BY id ASC
          `);
          rows = mergedRows;
        }
      }
    } catch (fbErr) {
      // Non-fatal if listUsers is not permitted or offline
    }

    const team = rows.map(a => {
      const emailPrefix = (a.email || '').split('@')[0];
      const formattedName = emailPrefix
        .split(/[._-]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Admin';

      const isSuper = a.role === 'super_admin';
      return {
        id: a.id,
        name: formattedName,
        email: a.email,
        role: isSuper ? 'SUPER ADMIN' : 'ADMIN',
        permissions: isSuper ? ['Full Access'] : ['Catalog', 'Orders', 'Production', 'Operations'],
        active: a.active === 1 || a.active === true,
        firebase_uid: a.firebase_uid,
        created_at: a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
      };
    });

    return sendSuccess(res, { team, count: team.length }, 'Team members retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Team Member Status / Role
 * PUT /api/admin/team/:id/status
 */
const updateTeamMemberStatusHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { active, role } = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid team member ID format.', 400);
    }

    const [existingRows] = await pool.execute('SELECT id, email, role, active FROM admins WHERE id = ? LIMIT 1', [numId]);
    if (existingRows.length === 0) {
      return sendError(res, `Team member with ID ${id} not found.`, 404);
    }

    const existing = existingRows[0];

    // Safety guard: Prevents admin from deactivating their own active account
    if (req.admin && req.admin.id === numId && active === false) {
      return sendError(res, 'You cannot deactivate your own administrative account.', 400);
    }

    const updates = [];
    const params = [];

    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }

    if (role !== undefined) {
      const normalizedRole = String(role).toLowerCase().includes('super') ? 'super_admin' : 'admin';
      updates.push('role = ?');
      params.push(normalizedRole);
    }

    if (updates.length > 0) {
      const query = `UPDATE admins SET ${updates.join(', ')} WHERE id = ?`;
      params.push(numId);
      await pool.execute(query, params);
    }

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'team.status_updated',
        'admin',
        numId,
        { email: existing.email, active: active !== undefined ? active : existing.active, role }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    const [updatedRows] = await pool.execute('SELECT id, firebase_uid, email, role, active, created_at FROM admins WHERE id = ?', [numId]);
    const updated = updatedRows[0];

    return sendSuccess(res, {
      id: updated.id,
      email: updated.email,
      role: updated.role === 'super_admin' ? 'SUPER ADMIN' : 'ADMIN',
      active: updated.active === 1 || updated.active === true
    }, 'Team member updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create / Invite Team Member
 * POST /api/admin/team
 */
const createTeamMemberHandler = async (req, res, next) => {
  try {
    const { email, role, firebase_uid } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return sendError(res, 'Valid email address is required.', 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRole = String(role || '').toLowerCase().includes('super') ? 'super_admin' : 'admin';
    const safeUid = firebase_uid && String(firebase_uid).trim() ? String(firebase_uid).trim() : `pending_${Date.now()}`;
    let finalUid = safeUid;

    try {
      const auth = getAuth();
      if (auth && typeof auth.getUserByEmail === 'function') {
        const fbUser = await auth.getUserByEmail(normalizedEmail);
        if (fbUser && fbUser.uid) {
          finalUid = fbUser.uid;
        }
      }
    } catch (_) {}

    // Check duplicate
    const [dup] = await pool.execute('SELECT id FROM admins WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (dup.length > 0) {
      return sendError(res, `An admin account with email '${normalizedEmail}' already exists.`, 400);
    }

    const [result] = await pool.execute(
      'INSERT INTO admins (firebase_uid, email, role, active) VALUES (?, ?, ?, 1)',
      [finalUid, normalizedEmail, normalizedRole]
    );

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'team.member_created',
        'admin',
        result.insertId,
        { email: normalizedEmail, role: normalizedRole }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, {
      id: result.insertId,
      email: normalizedEmail,
      role: normalizedRole === 'super_admin' ? 'SUPER ADMIN' : 'ADMIN',
      active: true
    }, 'Team member added successfully', 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(res, 'An admin account with this email or UID already exists.', 400);
    }
    return next(error);
  }
};

/**
 * Ensure admin_sessions table exists in MySQL database
 */
const ensureSessionTable = async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS \`admin_sessions\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT,
        \`session_id\` VARCHAR(128) NOT NULL,
        \`firebase_uid\` VARCHAR(128) NOT NULL,
        \`email\` VARCHAR(255) NOT NULL,
        \`admin_name\` VARCHAR(255) DEFAULT NULL,
        \`role\` VARCHAR(50) NOT NULL DEFAULT 'ADMIN',
        \`ip_address\` VARCHAR(100) DEFAULT NULL,
        \`user_agent\` TEXT DEFAULT NULL,
        \`login_time\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`last_activity\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`status\` ENUM('active', 'logged_out', 'expired') NOT NULL DEFAULT 'active',
        \`expires_at\` DATETIME NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_admin_sessions_session_id\` (\`session_id\`),
        KEY \`idx_admin_sessions_uid\` (\`firebase_uid\`),
        KEY \`idx_admin_sessions_status\` (\`status\`),
        KEY \`idx_admin_sessions_last_activity\` (\`last_activity\`),
        KEY \`idx_admin_sessions_expires_at\` (\`expires_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (err) {
    console.error('[ensureSessionTable Error]', err.message);
  }
};

/**
 * Record Admin Login Audit Event & Active Database Session
 * POST /api/admin/auth/login-event
 */
const recordAdminLoginHandler = async (req, res, next) => {
  try {
    await ensureSessionTable();

    const actorId = req.admin ? req.admin.firebase_uid : (req.user ? req.user.uid : 'UNKNOWN_ADMIN');
    const actorEmail = req.admin ? req.admin.email : (req.user ? req.user.email : 'admin@chipakk.shop');
    const adminId = req.admin ? req.admin.id : null;
    const adminRole = req.admin ? (req.admin.role === 'super_admin' ? 'SUPER ADMIN' : 'ADMIN') : 'ADMIN';

    const emailPrefix = (actorEmail || '').split('@')[0];
    const formattedName = emailPrefix
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Admin';

    const clientSessionId = req.body?.session_id || req.headers['x-session-id'] || `sess_${actorId.slice(0, 10)}_${Date.now()}`;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    // Upsert active session record (reuses existing session_id if supplied by persistent client)
    await pool.execute(`
      INSERT INTO admin_sessions (session_id, firebase_uid, email, admin_name, role, ip_address, user_agent, login_time, last_activity, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 'active', DATE_ADD(NOW(), INTERVAL 1 HOUR))
      ON DUPLICATE KEY UPDATE
        firebase_uid = VALUES(firebase_uid),
        email = VALUES(email),
        admin_name = VALUES(admin_name),
        role = VALUES(role),
        status = 'active',
        last_activity = NOW(),
        expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR),
        ip_address = VALUES(ip_address),
        user_agent = VALUES(user_agent)
    `, [
      clientSessionId,
      actorId,
      actorEmail,
      formattedName,
      adminRole,
      ipAddress,
      userAgent
    ]).catch(err => console.warn('[Admin Login Session Warn]', err.message));

    await writeAuditLog(
      actorId,
      actorEmail,
      'admin.login',
      'admins',
      adminId,
      {
        session_id: clientSessionId,
        ip: ipAddress,
        userAgent: userAgent,
        timestamp: new Date().toISOString()
      }
    );

    return sendSuccess(res, { logged: true, session_id: clientSessionId }, 'Admin login audit event and session recorded');
  } catch (error) {
    return next(error);
  }
};

/**
 * Record Admin Logout Audit Event & Invalidate Session
 * POST /api/admin/auth/logout-event
 */
const recordAdminLogoutHandler = async (req, res, next) => {
  try {
    await ensureSessionTable();

    const actorId = req.admin ? req.admin.firebase_uid : (req.body?.uid || (req.user ? req.user.uid : null));
    const actorEmail = req.admin ? req.admin.email : (req.body?.email || (req.user ? req.user.email : null));
    const adminId = req.admin ? req.admin.id : null;
    const reason = req.body?.reason || 'user_action';
    const sessionId = req.body?.session_id || req.headers['x-session-id'];

    const newStatus = reason === 'inactivity_timeout' ? 'expired' : 'logged_out';

    if (sessionId && actorId) {
      await pool.execute(
        'UPDATE admin_sessions SET status = ?, updated_at = NOW() WHERE session_id = ? AND firebase_uid = ?',
        [newStatus, sessionId, actorId]
      ).catch(() => {});
    } else if (sessionId) {
      await pool.execute(
        'UPDATE admin_sessions SET status = ?, updated_at = NOW() WHERE session_id = ?',
        [newStatus, sessionId]
      ).catch(() => {});
    } else if (actorId) {
      await pool.execute(
        'UPDATE admin_sessions SET status = ?, updated_at = NOW() WHERE firebase_uid = ? AND status = "active"',
        [newStatus, actorId]
      ).catch(() => {});
    }

    if (actorId) {
      await writeAuditLog(
        actorId,
        actorEmail,
        reason === 'inactivity_timeout' ? 'admin.session_expired' : 'admin.logout',
        'admins',
        adminId,
        {
          reason,
          session_id: sessionId || null,
          ip: req.ip || req.headers['x-forwarded-for'] || null,
          timestamp: new Date().toISOString()
        }
      );
    }

    return sendSuccess(res, { logged: true }, 'Admin logout audit event recorded');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Active Admin Sessions
 * GET /api/admin/active-sessions
 */
const getActiveSessionsHandler = async (req, res, next) => {
  try {
    await ensureSessionTable();

    // Expire any sessions past the 1-hour inactivity threshold
    await pool.execute(`
      UPDATE admin_sessions
      SET status = 'expired'
      WHERE status = 'active' AND expires_at <= NOW()
    `).catch(() => {});

    // Ensure the currently calling authenticated admin has an active session without duplicating
    if (req.user && req.user.uid) {
      const currentUid = req.user.uid;
      const currentEmail = req.user.email || 'admin@chipakk.shop';
      const currentRole = req.admin ? (req.admin.role === 'super_admin' ? 'SUPER ADMIN' : 'ADMIN') : 'ADMIN';
      const namePrefix = currentEmail.split('@')[0];
      const currentName = namePrefix.split(/[._-]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || 'Admin';
      const callerSessionId = req.headers['x-session-id'] || req.query?.session_id;

      if (callerSessionId) {
        const [updated] = await pool.execute(
          'UPDATE admin_sessions SET last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE session_id = ? AND firebase_uid = ? AND status = "active"',
          [callerSessionId, currentUid]
        ).catch(() => [{ affectedRows: 0 }]);

        if (updated && updated.affectedRows === 0) {
          await pool.execute(`
            INSERT INTO admin_sessions (session_id, firebase_uid, email, admin_name, role, ip_address, user_agent, login_time, last_activity, status, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 'active', DATE_ADD(NOW(), INTERVAL 1 HOUR))
            ON DUPLICATE KEY UPDATE status = 'active', last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR)
          `, [
            callerSessionId,
            currentUid,
            currentEmail,
            currentName,
            currentRole,
            req.ip || req.headers['x-forwarded-for'] || null,
            req.headers['user-agent'] || null
          ]).catch(() => {});
        }
      } else {
        const [existingActive] = await pool.execute(
          'SELECT id FROM admin_sessions WHERE firebase_uid = ? AND status = "active" AND expires_at > NOW() ORDER BY last_activity DESC LIMIT 1',
          [currentUid]
        );

        if (existingActive.length === 0) {
          const autoSessId = `sess_${currentUid.slice(0, 10)}_${Date.now()}`;
          await pool.execute(`
            INSERT INTO admin_sessions (session_id, firebase_uid, email, admin_name, role, ip_address, user_agent, login_time, last_activity, status, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 'active', DATE_ADD(NOW(), INTERVAL 1 HOUR))
          `, [
            autoSessId,
            currentUid,
            currentEmail,
            currentName,
            currentRole,
            req.ip || req.headers['x-forwarded-for'] || null,
            req.headers['user-agent'] || null
          ]).catch(() => {});
        } else {
          await pool.execute(
            'UPDATE admin_sessions SET last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
            [existingActive[0].id]
          ).catch(() => {});
        }
      }
    }

    // Query all active database sessions
    const [rows] = await pool.execute(`
      SELECT 
        id, session_id, firebase_uid, email, admin_name, role, ip_address, user_agent,
        login_time, last_activity, status, expires_at, created_at
      FROM admin_sessions
      WHERE status = 'active' AND expires_at > NOW()
      ORDER BY last_activity DESC
    `);

    const sessions = rows.map(s => ({
      id: s.id,
      session_id: s.session_id,
      firebase_uid: s.firebase_uid,
      name: s.admin_name || s.email.split('@')[0],
      email: s.email,
      role: s.role,
      login_time: s.login_time ? new Date(s.login_time).toISOString() : null,
      last_activity: s.last_activity ? new Date(s.last_activity).toISOString() : null,
      status: s.status === 'active' ? 'ACTIVE' : (s.status === 'expired' ? 'EXPIRED' : 'LOGGED OUT'),
      expires_at: s.expires_at ? new Date(s.expires_at).toISOString() : null,
      ip_address: s.ip_address || 'Localhost',
      is_current: req.user && req.user.uid === s.firebase_uid
    }));

    return sendSuccess(res, {
      sessions,
      total_active: sessions.length
    }, 'Active admin sessions retrieved successfully');
  } catch (error) {
    console.warn('[Active Sessions Optional Handler Fallback]', error.message);
    return sendSuccess(res, { sessions: [], total_active: 0 }, 'Active sessions fallback');
  }
};

/**
 * Record Real-time Admin Activity Heartbeat
 * POST /api/admin/auth/activity
 */
const recordAdminActivityHandler = async (req, res, next) => {
  try {
    await ensureSessionTable();
    if (req.user && req.user.uid) {
      await pool.execute(`
        UPDATE admin_sessions
        SET last_activity = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR)
        WHERE firebase_uid = ? AND status = 'active'
      `, [req.user.uid]).catch(() => {});
    }
    return sendSuccess(res, { active: true }, 'Activity heartbeat recorded');
  } catch (error) {
    return next(error);
  }
};

/**
 * Force Terminate / Revoke Admin Session
 * POST /api/admin/active-sessions/:id/terminate
 */
const terminateSessionHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid session ID format.', 400);
    }

    const [rows] = await pool.execute('SELECT id, session_id, firebase_uid, email FROM admin_sessions WHERE id = ?', [numId]);
    if (rows.length === 0) {
      return sendError(res, 'Session not found.', 404);
    }

    await pool.execute(
      'UPDATE admin_sessions SET status = "logged_out", updated_at = NOW() WHERE id = ?',
      [numId]
    );

    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'admin.session_terminated',
        'admin_sessions',
        numId,
        { terminated_email: rows[0].email, terminated_uid: rows[0].firebase_uid }
      ).catch(() => {});
    }

    return sendSuccess(res, { terminated: true }, 'Session terminated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getAdminDashboardHandler,
  getTeamMembersHandler,
  updateTeamMemberStatusHandler,
  createTeamMemberHandler,
  recordAdminLoginHandler,
  recordAdminLogoutHandler,
  getActiveSessionsHandler,
  recordAdminActivityHandler,
  terminateSessionHandler
};

