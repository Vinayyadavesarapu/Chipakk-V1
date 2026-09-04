const { pool } = require('../config/database');

/**
 * Fetch list of products with filters
 * Uses parameterized SQL queries exclusively against MySQL schema.
 */
const getProducts = async ({ category_id, active = 1, featured, limit = 20, offset = 0 }) => {
  const conditions = [];
  const params = [];

  if (active !== undefined && active !== null) {
    conditions.push('p.active = ?');
    params.push(active ? 1 : 0);
  }

  if (category_id) {
    const numCategory = parseInt(category_id, 10);
    if (!isNaN(numCategory)) {
      conditions.push('p.category_id = ?');
      params.push(numCategory);
    }
  }

  if (featured !== undefined && featured !== null) {
    conditions.push('p.featured = ?');
    params.push(featured ? 1 : 0);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const query = `
    SELECT 
      p.id,
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
      p.created_at,
      p.updated_at,
      pi.image_url AS primary_image_url,
      pi.storage_path AS primary_storage_path
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = 1
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  params.push(parsedLimit, parsedOffset);

  const [rows] = await pool.execute(query, params);
  return rows;
};

/**
 * Fetch a single product by numeric BIGINT ID with full relationships:
 * primary image, image list, category, options with values, and variants with stock.
 */
const getProductById = async (productId) => {
  const numId = parseInt(productId, 10);
  if (isNaN(numId)) {
    return null;
  }

  // 1. Fetch base product record
  const productQuery = `
    SELECT 
      p.id,
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
      p.created_at,
      p.updated_at
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?
    LIMIT 1
  `;

  const [productRows] = await pool.execute(productQuery, [numId]);
  if (!productRows || productRows.length === 0) {
    return null;
  }

  const product = productRows[0];

  // 2. Fetch images
  const imagesQuery = `
    SELECT id, image_url, storage_path, external_url, sort_order, is_primary
    FROM product_images
    WHERE product_id = ?
    ORDER BY is_primary DESC, sort_order ASC
  `;
  const [imageRows] = await pool.execute(imagesQuery, [numId]);
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
  const [optionRows] = await pool.execute(optionsQuery, [numId]);

  // Group option values by option
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
  const [variantRows] = await pool.execute(variantsQuery, [numId]);
  product.variants = variantRows;

  return product;
};

module.exports = {
  getProducts,
  getProductById
};
