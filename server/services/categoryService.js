const { pool } = require('../config/database');

/**
 * Fetch all categories
 */
const getCategories = async ({ activeOnly = true } = {}) => {
  let query = 'SELECT id, name, slug, description, active, created_at, updated_at FROM categories';
  const params = [];

  if (activeOnly) {
    query += ' WHERE active = ?';
    params.push(1);
  }

  query += ' ORDER BY name ASC';

  const [rows] = await pool.execute(query, params);
  return rows;
};

module.exports = {
  getCategories
};
