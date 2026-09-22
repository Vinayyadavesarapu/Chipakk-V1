const { pool } = require('../config/database');
const { sanitizeProductImageUrl, safelyDeleteUploadedFile } = require('../utils/imageUtils');

/**
 * Calculate derived rating tier based on average product rating
 */
const calculateRatingTier = (rating) => {
  const r = Math.round((parseFloat(rating) || 0.0) * 10) / 10;
  if (r >= 4.9) return 'LEGENDARY';
  if (r >= 4.7) return 'RARE';
  if (r >= 4.4) return 'EPIC';
  if (r >= 4.0) return 'UNCOMMON';
  if (r >= 3.0) return 'COMMON';
  return 'BASIC';
};

/**
 * Resolve Category ID in marshans_categories by numeric ID or name
 */
const resolveMarshansCategoryId = async (connection, categoryIdOrName) => {
  if (!categoryIdOrName) return null;
  const numId = parseInt(categoryIdOrName, 10);
  if (!isNaN(numId)) {
    const [rows] = await connection.execute(
      'SELECT id FROM marshans_categories WHERE id = ? AND store_id = 2 LIMIT 1',
      [numId]
    );
    return rows.length > 0 ? rows[0].id : null;
  }

  const trimmedName = String(categoryIdOrName).trim();
  const [rows] = await connection.execute(
    'SELECT id FROM marshans_categories WHERE name = ? AND store_id = 2 LIMIT 1',
    [trimmedName]
  );
  if (rows.length > 0) return rows[0].id;

  // If not found by name, create it in marshans_categories
  const catSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const [res] = await connection.execute(
    'INSERT INTO marshans_categories (store_id, name, slug, active) VALUES (2, ?, ?, 1)',
    [trimmedName, catSlug]
  );
  return res.insertId;
};

const taxProfileService = require('./taxProfileService');

/** Optional GST configuration columns (migration 017): queried lazily so an un-migrated database keeps working. */
let taxColumnSupport = null;
const checkTaxColumns = async () => {
  if (taxColumnSupport !== null) return taxColumnSupport;
  const support = { products: false, categories: false };
  try {
    const [p] = await pool.execute("SHOW COLUMNS FROM marshans_products LIKE 'hsn_code'");
    support.products = Array.isArray(p) && p.length > 0;
    const [c] = await pool.execute("SHOW COLUMNS FROM marshans_categories LIKE 'hsn_code'");
    support.categories = Array.isArray(c) && c.length > 0;
  } catch (_) { /* not migrated */ }
  taxColumnSupport = support;
  return support;
};
const taxSelectCols = (t) => [
  t.products ? 'p.hsn_code' : 'NULL AS hsn_code', t.products ? 'p.gst_rate' : 'NULL AS gst_rate',
  t.categories ? 'c.hsn_code AS category_hsn_code' : 'NULL AS category_hsn_code', t.categories ? 'c.gst_rate AS category_gst_rate' : 'NULL AS category_gst_rate'
];

/**
 * Fetch list of Marshans 3D products with pagination, search, and category filters
 */
