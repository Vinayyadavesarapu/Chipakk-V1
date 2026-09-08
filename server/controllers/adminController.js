const { pool } = require('../config/database');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

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
        lowStockCount
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
    const [rows] = await pool.execute(`
      SELECT id, firebase_uid, email, role, active, created_at, updated_at
      FROM admins
      ORDER BY id ASC
    `);

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
        created_at: a.created_at ? a.created_at.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
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

    // Check duplicate
    const [dup] = await pool.execute('SELECT id FROM admins WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (dup.length > 0) {
      return sendError(res, `An admin account with email '${normalizedEmail}' already exists.`, 400);
    }

    const [result] = await pool.execute(
      'INSERT INTO admins (firebase_uid, email, role, active) VALUES (?, ?, ?, 1)',
      [safeUid, normalizedEmail, normalizedRole]
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

module.exports = {
  getAdminDashboardHandler,
  getTeamMembersHandler,
  updateTeamMemberStatusHandler,
  createTeamMemberHandler
};
