const { pool } = require('../config/database');

/**
 * Default fallback experiences for Store 2
 */
const DEFAULT_EXPERIENCES = [
  { id: 2, store_id: 2, experience_code: 'normal', name: 'Standard 3D Catalog', description: 'Clean light presentation', settings: { dark_mode_enabled: false, animation: 'none' }, status: 'active' },
  { id: 3, store_id: 2, experience_code: 'glow', name: 'Glow Theme', description: 'LUMO lamp dynamic glow & dark mode', settings: { glow_color: '#00ffcc', dark_mode_enabled: true, animation: 'pulse', intensity: 0.8 }, status: 'active' },
  { id: 4, store_id: 2, experience_code: 'luxury', name: 'Luxury Theme', description: 'Gold accents and minimalist dark presentation', settings: { accent_color: '#d4af37', dark_mode_enabled: true, animation: 'subtle-shimmer', intensity: 0.5 }, status: 'active' },
  { id: 5, store_id: 2, experience_code: 'seasonal', name: 'Seasonal Theme', description: 'Holiday festival theme', settings: { seasonal_preset: 'festive', dark_mode_enabled: false, particle_effects: true }, status: 'active' }
];

/**
 * Canonical 6 Categories for THE MARSHANS (Store 2)
 */
const CANONICAL_MARSHANS_CATEGORIES = [
  { id: 1, store_id: 2, name: 'Utility Co.', slug: 'utility-co', description: 'Precision engineering tools, organizers, brackets, and functional everyday 3D prints', experience_id: null, active: 1, display_order: 1 },
  { id: 2, store_id: 2, name: 'Fandom', slug: 'fandom', description: 'High-detail collectible sculptures, game props, pop-culture statues, and miniatures', experience_id: null, active: 1, display_order: 2 },
  { id: 3, store_id: 2, name: 'Darshanam', slug: 'darshanam', description: 'Spiritual, devotional, and cultural architecture sculptures crafted with heritage precision', experience_id: null, active: 1, display_order: 3 },
  { id: 4, store_id: 2, name: 'LUMO', slug: 'lumo', description: 'Luminous ambient lamps and radiant light sculptures featuring dual daytime/nighttime aesthetics', experience_id: 3, active: 1, display_order: 4 },
  { id: 5, store_id: 2, name: 'Mini Tales', slug: 'mini-tales', description: 'Pocket-sized figurines, miniature tabletop dioramas, and micro-scale art pieces', experience_id: null, active: 1, display_order: 5 },
  { id: 6, store_id: 2, name: 'Custom', slug: 'custom', description: 'Bespoke additive manufacturing for on-demand customer CAD models and prototypes', experience_id: null, active: 1, display_order: 6 }
];

/**
 * Helper: Batch load media for a list of marshans_categories IDs
 */
const fetchMediaForCategories = async (catIds) => {
  const mediaMap = {};
  if (!catIds || catIds.length === 0) return mediaMap;

  catIds.forEach(id => {
    mediaMap[id] = { hero_light: null, hero_dark: null, banner: null, thumbnail: null };
  });

  try {
    const placeholders = catIds.map(() => '?').join(',');
    const [mediaRows] = await pool.execute(
      `SELECT category_id, media_type, image_url, metadata
       FROM marshans_category_media
       WHERE category_id IN (${placeholders})`,
      catIds
    );

    mediaRows.forEach(row => {
      const type = (row.media_type || '').toLowerCase();
      if (mediaMap[row.category_id] && type in mediaMap[row.category_id]) {
        mediaMap[row.category_id][type] = row.image_url;
      }
    });
  } catch (err) {
    console.warn('[marshansCategoryService.fetchMediaForCategories] Warning:', err.message);
  }

  return mediaMap;
};

/**
 * Helper: Batch load product counts for a list of marshans_categories IDs
 */
