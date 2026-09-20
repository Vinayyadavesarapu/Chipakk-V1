const { pool } = require('../config/database');

// Cache column check results
const taxProfileService = require('./taxProfileService');

let hasTaxColumns = null;
const checkHasTaxColumns = async () => {
  if (hasTaxColumns !== null) return hasTaxColumns;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM categories LIKE 'hsn_code'");
    hasTaxColumns = Array.isArray(cols) && cols.length > 0;
  } catch (_) {
    hasTaxColumns = false;
  }
  return hasTaxColumns;
};

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

let hasStoreIdColumn = null;
const checkHasStoreId = async () => {
  if (hasStoreIdColumn !== null) return hasStoreIdColumn;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM categories LIKE 'store_id'");
    hasStoreIdColumn = cols && cols.length > 0;
  } catch (err) {
    hasStoreIdColumn = false;
  }
  return hasStoreIdColumn;
};

let hasExperienceIdColumn = null;
const checkHasExperienceId = async () => {
  if (hasExperienceIdColumn !== null) return hasExperienceIdColumn;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM categories LIKE 'experience_id'");
    hasExperienceIdColumn = cols && cols.length > 0;
  } catch (err) {
    hasExperienceIdColumn = false;
  }
  return hasExperienceIdColumn;
};

let hasCategoryExperiencesTable = null;
const checkHasCategoryExperiencesTable = async () => {
  if (hasCategoryExperiencesTable !== null) return hasCategoryExperiencesTable;
  try {
    const [tables] = await pool.execute("SHOW TABLES LIKE 'category_experiences'");
    hasCategoryExperiencesTable = tables && tables.length > 0;
  } catch (err) {
    hasCategoryExperiencesTable = false;
  }
  return hasCategoryExperiencesTable;
};

let hasCategoryMediaTable = null;
const checkHasCategoryMediaTable = async () => {
  if (hasCategoryMediaTable !== null) return hasCategoryMediaTable;
  try {
    const [tables] = await pool.execute("SHOW TABLES LIKE 'category_media'");
    hasCategoryMediaTable = tables && tables.length > 0;
  } catch (err) {
    hasCategoryMediaTable = false;
  }
  return hasCategoryMediaTable;
};

/**
 * Default fallback experiences
 */
const DEFAULT_EXPERIENCES = [
  { id: 1, store_id: 1, experience_code: 'normal', name: 'Standard Shop', description: 'Standard ecommerce presentation', settings: { dark_mode_enabled: false, animation: 'none' }, status: 'active' },
  { id: 2, store_id: 2, experience_code: 'normal', name: 'Standard 3D Catalog', description: 'Clean light presentation', settings: { dark_mode_enabled: false, animation: 'none' }, status: 'active' },
  { id: 3, store_id: 2, experience_code: 'glow', name: 'Glow Theme', description: 'LUMO lamp dynamic glow & dark mode', settings: { glow_color: '#00ffcc', dark_mode_enabled: true, animation: 'pulse', intensity: 0.8 }, status: 'active' },
  { id: 4, store_id: 2, experience_code: 'luxury', name: 'Luxury Theme', description: 'Gold accents and minimalist dark presentation', settings: { accent_color: '#d4af37', dark_mode_enabled: true, animation: 'subtle-shimmer', intensity: 0.5 }, status: 'active' },
  { id: 5, store_id: 2, experience_code: 'seasonal', name: 'Seasonal Theme', description: 'Holiday festival theme', settings: { seasonal_preset: 'festive', dark_mode_enabled: false, particle_effects: true }, status: 'active' }
];

/**
 * Authoritative Canonical 6 Categories for THE MARSHANS (store_id = 2)
 * Seeded by migration_008_marshans_v1_simplification.sql
 * NOTE: Best Seller is a product-level merchandising flag and NEVER a category.
 */
