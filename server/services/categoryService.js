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

/**
 * Create a new category
 */
const createCategory = async ({ name, slug, description, active = 1 }) => {
  if (!name || typeof name !== 'string') {
    throw new Error('Category name is required');
  }

  const catSlug = (slug || name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const query = `
    INSERT INTO categories (name, slug, description, active)
    VALUES (?, ?, ?, ?)
  `;

  const [result] = await pool.execute(query, [name.trim(), catSlug, description || null, active ? 1 : 0]);

  return {
    id: result.insertId,
    name: name.trim(),
    slug: catSlug,
    description: description || null,
    active: active ? 1 : 0
  };
};

/**
 * Update an existing category
 */
const updateCategory = async (id, { name, slug, description, active }) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid category ID');
  }

  const updates = [];
  const params = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name.trim());
  }

  if (slug !== undefined || name !== undefined) {
    const catSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    updates.push('slug = ?');
    params.push(catSlug);
  }

  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description || null);
  }

  if (active !== undefined) {
    updates.push('active = ?');
    params.push(active ? 1 : 0);
  }

  if (updates.length === 0) {
    return null;
  }

  const query = `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`;
  params.push(numId);

  const [result] = await pool.execute(query, params);
  if (result.affectedRows === 0) {
    return null;
  }

  const [rows] = await pool.execute('SELECT id, name, slug, description, active, created_at, updated_at FROM categories WHERE id = ?', [numId]);
  return rows[0] || null;
};

/**
 * Delete or de-activate a category
 */
const deleteCategory = async (id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid category ID');
  }

  const [result] = await pool.execute('DELETE FROM categories WHERE id = ?', [numId]);
  return result.affectedRows > 0;
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory
};
