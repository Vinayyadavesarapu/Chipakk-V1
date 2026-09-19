const { pool } = require('../config/database');
const { isMarshansHybridCatalogEnabled } = require('../config/features');

/**
 * Allowed review statuses matching existing schema
 */
const ALLOWED_REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

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
 * Fetch list of customer reviews with filters & pagination
 */
const getReviews = async ({
  search,
  status,
  product_id,
  rating,
  store_id,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  const isHybrid = isMarshansHybridCatalogEnabled();

  if (store_id) {
    const sId = parseInt(store_id, 10);
    if (isHybrid && sId === 2) {
      conditions.push('r.store_id = 2 AND r.marshans_product_id IS NOT NULL AND mp.store_id = 2');
    } else if (sId === 1) {
      conditions.push('(COALESCE(r.store_id, 1) = 1 AND r.product_id IS NOT NULL AND (p.store_id = 1 OR p.store_id IS NULL))');
    } else {
      conditions.push('p.store_id = ?');
      params.push(sId);
    }
  }

  if (status && String(status).trim()) {
    conditions.push('r.status = ?');
    params.push(String(status).trim().toLowerCase());
  }

  if (product_id) {
    const numProdId = parseInt(product_id, 10);
    if (!isNaN(numProdId)) {
      if (isHybrid) {
        conditions.push('((r.store_id = 2 AND r.marshans_product_id = ?) OR (COALESCE(r.store_id, 1) = 1 AND r.product_id = ?))');
        params.push(numProdId, numProdId);
      } else {
        conditions.push('r.product_id = ?');
        params.push(numProdId);
      }
    }
  }

  if (rating !== undefined && rating !== null && rating !== '') {
    const numRating = parseInt(rating, 10);
    if (!isNaN(numRating)) {
      conditions.push('r.rating = ?');
      params.push(numRating);
    }
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(r.comment LIKE ? OR r.customer_name LIKE ? OR p.name LIKE ?)');
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total count query
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM reviews r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN marshans_products mp ON r.marshans_product_id = mp.id
    ${whereClause}
  `;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const query = `
    SELECT
      r.id,
      r.store_id,
      r.product_id,
      r.marshans_product_id,
      COALESCE(mp.name, p.name) AS product_name,
      COALESCE(mp.admin_product_id, p.admin_product_id) AS admin_product_id,
      r.customer_id,
      r.customer_name,
      u.email AS customer_email,
      r.rating,
      r.comment,
      r.status,
      r.created_at,
      r.updated_at
    FROM reviews r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN marshans_products mp ON r.marshans_product_id = mp.id
    LEFT JOIN users u ON r.customer_id = u.id
    ${whereClause}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const reviews = rows.map(r => ({
    id: r.id,
    store_id: r.store_id || (r.marshans_product_id ? 2 : 1),
    product_id: r.product_id,
    marshans_product_id: r.marshans_product_id || null,
    product_name: r.product_name || 'Deleted Product',
    admin_product_id: r.admin_product_id || null,
    customer_id: r.customer_id || null,
    customer_name: r.customer_name || (r.customer_email ? r.customer_email.split('@')[0] : 'Anonymous Customer'),
    customer_email: r.customer_email || null,
    rating: parseInt(r.rating, 10),
    comment: r.comment || '',
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    reviews
  };
};

/**
 * Fetch single review by BIGINT ID
 */
const getReviewById = async (reviewId, store_id = null) => {
  if (!reviewId) return null;

  const numId = parseInt(reviewId, 10);
  if (isNaN(numId)) return null;

  const params = [numId];
  let storeCondition = '';
  if (store_id !== null && store_id !== undefined) {
    const activeStoreId = parseInt(store_id, 10) === 2 ? 2 : 1;
    storeCondition = activeStoreId === 2
      ? ' AND r.store_id = 2 AND r.marshans_product_id IS NOT NULL AND mp.store_id = 2'
      : ' AND COALESCE(r.store_id, 1) = 1 AND r.product_id IS NOT NULL AND (p.store_id = 1 OR p.store_id IS NULL)';
  }

  const query = `
    SELECT
      r.id,
      r.store_id,
      r.product_id,
      r.marshans_product_id,
      COALESCE(mp.name, p.name) AS product_name,
      COALESCE(mp.admin_product_id, p.admin_product_id) AS admin_product_id,
      r.customer_id,
      r.customer_name,
      u.email AS customer_email,
      r.rating,
      r.comment,
      r.status,
      r.created_at,
      r.updated_at
    FROM reviews r
    LEFT JOIN products p ON r.product_id = p.id
    LEFT JOIN marshans_products mp ON r.marshans_product_id = mp.id
    LEFT JOIN users u ON r.customer_id = u.id
    WHERE r.id = ?${storeCondition}
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, params);
  if (!rows || rows.length === 0) {
    return null;
  }

  const r = rows[0];
  return {
    id: r.id,
    store_id: r.store_id || (r.marshans_product_id ? 2 : 1),
    product_id: r.product_id,
    marshans_product_id: r.marshans_product_id || null,
    product_name: r.product_name || 'Deleted Product',
    admin_product_id: r.admin_product_id || null,
    customer_id: r.customer_id || null,
    customer_name: r.customer_name || (r.customer_email ? r.customer_email.split('@')[0] : 'Anonymous Customer'),
    customer_email: r.customer_email || null,
    rating: parseInt(r.rating, 10),
    comment: r.comment || '',
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
};

/**
 * Create a new customer review with store scoping & product validation
 */
const createReview = async ({
  store_id = 1,
  product_id,
  customer_id = null,
  customer_name,
  rating,
  comment = '',
  status = 'pending'
} = {}) => {
  const activeStoreId = parseInt(store_id, 10) === 2 ? 2 : 1;
  const numProdId = parseInt(product_id, 10);
  const numRating = parseInt(rating, 10);

  if (isNaN(numProdId)) {
    throw new Error('Valid product ID is required.');
  }

  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    throw new Error('Rating must be an integer between 1 and 5.');
  }

  const isHybrid = isMarshansHybridCatalogEnabled();
  let validProductId = null;
  let validMarshansProductId = null;

  if (isHybrid && activeStoreId === 2) {
    // Validate in marshans_products
    const [rows] = await pool.execute(
      'SELECT id, name FROM marshans_products WHERE id = ? AND store_id = 2 AND active = 1 LIMIT 1',
      [numProdId]
    );
    if (!rows || rows.length === 0) {
      throw new Error(`Product #${numProdId} does not exist in THE MARSHANS catalog.`);
    }
    validMarshansProductId = rows[0].id;
  } else {
    // Validate in products
    const [rows] = await pool.execute(
      'SELECT id, name, store_id FROM products WHERE id = ? AND (store_id = 1 OR store_id IS NULL) AND active = 1 LIMIT 1',
      [numProdId]
    );
    if (!rows || rows.length === 0) {
      throw new Error(`Product #${numProdId} does not exist in CHIPAKK catalog.`);
    }
    validProductId = rows[0].id;
  }

  const query = `
    INSERT INTO reviews (
      store_id,
      product_id,
      marshans_product_id,
      customer_id,
      customer_name,
      rating,
      comment,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const [result] = await pool.execute(query, [
    activeStoreId,
    validProductId,
    validMarshansProductId,
    customer_id ? parseInt(customer_id, 10) : null,
    customer_name ? String(customer_name).trim() : 'Anonymous',
    numRating,
    comment ? String(comment).trim() : '',
    ALLOWED_REVIEW_STATUSES.includes(status) ? status : 'pending'
  ]);

  return getReviewById(result.insertId);
};

/**
 * Update review status, rating, and/or comment
 */
const updateReview = async (id, updateData = {}, store_id = null) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid review ID format.');
  }

  const existing = await getReviewById(numId, store_id);
  if (!existing) {
    return null;
  }

  const { rating, comment, status } = updateData;

  const updates = [];
  const params = [];

  if (status !== undefined) {
    const rawStatus = String(status || '').trim().toLowerCase();
    if (!ALLOWED_REVIEW_STATUSES.includes(rawStatus)) {
      throw new Error(`Invalid status. Allowed values: ${ALLOWED_REVIEW_STATUSES.join(', ')}`);
    }
    updates.push('status = ?');
    params.push(rawStatus);
  }

  if (rating !== undefined) {
    const numRating = parseInt(rating, 10);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      throw new Error('Rating must be an integer between 1 and 5.');
    }
    updates.push('rating = ?');
    params.push(numRating);
  }

  if (comment !== undefined) {
    updates.push('comment = ?');
    params.push(comment !== null ? String(comment).trim() : null);
  }

  if (updates.length > 0) {
    const query = `UPDATE reviews SET ${updates.join(', ')} WHERE id = ?`;
    params.push(numId);
    await pool.execute(query, params);
  }

  return getReviewById(numId, store_id);
};

module.exports = {
  ALLOWED_REVIEW_STATUSES,
  calculateRatingTier,
  getReviews,
  getReviewById,
  createReview,
  updateReview
};
