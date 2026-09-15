const { pool } = require('../config/database');
const { isMarshansHybridCatalogEnabled } = require('../config/features');

/**
 * Safe JSON parser
 */
const safeJsonParse = (val, fallback = null) => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (_) {
    return fallback;
  }
};

/**
 * Resolve or create active cart for user or session
 */
const getOrCreateCart = async ({ userId = null, storeId = 1, sessionId = null, connection = null } = {}) => {
  const conn = connection || pool;
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const numUserId = userId ? parseInt(userId, 10) : null;
  const safeSessionId = sessionId && typeof sessionId === 'string' ? sessionId.trim() : null;

  if (!numUserId && !safeSessionId) {
    const err = new Error('Either userId or sessionId is required to resolve a cart.');
    err.statusCode = 400;
    throw err;
  }

  let cart = null;

  if (numUserId) {
    const [rows] = await conn.execute(
      'SELECT id, user_id, store_id, session_id, status, created_at, updated_at FROM carts WHERE user_id = ? AND store_id = ? AND status = "active" ORDER BY id DESC LIMIT 1',
      [numUserId, activeStoreId]
    );
    if (rows && rows.length > 0) {
      cart = rows[0];
    }
  } else if (safeSessionId) {
    const [rows] = await conn.execute(
      'SELECT id, user_id, store_id, session_id, status, created_at, updated_at FROM carts WHERE session_id = ? AND store_id = ? AND status = "active" ORDER BY id DESC LIMIT 1',
      [safeSessionId, activeStoreId]
    );
    if (rows && rows.length > 0) {
      cart = rows[0];
    }
  }

  if (!cart) {
    const [insertResult] = await conn.execute(
      'INSERT INTO carts (user_id, store_id, session_id, status) VALUES (?, ?, ?, "active")',
      [numUserId, activeStoreId, safeSessionId]
    );
    const newCartId = insertResult.insertId;
    const [newRows] = await conn.execute(
      'SELECT id, user_id, store_id, session_id, status, created_at, updated_at FROM carts WHERE id = ? LIMIT 1',
      [newCartId]
    );
    cart = newRows[0];
  }

  return cart;
};

/**
 * Get Cart with items and formatted monetary totals
 */
