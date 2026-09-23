const { pool } = require('../config/database');
const { sanitizeProductImageUrl, safelyDeleteUploadedFile, safelyDeleteUploadedFileIfUnreferenced } = require('../utils/imageUtils');
const taxProfileService = require('./taxProfileService');

/**
 * Cache available columns in products table for backward-compatible queries
 */
let checkedColumns = null;
const checkProductColumns = async () => {
  if (checkedColumns !== null) return checkedColumns;
  try {
    const [cols] = await pool.execute("SHOW COLUMNS FROM products");
    const names = new Set(cols.map(c => c.Field));
    checkedColumns = {
      store_id: names.has('store_id'),
      short_description: names.has('short_description'),
      weight_grams: names.has('weight_grams'),
      dimensions_mm: names.has('dimensions_mm'),
      material_info: names.has('material_info'),
      production_notes: names.has('production_notes'),
      experience_override: names.has('experience_override'),
      is_best_seller: names.has('is_best_seller'),
      view_360_url: names.has('view_360_url'),
      lumo_light_image: names.has('lumo_light_image'),
      lumo_dark_image: names.has('lumo_dark_image'),
      lumo_light_360_url: names.has('lumo_light_360_url'),
      lumo_dark_360_url: names.has('lumo_dark_360_url'),
      hsn_code: names.has('hsn_code') && names.has('gst_rate'),
      category_hsn_code: false
    };
    try {
      const [catCols] = await pool.execute("SHOW COLUMNS FROM categories");
      const cn = new Set((catCols || []).map(c => c.Field));
      checkedColumns.category_hsn_code = cn.has('hsn_code') && cn.has('gst_rate');
    } catch (_) { /* categories not migrated */ }
  } catch (err) {
    checkedColumns = {
      store_id: false,
      short_description: false,
      weight_grams: false,
      dimensions_mm: false,
      material_info: false,
      production_notes: false,
      experience_override: false,
      is_best_seller: false,
      view_360_url: false,
      lumo_light_image: false,
      lumo_dark_image: false,
      lumo_light_360_url: false,
      lumo_dark_360_url: false,
      hsn_code: false,
      category_hsn_code: false
    };
  }
  return checkedColumns;
};

const resetColumnCheckCache = (mockCols = null) => {
  checkedColumns = mockCols;
};

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
 * Fetch list of products with filters & pagination
 */
