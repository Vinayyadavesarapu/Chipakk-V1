const { pool } = require('../config/database');
const { sendSuccess } = require('../utils/responseHandler');

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

module.exports = {
  getAdminDashboardHandler
};