const getProducts = async ({
  search,
  category_id,
  active,
  featured,
  is_best_seller,
  drop_status,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  conditions.push('p.store_id = 2');

  // 1. Search filter
  if (search && typeof search === 'string' && search.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push('(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ? OR p.admin_product_id LIKE ?)');
    params.push(term, term, term, term);
  }

  // 2. Category filter
  if (category_id !== undefined && category_id !== null && category_id !== '') {
    const numCatId = parseInt(category_id, 10);
    if (!isNaN(numCatId)) {
      conditions.push('p.category_id = ?');
      params.push(numCatId);
    } else {
      conditions.push('(c.slug = ? OR c.name = ?)');
      params.push(String(category_id).trim(), String(category_id).trim());
    }
  }

  // 3. Active filter
  if (active !== undefined && active !== null && active !== '') {
    conditions.push('p.active = ?');
    params.push(active === 'true' || active === 1 || active === '1' ? 1 : 0);
  }

  // 4. Featured filter
  if (featured !== undefined && featured !== null && featured !== '') {
    conditions.push('p.featured = ?');
    params.push(featured === 'true' || featured === 1 || featured === '1' ? 1 : 0);
  }

  // 5. Best Seller filter
  if (is_best_seller !== undefined && is_best_seller !== null && is_best_seller !== '') {
    conditions.push('p.is_best_seller = ?');
    params.push(is_best_seller === 'true' || is_best_seller === 1 || is_best_seller === '1' ? 1 : 0);
  }

  // 6. Scheduled Drop Status filter
  if (drop_status) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (drop_status === 'dropped') {
      conditions.push('(p.scheduled_drop_time IS NULL OR p.scheduled_drop_time <= ?)');
      params.push(now);
    } else if (drop_status === 'upcoming') {
      conditions.push('(p.scheduled_drop_time IS NOT NULL AND p.scheduled_drop_time > ?)');
      params.push(now);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total count query
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM marshans_products p
    ${whereClause}
  `;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  // Main products query
  const taxSupport = await checkTaxColumns();
  const selectCols = [
    'p.id',
    'p.store_id',
    'p.admin_product_id',
    'p.category_id',
    'c.name AS category_name',
    'c.slug AS category_slug',
    'p.name',
    'p.sku',
    'p.short_description',
    'p.description',
    'p.price',
    'p.compare_at_price',
    'p.weight_grams',
    'p.dimensions_mm',
    'p.material_info',
    'p.production_notes',
    'p.experience_override',
    'p.is_best_seller',
    'p.view_360_url',
    'p.lumo_light_image',
    'p.lumo_dark_image',
    'p.lumo_light_360_url',
    'p.lumo_dark_360_url',
    ...taxSelectCols(taxSupport),
    'p.tags',
    'p.active',
    'p.featured',
    'p.scheduled_drop_time',
    'p.created_at',
    'p.updated_at',
    'pi.image_url AS primary_image_url',
    'pi.storage_path AS primary_storage_path'
  ].join(', ');

  const query = `
    SELECT ${selectCols}
    FROM marshans_products p
    LEFT JOIN marshans_categories c ON p.category_id = c.id AND c.store_id = 2
    LEFT JOIN marshans_product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
    ${whereClause}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  // Batch fetch gallery images
  let imagesByProduct = {};
  if (rows.length > 0) {
    try {
      const prodIds = rows.map(r => r.id);
      const placeholders = prodIds.map(() => '?').join(',');
      const [imgRows] = await pool.execute(`
        SELECT id, product_id, image_url, storage_path, external_url, sort_order, is_primary
        FROM marshans_product_images
        WHERE product_id IN (${placeholders})
        ORDER BY sort_order ASC, id ASC
      `, prodIds);
      imgRows.forEach(img => {
        if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
        imagesByProduct[img.product_id].push(img);
      });
    } catch (err) {
      console.warn('[MarshansProductImages Batch Fetch Warning]', err.message);
    }
  }

  const products = rows.map(r => {
    const prodImgs = imagesByProduct[r.id] || [];
    const primaryImg = prodImgs.find(i => i.is_primary) || prodImgs[0];
    const pricePaise = parseInt(r.price, 10) || 0;
    const compareAtPaise = r.compare_at_price !== null && r.compare_at_price !== undefined ? (parseInt(r.compare_at_price, 10) || 0) : null;
    return {
      ...r,
      price: pricePaise,
      price_paise: pricePaise,
      price_rupees: Math.round(pricePaise / 100),
      compare_at_price: compareAtPaise,
      compare_at_price_paise: compareAtPaise,
      compare_at_price_rupees: compareAtPaise !== null ? Math.round(compareAtPaise / 100) : null,
      images: prodImgs,
      primary_image_url: primaryImg ? primaryImg.image_url : r.primary_image_url,
      primary_storage_path: primaryImg ? primaryImg.storage_path : r.primary_storage_path,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || []),
      dimensions_mm: typeof r.dimensions_mm === 'string' ? JSON.parse(r.dimensions_mm) : (r.dimensions_mm || null),
      experience_override: r.experience_override || null,
      effective_experience: r.experience_override || 'normal',
      is_best_seller: r.is_best_seller === 1,
      ...taxProfileService.shapeTaxConfig(r),
      view_360_url: r.view_360_url || null,
      lumo_light_image: r.lumo_light_image || null,
      lumo_dark_image: r.lumo_dark_image || null,
      lumo_light_360_url: r.lumo_light_360_url || r.view_360_url || null,
      lumo_dark_360_url: r.lumo_dark_360_url || null
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    products
  };
};

/**
 * Fetch a single Marshans 3D product by numeric ID or string Admin Product ID
 */
const getProductById = async (productIdOrAdminId) => {
  if (!productIdOrAdminId) return null;

  const numId = parseInt(productIdOrAdminId, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(productIdOrAdminId).trim();

  const taxSupport = await checkTaxColumns();
  const selectCols = [
    'p.id',
    'p.store_id',
    'p.admin_product_id',
    'p.category_id',
    'c.name AS category_name',
    'c.slug AS category_slug',
    'p.name',
    'p.sku',
    'p.short_description',
    'p.description',
    'p.price',
    'p.compare_at_price',
    'p.weight_grams',
    'p.dimensions_mm',
    'p.material_info',
    'p.production_notes',
    'p.experience_override',
    'p.is_best_seller',
    'p.view_360_url',
    'p.lumo_light_image',
    'p.lumo_dark_image',
    'p.lumo_light_360_url',
    'p.lumo_dark_360_url',
    ...taxSelectCols(taxSupport),
    'p.tags',
    'p.active',
    'p.featured',
    'p.scheduled_drop_time',
    'p.created_at',
    'p.updated_at'
  ].join(', ');

  const productQuery = `
    SELECT ${selectCols}
    FROM marshans_products p
    LEFT JOIN marshans_categories c ON p.category_id = c.id AND c.store_id = 2
    WHERE p.store_id = 2 AND ${isNumeric ? 'p.id = ?' : 'p.admin_product_id = ?'}
    LIMIT 1
  `;

  const [prodRows] = await pool.execute(productQuery, [isNumeric ? numId : String(productIdOrAdminId)]);
  if (!prodRows || prodRows.length === 0) return null;

  const product = prodRows[0];
  const numProductId = product.id;

  const pricePaise = parseInt(product.price, 10) || 0;
  const compareAtPaise = product.compare_at_price !== null && product.compare_at_price !== undefined ? (parseInt(product.compare_at_price, 10) || 0) : null;
  product.price = pricePaise;
  product.price_paise = pricePaise;
  product.price_rupees = Math.round(pricePaise / 100);
  product.compare_at_price = compareAtPaise;
  product.compare_at_price_paise = compareAtPaise;
  product.compare_at_price_rupees = compareAtPaise !== null ? Math.round(compareAtPaise / 100) : null;

  product.experience_override = product.experience_override || null;
  product.effective_experience = product.experience_override || 'normal';
  product.is_best_seller = product.is_best_seller === 1;
  Object.assign(product, taxProfileService.shapeTaxConfig(product));
  product.view_360_url = product.view_360_url || null;
  product.lumo_light_image = product.lumo_light_image || null;
  product.lumo_dark_image = product.lumo_dark_image || null;
  product.lumo_light_360_url = product.lumo_light_360_url || product.view_360_url || null;
  product.lumo_dark_360_url = product.lumo_dark_360_url || null;
  product.tags = typeof product.tags === 'string' ? JSON.parse(product.tags) : (product.tags || []);
  product.dimensions_mm = typeof product.dimensions_mm === 'string' ? JSON.parse(product.dimensions_mm) : (product.dimensions_mm || null);

  // 1. Fetch images from marshans_product_images
  const imagesQuery = `
    SELECT id, product_id, image_url, storage_path, external_url, sort_order, is_primary
    FROM marshans_product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
  `;
  const [imageRows] = await pool.execute(imagesQuery, [numProductId]);
  product.images = imageRows || [];

  const primaryImg = product.images.find(i => i.is_primary) || product.images[0];
  product.primary_image_url = primaryImg ? primaryImg.image_url : null;
  product.primary_storage_path = primaryImg ? primaryImg.storage_path : null;

  // 2. Fetch mapped 3D materials from marshans_product_materials JOIN materials
  try {
    const [matRows] = await pool.execute(`
      SELECT
        pm.material_id,
        pm.is_default,
        pm.price_modifier,
        m.name,
        m.type AS material_type,
        m.color AS color_name,
        m.color_hex,
        m.unit,
        m.cost
      FROM marshans_product_materials pm
      JOIN materials m ON pm.material_id = m.id
      WHERE pm.product_id = ?
    `, [numProductId]);
    product.materials = matRows;
  } catch (_) {
    product.materials = [];
  }

  // 3. Fetch mapped finishing options from marshans_product_finishing_options JOIN finishing_options
  try {
    const [finishRows] = await pool.execute(`
      SELECT
        pfo.finishing_option_id,
        pfo.is_default,
        fo.name,
        fo.price_modifier,
        fo.lead_time_days
      FROM marshans_product_finishing_options pfo
      JOIN finishing_options fo ON pfo.finishing_option_id = fo.id
      WHERE pfo.product_id = ?
    `, [numProductId]);
    product.finishing_options = finishRows;
  } catch (_) {
    product.finishing_options = [];
  }

  // 4. Fetch review rating stats from reviews WHERE marshans_product_id = ?
  try {
    const ratingQuery = `
      SELECT
        COALESCE(AVG(rating), 0) AS average_rating,
        COUNT(id) AS review_count
      FROM reviews
      WHERE marshans_product_id = ? AND store_id = 2 AND status = 'approved'
    `;
    const [ratingRows] = await pool.execute(ratingQuery, [numProductId]);
    const avgRating = parseFloat(ratingRows[0]?.average_rating) || 0.0;
    const reviewCount = parseInt(ratingRows[0]?.review_count, 10) || 0;
    product.average_rating = Math.round(avgRating * 10) / 10;
    product.review_count = reviewCount;
    product.rating_tier = calculateRatingTier(avgRating);
  } catch (_) {
    product.average_rating = 4.7;
    product.review_count = 0;
    product.rating_tier = 'RARE';
  }

  return product;
};

/**
 * Create a new Marshans 3D product in marshans_products
 */
const createProduct = async (productData) => {
  const {
    admin_product_id,
    name,
    sku,
    short_description,
    description,
    price,
    compare_at_price = 0,
    category_id,
    category_name,
    weight_grams,
    dimensions_mm,
    material_info,
    production_notes,
    experience_override,
    is_best_seller = 0,
    view_360_url,
    lumo_light_image,
    lumo_dark_image,
    lumo_light_360_url,
    lumo_dark_360_url,
    hsn_code,
    gst_rate,
    tags = [],
    images = [],
    material_ids = [],
    finishing_option_ids = [],
    scheduled_drop_time,
    active = 1,
    featured = 0
  } = productData;
  const taxCfg = taxProfileService.parseTaxConfigInput(productData);

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Product name is required');
  }

  const safeAdminId = admin_product_id && String(admin_product_id).trim() ? String(admin_product_id).trim() : null;
  const generatedSku = (sku || (safeAdminId ? `SKU-${safeAdminId}` : `SKU-MRSH-${Date.now()}-${Math.floor(Math.random() * 1000)}`)).trim();
  const safeDropTime = scheduled_drop_time ? new Date(scheduled_drop_time).toISOString().slice(0, 19).replace('T', ' ') : null;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const resolvedCatId = await resolveMarshansCategoryId(connection, category_id || category_name);
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean));
    const dimensionsJson = dimensions_mm ? (typeof dimensions_mm === 'string' ? dimensions_mm : JSON.stringify(dimensions_mm)) : null;

    // Automatic 360 compatibility fallback
    const effective360 = view_360_url || lumo_light_360_url || lumo_dark_360_url || null;

    const insertFields = [
      'store_id',
      'admin_product_id',
      'category_id',
      'name',
      'sku',
      'short_description',
      'description',
      'price',
      'compare_at_price',
      'weight_grams',
      'dimensions_mm',
      'material_info',
      'production_notes',
      'experience_override',
      'is_best_seller',
      'view_360_url',
      'lumo_light_image',
      'lumo_dark_image',
      'lumo_light_360_url',
      'lumo_dark_360_url',
      'tags',
      'active',
      'featured',
      'scheduled_drop_time'
    ];

    const insertValues = [
      2, // store_id strictly 2 for THE MARSHANS
      safeAdminId,
      resolvedCatId,
      name.trim(),
      generatedSku,
      short_description || null,
      description || null,
      parseInt(price, 10) || 0,
      parseInt(compare_at_price, 10) || 0,
      weight_grams ? parseFloat(weight_grams) : null,
      dimensionsJson,
      material_info || null,
      production_notes || null,
      experience_override ? String(experience_override).trim() : null,
      is_best_seller ? 1 : 0,
      effective360 ? String(effective360).trim() : null,
      lumo_light_image ? String(lumo_light_image).trim() : null,
      lumo_dark_image ? String(lumo_dark_image).trim() : null,
      lumo_light_360_url ? String(lumo_light_360_url).trim() : null,
      lumo_dark_360_url ? String(lumo_dark_360_url).trim() : null,
      tagsJson,
      active ? 1 : 0,
      featured ? 1 : 0,
      safeDropTime
    ];
    if (taxCfg.hsn_code.provided || taxCfg.gst_rate.provided) {
      if ((await checkTaxColumns()).products) { insertFields.push('hsn_code', 'gst_rate'); insertValues.push(taxCfg.hsn_code.value, taxCfg.gst_rate.value); }
    }

    const placeholders = insertFields.map(() => '?').join(', ');
    const insertQuery = `INSERT INTO marshans_products (${insertFields.join(', ')}) VALUES (${placeholders})`;

    const [prodResult] = await connection.execute(insertQuery, insertValues);
    const productId = prodResult.insertId;

    // 1. Insert product images
    if (Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const img = typeof images[i] === 'string' ? { image_url: images[i] } : images[i];
        const rawUrl = img.image_url || img.url || '';
        const imgUrl = sanitizeProductImageUrl(rawUrl);
        if (imgUrl) {
          await connection.execute(
            'INSERT INTO marshans_product_images (product_id, image_url, storage_path, sort_order, is_primary) VALUES (?, ?, ?, ?, ?)',
            [productId, imgUrl, img.storage_path || null, i, i === 0 ? 1 : 0]
          );
        }
      }
    }

    // 2. Insert materials mappings
    if (Array.isArray(material_ids) && material_ids.length > 0) {
      for (let i = 0; i < material_ids.length; i++) {
        const mId = parseInt(material_ids[i], 10);
        if (!isNaN(mId)) {
          await connection.execute(
            'INSERT INTO marshans_product_materials (product_id, material_id, is_default) VALUES (?, ?, ?)',
            [productId, mId, i === 0 ? 1 : 0]
          );
        }
      }
    }

    // 3. Insert finishing options mappings
    if (Array.isArray(finishing_option_ids) && finishing_option_ids.length > 0) {
      for (let i = 0; i < finishing_option_ids.length; i++) {
        const fId = parseInt(finishing_option_ids[i], 10);
        if (!isNaN(fId)) {
          await connection.execute(
            'INSERT INTO marshans_product_finishing_options (product_id, finishing_option_id, is_default) VALUES (?, ?, ?)',
            [productId, fId, i === 0 ? 1 : 0]
          );
        }
      }
    }

    await connection.commit();
    connection.release();

    return getProductById(productId);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Update an existing Marshans 3D product in marshans_products
 */
const updateProduct = async (id, updateData) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid product ID');

  const existing = await getProductById(numId);
  if (!existing) return null;

  const {
    admin_product_id,
    name,
    sku,
    short_description,
    description,
    price,
    compare_at_price,
    category_id,
    category_name,
    weight_grams,
    dimensions_mm,
    material_info,
    production_notes,
    experience_override,
    is_best_seller,
    view_360_url,
    lumo_light_image,
    lumo_dark_image,
    lumo_light_360_url,
    lumo_dark_360_url,
    hsn_code,
    gst_rate,
    tags,
    images,
    material_ids,
    finishing_option_ids,
    scheduled_drop_time,
    active,
    featured
  } = updateData;
  const taxCfg = taxProfileService.parseTaxConfigInput(updateData);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const updates = [];
    const params = [];

    if (admin_product_id !== undefined) {
      updates.push('admin_product_id = ?');
      params.push(admin_product_id ? String(admin_product_id).trim() : null);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(String(name).trim());
    }
    if (sku !== undefined) {
      updates.push('sku = ?');
      params.push(String(sku).trim());
    }
    if (short_description !== undefined) {
      updates.push('short_description = ?');
      params.push(short_description || null);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description || null);
    }
    if (price !== undefined) {
      updates.push('price = ?');
      params.push(parseInt(price, 10) || 0);
    }
    if (compare_at_price !== undefined) {
      updates.push('compare_at_price = ?');
      params.push(parseInt(compare_at_price, 10) || 0);
    }
    if (weight_grams !== undefined) {
      updates.push('weight_grams = ?');
      params.push(weight_grams ? parseFloat(weight_grams) : null);
    }
    if (dimensions_mm !== undefined) {
      updates.push('dimensions_mm = ?');
      params.push(dimensions_mm ? (typeof dimensions_mm === 'string' ? dimensions_mm : JSON.stringify(dimensions_mm)) : null);
    }
    if (material_info !== undefined) {
      updates.push('material_info = ?');
      params.push(material_info || null);
    }
    if (production_notes !== undefined) {
      updates.push('production_notes = ?');
      params.push(production_notes || null);
    }
    if (experience_override !== undefined) {
      updates.push('experience_override = ?');
      params.push(experience_override ? String(experience_override).trim() : null);
    }
    if (is_best_seller !== undefined) {
      updates.push('is_best_seller = ?');
      params.push(is_best_seller ? 1 : 0);
    }
    if ((taxCfg.hsn_code.provided || taxCfg.gst_rate.provided) && (await checkTaxColumns()).products) {
      if (taxCfg.hsn_code.provided) { updates.push('hsn_code = ?'); params.push(taxCfg.hsn_code.value); }
      if (taxCfg.gst_rate.provided) { updates.push('gst_rate = ?'); params.push(taxCfg.gst_rate.value); }
    }
    if (category_id !== undefined || category_name !== undefined) {
      const resolvedCatId = await resolveMarshansCategoryId(connection, category_id || category_name);
      updates.push('category_id = ?');
      params.push(resolvedCatId);
    }
    if (tags !== undefined) {
      const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean));
      updates.push('tags = ?');
      params.push(tagsJson);
    }
    if (active !== undefined) {
      updates.push('active = ?');
      params.push(active ? 1 : 0);
    }
    if (featured !== undefined) {
      updates.push('featured = ?');
      params.push(featured ? 1 : 0);
    }
    if (scheduled_drop_time !== undefined) {
      const safeDropTime = scheduled_drop_time ? new Date(scheduled_drop_time).toISOString().slice(0, 19).replace('T', ' ') : null;
      updates.push('scheduled_drop_time = ?');
      params.push(safeDropTime);
    }

    // 360 & LUMO fields
    if (view_360_url !== undefined || lumo_light_360_url !== undefined || lumo_dark_360_url !== undefined) {
      const effective360 = view_360_url !== undefined ? view_360_url : (lumo_light_360_url || lumo_dark_360_url);
      updates.push('view_360_url = ?');
      params.push(effective360 ? String(effective360).trim() : null);
    }
    if (lumo_light_image !== undefined) {
      updates.push('lumo_light_image = ?');
      params.push(lumo_light_image ? String(lumo_light_image).trim() : null);
    }
    if (lumo_dark_image !== undefined) {
      updates.push('lumo_dark_image = ?');
      params.push(lumo_dark_image ? String(lumo_dark_image).trim() : null);
    }
    if (lumo_light_360_url !== undefined) {
      updates.push('lumo_light_360_url = ?');
      params.push(lumo_light_360_url ? String(lumo_light_360_url).trim() : null);
    }
    if (lumo_dark_360_url !== undefined) {
      updates.push('lumo_dark_360_url = ?');
      params.push(lumo_dark_360_url ? String(lumo_dark_360_url).trim() : null);
    }

    if (updates.length > 0) {
      const updateQuery = `UPDATE marshans_products SET ${updates.join(', ')} WHERE id = ? AND store_id = 2`;
      params.push(numId);
      await connection.execute(updateQuery, params);
    }

    // Update images if provided
    if (Array.isArray(images)) {
      await connection.execute('DELETE FROM marshans_product_images WHERE product_id = ?', [numId]);
      for (let i = 0; i < images.length; i++) {
        const img = typeof images[i] === 'string' ? { image_url: images[i] } : images[i];
        const rawUrl = img.image_url || img.url || '';
        const imgUrl = sanitizeProductImageUrl(rawUrl);
        if (imgUrl) {
          await connection.execute(
            'INSERT INTO marshans_product_images (product_id, image_url, storage_path, sort_order, is_primary) VALUES (?, ?, ?, ?, ?)',
            [numId, imgUrl, img.storage_path || null, i, i === 0 ? 1 : 0]
          );
        }
      }
    }

    // Update materials if provided
    if (Array.isArray(material_ids)) {
      await connection.execute('DELETE FROM marshans_product_materials WHERE product_id = ?', [numId]);
      for (let i = 0; i < material_ids.length; i++) {
        const mId = parseInt(material_ids[i], 10);
        if (!isNaN(mId)) {
          await connection.execute(
            'INSERT INTO marshans_product_materials (product_id, material_id, is_default) VALUES (?, ?, ?)',
            [numId, mId, i === 0 ? 1 : 0]
          );
        }
      }
    }

    // Update finishing options if provided
    if (Array.isArray(finishing_option_ids)) {
      await connection.execute('DELETE FROM marshans_product_finishing_options WHERE product_id = ?', [numId]);
      for (let i = 0; i < finishing_option_ids.length; i++) {
        const fId = parseInt(finishing_option_ids[i], 10);
        if (!isNaN(fId)) {
          await connection.execute(
            'INSERT INTO marshans_product_finishing_options (product_id, finishing_option_id, is_default) VALUES (?, ?, ?)',
            [numId, fId, i === 0 ? 1 : 0]
          );
        }
      }
    }

    await connection.commit();
    connection.release();

    return getProductById(numId);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Soft Deactivate a Marshans 3D product
 */