const getProducts = async ({
  search,
  category_id,
  active,
  featured,
  is_best_seller,
  drop_status,
  store_id,
  limit = 50,
  offset = 0
} = {}) => {
  const cols = await checkProductColumns();
  const conditions = [];
  const params = [];

  if (cols.store_id && store_id) {
    conditions.push('(p.store_id = ? OR p.store_id IS NULL)');
    params.push(store_id);
  }

  if (active !== undefined && active !== null && active !== '') {
    conditions.push('p.active = ?');
    params.push(active === 'true' || active === 1 || active === '1' ? 1 : 0);
  }

  if (category_id !== undefined && category_id !== null && category_id !== '') {
    const numCategory = parseInt(category_id, 10);
    if (!isNaN(numCategory)) {
      conditions.push('p.category_id = ?');
      params.push(numCategory);
    } else {
      conditions.push('(c.slug = ? OR c.name = ?)');
      params.push(String(category_id).trim(), String(category_id).trim());
    }
  }

  if (featured !== undefined && featured !== null && featured !== '') {
    conditions.push('p.featured = ?');
    params.push(featured === 'true' || featured === 1 || featured === '1' ? 1 : 0);
  }

  if (cols.is_best_seller && is_best_seller !== undefined && is_best_seller !== null && is_best_seller !== '') {
    conditions.push('p.is_best_seller = ?');
    params.push(is_best_seller === 'true' || is_best_seller === 1 || is_best_seller === '1' ? 1 : 0);
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(p.name LIKE ? OR p.admin_product_id LIKE ? OR p.sku LIKE ?)');
    params.push(term, term, term);
  }

  if (drop_status) {
    const nowISO = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (drop_status === 'live') {
      conditions.push('p.active = 1 AND (p.scheduled_drop_time IS NULL OR p.scheduled_drop_time <= ?)');
      params.push(nowISO);
    } else if (drop_status === 'upcoming') {
      conditions.push('p.active = 1 AND p.scheduled_drop_time > ?');
      params.push(nowISO);
    } else if (drop_status === 'inactive') {
      conditions.push('p.active = 0');
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 1000);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM products p ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const selectCols = [
    'p.id',
    cols.store_id ? 'p.store_id' : '1 AS store_id',
    'p.admin_product_id',
    'p.category_id',
    'c.name AS category_name',
    'c.slug AS category_slug',
    'p.name',
    'p.sku',
    cols.short_description ? 'p.short_description' : 'NULL AS short_description',
    'p.description',
    'p.price',
    'p.compare_at_price',
    cols.weight_grams ? 'p.weight_grams' : 'NULL AS weight_grams',
    cols.dimensions_mm ? 'p.dimensions_mm' : 'NULL AS dimensions_mm',
    cols.material_info ? 'p.material_info' : 'NULL AS material_info',
    cols.production_notes ? 'p.production_notes' : 'NULL AS production_notes',
    cols.experience_override ? 'p.experience_override' : 'NULL AS experience_override',
    cols.is_best_seller ? 'p.is_best_seller' : '0 AS is_best_seller',
    cols.view_360_url ? 'p.view_360_url' : 'NULL AS view_360_url',
    cols.lumo_light_image ? 'p.lumo_light_image' : 'NULL AS lumo_light_image',
    cols.lumo_dark_image ? 'p.lumo_dark_image' : 'NULL AS lumo_dark_image',
    cols.lumo_light_360_url ? 'p.lumo_light_360_url' : 'NULL AS lumo_light_360_url',
    cols.lumo_dark_360_url ? 'p.lumo_dark_360_url' : 'NULL AS lumo_dark_360_url',
    cols.hsn_code ? 'p.hsn_code' : 'NULL AS hsn_code',
    cols.hsn_code ? 'p.gst_rate' : 'NULL AS gst_rate',
    cols.category_hsn_code ? 'c.hsn_code AS category_hsn_code' : 'NULL AS category_hsn_code',
    cols.category_hsn_code ? 'c.gst_rate AS category_gst_rate' : 'NULL AS category_gst_rate',
    'p.tags',
    'p.active',
    'p.featured',
    'p.scheduled_drop_time',
    'p.created_at',
    'p.updated_at',
    'pi.image_url AS primary_image_url',
    'pi.storage_path AS primary_storage_path',
    'COALESCE(inv.stock, 0) AS stock'
  ].join(', ');

  const query = `
    SELECT ${selectCols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
    LEFT JOIN product_variants pv ON p.id = pv.product_id AND pv.variant_slug = 'default'
    LEFT JOIN inventory inv ON (pv.id = inv.variant_id)
    ${whereClause}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  let imagesByProduct = {};
  if (rows.length > 0) {
    try {
      const prodIds = rows.map(r => r.id);
      const placeholders = prodIds.map(() => '?').join(',');
      const [imgRows] = await pool.execute(`
        SELECT id, product_id, image_url, storage_path, external_url, sort_order, is_primary
        FROM product_images
        WHERE product_id IN (${placeholders})
        ORDER BY sort_order ASC, id ASC
      `, prodIds);
      imgRows.forEach(img => {
        if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
        imagesByProduct[img.product_id].push(img);
      });
    } catch (err) {
      console.warn('[ProductImages Batch Fetch Warning]', err.message);
    }
  }

  const products = rows.map(r => {
    const prodImgs = imagesByProduct[r.id] || [];
    const primaryImg = prodImgs.find(i => i.is_primary) || prodImgs[0];
    const priceRupees = parseInt(r.price, 10) || 0;
    const compareAtRupees = r.compare_at_price !== null && r.compare_at_price !== undefined ? (parseInt(r.compare_at_price, 10) || 0) : null;
    return {
      ...r,
      price: priceRupees,
      price_rupees: priceRupees,
      compare_at_price: compareAtRupees,
      compare_at_price_rupees: compareAtRupees,
      images: prodImgs,
      primary_image_url: primaryImg ? primaryImg.image_url : r.primary_image_url,
      primary_storage_path: primaryImg ? primaryImg.storage_path : r.primary_storage_path,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || []),
      dimensions_mm: typeof r.dimensions_mm === 'string' ? JSON.parse(r.dimensions_mm) : (r.dimensions_mm || null),
      experience_override: r.experience_override || null,
      effective_experience: r.experience_override || 'normal',
      is_best_seller: r.is_best_seller === 1,
      view_360_url: r.view_360_url || null,
      lumo_light_image: r.lumo_light_image || null,
      lumo_dark_image: r.lumo_dark_image || null,
      lumo_light_360_url: r.lumo_light_360_url || null,
      lumo_dark_360_url: r.lumo_dark_360_url || null,
      ...taxProfileService.shapeTaxConfig(r)
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
 * Fetch a single product by numeric BIGINT ID or admin_product_id string with full relationships
 */
const getProductById = async (productIdOrAdminId, storeId = null) => {
  if (!productIdOrAdminId) return null;

  const numId = parseInt(productIdOrAdminId, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(productIdOrAdminId);
  const cols = await checkProductColumns();

  const selectCols = [
    'p.id',
    cols.store_id ? 'p.store_id' : '1 AS store_id',
    'p.admin_product_id',
    'p.category_id',
    'c.name AS category_name',
    'c.slug AS category_slug',
    'p.name',
    'p.sku',
    cols.short_description ? 'p.short_description' : 'NULL AS short_description',
    'p.description',
    'p.price',
    'p.compare_at_price',
    cols.weight_grams ? 'p.weight_grams' : 'NULL AS weight_grams',
    cols.dimensions_mm ? 'p.dimensions_mm' : 'NULL AS dimensions_mm',
    cols.material_info ? 'p.material_info' : 'NULL AS material_info',
    cols.production_notes ? 'p.production_notes' : 'NULL AS production_notes',
    cols.experience_override ? 'p.experience_override' : 'NULL AS experience_override',
    cols.is_best_seller ? 'p.is_best_seller' : '0 AS is_best_seller',
    cols.view_360_url ? 'p.view_360_url' : 'NULL AS view_360_url',
    cols.lumo_light_image ? 'p.lumo_light_image' : 'NULL AS lumo_light_image',
    cols.lumo_dark_image ? 'p.lumo_dark_image' : 'NULL AS lumo_dark_image',
    cols.lumo_light_360_url ? 'p.lumo_light_360_url' : 'NULL AS lumo_light_360_url',
    cols.lumo_dark_360_url ? 'p.lumo_dark_360_url' : 'NULL AS lumo_dark_360_url',
    cols.hsn_code ? 'p.hsn_code' : 'NULL AS hsn_code',
    cols.hsn_code ? 'p.gst_rate' : 'NULL AS gst_rate',
    cols.category_hsn_code ? 'c.hsn_code AS category_hsn_code' : 'NULL AS category_hsn_code',
    cols.category_hsn_code ? 'c.gst_rate AS category_gst_rate' : 'NULL AS category_gst_rate',
    'p.tags',
    'p.active',
    'p.featured',
    'p.scheduled_drop_time',
    'p.created_at',
    'p.updated_at'
  ].join(', ');

  const idCondition = isNumeric ? 'p.id = ?' : 'p.admin_product_id = ?';
  const queryParams = [isNumeric ? numId : String(productIdOrAdminId)];

  // Enforce store isolation: a product belonging to another store's store_id must
  // never be readable/writable through this legacy CHIPAKK service (prevents Store 1
  // requests from leaking or mutating Store 2 legacy-table rows preserved by migration 012).
  let storeCondition = '';
  if (cols.store_id && storeId !== null && storeId !== undefined) {
    storeCondition = ' AND (p.store_id = ? OR p.store_id IS NULL)';
    queryParams.push(storeId);
  }

  const productQuery = `
    SELECT ${selectCols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${idCondition}${storeCondition}
    LIMIT 1
  `;

  const [prodRows] = await pool.execute(productQuery, queryParams);
  if (!prodRows || prodRows.length === 0) return null;

  const product = prodRows[0];
  const numProductId = product.id;

  const priceRupees = parseInt(product.price, 10) || 0;
  const compareAtRupees = product.compare_at_price !== null && product.compare_at_price !== undefined ? (parseInt(product.compare_at_price, 10) || 0) : null;
  product.price = priceRupees;
  product.price_paise = priceRupees * 100;
  product.price_rupees = priceRupees;
  product.compare_at_price = compareAtRupees;
  product.compare_at_price_paise = compareAtRupees !== null ? compareAtRupees * 100 : null;
  product.compare_at_price_rupees = compareAtRupees;

  product.experience_override = product.experience_override || null;
  product.effective_experience = product.experience_override || 'normal';
  product.is_best_seller = product.is_best_seller === 1;
  product.view_360_url = product.view_360_url || null;
  product.lumo_light_image = product.lumo_light_image || null;
  product.lumo_dark_image = product.lumo_dark_image || null;
  product.lumo_light_360_url = product.lumo_light_360_url || null;
  product.lumo_dark_360_url = product.lumo_dark_360_url || null;
  Object.assign(product, taxProfileService.shapeTaxConfig(product));
  product.tags = typeof product.tags === 'string' ? JSON.parse(product.tags) : (product.tags || []);
  product.dimensions_mm = typeof product.dimensions_mm === 'string' ? JSON.parse(product.dimensions_mm) : (product.dimensions_mm || null);

  // 1. Fetch images
  const imagesQuery = `
    SELECT id, image_url, storage_path, external_url, sort_order, is_primary
    FROM product_images
    WHERE product_id = ?
    ORDER BY sort_order ASC, id ASC
  `;
  const [imageRows] = await pool.execute(imagesQuery, [numProductId]);
  product.images = imageRows;

  const primaryImg = imageRows.find(img => img.is_primary) || imageRows[0];
  product.primary_image_url = primaryImg ? primaryImg.image_url : null;
  product.primary_storage_path = primaryImg ? primaryImg.storage_path : null;

  // 2. Fetch options & option values
  try {
    const [optRows] = await pool.execute(`
      SELECT id, name, sort_order
      FROM product_options
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `, [numProductId]);

    if (optRows && optRows.length > 0) {
      const optIds = optRows.map(o => o.id);
      const valPlaceholders = optIds.map(() => '?').join(',');
      const [valRows] = await pool.execute(`
        SELECT id, option_id, value, sort_order
        FROM product_option_values
        WHERE option_id IN (${valPlaceholders})
        ORDER BY sort_order ASC, id ASC
      `, optIds);

      const valuesByOption = {};
      (valRows || []).forEach(v => {
        if (!valuesByOption[v.option_id]) valuesByOption[v.option_id] = [];
        valuesByOption[v.option_id].push({
          id: v.id,
          value: v.value,
          sort_order: v.sort_order
        });
      });

      product.options = optRows.map(o => ({
        id: o.id,
        name: o.name,
        sort_order: o.sort_order,
        values: valuesByOption[o.id] || []
      }));
    } else {
      product.options = [];
    }
  } catch (err) {
    product.options = [];
  }

  // 3. Fetch variants and inventory
  const variantsQuery = `
    SELECT
      pv.id AS variant_id,
      pv.variant_slug,
      pv.sku,
      pv.price,
      pv.option_combination,
      pv.active,
      COALESCE(inv.stock, 0) AS stock,
      COALESCE(inv.reserved_stock, 0) AS reserved_stock
    FROM product_variants pv
    LEFT JOIN inventory inv ON pv.id = inv.variant_id
    WHERE pv.product_id = ?
    ORDER BY pv.id ASC
  `;
  const [variantRows] = await pool.execute(variantsQuery, [numProductId]);
  product.variants = (variantRows || []).map(v => {
    const vPrice = parseInt(v.price, 10) || 0;
    let optComb = v.option_combination;
    if (typeof optComb === 'string') {
      try { optComb = JSON.parse(optComb); } catch (_) { optComb = {}; }
    } else if (!optComb || typeof optComb !== 'object') {
      optComb = {};
    }
    const totalStock = parseInt(v.stock, 10) || 0;
    const reserved = parseInt(v.reserved_stock, 10) || 0;
    const availableStock = Math.max(0, totalStock - reserved);
    return {
      ...v,
      id: v.variant_id,
      price: vPrice,
      price_rupees: vPrice,
      option_combination: optComb,
      stock: totalStock,
      available_stock: availableStock
    };
  });

  const defaultVar = variantRows.find(v => v.variant_slug === 'default') || variantRows[0];
  product.stock = defaultVar ? defaultVar.stock : 0;

  // 3. Fetch mapped materials (product_materials)
  try {
    const [matRows] = await pool.execute(`
      SELECT
        pm.material_id,
        pm.is_default,
        pm.price_modifier,
        m.name,
        m.type,
        m.color,
        m.color_hex,
        m.unit,
        m.cost
      FROM product_materials pm
      JOIN materials m ON pm.material_id = m.id
      WHERE pm.product_id = ?
    `, [numProductId]);
    product.materials = matRows;
  } catch (_) {
    product.materials = [];
  }

  // 4. Fetch mapped finishing options (product_finishing_options)
  try {
    const [finishRows] = await pool.execute(`
      SELECT
        pfo.finishing_option_id,
        pfo.is_default,
        fo.name,
        fo.price_modifier,
        fo.lead_time_days
      FROM product_finishing_options pfo
      JOIN finishing_options fo ON pfo.finishing_option_id = fo.id
      WHERE pfo.product_id = ?
    `, [numProductId]);
    product.finishing_options = finishRows;
  } catch (_) {
    product.finishing_options = [];
  }

  // 5. Fetch review rating stats
  const ratingQuery = `
    SELECT
      COALESCE(AVG(rating), 0) AS average_rating,
      COUNT(id) AS review_count
    FROM reviews
    WHERE product_id = ? AND status = 'approved'
  `;
  const [ratingRows] = await pool.execute(ratingQuery, [numProductId]);
  const avgRating = parseFloat(ratingRows[0]?.average_rating) || 0.0;
  const reviewCount = parseInt(ratingRows[0]?.review_count, 10) || 0;
  product.average_rating = Math.round(avgRating * 10) / 10;
  product.review_count = reviewCount;
  product.rating_tier = calculateRatingTier(avgRating);

  return product;
};

/**
 * Helper to resolve category ID by ID or name
 */
const resolveCategoryId = async (connection, categoryIdOrName) => {
  if (!categoryIdOrName) return null;
  const numId = parseInt(categoryIdOrName, 10);
  if (!isNaN(numId)) return numId;

  const [rows] = await connection.execute('SELECT id FROM categories WHERE name = ? LIMIT 1', [String(categoryIdOrName).trim()]);
  if (rows.length > 0) return rows[0].id;

  const catSlug = String(categoryIdOrName).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
  const [res] = await connection.execute('INSERT INTO categories (name, slug, active) VALUES (?, ?, 1)', [String(categoryIdOrName).trim(), catSlug]);
  return res.insertId;
};

/**
 * Create a new product in MySQL
 */
const createProduct = async (productData) => {
  const {
    name,
    store_id = 1,
    admin_product_id,
    sku,
    short_description,
    description,
    category_id,
    category_name,
    price = 0,
    compare_at_price = 0,
    weight_grams = null,
    dimensions_mm = null,
    material_info = null,
    production_notes = null,
    experience_override = null,
    tags = [],
    active = 1,
    featured = 0,
    scheduled_drop_time = null,
    is_best_seller = 0,
    view_360_url = null,
    lumo_light_image = null,
    lumo_dark_image = null,
    lumo_light_360_url = null,
    lumo_dark_360_url = null,
    hsn_code,
    gst_rate,
    images = [],
    materials = [],
    finishing_options = [],
    options = [],
    variants = [],
    stock
  } = productData;
  const taxCfg = taxProfileService.parseTaxConfigInput(productData); // validated HSN / GST rate (400 on bad input)

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Product name is required');
  }

  const safeAdminId = admin_product_id && String(admin_product_id).trim() ? String(admin_product_id).trim() : null;
  const generatedSku = (sku || safeAdminId ? `SKU-${safeAdminId}` : `SKU-${Date.now()}-${Math.floor(Math.random() * 1000)}`).trim();
  const safeDropTime = scheduled_drop_time ? new Date(scheduled_drop_time).toISOString().slice(0, 19).replace('T', ' ') : null;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const resolvedCatId = await resolveCategoryId(connection, category_id || category_name);
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean));
    const dimensionsJson = dimensions_mm ? (typeof dimensions_mm === 'string' ? dimensions_mm : JSON.stringify(dimensions_mm)) : null;

    const cols = await checkProductColumns();

    const insertFields = ['admin_product_id', 'category_id', 'name', 'sku', 'description', 'price', 'compare_at_price', 'tags', 'active', 'featured', 'scheduled_drop_time'];
    const insertValues = [
      safeAdminId,
      resolvedCatId,
      name.trim(),
      generatedSku,
      description || null,
      parseInt(price, 10) || 0,
      parseInt(compare_at_price, 10) || 0,
      tagsJson,
      active ? 1 : 0,
      featured ? 1 : 0,
      safeDropTime
    ];

    if (cols.store_id) {
      insertFields.push('store_id');
      insertValues.push(store_id || 1);
    }
    if (cols.short_description) {
      insertFields.push('short_description');
      insertValues.push(short_description || null);
    }
    if (cols.weight_grams) {
      insertFields.push('weight_grams');
      insertValues.push(weight_grams ? parseFloat(weight_grams) : null);
    }
    if (cols.dimensions_mm) {
      insertFields.push('dimensions_mm');
      insertValues.push(dimensionsJson);
    }
    if (cols.material_info) {
      insertFields.push('material_info');
      insertValues.push(material_info || null);
    }
    if (cols.production_notes) {
      insertFields.push('production_notes');
      insertValues.push(production_notes || null);
    }
    if (cols.experience_override) {
      insertFields.push('experience_override');
      insertValues.push(experience_override ? String(experience_override).trim() : null);
    }
    if (cols.is_best_seller) {
      insertFields.push('is_best_seller');
      insertValues.push(is_best_seller ? 1 : 0);
    }
    if (cols.view_360_url) {
      const effective360 = view_360_url || lumo_light_360_url || lumo_dark_360_url || null;
      insertFields.push('view_360_url');
      insertValues.push(effective360 ? String(effective360).trim() : null);
    }
    if (cols.lumo_light_image) {
      insertFields.push('lumo_light_image');
      insertValues.push(lumo_light_image ? String(lumo_light_image).trim() : null);
    }
    if (cols.lumo_dark_image) {
      insertFields.push('lumo_dark_image');
      insertValues.push(lumo_dark_image ? String(lumo_dark_image).trim() : null);
    }
    if (cols.lumo_light_360_url) {
      insertFields.push('lumo_light_360_url');
      insertValues.push(lumo_light_360_url ? String(lumo_light_360_url).trim() : null);
    }
    if (cols.lumo_dark_360_url) {
      insertFields.push('lumo_dark_360_url');
      insertValues.push(lumo_dark_360_url ? String(lumo_dark_360_url).trim() : null);
    }
    if (cols.hsn_code) {
      insertFields.push('hsn_code', 'gst_rate');
      insertValues.push(taxCfg.hsn_code.value, taxCfg.gst_rate.value);
    }

    const placeholders = insertFields.map(() => '?').join(', ');
    const insertProductQuery = `INSERT INTO products (${insertFields.join(', ')}) VALUES (${placeholders})`;

    const [prodResult] = await connection.execute(insertProductQuery, insertValues);
    const productId = prodResult.insertId;

    // 2. Insert images
    if (Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const img = typeof images[i] === 'string' ? { image_url: images[i] } : images[i];
        const rawUrl = img.image_url || img.url || '';
        const imgUrl = sanitizeProductImageUrl(rawUrl);
        if (imgUrl) {
          await connection.execute(
            `INSERT INTO product_images (product_id, image_url, storage_path, external_url, sort_order, is_primary) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              productId,
              imgUrl,
              img.storage_path || null,
              img.external_url || (imgUrl.startsWith('http') ? imgUrl : null),
              img.sort_order || i,
              i === 0 || img.is_primary ? 1 : 0
            ]
          );
        }
      }
    }

    // 3. Insert product options and values if provided
    if (Array.isArray(options) && options.length > 0) {
      for (let optIdx = 0; optIdx < options.length; optIdx++) {
        const opt = options[optIdx];
        const optName = typeof opt === 'string' ? opt : (opt.name || opt.title || '');
        if (!optName.trim()) continue;
        const [optRes] = await connection.execute(
          `INSERT INTO product_options (product_id, name, sort_order) VALUES (?, ?, ?)`,
          [productId, optName.trim(), opt.sort_order !== undefined ? opt.sort_order : optIdx]
        );
        const optionId = optRes.insertId;
        const values = Array.isArray(opt.values) ? opt.values : [];
        for (let valIdx = 0; valIdx < values.length; valIdx++) {
          const valItem = values[valIdx];
          const valStr = typeof valItem === 'string' ? valItem : (valItem.value || valItem.name || '');
          if (!valStr.trim()) continue;
          await connection.execute(
            `INSERT INTO product_option_values (option_id, value, sort_order) VALUES (?, ?, ?)`,
            [optionId, valStr.trim(), valItem.sort_order !== undefined ? valItem.sort_order : valIdx]
          );
        }
      }
    }

    // 4. Create variants and inventory
    if (Array.isArray(variants) && variants.length > 0) {
      for (let vIdx = 0; vIdx < variants.length; vIdx++) {
        const v = variants[vIdx];
        const vPrice = parseInt(v.price, 10) || parseInt(price, 10) || 0;
        const vComb = typeof v.option_combination === 'string' ? v.option_combination : JSON.stringify(v.option_combination || {});
        const baseSlug = v.variant_slug || (v.sku ? String(v.sku).toLowerCase().replace(/[^a-z0-9]+/g, '-') : `var-${vIdx + 1}`);
        const vSlug = `${productId}-${baseSlug}`;
        const vSku = (v.sku || `${generatedSku}-V${vIdx + 1}`).trim();
        const vActive = v.active === 0 || v.active === false ? 0 : 1;

        const [vRes] = await connection.execute(
          `INSERT INTO product_variants (product_id, variant_slug, sku, price, option_combination, active) VALUES (?, ?, ?, ?, ?, ?)`,
          [productId, vSlug, vSku, vPrice, vComb, vActive]
        );
        const vId = vRes.insertId;

        const vStock = v.stock !== undefined && v.stock !== null ? Math.max(parseInt(v.stock, 10) || 0, 0) : (stock !== undefined && stock !== null ? Math.max(parseInt(stock, 10) || 0, 0) : null);
        if (vStock !== null) {
          await connection.execute(
            `INSERT INTO inventory (variant_id, stock, reserved_stock) VALUES (?, ?, 0)`,
            [vId, vStock]
          );
        }
      }
    } else {
      // Default single variant
      const defaultVariantSlug = 'default';
      const [varResult] = await connection.execute(
        `INSERT INTO product_variants (product_id, variant_slug, sku, price, option_combination, active) VALUES (?, ?, ?, ?, ?, 1)`,
        [
          productId,
          defaultVariantSlug,
          generatedSku,
          parseInt(price, 10) || 0,
          JSON.stringify({})
        ]
      );

      const variantId = varResult.insertId;

      if (stock !== undefined && stock !== null) {
        const stockVal = Math.max(parseInt(stock, 10) || 0, 0);
        await connection.execute(
          `INSERT INTO inventory (variant_id, stock, reserved_stock) VALUES (?, ?, 0)`,
          [variantId, stockVal]
        );
      }
    }

    // 4. Map multiple materials (product_materials)
    if (Array.isArray(materials) && materials.length > 0) {
      for (let i = 0; i < materials.length; i++) {
        const mat = typeof materials[i] === 'object' ? materials[i] : { material_id: materials[i] };
        if (mat.material_id) {
          try {
            await connection.execute(
              `INSERT INTO product_materials (product_id, material_id, is_default, price_modifier) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_default = VALUES(is_default)`,
              [productId, mat.material_id, mat.is_default || (i === 0 ? 1 : 0), mat.price_modifier || 0]
            );
          } catch (_) {}
        }
      }
    }

    // 5. Map finishing options (product_finishing_options)
    if (Array.isArray(finishing_options) && finishing_options.length > 0) {
      for (let i = 0; i < finishing_options.length; i++) {
        const fo = typeof finishing_options[i] === 'object' ? finishing_options[i] : { finishing_option_id: finishing_options[i] };
        if (fo.finishing_option_id) {
          try {
            await connection.execute(
              `INSERT INTO product_finishing_options (product_id, finishing_option_id, is_default) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_default = VALUES(is_default)`,
              [productId, fo.finishing_option_id, fo.is_default || (i === 0 ? 1 : 0)]
            );
          } catch (_) {}
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
 * Update an existing product
 */
const updateProduct = async (id, updateData, storeId = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid product ID');

  const existing = await getProductById(numId, storeId);
  if (!existing) throw new Error(`Product #${id} not found`);

  const {
    name,
    sku,
    short_description,
    description,
    category_id,
    category_name,
    price,
    compare_at_price,
    weight_grams,
    dimensions_mm,
    material_info,
    production_notes,
    experience_override,
    tags,
    active,
    featured,
    scheduled_drop_time,
    is_best_seller,
    view_360_url,
    lumo_light_image,
    lumo_dark_image,
    lumo_light_360_url,
    lumo_dark_360_url,
    hsn_code,
    gst_rate,
    images,
    materials,
    finishing_options,
    options,
    variants,
    stock
  } = updateData;
  const taxCfg = taxProfileService.parseTaxConfigInput(updateData);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const cols = await checkProductColumns();
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (sku !== undefined) { updates.push('sku = ?'); params.push(sku.trim()); }
    if (cols.short_description && short_description !== undefined) {
      updates.push('short_description = ?');
      params.push(short_description || null);
    }
    if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }
    if (cols.weight_grams && weight_grams !== undefined) {
      updates.push('weight_grams = ?');
      params.push(weight_grams ? parseFloat(weight_grams) : null);
    }
    if (cols.dimensions_mm && dimensions_mm !== undefined) {
      updates.push('dimensions_mm = ?');
      params.push(dimensions_mm ? (typeof dimensions_mm === 'string' ? dimensions_mm : JSON.stringify(dimensions_mm)) : null);
    }
    if (cols.material_info && material_info !== undefined) {
      updates.push('material_info = ?');
      params.push(material_info || null);
    }
    if (cols.production_notes && production_notes !== undefined) {
      updates.push('production_notes = ?');
      params.push(production_notes || null);
    }
    if (cols.experience_override && experience_override !== undefined) {
      updates.push('experience_override = ?');
      params.push(experience_override ? String(experience_override).trim() : null);
    }

    if (category_id !== undefined || category_name !== undefined) {
      const resolvedCatId = await resolveCategoryId(connection, category_id || category_name);
      updates.push('category_id = ?');
      params.push(resolvedCatId);
    }

    if (price !== undefined) { updates.push('price = ?'); params.push(parseInt(price, 10) || 0); }
    if (compare_at_price !== undefined) { updates.push('compare_at_price = ?'); params.push(parseInt(compare_at_price, 10) || 0); }

    if (tags !== undefined) {
      const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim()).filter(Boolean));
      updates.push('tags = ?');
      params.push(tagsJson);
    }

    if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
    if (featured !== undefined) { updates.push('featured = ?'); params.push(featured ? 1 : 0); }
    if (scheduled_drop_time !== undefined) {
      const safeDropTime = scheduled_drop_time ? new Date(scheduled_drop_time).toISOString().slice(0, 19).replace('T', ' ') : null;
      updates.push('scheduled_drop_time = ?');
      params.push(safeDropTime);
    }
    if (cols.is_best_seller && is_best_seller !== undefined) {
      updates.push('is_best_seller = ?');
      params.push(is_best_seller ? 1 : 0);
    }
    if (cols.view_360_url && (view_360_url !== undefined || lumo_light_360_url !== undefined || lumo_dark_360_url !== undefined)) {
      const effective360 = view_360_url !== undefined ? view_360_url : (lumo_light_360_url || lumo_dark_360_url);
      updates.push('view_360_url = ?');
      params.push(effective360 ? String(effective360).trim() : null);
    }
    if (cols.lumo_light_image && lumo_light_image !== undefined) {
      updates.push('lumo_light_image = ?');
      params.push(lumo_light_image ? String(lumo_light_image).trim() : null);
    }
    if (cols.lumo_dark_image && lumo_dark_image !== undefined) {
      updates.push('lumo_dark_image = ?');
      params.push(lumo_dark_image ? String(lumo_dark_image).trim() : null);
    }
    if (cols.lumo_light_360_url && lumo_light_360_url !== undefined) {
      updates.push('lumo_light_360_url = ?');
      params.push(lumo_light_360_url ? String(lumo_light_360_url).trim() : null);
    }
    if (cols.lumo_dark_360_url && lumo_dark_360_url !== undefined) {
      updates.push('lumo_dark_360_url = ?');
      params.push(lumo_dark_360_url ? String(lumo_dark_360_url).trim() : null);
    }
    if (cols.hsn_code && taxCfg.hsn_code.provided) { updates.push('hsn_code = ?'); params.push(taxCfg.hsn_code.value); }
    if (cols.hsn_code && taxCfg.gst_rate.provided) { updates.push('gst_rate = ?'); params.push(taxCfg.gst_rate.value); }

    if (updates.length > 0) {
      const updateQuery = `UPDATE products SET ${updates.join(', ')} WHERE id = ?`;
      params.push(numId);
      await connection.execute(updateQuery, params);
    }

    // Update images if provided
    if (Array.isArray(images)) {
      await connection.execute('DELETE FROM product_images WHERE product_id = ?', [numId]);
      for (let i = 0; i < images.length; i++) {
        const img = typeof images[i] === 'string' ? { image_url: images[i] } : images[i];
        const rawUrl = img.image_url || img.url || '';
        const imgUrl = sanitizeProductImageUrl(rawUrl);
        if (imgUrl) {
          await connection.execute(
            `INSERT INTO product_images (product_id, image_url, storage_path, external_url, sort_order, is_primary) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              numId,
              imgUrl,
              img.storage_path || null,
              img.external_url || (imgUrl.startsWith('http') ? imgUrl : null),
              img.sort_order || i,
              i === 0 || img.is_primary ? 1 : 0
            ]
          );
        }
      }
    }

    // Update materials mapping if provided
    if (Array.isArray(materials)) {
      try {
        await connection.execute('DELETE FROM product_materials WHERE product_id = ?', [numId]);
        for (let i = 0; i < materials.length; i++) {
          const mat = typeof materials[i] === 'object' ? materials[i] : { material_id: materials[i] };
          if (mat.material_id) {
            await connection.execute(
              `INSERT INTO product_materials (product_id, material_id, is_default, price_modifier) VALUES (?, ?, ?, ?)`,
              [numId, mat.material_id, mat.is_default || (i === 0 ? 1 : 0), mat.price_modifier || 0]
            );
          }
        }
      } catch (_) {}
    }

    // Update finishing options mapping if provided
    if (Array.isArray(finishing_options)) {
      try {
        await connection.execute('DELETE FROM product_finishing_options WHERE product_id = ?', [numId]);
        for (let i = 0; i < finishing_options.length; i++) {
          const fo = typeof finishing_options[i] === 'object' ? finishing_options[i] : { finishing_option_id: finishing_options[i] };
          if (fo.finishing_option_id) {
            await connection.execute(
              `INSERT INTO product_finishing_options (product_id, finishing_option_id, is_default) VALUES (?, ?, ?)`,
              [numId, fo.finishing_option_id, fo.is_default || (i === 0 ? 1 : 0)]
            );
          }
        }
      } catch (_) {}
    }

    // Update options if provided
    if (Array.isArray(options)) {
      await connection.execute('DELETE FROM product_options WHERE product_id = ?', [numId]);
      for (let optIdx = 0; optIdx < options.length; optIdx++) {
        const opt = options[optIdx];
        const optName = typeof opt === 'string' ? opt : (opt.name || opt.title || '');
        if (!optName.trim()) continue;
        const [optRes] = await connection.execute(
          'INSERT INTO product_options (product_id, name, sort_order) VALUES (?, ?, ?)',
          [numId, optName.trim(), opt.sort_order !== undefined ? opt.sort_order : optIdx]
        );
        const optionId = optRes.insertId;
        const values = Array.isArray(opt.values) ? opt.values : [];
        for (let valIdx = 0; valIdx < values.length; valIdx++) {
          const valItem = values[valIdx];
          const valStr = typeof valItem === 'string' ? valItem : (valItem.value || valItem.name || '');
          if (!valStr.trim()) continue;
          await connection.execute(
            'INSERT INTO product_option_values (option_id, value, sort_order) VALUES (?, ?, ?)',
            [optionId, valStr.trim(), valItem.sort_order !== undefined ? valItem.sort_order : valIdx]
          );
        }
      }
    }

    // Update variants if provided
    if (Array.isArray(variants)) {
      if (variants.length > 0) {
        const [existingVariants] = await connection.execute(
          'SELECT id, sku, variant_slug FROM product_variants WHERE product_id = ?',
          [numId]
        );
        const existingById = new Map();
        const existingBySku = new Map();
        (existingVariants || []).forEach(ev => {
          existingById.set(Number(ev.id), ev);
          if (ev.sku) existingBySku.set(String(ev.sku).trim(), ev);
        });

        const retainedVariantIds = [];

        for (let vIdx = 0; vIdx < variants.length; vIdx++) {
          const v = variants[vIdx];
          const vPrice = parseInt(v.price, 10) || parseInt(price, 10) || parseInt(existing.price, 10) || 0;
          const vComb = typeof v.option_combination === 'string' ? v.option_combination : JSON.stringify(v.option_combination || {});
          const vActive = v.active === 0 || v.active === false ? 0 : 1;
          const vSku = (v.sku || `${existing.sku}-V${vIdx + 1}`).trim();
          const baseSlug = v.variant_slug || (vSku ? String(vSku).toLowerCase().replace(/[^a-z0-9]+/g, '-') : `var-${vIdx + 1}`);
          const vSlug = `${numId}-${baseSlug}`;

          let targetVarId = null;
          if (v.id && existingById.has(Number(v.id))) {
            targetVarId = Number(v.id);
            await connection.execute(
              'UPDATE product_variants SET sku = ?, price = ?, option_combination = ?, active = ? WHERE id = ?',
              [vSku, vPrice, vComb, vActive, targetVarId]
            );
          } else if (existingBySku.has(vSku)) {
            targetVarId = Number(existingBySku.get(vSku).id);
            await connection.execute(
              'UPDATE product_variants SET sku = ?, price = ?, option_combination = ?, active = ? WHERE id = ?',
              [vSku, vPrice, vComb, vActive, targetVarId]
            );
          } else {
            const [insRes] = await connection.execute(
              'INSERT INTO product_variants (product_id, variant_slug, sku, price, option_combination, active) VALUES (?, ?, ?, ?, ?, ?)',
              [numId, vSlug, vSku, vPrice, vComb, vActive]
            );
            targetVarId = insRes.insertId;
          }

          retainedVariantIds.push(targetVarId);

          if (v.stock !== undefined && v.stock !== null) {
            const stockVal = Math.max(parseInt(v.stock, 10) || 0, 0);
            await connection.execute(
              'INSERT INTO inventory (variant_id, stock, reserved_stock) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE stock = VALUES(stock)',
              [targetVarId, stockVal]
            );
          }
        }

        // Delete obsolete variants that were removed
        const obsoleteIds = (existingVariants || [])
          .map(ev => Number(ev.id))
          .filter(id => !retainedVariantIds.includes(id));

        if (obsoleteIds.length > 0) {
          const obsPlaceholders = obsoleteIds.map(() => '?').join(',');
          await connection.execute(
            `DELETE FROM product_variants WHERE product_id = ? AND id IN (${obsPlaceholders})`,
            [numId, ...obsoleteIds]
          );
        }
      }
    } else if (price !== undefined || stock !== undefined) {
      // Legacy fallback: update default variant price & stock if provided
      const [varRows] = await connection.execute('SELECT id FROM product_variants WHERE product_id = ? AND variant_slug = "default" LIMIT 1', [numId]);
      let defaultVariantId;

      if (varRows.length > 0) {
        defaultVariantId = varRows[0].id;
        if (price !== undefined) {
          await connection.execute('UPDATE product_variants SET price = ? WHERE id = ?', [parseInt(price, 10) || 0, defaultVariantId]);
        }
      } else {
        const [newVar] = await connection.execute(
          `INSERT INTO product_variants (product_id, variant_slug, sku, price, option_combination, active) VALUES (?, 'default', ?, ?, '{}', 1)`,
          [numId, sku || existing.sku, parseInt(price || existing.price, 10) || 0]
        );
        defaultVariantId = newVar.insertId;
      }

      if (stock !== undefined && stock !== null) {
        const stockVal = Math.max(parseInt(stock, 10) || 0, 0);
        await connection.execute(
          `INSERT INTO inventory (variant_id, stock, reserved_stock) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`,
          [defaultVariantId, stockVal]
        );
      }
    }

    await connection.commit();
    connection.release();

    return getProductById(numId, storeId);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Soft Deactivate a product by BIGINT ID
 */
const deleteProduct = async (id, storeId = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid product ID');

  const cols = await checkProductColumns();
  const params = [numId];
  let storeCondition = '';
  if (cols.store_id && storeId !== null && storeId !== undefined) {
    storeCondition = ' AND (store_id = ? OR store_id IS NULL)';
    params.push(storeId);
  }

  const [result] = await pool.execute(`UPDATE products SET active = 0 WHERE id = ?${storeCondition}`, params);
  return result.affectedRows > 0;
};

/**
 * Delete a product image from the database and remove local physical file safely.
 * Enforces Store 1 ownership and handles primary image re-assignment.
 *
 * @param {number|string} productId Product ID
 * @param {number|string} imageId Image ID in product_images
 * @param {number} [storeId=1] Store ID scope (defaults to Store 1 for CHIPAKK)
 * @returns {Promise<{deletedImageId: number, remainingImages: Array}>}
 */
const deleteProductImage = async (productId, imageId, storeId = 1) => {
  const numProductId = parseInt(productId, 10);
  const numImageId = parseInt(imageId, 10);
  if (isNaN(numProductId) || isNaN(numImageId)) {
    const err = new Error('Invalid product ID or image ID format');
    err.statusCode = 400;
    throw err;
  }

  const cols = await checkProductColumns();

  // 1. Verify product existence and enforce store ownership
  let prodQuery = 'SELECT id';
  if (cols.store_id) prodQuery += ', store_id';
  prodQuery += ' FROM products WHERE id = ?';

  const [productRows] = await pool.execute(prodQuery, [numProductId]);
  if (productRows.length === 0) {
    const err = new Error(`Product ${numProductId} not found`);
    err.statusCode = 404;
    throw err;
  }

  const product = productRows[0];
  if (cols.store_id && storeId !== null && storeId !== undefined) {
    const effectiveStoreId = product.store_id || 1;
    if (effectiveStoreId !== Number(storeId)) {
      const err = new Error(`Access denied. Product belongs to Store ${effectiveStoreId}, not Store ${storeId}`);
      err.statusCode = 403;
      throw err;
    }
  }

  // 2. Fetch target image to delete
  const [imgRows] = await pool.execute(
    'SELECT id, product_id, image_url, storage_path, sort_order, is_primary FROM product_images WHERE id = ? AND product_id = ?',
    [numImageId, numProductId]
  );
  if (imgRows.length === 0) {
    const err = new Error(`Image ${numImageId} not found on product ${numProductId}`);
    err.statusCode = 404;
    throw err;
  }

  const imageToDelete = imgRows[0];

  // 3. Remove DB record safely
  await pool.execute('DELETE FROM product_images WHERE id = ? AND product_id = ?', [numImageId, numProductId]);

  // 4. Safely delete physical file only if not referenced elsewhere in the database
  await safelyDeleteUploadedFileIfUnreferenced(imageToDelete.image_url, imageToDelete.storage_path, pool, { product_image_id: numImageId });

  // 5. Handle primary image deletion safely: promote next image to primary if deleted was primary
  if (imageToDelete.is_primary === 1) {
    const [remainingRows] = await pool.execute(
      'SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1',
      [numProductId]
    );
    if (remainingRows.length > 0) {
      await pool.execute(
        'UPDATE product_images SET is_primary = 1 WHERE id = ?',
        [remainingRows[0].id]
      );
    }
  }

  // 6. Fetch and return remaining images
  const [remainingImages] = await pool.execute(
    'SELECT id, product_id, image_url, storage_path, external_url, sort_order, is_primary FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC',
    [numProductId]
  );

  return {
    deletedImageId: numImageId,
    remainingImages
  };
};

/**
 * Reactivate a deactivated product by BIGINT ID
 */
const reactivateProduct = async (id, storeId = 1) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) throw new Error('Invalid product ID');

  const cols = await checkProductColumns();
  const params = [numId];
  let storeCondition = '';
  if (cols.store_id && storeId !== null && storeId !== undefined) {
    storeCondition = ' AND (store_id = ? OR store_id IS NULL)';
    params.push(storeId);
  }

  const [existing] = await pool.execute(`SELECT id FROM products WHERE id = ?${storeCondition}`, params);
  if (!existing || existing.length === 0) {
    const err = new Error(`Product ${numId} not found`);
    err.statusCode = 404;
    throw err;
  }

  await pool.execute(`UPDATE products SET active = 1 WHERE id = ?${storeCondition}`, params);
  await pool.execute('UPDATE product_variants SET active = 1 WHERE product_id = ?', [numId]);

  return getProductById(numId, storeId);
};

module.exports = {
  checkProductColumns,
  resetColumnCheckCache,
  calculateRatingTier,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  reactivateProduct
};