const CANONICAL_MARSHANS_CATEGORIES = [
  {
    id: 1,
    store_id: 2,
    name: 'Utility Co.',
    slug: 'utility-co',
    description: 'Precision engineering tools, organizers, brackets, and functional everyday 3D prints',
    experience_id: null,
    active: 1,
    display_order: 1,
    product_count: 0,
    experience: { id: null, experience_code: 'normal', name: 'Standard 3D Catalog', settings: { dark_mode_enabled: false, animation: 'none' } },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  },
  {
    id: 2,
    store_id: 2,
    name: 'Fandom',
    slug: 'fandom',
    description: 'High-detail collectible sculptures, game props, pop-culture statues, and miniatures',
    experience_id: null,
    active: 1,
    display_order: 2,
    product_count: 0,
    experience: { id: null, experience_code: 'normal', name: 'Standard 3D Catalog', settings: { dark_mode_enabled: false, animation: 'none' } },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  },
  {
    id: 3,
    store_id: 2,
    name: 'Darshanam',
    slug: 'darshanam',
    description: 'Spiritual, devotional, and cultural architecture sculptures crafted with heritage precision',
    experience_id: null,
    active: 1,
    display_order: 3,
    product_count: 0,
    experience: { id: null, experience_code: 'normal', name: 'Standard 3D Catalog', settings: { dark_mode_enabled: false, animation: 'none' } },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  },
  {
    id: 4,
    store_id: 2,
    name: 'LUMO',
    slug: 'lumo',
    description: 'Luminous ambient lamps and radiant light sculptures featuring dual daytime/nighttime aesthetics',
    experience_id: 3,
    active: 1,
    display_order: 4,
    product_count: 0,
    experience: { id: 3, experience_code: 'glow', name: 'Glow Theme', settings: { glow_color: '#00ffcc', dark_mode_enabled: true, animation: 'pulse', intensity: 0.8 } },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  },
  {
    id: 5,
    store_id: 2,
    name: 'Mini Tales',
    slug: 'mini-tales',
    description: 'Pocket-sized figurines, miniature tabletop dioramas, and micro-scale art pieces',
    experience_id: null,
    active: 1,
    display_order: 5,
    product_count: 0,
    experience: { id: null, experience_code: 'normal', name: 'Standard 3D Catalog', settings: { dark_mode_enabled: false, animation: 'none' } },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  },
  {
    id: 6,
    store_id: 2,
    name: 'Custom',
    slug: 'custom',
    description: 'Bespoke additive manufacturing for on-demand customer CAD models and prototypes',
    experience_id: null,
    active: 1,
    display_order: 6,
    product_count: 0,
    experience: { id: null, experience_code: 'normal', name: 'Standard 3D Catalog', settings: { dark_mode_enabled: false, animation: 'none' } },
    media: { hero_light: null, hero_dark: null, banner: null, thumbnail: null }
  }
];

/**
 * Fetch available experiences for a store
 */
const getExperiences = async (storeId = 2) => {
  const hasTable = await checkHasCategoryExperiencesTable();
  if (!hasTable) {
    return DEFAULT_EXPERIENCES.filter(e => !storeId || e.store_id === parseInt(storeId, 10) || e.store_id === 2);
  }

  try {
    const [rows] = await pool.execute(
      `SELECT * FROM category_experiences WHERE (store_id = ? OR store_id = 2) AND status = 'active' ORDER BY id ASC`,
      [storeId || 2]
    );
    return rows.map(r => ({
      ...r,
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : (r.settings || {})
    }));
  } catch (err) {
    return DEFAULT_EXPERIENCES.filter(e => !storeId || e.store_id === parseInt(storeId, 10) || e.store_id === 2);
  }
};

/**
 * Helper to fetch media map for an array of category IDs
 */
