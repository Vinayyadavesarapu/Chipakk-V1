const { pool } = require('../config/database');

/**
 * Calculate derived rating tier based on average product rating
 * 0.0-2.9 -> BASIC
 * 3.0-3.9 -> COMMON
 * 4.0-4.3 -> UNCOMMON
 * 4.4-4.6 -> EPIC
 * 4.7-4.8 -> RARE
 * 4.9-5.0 -> LEGENDARY
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
 * Supports search (name, admin_product_id, sku), category, active status, drop status, and pagination.
 */
const getProducts = async ({
  search,
  category_id,
  active,
  featured,
  drop_status,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  if (active !== undefined && active !== null && active !== '') {
    conditions.push('p.active = ?');
    params.push(active === 'true' || active === 1 || active === '1' ? 1 : 0);
  }

  if (category_id) {
    const numCategory = parseInt(category_id, 10);
    if (!isNaN(numCategory)) {
      conditions.push('p.category_id = ?');
      params.push(numCategory);
    }
  }

  if (featured !== undefined && featured !== null && featured !== '') {
    conditions.push('p.featured = ?');
    params.push(featured === 'true' || featured === 1 || featured === '1' ? 1 : 0);
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

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM products p ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const query = `
    SELECT 
      p.id,
      p.admin_product_id,
      p.category_id,
      c.name AS category_name,
      p.name,
      p.sku,
      p.description,
      p.price,
      p.compare_at_price,
      p.tags,
      p.active,
      p.featured,
      p.scheduled_drop_time,
      p.created_at,
      p.updated_at,
      pi.image_url AS primary_image_url,
      pi.storage_path AS primary_storage_path,
      COALESCE(inv.stock, 0) AS stock
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

  const products = rows.map(r => ({
    ...r,
    tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || [])
  }));

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    products
  };
};

/**
 * Fetch a single product by numeric BIGINT ID or admin_product_id string with full relationships:
 * primary image, image list, category, options with values, and variants with stock.
 */
const getProductById = async (productIdOrAdminId) => {
  if (!productIdOrAdminId) return null;

  const numId = parseInt(productIdOrAdminId, 10);
  const isNumeric = !isNaN(numId) && String(numId) === String(productIdOrAdminId);

  const productQuery = `
    SELECT 
      p.id,
      p.admin_product_id,
      p.category_id,
      c.name AS category_name,
      c.slug AS category_slug,
      p.name,
      p.sku,
      p.description,
      p.price,
      p.compare_at_price,
      p.tags,
      p.active,
      p.featured,
      p.scheduled_drop_time,
      p.created_at,
      p.updated_at
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${isNumeric ? 'p.id = ?' : 'p.admin_product_id = ?'}
    LIMIT 1
  `;

  const param = isNumeric ? numId : String(productIdOrAdminId).trim();
  const [productRows] = await pool.execute(productQuery, [param]);

  if (!productRows || productRows.length === 0) {
    return null;
  }

  const product = productRows[0];
  const numProductId = product.id;
  product.tags = typeof product.tags === 'string' ? JSON.parse(product.tags) : (product.tags || []);

  // 2. Fetch images
  const imagesQuery = `
    SELECT id, image_url, storage_path, external_url, sort_order, is_primary
    FROM product_images
    WHERE product_id = ?
    ORDER BY is_primary DESC, sort_order ASC
  `;
  const [imageRows] = await pool.execute(imagesQuery, [numProductId]);
  product.images = imageRows;

  // 3. Fetch options and values
  const optionsQuery = `
    SELECT 
      po.id AS option_id,
      po.name AS option_name,
      po.sort_order AS option_sort_order,
      pov.id AS value_id,
      pov.value AS option_value,
      pov.sort_order AS value_sort_order
    FROM product_options po
    LEFT JOIN product_option_values pov ON po.id = pov.option_id
    WHERE po.product_id = ?
    ORDER BY po.sort_order ASC, pov.sort_order ASC
  `;
  const [optionRows] = await pool.execute(optionsQuery, [numProductId]);

  const optionsMap = new Map();
  optionRows.forEach(row => {
    if (!optionsMap.has(row.option_id)) {
      optionsMap.set(row.option_id, {
        id: row.option_id,
        name: row.option_name,
        sort_order: row.option_sort_order,
        values: []
      });
    }
    if (row.value_id) {
      optionsMap.get(row.option_id).values.push({
        id: row.value_id,
        value: row.option_value,
        sort_order: row.value_sort_order
      });
    }
  });
  product.options = Array.from(optionsMap.values());

  // 4. Fetch variants and inventory
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
  product.variants = variantRows;

  const defaultVar = variantRows.find(v => v.variant_slug === 'default') || variantRows[0];
  product.stock = defaultVar ? defaultVar.stock : 0;

  // 5. Fetch review rating stats & derived rating tier
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
 * Expects price in paise (INTEGER).
 */
const createProduct = async (productData) => {
  const {
    name,
    admin_product_id,
    sku,
    description,
    category_id,
    category_name,
    price = 0,
    compare_at_price = 0,
    tags = [],
    active = 1,
    featured = 0,
    scheduled_drop_time = null,
    images = [],
    stock
  } = productData;

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

    // 1. Insert base product
    const insertProductQuery = `
      INSERT INTO products (
        admin_product_id, category_id, name, sku, description, price, compare_at_price, tags, active, featured, scheduled_drop_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [prodResult] = await connection.execute(insertProductQuery, [
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
    ]);

    const productId = prodResult.insertId;

    // 2. Insert images
    if (Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const img = typeof images[i] === 'string' ? { image_url: images[i] } : images[i];
        const imgUrl = img.image_url || img.url || '';
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

    // 3. Create default variant
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
 * Update an existing product in MySQL
 */
const updateProduct = async (id, productData) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid product ID');
  }

  const existing = await getProductById(numId);
  if (!existing) {
    return null;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      name,
      admin_product_id,
      sku,
      description,
      category_id,
      category_name,
      price,
      compare_at_price,
      tags,
      active,
      featured,
      scheduled_drop_time,
      images,
      stock
    } = productData;

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (admin_product_id !== undefined) {
      updates.push('admin_product_id = ?');
      params.push(admin_product_id && String(admin_product_id).trim() ? String(admin_product_id).trim() : null);
    }
    if (sku !== undefined) { updates.push('sku = ?'); params.push(sku.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }

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
        const imgUrl = img.image_url || img.url || '';
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

    // Update default variant price & stock if provided
    if (price !== undefined || stock !== undefined) {
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

    return getProductById(numId);
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * Soft Deactivate a product by BIGINT ID
 * Preserves historical order line item integrity by setting active = 0.
 */
const deleteProduct = async (id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid product ID');
  }

  const [result] = await pool.execute('UPDATE products SET active = 0 WHERE id = ?', [numId]);
  return result.affectedRows > 0;
};

module.exports = {
  calculateRatingTier,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
};