const fetchProductCountsForCategories = async (catIds) => {
  const countMap = {};
  if (!catIds || catIds.length === 0) return countMap;

  catIds.forEach(id => { countMap[id] = 0; });

  try {
    const placeholders = catIds.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT category_id, COUNT(*) AS cnt
       FROM marshans_products
       WHERE category_id IN (${placeholders}) AND active = 1
       GROUP BY category_id`,
      catIds
    );

    rows.forEach(r => {
      countMap[r.category_id] = parseInt(r.cnt, 10) || 0;
    });
  } catch (err) {
    console.warn('[marshansCategoryService.fetchProductCountsForCategories] Warning:', err.message);
  }

  return countMap;
};

/**
 * Get list of Marshans categories with experience & media mappings
 */
const getCategories = async ({ activeOnly = false } = {}) => {
  try {
    const conditions = [];
    const params = [];

    if (activeOnly) {
      conditions.push('c.active = 1');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        c.id,
        c.store_id,
        c.name,
        c.slug,
        c.description,
        c.image_url,
        c.experience_id,
        c.active,
        c.created_at,
        c.updated_at,
        ce.id AS exp_id,
        ce.experience_code,
        ce.name AS experience_name,
        ce.settings AS experience_settings
      FROM marshans_categories c
      LEFT JOIN category_experiences ce ON c.experience_id = ce.id
      WHERE c.store_id = 2${whereClause ? ` AND ${whereClause.slice(6)}` : ''}
      ORDER BY c.id ASC
    `;

    const [rows] = await pool.execute(query, params);

    // If rows exist in DB, return them populated with media & product counts
    if (rows && rows.length > 0) {
      const catIds = rows.map(r => r.id);
      const [mediaMap, countMap] = await Promise.all([
        fetchMediaForCategories(catIds),
        fetchProductCountsForCategories(catIds)
      ]);

      return rows.map(r => {
        let expSettings = null;
        if (r.experience_settings) {
          expSettings = typeof r.experience_settings === 'string'
            ? JSON.parse(r.experience_settings)
            : r.experience_settings;
        }

        return {
          id: r.id,
          store_id: r.store_id || 2,
          name: r.name,
          slug: r.slug,
          description: r.description || '',
          image_url: r.image_url || '',
          experience_id: r.experience_id || null,
          active: r.active === 1,
          product_count: countMap[r.id] || 0,
          experience: {
            id: r.exp_id || null,
            experience_code: r.experience_code || 'normal',
            name: r.experience_name || 'Standard 3D Catalog',
            settings: expSettings || { dark_mode_enabled: false, animation: 'none' }
          },
          media: mediaMap[r.id] || { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
        };
      });
    }
  } catch (err) {
    console.warn('[marshansCategoryService.getCategories] DB query failed, falling back to canonical list:', err.message);
  }

  // Graceful fallback to canonical list if table is not yet populated
  return CANONICAL_MARSHANS_CATEGORIES.map(c => ({
    ...c,
    active: c.active === 1,
    image_url: '',
    product_count: 0,
    experience: {
      id: c.experience_id,
      experience_code: c.experience_id === 3 ? 'glow' : 'normal',
      name: c.experience_id === 3 ? 'Glow Theme' : 'Standard 3D Catalog',
      settings: c.experience_id === 3
        ? { glow_color: '#00ffcc', dark_mode_enabled: true, animation: 'pulse', intensity: 0.8 }
        : { dark_mode_enabled: false, animation: 'none' }
    },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  }));
};

/**
 * Get category by slug from marshans_categories
 */
const getCategoryBySlug = async (slug) => {
  if (!slug || !String(slug).trim()) return null;
  const cleanSlug = String(slug).trim().toLowerCase();

  try {
    const query = `
      SELECT 
        c.id,
        c.store_id,
        c.name,
        c.slug,
        c.description,
        c.image_url,
        c.experience_id,
        c.active,
        c.created_at,
        c.updated_at,
        ce.id AS exp_id,
        ce.experience_code,
        ce.name AS experience_name,
        ce.settings AS experience_settings
      FROM marshans_categories c
      LEFT JOIN category_experiences ce ON c.experience_id = ce.id
      WHERE c.store_id = 2 AND LOWER(c.slug) = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(query, [cleanSlug]);

    if (rows && rows.length > 0) {
      const r = rows[0];
      const [mediaMap, countMap] = await Promise.all([
        fetchMediaForCategories([r.id]),
        fetchProductCountsForCategories([r.id])
      ]);

      let expSettings = null;
      if (r.experience_settings) {
        expSettings = typeof r.experience_settings === 'string' ? JSON.parse(r.experience_settings) : r.experience_settings;
      }

      return {
        id: r.id,
        store_id: r.store_id || 2,
        name: r.name,
        slug: r.slug,
        description: r.description || '',
        image_url: r.image_url || '',
        experience_id: r.experience_id || null,
        active: r.active === 1,
        product_count: countMap[r.id] || 0,
        experience: {
          id: r.exp_id || null,
          experience_code: r.experience_code || 'normal',
          name: r.experience_name || 'Standard 3D Catalog',
          settings: expSettings || { dark_mode_enabled: false, animation: 'none' }
        },
        media: mediaMap[r.id] || { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
      };
    }
  } catch (err) {
    console.warn('[marshansCategoryService.getCategoryBySlug] DB query error:', err.message);
  }

  // Fallback to canonical category
  const canonical = CANONICAL_MARSHANS_CATEGORIES.find(c => c.slug.toLowerCase() === cleanSlug);
  if (canonical) {
    return {
      ...canonical,
      active: canonical.active === 1,
      image_url: '',
      product_count: 0,
      experience: {
        id: canonical.experience_id,
        experience_code: canonical.experience_id === 3 ? 'glow' : 'normal',
        name: canonical.experience_id === 3 ? 'Glow Theme' : 'Standard 3D Catalog',
        settings: canonical.experience_id === 3
          ? { glow_color: '#00ffcc', dark_mode_enabled: true, animation: 'pulse', intensity: 0.8 }
          : { dark_mode_enabled: false, animation: 'none' }
      },
      media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
    };
  }

  return null;
};

/**
 * Get category experience for a Marshans category
 */
const getCategoryExperience = async (identifier) => {
  if (!identifier) return null;

  const numId = parseInt(identifier, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(identifier).trim();

  let category = null;
  if (isNumeric) {
    const cats = await getCategories({ activeOnly: false });
    category = cats.find(c => c.id === numId);
  } else {
    category = await getCategoryBySlug(identifier);
  }

  if (!category) return null;

  return {
    category_id: category.id,
    category_name: category.name,
    category_slug: category.slug,
    store_id: 2,
    experience: category.experience,
    media: category.media
  };
};

/**
 * Get available category experiences from shared category_experiences for Store 2
 */
const getExperiences = async () => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, store_id, experience_code, name, description, settings, status FROM category_experiences WHERE store_id = 2 AND status = 'active' ORDER BY id ASC"
    );
    if (rows && rows.length > 0) {
      return rows.map(r => ({
        ...r,
        settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : (r.settings || {})
      }));
    }
  } catch (err) {
    console.warn('[marshansCategoryService.getExperiences] DB error, using default experiences:', err.message);
  }
  return DEFAULT_EXPERIENCES;
};

/**
 * Set experience on a Marshans category
 */
const setCategoryExperience = async (id, { experience_id, experience_code, settings }) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid category ID');

  let targetExperienceId = experience_id || null;

  if (!targetExperienceId && experience_code) {
    try {
      const [expRows] = await pool.execute(
        'SELECT id FROM category_experiences WHERE experience_code = ? AND store_id = 2 LIMIT 1',
        [experience_code]
      );
      if (expRows.length > 0) {
        targetExperienceId = expRows[0].id;
      }
    } catch (_) {}
  }

  await pool.execute(
    'UPDATE marshans_categories SET experience_id = ? WHERE id = ? AND store_id = 2',
    [targetExperienceId, numId]
  );

  return getCategoryExperience(numId);
};

/**
 * Set media asset for a Marshans category
 */
const setCategoryMedia = async (id, mediaType, imageUrl, metadata = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid category ID');

  const cleanType = String(mediaType).trim().toLowerCase();
  const metaJson = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

  const [categoryRows] = await pool.execute(
    'SELECT id FROM marshans_categories WHERE id = ? AND store_id = 2 LIMIT 1',
    [numId]
  );
  if (!categoryRows.length) throw new Error('Marshans category not found.');

  const query = `
    INSERT INTO marshans_category_media (category_id, media_type, image_url, metadata)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      image_url = VALUES(image_url),
      metadata = VALUES(metadata),
      updated_at = CURRENT_TIMESTAMP
  `;

  await pool.execute(query, [numId, cleanType, imageUrl, metaJson]);

  return {
    category_id: numId,
    media_type: cleanType,
    image_url: imageUrl,
    metadata: metaJson ? JSON.parse(metaJson) : null
  };
};

/**
 * Create a new Marshans category
 */
const createCategory = async (categoryData) => {
  const {
    name,
    slug,
    description,
    image_url,
    active = 1,
    experience_id,
    hero_light,
    hero_dark
  } = categoryData;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Category name is required');
  }

  const cleanName = name.trim();
  const cleanSlug = (slug && String(slug).trim()) ? String(slug).trim().toLowerCase() : cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [res] = await connection.execute(
      'INSERT INTO marshans_categories (store_id, name, slug, description, image_url, experience_id, active) VALUES (2, ?, ?, ?, ?, ?, ?)',
      [cleanName, cleanSlug, description || null, image_url || null, experience_id || null, active ? 1 : 0]
    );

    const newId = res.insertId;

    // Insert hero_light media if provided
    if (hero_light) {
      await connection.execute(
        'INSERT INTO marshans_category_media (category_id, media_type, image_url) VALUES (?, ?, ?)',
        [newId, 'hero_light', hero_light]
      );
    }

    // Insert hero_dark media if provided
    if (hero_dark) {
      await connection.execute(
        'INSERT INTO marshans_category_media (category_id, media_type, image_url) VALUES (?, ?, ?)',
        [newId, 'hero_dark', hero_dark]
      );
    }

    await connection.commit();
    connection.release();

    return getCategoryBySlug(cleanSlug);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Update an existing Marshans category
 */
const updateCategory = async (id, updateData) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid category ID');

  const {
    name,
    slug,
    description,
    image_url,
    active,
    experience_id,
    hero_light,
    hero_dark
  } = updateData;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(String(name).trim()); }
    if (slug !== undefined) { updates.push('slug = ?'); params.push(String(slug).trim().toLowerCase()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }
    if (image_url !== undefined) { updates.push('image_url = ?'); params.push(image_url || null); }
    if (experience_id !== undefined) { updates.push('experience_id = ?'); params.push(experience_id || null); }
    if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }

    if (updates.length > 0) {
      params.push(numId);
      await connection.execute(`UPDATE marshans_categories SET ${updates.join(', ')} WHERE id = ? AND store_id = 2`, params);
    }

    if (hero_light !== undefined) {
      if (hero_light) {
        await connection.execute(
          'INSERT INTO marshans_category_media (category_id, media_type, image_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image_url = VALUES(image_url)',
          [numId, 'hero_light', hero_light]
        );
      } else {
        await connection.execute('DELETE FROM marshans_category_media WHERE category_id = ? AND media_type = ?', [numId, 'hero_light']);
      }
    }

    if (hero_dark !== undefined) {
      if (hero_dark) {
        await connection.execute(
          'INSERT INTO marshans_category_media (category_id, media_type, image_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE image_url = VALUES(image_url)',
          [numId, 'hero_dark', hero_dark]
        );
      } else {
        await connection.execute('DELETE FROM marshans_category_media WHERE category_id = ? AND media_type = ?', [numId, 'hero_dark']);
      }
    }

    await connection.commit();
    connection.release();

    const [rows] = await pool.execute('SELECT slug FROM marshans_categories WHERE id = ? AND store_id = 2 LIMIT 1', [numId]);
    if (rows.length > 0) {
      return getCategoryBySlug(rows[0].slug);
    }
    return null;
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Delete / deactivate a Marshans category
 */
const deleteCategory = async (id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid category ID');

  const [result] = await pool.execute('DELETE FROM marshans_categories WHERE id = ? AND store_id = 2', [numId]);
  return result.affectedRows > 0;
};

module.exports = {
  getCategories,
  getCategoryBySlug,
  getCategoryExperience,
  getExperiences,
  setCategoryExperience,
  setCategoryMedia,
  createCategory,
  updateCategory,
  deleteCategory
};