const deleteProduct = async (id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid product ID');

  const [result] = await pool.execute('UPDATE marshans_products SET active = 0 WHERE id = ? AND store_id = 2', [numId]);
  return result.affectedRows > 0;
};

/**
 * Delete a product image from marshans_product_images and remove local physical file safely.
 *
 * @param {number|string} productId Product ID
 * @param {number|string} imageId Image ID in marshans_product_images
 * @param {number} [storeId=2] Store ID scope
 * @returns {Promise<{deletedImageId: number, remainingImages: Array}>}
 */
const deleteProductImage = async (productId, imageId, storeId = 2) => {
  const numProductId = parseInt(productId, 10);
  const numImageId = parseInt(imageId, 10);
  if (isNaN(numProductId) || isNaN(numImageId)) {
    const err = new Error('Invalid product ID or image ID format');
    err.statusCode = 400;
    throw err;
  }

  // 1. Verify product existence and Store 2 ownership
  const [productRows] = await pool.execute(
    'SELECT id, store_id FROM marshans_products WHERE id = ?',
    [numProductId]
  );
  if (productRows.length === 0) {
    const err = new Error(`Marshans product ${numProductId} not found`);
    err.statusCode = 404;
    throw err;
  }

  const product = productRows[0];
  if (storeId !== null && storeId !== undefined && Number(product.store_id) !== Number(storeId)) {
    const err = new Error(`Access denied. Product belongs to Store ${product.store_id}, not Store ${storeId}`);
    err.statusCode = 403;
    throw err;
  }

  // 2. Fetch target image to delete
  const [imgRows] = await pool.execute(
    'SELECT id, product_id, image_url, storage_path, sort_order, is_primary FROM marshans_product_images WHERE id = ? AND product_id = ?',
    [numImageId, numProductId]
  );
  if (imgRows.length === 0) {
    const err = new Error(`Image ${numImageId} not found on Marshans product ${numProductId}`);
    err.statusCode = 404;
    throw err;
  }

  const imageToDelete = imgRows[0];

  // 3. Remove DB record safely
  await pool.execute('DELETE FROM marshans_product_images WHERE id = ? AND product_id = ?', [numImageId, numProductId]);

  // 4. Safely delete physical file if local upload
  safelyDeleteUploadedFile(imageToDelete.image_url, imageToDelete.storage_path);

  // 5. Promote next image to primary if deleted was primary
  if (imageToDelete.is_primary === 1) {
    const [remainingRows] = await pool.execute(
      'SELECT id FROM marshans_product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1',
      [numProductId]
    );
    if (remainingRows.length > 0) {
      await pool.execute(
        'UPDATE marshans_product_images SET is_primary = 1 WHERE id = ?',
        [remainingRows[0].id]
      );
    }
  }

  // 6. Fetch and return remaining images
  const [remainingImages] = await pool.execute(
    'SELECT id, product_id, image_url, storage_path, sort_order, is_primary FROM marshans_product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC',
    [numProductId]
  );

  return {
    deletedImageId: numImageId,
    remainingImages
  };
};

module.exports = {
  calculateRatingTier,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage
};