const getCart = async ({ userId = null, storeId = 1, sessionId = null, connection = null } = {}) => {
  const conn = connection || pool;
  const cart = await getOrCreateCart({ userId, storeId, sessionId, connection: conn });

  const [itemRows] = await conn.execute(
    'SELECT id, cart_id, product_id, marshans_product_id, variant_id, quantity, unit_price, product_name, sku, image_url, options_snapshot, created_at, updated_at FROM cart_items WHERE cart_id = ? ORDER BY id ASC',
    [cart.id]
  );

  for (const item of itemRows || []) {
    const hasChipakkProduct = item.product_id !== null && item.product_id !== undefined;
    const hasMarshansProduct = item.marshans_product_id !== null && item.marshans_product_id !== undefined;
    if (hasChipakkProduct === hasMarshansProduct) {
      const err = new Error('Corrupt cart item: Exactly one catalog product ID must be populated.');
      err.statusCode = 500;
      throw err;
    }
  }

  let subtotalPaise = 0;
  let totalItems = 0;

  const items = (itemRows || []).map(row => {
    const qty = parseInt(row.quantity, 10) || 1;
    const unitPaise = parseInt(row.unit_price, 10) || 0;
    const lineTotalPaise = unitPaise * qty;

    subtotalPaise += lineTotalPaise;
    totalItems += qty;

    return {
      id: row.id,
      cart_id: row.cart_id,
      product_id: row.product_id,
      marshans_product_id: row.marshans_product_id,
      variant_id: row.variant_id,
      product_name: row.product_name,
      sku: row.sku,
      image_url: row.image_url,
      quantity: qty,
      unit_price_paise: unitPaise,
      unit_price_rupees: Math.round(unitPaise / 100),
      total_price_paise: lineTotalPaise,
      total_price_rupees: Math.round(lineTotalPaise / 100),
      options_snapshot: safeJsonParse(row.options_snapshot, null),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });

  return {
    id: cart.id,
    user_id: cart.user_id,
    store_id: cart.store_id,
    session_id: cart.session_id,
    status: cart.status,
    total_items: totalItems,
    subtotal_paise: subtotalPaise,
    subtotal_rupees: Math.round(subtotalPaise / 100),
    items,
    created_at: cart.created_at,
    updated_at: cart.updated_at
  };
};

/**
 * Add item to cart with store isolation and image resolution
 */
const addItem = async ({
  userId = null,
  storeId = 1,
  sessionId = null,
  productId,
  variantId = null,
  quantity = 1,
  options = null,
  connection = null
} = {}) => {
  const conn = connection || pool;
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;
  const numProductId = parseInt(productId, 10);
  const qty = Math.max(parseInt(quantity, 10) || 1, 1);

  if (isNaN(numProductId)) {
    const err = new Error('Valid numeric product ID is required.');
    err.statusCode = 400;
    throw err;
  }

  const isHybridMarshans = isMarshansHybridCatalogEnabled() && activeStoreId === 2;

  let validatedProduct = null;
  let unitPricePaise = 0;
  let productName = '';
  let sku = null;
  let resolvedImageUrl = null;
  let resolvedVariantId = null;

  if (isHybridMarshans) {
    // Look up in isolated marshans_products
    const [mpRows] = await conn.execute(
      'SELECT id, name, sku, price, active, lumo_light_image FROM marshans_products WHERE id = ? AND store_id = 2 LIMIT 1',
      [numProductId]
    );

    if (!mpRows || mpRows.length === 0 || !mpRows[0].active) {
      const err = new Error(`Product #${numProductId} is invalid or not available in THE MARSHANS catalog.`);
      err.statusCode = 400;
      throw err;
    }

    validatedProduct = mpRows[0];
    productName = validatedProduct.name;
    sku = validatedProduct.sku;
    unitPricePaise = parseInt(validatedProduct.price, 10) || 0;
    resolvedImageUrl = validatedProduct.lumo_light_image || null;

    // Resolve primary image from marshans_product_images if available
    try {
      const [imgRows] = await conn.execute(
        'SELECT image_url FROM marshans_product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1',
        [numProductId]
      );
      if (imgRows && imgRows.length > 0 && imgRows[0].image_url) {
        resolvedImageUrl = imgRows[0].image_url;
      }
    } catch (_) {}
  } else {
    // Look up in Store 1 products catalog
    const [pRows] = await conn.execute(
      'SELECT id, name, sku, price, active, image_url, store_id FROM products WHERE id = ? AND (store_id = 1 OR store_id IS NULL) LIMIT 1',
      [numProductId]
    );

    if (!pRows || pRows.length === 0 || !pRows[0].active) {
      const err = new Error(`Product #${numProductId} is invalid or not available in CHIPAKK catalog.`);
      err.statusCode = 400;
      throw err;
    }

    validatedProduct = pRows[0];
    // Enforce store isolation: Store 1 cannot add Store 2 product
    if (validatedProduct.store_id && parseInt(validatedProduct.store_id, 10) === 2) {
      const err = new Error(`Product #${numProductId} belongs to THE MARSHANS and cannot be added to CHIPAKK cart.`);
      err.statusCode = 400;
      throw err;
    }

    productName = validatedProduct.name;
    sku = validatedProduct.sku;
    unitPricePaise = parseInt(validatedProduct.price, 10) || 0;
    resolvedImageUrl = validatedProduct.image_url || null;

    // Variant validation
    if (variantId) {
      const numVarId = parseInt(variantId, 10);
      if (!isNaN(numVarId)) {
        const [vRows] = await conn.execute(
          'SELECT id, sku, price, active FROM product_variants WHERE id = ? AND product_id = ? LIMIT 1',
          [numVarId, numProductId]
        );
        if (vRows && vRows.length > 0 && vRows[0].active) {
          resolvedVariantId = vRows[0].id;
          unitPricePaise = parseInt(vRows[0].price, 10) || unitPricePaise;
          if (vRows[0].sku) sku = vRows[0].sku;
        }
      }
    }
  }

  const cart = await getOrCreateCart({ userId, storeId: activeStoreId, sessionId, connection: conn });

  // Deduplicate existing item in cart
  let existingItem = null;
  if (isHybridMarshans) {
    const [existingRows] = await conn.execute(
      'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND marshans_product_id = ? LIMIT 1',
      [cart.id, validatedProduct.id]
    );
    if (existingRows && existingRows.length > 0) {
      existingItem = existingRows[0];
    }
  } else {
    const query = resolvedVariantId !== null
      ? 'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? AND variant_id = ? LIMIT 1'
      : 'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ? AND variant_id IS NULL LIMIT 1';
    const params = resolvedVariantId !== null
      ? [cart.id, validatedProduct.id, resolvedVariantId]
      : [cart.id, validatedProduct.id];

    const [existingRows] = await conn.execute(query, params);
    if (existingRows && existingRows.length > 0) {
      existingItem = existingRows[0];
    }
  }

  const optionsJson = options ? JSON.stringify(options) : null;

  if (existingItem) {
    const newQuantity = existingItem.quantity + qty;
    await conn.execute(
      'UPDATE cart_items SET quantity = ?, unit_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newQuantity, unitPricePaise, existingItem.id]
    );
  } else {
    const targetProductId = isHybridMarshans ? null : validatedProduct.id;
    const targetMarshansProductId = isHybridMarshans ? validatedProduct.id : null;

    if ((!targetProductId && !targetMarshansProductId) || (targetProductId && targetMarshansProductId)) {
      const err = new Error('Cart invariant violation: Exactly one of product_id or marshans_product_id must be populated.');
      err.statusCode = 400;
      throw err;
    }

    await conn.execute(
      `INSERT INTO cart_items (
        cart_id, product_id, marshans_product_id, variant_id, quantity,
        unit_price, product_name, sku, image_url, options_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cart.id,
        targetProductId,
        targetMarshansProductId,
        resolvedVariantId,
        qty,
        unitPricePaise,
        productName,
        sku,
        resolvedImageUrl,
        optionsJson
      ]
    );
  }

  return getCart({ userId, storeId: activeStoreId, sessionId, connection: conn });
};

/**
 * Update cart item quantity
 */
const updateItem = async ({
  userId = null,
  storeId = 1,
  sessionId = null,
  itemId,
  quantity,
  connection = null
} = {}) => {
  const conn = connection || pool;
  const numItemId = parseInt(itemId, 10);
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;

  if (isNaN(numItemId)) {
    const err = new Error('Invalid cart item ID.');
    err.statusCode = 400;
    throw err;
  }

  const [itemRows] = await conn.execute(
    `SELECT ci.id, ci.cart_id, c.user_id, c.session_id, c.store_id, c.status
     FROM cart_items ci
     JOIN carts c ON ci.cart_id = c.id
     WHERE ci.id = ? AND c.status = 'active' LIMIT 1`,
    [numItemId]
  );

  if (!itemRows || itemRows.length === 0) {
    const err = new Error('Cart item not found or cart is no longer active.');
    err.statusCode = 404;
    throw err;
  }

  const itemRecord = itemRows[0];

  // Verify store isolation
  if (itemRecord.store_id && parseInt(itemRecord.store_id, 10) !== activeStoreId) {
    const err = new Error('Cart item does not belong to the current store.');
    err.statusCode = 403;
    throw err;
  }

  // Verify ownership
  if (itemRecord.user_id) {
    if (!userId || parseInt(itemRecord.user_id, 10) !== parseInt(userId, 10)) {
      const err = new Error('Access denied to cart item.');
      err.statusCode = 403;
      throw err;
    }
  } else if (itemRecord.session_id) {
    const safeSessionId = sessionId ? String(sessionId).trim() : null;
    if (!safeSessionId || itemRecord.session_id !== safeSessionId) {
      const err = new Error('Access denied to cart item.');
      err.statusCode = 403;
      throw err;
    }
  }

  const newQty = parseInt(quantity, 10);

  if (isNaN(newQty) || newQty <= 0) {
    await conn.execute('DELETE FROM cart_items WHERE id = ?', [numItemId]);
  } else {
    await conn.execute('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      newQty,
      numItemId
    ]);
  }

  return getCart({ userId, storeId: activeStoreId, sessionId, connection: conn });
};

/**
 * Remove item from cart
 */
const removeItem = async ({
  userId = null,
  storeId = 1,
  sessionId = null,
  itemId,
  connection = null
} = {}) => {
  const conn = connection || pool;
  const numItemId = parseInt(itemId, 10);
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;

  if (isNaN(numItemId)) {
    const err = new Error('Invalid cart item ID.');
    err.statusCode = 400;
    throw err;
  }

  const [itemRows] = await conn.execute(
    `SELECT ci.id, ci.cart_id, c.user_id, c.session_id, c.store_id, c.status
     FROM cart_items ci
     JOIN carts c ON ci.cart_id = c.id
     WHERE ci.id = ? AND c.status = 'active' LIMIT 1`,
    [numItemId]
  );

  if (!itemRows || itemRows.length === 0) {
    const err = new Error('Cart item not found or cart is no longer active.');
    err.statusCode = 404;
    throw err;
  }

  const itemRecord = itemRows[0];

  // Verify store isolation
  if (itemRecord.store_id && parseInt(itemRecord.store_id, 10) !== activeStoreId) {
    const err = new Error('Cart item does not belong to the current store.');
    err.statusCode = 403;
    throw err;
  }

  // Verify ownership
  if (itemRecord.user_id) {
    if (!userId || parseInt(itemRecord.user_id, 10) !== parseInt(userId, 10)) {
      const err = new Error('Access denied to cart item.');
      err.statusCode = 403;
      throw err;
    }
  } else if (itemRecord.session_id) {
    const safeSessionId = sessionId ? String(sessionId).trim() : null;
    if (!safeSessionId || itemRecord.session_id !== safeSessionId) {
      const err = new Error('Access denied to cart item.');
      err.statusCode = 403;
      throw err;
    }
  }

  await conn.execute('DELETE FROM cart_items WHERE id = ?', [numItemId]);

  return getCart({ userId, storeId: activeStoreId, sessionId, connection: conn });
};

/**
 * Clear all items from active cart
 */
const clearCart = async ({
  userId = null,
  storeId = 1,
  sessionId = null,
  cartId = null,
  connection = null
} = {}) => {
  const conn = connection || pool;
  const activeStoreId = parseInt(storeId, 10) === 2 ? 2 : 1;

  // Resolve user/session cart for the current store
  const cart = await getOrCreateCart({ userId, storeId: activeStoreId, sessionId, connection: conn });

  // If cartId was supplied, verify it matches the resolved active cart for this user/session & store
  if (cartId && parseInt(cartId, 10) !== parseInt(cart.id, 10)) {
    const err = new Error('Access denied: Cannot clear another customer\'s cart.');
    err.statusCode = 403;
    throw err;
  }

  await conn.execute('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);

  return { success: true, cart_id: cart.id };
};

/**
 * Mark cart as converted upon order creation inside transaction
 */
const convertCartToOrder = async ({ cartId, connection }) => {
  if (!cartId) return;
  const conn = connection || pool;
  await conn.execute('UPDATE carts SET status = "converted" WHERE id = ?', [cartId]);
  await conn.execute('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
};

module.exports = {
  getOrCreateCart,
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  convertCartToOrder
};