const fetchMediaForCategories = async (categoryIds = []) => {
  if (!categoryIds || categoryIds.length === 0) return {};
  const hasTable = await checkHasCategoryMediaTable();
  if (!hasTable) return {};

  try {
    const placeholders = categoryIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT category_id, media_type, image_url, metadata FROM category_media WHERE category_id IN (${placeholders})`,
      categoryIds
    );

    const mediaMap = {};
    for (const r of rows) {
      if (!mediaMap[r.category_id]) mediaMap[r.category_id] = {};
      mediaMap[r.category_id][r.media_type] = {
        image_url: r.image_url,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || null)
      };
    }
    return mediaMap;
  } catch (err) {
    console.error('[fetchMediaForCategories error]', err.message);
    return {};
  }
};

/**
 * Fetch all categories with live database product counts, experience, and media scoped by storeId
 */
const getCategories = async ({ activeOnly = true, storeId = null } = {}) => {
  const numStoreId = storeId !== null && storeId !== undefined ? parseInt(storeId, 10) : null;

  try {
    const hasStoreId = await checkHasStoreId();
    const hasExpCol = await checkHasExperienceId();
    const hasExpTable = await checkHasCategoryExperiencesTable();

    const conditions = [];
    const params = [];

    if (hasStoreId && numStoreId) {
      if (numStoreId === 1) {
        conditions.push('(c.store_id = 1 OR c.store_id IS NULL)');
      } else {
        conditions.push('c.store_id = ?');
        params.push(numStoreId);
      }
    }

    // Best Seller is a product-level merchandising flag and NEVER a category
    conditions.push("LOWER(TRIM(c.name)) != 'best seller'");
    conditions.push("LOWER(TRIM(c.slug)) != 'best-seller'");

    if (activeOnly) {
      conditions.push('c.active = ?');
      params.push(1);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let query = '';
    if (hasExpCol && hasExpTable) {
      query = `
        SELECT
          c.*,
          COUNT(p.id) AS product_count,
          ce.id AS exp_id,
          ce.experience_code AS exp_code,
          ce.name AS exp_name,
          ce.settings AS exp_settings
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id AND p.active = 1
        LEFT JOIN category_experiences ce ON c.experience_id = ce.id
        ${whereClause}
        GROUP BY c.id ORDER BY c.name ASC
      `;
    } else {
      query = `
        SELECT
          c.*,
          COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p ON c.id = p.category_id AND p.active = 1
        ${whereClause}
        GROUP BY c.id ORDER BY c.name ASC
      `;
    }

    const [rows] = await pool.execute(query, params);

    // If query returned 0 rows for Marshans, return the canonical 6 categories
    if ((!rows || rows.length === 0) && numStoreId === 2) {
      return activeOnly ? CANONICAL_MARSHANS_CATEGORIES.filter(c => c.active) : CANONICAL_MARSHANS_CATEGORIES;
    }

    const categoryIds = (rows || []).map(r => r.id);
    const mediaMap = await fetchMediaForCategories(categoryIds);

    return (rows || [])
      .filter(r => {
        const nameLower = (r.name || '').toLowerCase().trim();
        const slugLower = (r.slug || '').toLowerCase().trim();
        return nameLower !== 'best seller' && slugLower !== 'best-seller';
      })
      .map(r => {
        const rawExpSettings = r.exp_settings;
        const parsedExpSettings = typeof rawExpSettings === 'string' ? JSON.parse(rawExpSettings) : (rawExpSettings || {});

        // For Store 1 (CHIPAKK), experience always defaults to standard normal
        const isChipakk = (numStoreId === 1 || r.store_id === 1);
        const expCode = isChipakk ? 'normal' : (r.exp_code || 'normal');
        const expName = isChipakk ? 'Standard Shop' : (r.exp_name || 'Normal');
        const expSettings = isChipakk ? { dark_mode_enabled: false } : parsedExpSettings;

        const catMedia = mediaMap[r.id] || {};

        return {
          ...r,
          image_url: r.image_url || null,
          ...(r.hsn_code !== undefined ? { hsn_code: r.hsn_code || null, gst_rate: r.gst_rate === null || r.gst_rate === undefined ? null : Number(r.gst_rate) } : {}),
          product_count: parseInt(r.product_count, 10) || 0,
          experience: {
            id: isChipakk ? null : (r.exp_id || null),
            experience_code: expCode,
            name: expName,
            settings: expSettings
          },
          media: {
            hero_light: catMedia['hero_light']?.image_url || null,
            hero_dark: catMedia['hero_dark']?.image_url || null,
            banner: catMedia['banner']?.image_url || r.image_url || null,
            thumbnail: catMedia['thumbnail']?.image_url || r.image_url || null
          }
        };
      });
  } catch (err) {
    console.warn('[categoryService.getCategories] Live DB query unavailable, using fallback:', err.message);
    if (numStoreId === 2) {
      return activeOnly ? CANONICAL_MARSHANS_CATEGORIES.filter(c => c.active) : CANONICAL_MARSHANS_CATEGORIES;
    }
    return [];
  }
};

/**
 * Upsert category media asset
 */
const setCategoryMedia = async (categoryId, mediaType, imageUrl, metadata = null) => {
  const numId = parseInt(categoryId, 10);
  if (isNaN(numId)) throw new Error('Invalid category ID');
  if (!mediaType || !imageUrl) throw new Error('mediaType and imageUrl are required');

  const cleanType = mediaType.trim();
  const cleanUrl = imageUrl.trim();

  // Sync in-memory fallback categories (e.g. LUMO) for development resilience
  const canonicalCat = CANONICAL_MARSHANS_CATEGORIES.find(c => c.id === numId);
  if (canonicalCat) {
    if (!canonicalCat.media) canonicalCat.media = {};
    canonicalCat.media[cleanType] = cleanUrl;
  }

  const hasTable = await checkHasCategoryMediaTable();
  if (!hasTable) {
    return { category_id: numId, media_type: cleanType, image_url: cleanUrl, metadata };
  }

  const metaJson = metadata ? JSON.stringify(metadata) : null;
  const query = `
    INSERT INTO category_media (category_id, media_type, image_url, metadata)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      image_url = VALUES(image_url),
      metadata = VALUES(metadata),
      updated_at = CURRENT_TIMESTAMP
  `;

  try {
    await pool.execute(query, [numId, cleanType, cleanUrl, metaJson]);
  } catch (err) {
    console.warn('[categoryService.setCategoryMedia] Live DB update failed, in-memory state updated:', err.message);
  }

  return { category_id: numId, media_type: cleanType, image_url: cleanUrl, metadata };
};

/**
 * Set or update category experience
 */
const setCategoryExperience = async (categoryId, { experience_id, experience_code, settings }) => {
  const numId = parseInt(categoryId, 10);
  if (isNaN(numId)) throw new Error('Invalid category ID');

  let resolvedExpId = experience_id ? parseInt(experience_id, 10) : null;

  if (!resolvedExpId && experience_code) {
    const [rows] = await pool.execute(
      `SELECT id FROM category_experiences WHERE experience_code = ? LIMIT 1`,
      [experience_code]
    );
    if (rows && rows.length > 0) resolvedExpId = rows[0].id;
  }

  const hasExpCol = await checkHasExperienceId();
  if (hasExpCol && resolvedExpId !== undefined) {
    await pool.execute(`UPDATE categories SET experience_id = ? WHERE id = ?`, [resolvedExpId, numId]);
  }

  if (settings && resolvedExpId) {
    const settingsJson = typeof settings === 'string' ? settings : JSON.stringify(settings);
    await pool.execute(
      `UPDATE category_experiences SET settings = ? WHERE id = ?`,
      [settingsJson, resolvedExpId]
    );
  }

  return { category_id: numId, experience_id: resolvedExpId, settings };
};

/**
 * Get category experience details by ID or Slug
 */
const getCategoryExperience = async (identifier, storeId = null) => {
  const isNumeric = /^\d+$/.test(String(identifier).trim());
  const whereCol = isNumeric ? 'c.id' : 'c.slug';
  const val = isNumeric ? parseInt(identifier, 10) : String(identifier).trim();

  const hasExpCol = await checkHasExperienceId();
  const hasExpTable = await checkHasCategoryExperiencesTable();

  let query = '';
    let storeCondition = '';
    const queryParams = [val];
    if (storeId) {
      const sId = parseInt(storeId, 10);
      if (sId === 1) {
        storeCondition = ' AND (c.store_id = 1 OR c.store_id IS NULL)';
      } else {
        storeCondition = ' AND c.store_id = ?';
        queryParams.push(sId);
      }
    }

    if (hasExpCol && hasExpTable) {
      query = `
        SELECT
          c.id, c.name, c.slug, c.store_id,
          ce.id AS exp_id,
          ce.experience_code AS exp_code,
          ce.name AS exp_name,
          ce.settings AS exp_settings
        FROM categories c
        LEFT JOIN category_experiences ce ON c.experience_id = ce.id
        WHERE ${whereCol} = ?${storeCondition}
        LIMIT 1
      `;
    } else {
      query = `SELECT c.id, c.name, c.slug, c.store_id FROM categories c WHERE ${whereCol} = ?${storeCondition} LIMIT 1`;
    }

    const [rows] = await pool.execute(query, queryParams);
  if (!rows || rows.length === 0) return null;

  const r = rows[0];
  const isChipakk = (storeId === 1 || r.store_id === 1);
  const rawSettings = r.exp_settings;
  const parsedSettings = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : (rawSettings || {});

  return {
    category_id: r.id,
    category_name: r.name,
    category_slug: r.slug,
    experience_id: isChipakk ? null : (r.exp_id || null),
    experience_code: isChipakk ? 'normal' : (r.exp_code || 'normal'),
    name: isChipakk ? 'Standard Shop' : (r.exp_name || 'Normal'),
    settings: isChipakk ? { dark_mode_enabled: false } : parsedSettings
  };
};

/**
 * Get category by Slug for Storefront (Customer Category Page API)
 * Returns category details, experience, media, and products with experience_override
 */
const getCategoryBySlug = async (slug, storeId = null) => {
  if (!slug) throw new Error('Category slug is required');

  const cleanSlug = slug.toLowerCase().trim();
  const numStoreId = storeId !== null && storeId !== undefined ? parseInt(storeId, 10) : null;

  try {
    const hasStoreId = await checkHasStoreId();
    const hasExpCol = await checkHasExperienceId();
    const hasExpTable = await checkHasCategoryExperiencesTable();

    const conditions = ['c.slug = ?'];
    const params = [cleanSlug];

    if (hasStoreId && numStoreId) {
      if (numStoreId === 1) {
        conditions.push('(c.store_id = 1 OR c.store_id IS NULL)');
      } else {
        conditions.push('c.store_id = ?');
        params.push(numStoreId);
      }
    }

    let catQuery = '';
    if (hasExpCol && hasExpTable) {
      catQuery = `
        SELECT
          c.*,
          ce.id AS exp_id,
          ce.experience_code AS exp_code,
          ce.name AS exp_name,
          ce.settings AS exp_settings
        FROM categories c
        LEFT JOIN category_experiences ce ON c.experience_id = ce.id
        WHERE ${conditions.join(' AND ')}
        LIMIT 1
      `;
    } else {
      catQuery = `
        SELECT c.* FROM categories c
        WHERE ${conditions.join(' AND ')}
        LIMIT 1
      `;
    }

    const [catRows] = await pool.execute(catQuery, params);
    if (!catRows || catRows.length === 0) {
      if (numStoreId === 2) {
        const fallback = CANONICAL_MARSHANS_CATEGORIES.find(c => c.slug === cleanSlug);
        if (fallback) {
          return {
            category: {
              id: fallback.id,
              store_id: 2,
              name: fallback.name,
              slug: fallback.slug,
              description: fallback.description,
              image_url: null,
              active: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            experience: fallback.experience,
            media: fallback.media,
            products: []
          };
        }
      }
      return null;
    }

  const category = catRows[0];
  const isChipakk = (storeId === 1 || category.store_id === 1);
  const rawExpSettings = category.exp_settings;
  const parsedExpSettings = typeof rawExpSettings === 'string' ? JSON.parse(rawExpSettings) : (rawExpSettings || {});

  const experience = {
    id: isChipakk ? null : (category.exp_id || null),
    experience_code: isChipakk ? 'normal' : (category.exp_code || 'normal'),
    name: isChipakk ? 'Standard Shop' : (category.exp_name || 'Normal'),
    settings: isChipakk ? { dark_mode_enabled: false } : parsedExpSettings
  };

  // Fetch category media
  const mediaMap = await fetchMediaForCategories([category.id]);
  const catMedia = mediaMap[category.id] || {};
  const media = {
    hero_light: catMedia['hero_light']?.image_url || null,
    hero_dark: catMedia['hero_dark']?.image_url || null,
    banner: catMedia['banner']?.image_url || category.image_url || null,
    thumbnail: catMedia['thumbnail']?.image_url || category.image_url || null
  };

  // Check products table for experience_override
  let hasExpOverride = false;
  try {
    const [prodCols] = await pool.execute("SHOW COLUMNS FROM products LIKE 'experience_override'");
    hasExpOverride = prodCols && prodCols.length > 0;
  } catch (_) {}

  // Fetch products in this category
  const selectExpOverride = hasExpOverride ? 'p.experience_override,' : 'NULL AS experience_override,';
  const prodQuery = `
    SELECT
      p.id,
      p.store_id,
      p.name,
      p.sku,
      p.price,
      p.compare_at_price,
      p.featured,
      p.active,
      ${selectExpOverride}
      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS primary_image
    FROM products p
    WHERE p.category_id = ? AND p.active = 1
    ORDER BY p.id DESC
  `;

  const [prodRows] = await pool.execute(prodQuery, [category.id]);
  const products = prodRows.map(p => ({
    ...p,
    price: parseInt(p.price, 10) || 0,
    compare_at_price: parseInt(p.compare_at_price, 10) || 0,
    experience_override: p.experience_override || null,
    effective_experience: p.experience_override || experience.experience_code || 'normal'
  }));

    return {
      category: {
        id: category.id,
        store_id: category.store_id || 1,
        name: category.name,
        slug: category.slug,
        description: category.description || null,
        image_url: category.image_url || null,
        active: category.active ? 1 : 0,
        created_at: category.created_at,
        updated_at: category.updated_at
      },
      experience,
      media,
      products
    };
  } catch (err) {
    console.warn('[categoryService.getCategoryBySlug] DB query unavailable, using fallback:', err.message);
    if (numStoreId === 2) {
      const fallback = CANONICAL_MARSHANS_CATEGORIES.find(c => c.slug === cleanSlug);
      if (fallback) {
        return {
          category: {
            id: fallback.id,
            store_id: 2,
            name: fallback.name,
            slug: fallback.slug,
            description: fallback.description,
            image_url: null,
            active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          experience: fallback.experience,
          media: fallback.media,
          products: []
        };
      }
    }
    return null;
  }
};

/**
 * Create a new category
 */
const createCategory = async ({
  name,
  slug,
  description,
  image_url,
  active = 1,
  store_id = 1,
  experience_id = null,
  experience_code = null,
  experience_settings = null,
  media = null,
  hero_light = null,
  hero_dark = null,
  hsn_code,
  gst_rate
}) => {
  const taxCfg = taxProfileService.parseTaxConfigInput({ hsn_code, gst_rate });
  if (!name || typeof name !== 'string') {
    throw new Error('Category name is required');
  }

  const catSlug = (slug || name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const hasImage = await checkHasImageUrl();
  const hasStoreId = await checkHasStoreId();
  const hasExpId = await checkHasExperienceId();

  // Resolve experience_id if code given
  let resolvedExpId = experience_id ? parseInt(experience_id, 10) : null;
  if (!resolvedExpId && experience_code) {
    try {
      const [rows] = await pool.execute(
        `SELECT id FROM category_experiences WHERE experience_code = ? LIMIT 1`,
        [experience_code]
      );
      if (rows && rows.length > 0) resolvedExpId = rows[0].id;
    } catch (_) {}
  }

  let cols = ['name', 'slug', 'description', 'active'];
  let placeholders = ['?', '?', '?', '?'];
  let params = [name.trim(), catSlug, description || null, active ? 1 : 0];

  if (hasImage) {
    cols.push('image_url');
    placeholders.push('?');
    params.push(image_url || null);
  }

  if (hasStoreId) {
    cols.push('store_id');
    placeholders.push('?');
    params.push(store_id || 1);
  }

  if (hasExpId && resolvedExpId) {
    cols.push('experience_id');
    placeholders.push('?');
    params.push(resolvedExpId);
  }

  if ((taxCfg.hsn_code.provided || taxCfg.gst_rate.provided) && await checkHasTaxColumns()) {
    cols.push('hsn_code', 'gst_rate');
    placeholders.push('?', '?');
    params.push(taxCfg.hsn_code.value, taxCfg.gst_rate.value);
  }

  const query = `
    INSERT INTO categories (${cols.join(', ')})
    VALUES (${placeholders.join(', ')})
  `;

  const [result] = await pool.execute(query, params);
  const newCategoryId = result.insertId;

  // Handle custom experience settings if provided
  if (experience_settings && resolvedExpId) {
    await setCategoryExperience(newCategoryId, { experience_id: resolvedExpId, settings: experience_settings });
  }

  // Handle media creation
  if (hero_light) await setCategoryMedia(newCategoryId, 'hero_light', hero_light);
  if (hero_dark) await setCategoryMedia(newCategoryId, 'hero_dark', hero_dark);
  if (image_url) {
    await setCategoryMedia(newCategoryId, 'banner', image_url);
    await setCategoryMedia(newCategoryId, 'thumbnail', image_url);
  }
  if (media && typeof media === 'object') {
    for (const [mType, mVal] of Object.entries(media)) {
      if (typeof mVal === 'string' && mVal.trim()) {
        await setCategoryMedia(newCategoryId, mType, mVal.trim());
      } else if (mVal && mVal.image_url) {
        await setCategoryMedia(newCategoryId, mType, mVal.image_url, mVal.metadata);
      }
    }
  }

  return {
    id: newCategoryId,
    store_id: store_id || 1,
    experience_id: resolvedExpId,
    name: name.trim(),
    slug: catSlug,
    description: description || null,
    image_url: image_url || null,
    product_count: 0,
    active: active ? 1 : 0,
    media: {
      hero_light: hero_light || null,
      hero_dark: hero_dark || null,
      banner: image_url || null,
      thumbnail: image_url || null
    }
  };
};

/**
 * Update an existing category
 */
const updateCategory = async (id, {
  name,
  slug,
  description,
  image_url,
  active,
  experience_id,
  experience_code,
  experience_settings,
  media,
  hero_light,
  hero_dark,
  hsn_code,
  gst_rate
}, storeId = null) => {
  const taxCfg = taxProfileService.parseTaxConfigInput({ hsn_code, gst_rate });
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid category ID');
  }

  const hasImage = await checkHasImageUrl();
  const hasExpId = await checkHasExperienceId();
  const hasStoreId = await checkHasStoreId();

  if (hasStoreId && storeId !== null && storeId !== undefined) {
    const [ownerRows] = await pool.execute('SELECT store_id FROM categories WHERE id = ? LIMIT 1', [numId]);
    if (!ownerRows || ownerRows.length === 0) {
      return null;
    }
    const ownerStoreId = ownerRows[0].store_id;
    const sId = parseInt(storeId, 10);
    const matchesStore = sId === 1
      ? (ownerStoreId === 1 || ownerStoreId === null)
      : (ownerStoreId === sId);
    if (!matchesStore) {
      return null;
    }
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

  if (hasImage && image_url !== undefined) {
    updates.push('image_url = ?');
    params.push(image_url || null);
  }

  if (active !== undefined) {
    updates.push('active = ?');
    params.push(active ? 1 : 0);
  }

  let resolvedExpId = experience_id !== undefined ? (experience_id ? parseInt(experience_id, 10) : null) : undefined;
  if (resolvedExpId === undefined && experience_code) {
    try {
      const [rows] = await pool.execute(
        `SELECT id FROM category_experiences WHERE experience_code = ? LIMIT 1`,
        [experience_code]
      );
      if (rows && rows.length > 0) resolvedExpId = rows[0].id;
    } catch (_) {}
  }

  if (hasExpId && resolvedExpId !== undefined) {
    updates.push('experience_id = ?');
    params.push(resolvedExpId);
  }

  if ((taxCfg.hsn_code.provided || taxCfg.gst_rate.provided) && await checkHasTaxColumns()) {
    if (taxCfg.hsn_code.provided) { updates.push('hsn_code = ?'); params.push(taxCfg.hsn_code.value); }
    if (taxCfg.gst_rate.provided) { updates.push('gst_rate = ?'); params.push(taxCfg.gst_rate.value); }
  }

  // Sync in-memory fallback category (e.g. LUMO) for development resilience
  const canonicalCat = CANONICAL_MARSHANS_CATEGORIES.find(c => c.id === numId);
  if (canonicalCat) {
    if (name !== undefined) canonicalCat.name = name.trim();
    if (slug !== undefined) canonicalCat.slug = slug.trim();
    if (description !== undefined) canonicalCat.description = description;
    if (image_url !== undefined) canonicalCat.image_url = image_url;
    if (active !== undefined) canonicalCat.active = active ? 1 : 0;
    if (!canonicalCat.media) canonicalCat.media = {};
    if (hero_light !== undefined) canonicalCat.media.hero_light = hero_light || null;
    if (hero_dark !== undefined) canonicalCat.media.hero_dark = hero_dark || null;
  }

  if (updates.length > 0) {
    try {
      const query = `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`;
      params.push(numId);
      await pool.execute(query, params);
    } catch (err) {
      console.warn('[categoryService.updateCategory] Live DB update failed, in-memory state updated:', err.message);
    }
  }

  // Handle custom experience settings
  if (experience_settings && (resolvedExpId || experience_id)) {
    await setCategoryExperience(numId, { experience_id: resolvedExpId || experience_id, settings: experience_settings });
  }

  // Handle media updates
  if (hero_light !== undefined) {
    if (hero_light) await setCategoryMedia(numId, 'hero_light', hero_light);
  }
  if (hero_dark !== undefined) {
    if (hero_dark) await setCategoryMedia(numId, 'hero_dark', hero_dark);
  }
  if (image_url) {
    await setCategoryMedia(numId, 'banner', image_url);
    await setCategoryMedia(numId, 'thumbnail', image_url);
  }
  if (media && typeof media === 'object') {
    for (const [mType, mVal] of Object.entries(media)) {
      if (typeof mVal === 'string' && mVal.trim()) {
        await setCategoryMedia(numId, mType, mVal.trim());
      } else if (mVal && mVal.image_url) {
        await setCategoryMedia(numId, mType, mVal.image_url, mVal.metadata);
      }
    }
  }

  try {
    const [rows] = await pool.execute(`
      SELECT
        c.*,
        COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.active = 1
      WHERE c.id = ?
      GROUP BY c.id
    `, [numId]);

    if (rows && rows.length > 0) {
      const cat = rows[0];
      const mediaMap = await fetchMediaForCategories([numId]);
      const catMedia = mediaMap[numId] || {};

      return {
        ...cat,
        image_url: cat.image_url || null,
        product_count: parseInt(cat.product_count, 10) || 0,
        media: {
          hero_light: catMedia['hero_light']?.image_url || (canonicalCat?.media?.hero_light || null),
          hero_dark: catMedia['hero_dark']?.image_url || (canonicalCat?.media?.hero_dark || null),
          banner: catMedia['banner']?.image_url || cat.image_url || null,
          thumbnail: catMedia['thumbnail']?.image_url || cat.image_url || null
        }
      };
    }
  } catch (err) {
    console.warn('[categoryService.updateCategory] Live DB fetch failed, returning updated state:', err.message);
  }

  if (canonicalCat) {
    return {
      ...canonicalCat,
      product_count: 0
    };
  }

  return null;
};

/**
 * Delete a category
 */
const deleteCategory = async (id, storeId = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid category ID');
  }

  const hasStoreId = await checkHasStoreId();
  const params = [numId];
  let storeCondition = '';
  if (hasStoreId && storeId !== null && storeId !== undefined) {
    const sId = parseInt(storeId, 10);
    if (sId === 1) {
      storeCondition = ' AND (store_id = 1 OR store_id IS NULL)';
    } else {
      storeCondition = ' AND store_id = ?';
      params.push(sId);
    }
  }

  const [result] = await pool.execute(`DELETE FROM categories WHERE id = ?${storeCondition}`, params);
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
