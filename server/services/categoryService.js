const { pool } = require('../config/database');

// Cache column check result for image_url
let hasImageUrlColumn = null;
const checkHasImageUrl = async () => {
  if (hasImageUrlColumn !== null) return hasImageUrlColumn;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM categories LIKE 'image_url'");
    hasImageUrlColumn = cols && cols.length > 0;
  } catch (err) {
    hasImageUrlColumn = false;
  }
  return hasImageUrlColumn;
};

/**
 * Fetch all categories with live database product counts
 */
const getCategories = async ({ activeOnly = true } = {}) => {
  let query = `
    SELECT 
      c.*,
      COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p ON c.id = p.category_id AND p.active = 1
  `;
  const params = [];

  if (activeOnly) {
    query += ' WHERE c.active = ?';
    params.push(1);
  }

  query += ' GROUP BY c.id ORDER BY c.name ASC';

  const [rows] = await pool.execute(query, params);
  return rows.map(r => ({
    ...r,
    image_url: r.image_url || null,
    product_count: parseInt(r.product_count, 10) || 0
  }));
};

/**
 * Create a new category
 */
const createCategory = async ({ name, slug, description, image_url, active = 1 }) => {
  if (!name || typeof name !== 'string') {
    throw new Error('Category name is required');
  }

  const catSlug = (slug || name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const hasImage = await checkHasImageUrl();

  let query;
  let params;

  if (hasImage) {
    query = `
      INSERT INTO categories (name, slug, description, image_url, active)
      VALUES (?, ?, ?, ?, ?)
    `;
    params = [name.trim(), catSlug, description || null, image_url || null, active ? 1 : 0];
  } else {
    query = `
      INSERT INTO categories (name, slug, description, active)
      VALUES (?, ?, ?, ?)
    `;
    params = [name.trim(), catSlug, description || null, active ? 1 : 0];
  }

  const [result] = await pool.execute(query, params);

  return {
    id: result.insertId,
    name: name.trim(),
    slug: catSlug,
    description: description || null,
    image_url: image_url || null,
    product_count: 0,
    active: active ? 1 : 0
  };
};

/**
 * Update an existing category
 */
const updateCategory = async (id, { name, slug, description, image_url, active }) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid category ID');
  }

  const hasImage = await checkHasImageUrl();
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

  if (hasImage && image_url !== undefined) {
    updates.push('image_url = ?');
    params.push(image_url || null);
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

  const [rows] = await pool.execute(`
    SELECT 
      c.*,
      COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p ON c.id = p.category_id AND p.active = 1
    WHERE c.id = ?
    GROUP BY c.id
  `, [numId]);

  if (!rows || rows.length === 0) return null;

  return {
    ...rows[0],
    image_url: rows[0].image_url || null,
    product_count: parseInt(rows[0].product_count, 10) || 0
  };
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
