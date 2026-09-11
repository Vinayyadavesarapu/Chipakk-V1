const { pool } = require('../config/database');

/**
 * Get Admin Notifications
 */
const getAdminNotifications = async ({ limit = 20 } = {}) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, type, title, message, link, is_read, created_at FROM admin_notifications ORDER BY created_at DESC, id DESC LIMIT ?',
      [Math.min(parseInt(limit, 10) || 20, 100)]
    );
    const unreadCount = rows.filter(r => !r.is_read).length;
    return { notifications: rows, unread_count: unreadCount };
  } catch (err) {
    // Graceful fallback if migration not yet applied
    return { notifications: [], unread_count: 0 };
  }
};

/**
 * Create Admin Notification
 */
const createNotification = async ({ type = 'system', title, message, link = null }) => {
  if (!title || !message) return null;
  try {
    const [result] = await pool.execute(
      'INSERT INTO admin_notifications (type, title, message, link) VALUES (?, ?, ?, ?)',
      [String(type), String(title), String(message), link ? String(link) : null]
    );
    return { id: result.insertId, type, title, message, link, is_read: 0 };
  } catch (err) {
    console.warn('[Notification Service Error]', err.message);
    return null;
  }
};

/**
 * Mark a single notification as read
 */
const markNotificationRead = async (id) => {
  try {
    await pool.execute('UPDATE admin_notifications SET is_read = 1 WHERE id = ?', [id]);
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Mark all notifications as read
 */
const markAllNotificationsRead = async () => {
  try {
    await pool.execute('UPDATE admin_notifications SET is_read = 1 WHERE is_read = 0');
    return true;
  } catch (err) {
    return false;
  }
};

module.exports = {
  getAdminNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead
};
