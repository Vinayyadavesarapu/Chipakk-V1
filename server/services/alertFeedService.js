/**
 * Alert Feed Service
 * Serves real-time, cursor-paginated order feeds across CHIPAKK and THE MARSHANS.
 *
 * Supported order categories:
 * 1. CHIPAKK_RETAIL        (Store ID 1, orders table)
 * 2. MARSHANS_RETAIL       (Store ID 2, orders table)
 * 3. MARSHANS_CUSTOM_FORGE (Store ID 2, custom_forge_orders table)
 *
 * Architectural Guarantees:
 * - First install retrieves unacknowledged orders without silent 24-hour truncation.
 * - Deterministic, crash-safe SQL keyset pagination: (created_at ASC, feed_id ASC).
 * - Stable ordering when timestamps are identical (>100 orders sharing the same second).
 * - Immediate alert on every new order (pending, paid, failed, COD).
 * - Acknowledgment works across all payment states without modifying production/fulfillment status.
 * - Duplicate prevention: payment status updates never change created_at or re-trigger alerts.
 */

const { pool } = require('../config/database');
const { KNOWN_STORES } = require('../middleware/storeContext');
const { checkCustomForgeTablesExist } = require('./customForgeService');

// Order Category Constants
const CATEGORIES = {
  CHIPAKK_RETAIL: 'CHIPAKK_RETAIL',
  MARSHANS_RETAIL: 'MARSHANS_RETAIL',
  MARSHANS_CUSTOM_FORGE: 'MARSHANS_CUSTOM_FORGE'
};

/**
 * Converts a Date object or date string into a MySQL DATETIME string in UTC ('YYYY-MM-DD HH:MM:SS')
 */
function toSqlDatetime(d) {
  if (!d) return null;
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return null;
  return dateObj.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Builds a deterministic cursor string from timestamp and feed_id
 */
function buildCursor(createdAtIso, feedId) {
  return `${createdAtIso}_${feedId}`;
}

/**
 * Parses a cursor string into timestamp milliseconds, ISO string, SQL datetime, and feed ID metadata
 */
function parseCursor(cursorStr) {
  if (!cursorStr || typeof cursorStr !== 'string') return null;
  const clean = cursorStr.trim();
  const underscoreIndex = clean.indexOf('_');
  if (underscoreIndex === -1) return null;

  const isoPart = clean.substring(0, underscoreIndex);
  const feedIdPart = clean.substring(underscoreIndex + 1);
  const parsedDate = new Date(isoPart);

  if (isNaN(parsedDate.getTime()) || !feedIdPart) {
    return null;
  }

  let type = null;
  let numericId = null;
  if (feedIdPart.startsWith('retail_')) {
    type = 'retail';
    numericId = parseInt(feedIdPart.replace('retail_', ''), 10);
  } else if (feedIdPart.startsWith('custom_forge_')) {
    type = 'custom_forge';
    numericId = parseInt(feedIdPart.replace('custom_forge_', ''), 10);
  }

  if (!type || isNaN(numericId) || numericId <= 0) {
    return null;
  }

  return {
    timeMs: parsedDate.getTime(),
    iso: parsedDate.toISOString(),
    sqlDatetime: toSqlDatetime(parsedDate),
    feedId: feedIdPart,
    type,
    numericId
  };
}

/**
 * Deterministic total comparator for order feed items.
 * Primary: created_at ascending
 * Secondary tiebreaker: Custom Forge before Retail at same second
 * Tertiary tiebreaker: numeric order_id ascending
 */
function compareAlertOrders(a, b) {
  const timeDiff = a.created_at_ms - b.created_at_ms;
  if (timeDiff !== 0) {
    return timeDiff;
  }
  const typeA = a.feed_id.startsWith('custom_forge_') ? 1 : 2;
  const typeB = b.feed_id.startsWith('custom_forge_') ? 1 : 2;
  if (typeA !== typeB) {
    return typeA - typeB;
  }
  return a.order_id - b.order_id;
}

/**
 * Safely parses shipping address JSON and returns clean delivery fields.
 */
function normalizeDeliveryAddress(rawAddress) {
  if (!rawAddress) return null;
  let parsed = rawAddress;
  if (typeof rawAddress === 'string') {
    try {
      parsed = JSON.parse(rawAddress);
    } catch (_) {
      return { raw: rawAddress };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  return {
    name: parsed.name || parsed.fullName || parsed.customer_name || null,
    phone: parsed.phone || parsed.phoneNumber || parsed.customer_phone || null,
    address: parsed.address || parsed.address_line1 || parsed.street || null,
    city: parsed.city || null,
    state: parsed.state || null,
    pincode: parsed.pincode || parsed.zip || parsed.postal_code || null,
    country: parsed.country || 'India'
  };
}

/**
 * Fetches alert feed orders with SQL keyset cursor pagination, store isolation, and line items.
 */
const getAlertFeed = async ({
  cursor = null,
  since = null,
  limit = 50,
  store_id = null,
  category = null
} = {}) => {
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  // Parse cursor if supplied
  const cursorInfo = parseCursor(cursor);

  // Determine explicit since timestamp if supplied
  let sinceDate = null;
  if (since) {
    const sDate = new Date(since);
    if (!isNaN(sDate.getTime())) {
      sinceDate = sDate;
    }
  }

  // Filter flags based on store_id and category
  const filterStoreId = store_id !== null && store_id !== undefined ? parseInt(store_id, 10) : null;
  const filterCategory = category && typeof category === 'string' ? category.trim().toUpperCase() : null;

  const shouldFetchRetail = !filterCategory || filterCategory === CATEGORIES.CHIPAKK_RETAIL || filterCategory === CATEGORIES.MARSHANS_RETAIL;
  const shouldFetchCustomForge = (!filterCategory || filterCategory === CATEGORIES.MARSHANS_CUSTOM_FORGE) && (filterStoreId === null || filterStoreId === 2);

  const fetchLimit = parsedLimit + 1;
  const candidateOrders = [];

  // ===========================================================================
  // 1. QUERY RETAIL ORDERS (Store 1: CHIPAKK, Store 2: THE MARSHANS)
  // ===========================================================================
  if (shouldFetchRetail) {
    const retailConditions = [];
    const retailParams = [];

    // Store filter
    if (filterCategory === CATEGORIES.CHIPAKK_RETAIL || filterStoreId === 1) {
      retailConditions.push('(o.store_id = 1 OR o.store_id IS NULL)');
    } else if (filterCategory === CATEGORIES.MARSHANS_RETAIL || filterStoreId === 2) {
      retailConditions.push('o.store_id = 2');
    }

    // Keyset pagination / Time filter / First install filter
    if (cursorInfo) {
      if (cursorInfo.type === 'retail') {
        retailConditions.push('((o.created_at > ?) OR (o.created_at = ? AND o.id > ?))');
        retailParams.push(cursorInfo.sqlDatetime, cursorInfo.sqlDatetime, cursorInfo.numericId);
      } else {
        // Cursor was Custom Forge at this timestamp. Custom Forge comes before Retail at same second.
        retailConditions.push('(o.created_at >= ?)');
        retailParams.push(cursorInfo.sqlDatetime);
      }
    } else if (sinceDate) {
      retailConditions.push('(o.created_at >= ?)');
      retailParams.push(toSqlDatetime(sinceDate));
    } else {
      // First installation without cursor and without since: retrieve unacknowledged orders without 24h cutoff!
      retailConditions.push('NOT EXISTS (SELECT 1 FROM order_status_history osh WHERE osh.order_id = o.id AND osh.note = "ORDER_ACKNOWLEDGED")');
    }

    const whereClause = retailConditions.length > 0 ? `WHERE ${retailConditions.join(' AND ')}` : '';

    const retailQuery = `
      SELECT
        o.id,
        o.order_number,
        COALESCE(o.store_id, 1) AS store_id,
        o.customer_id,
        o.customer_name,
        o.customer_email,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.phone')), '') AS customer_phone,
        o.shipping_address,
        o.payment_method,
        o.payment_status,
        o.fulfillment_status,
        o.subtotal,
        o.discount_total,
        o.shipping_charge,
        o.total_price,
        o.coupon_code,
        o.created_at,
        o.updated_at
      FROM orders o
      ${whereClause}
      ORDER BY o.created_at ASC, o.id ASC
      LIMIT ?
    `;

    try {
      const [retailRows] = await pool.execute(retailQuery, [...retailParams, fetchLimit]);

      for (const row of retailRows) {
        const isStore2 = parseInt(row.store_id, 10) === 2;
        const feedId = `retail_${row.id}`;
        const createdAtDate = new Date(row.created_at);
        const createdAtIso = createdAtDate.toISOString();

        // Convert paise to rupees for Store 2; Store 1 stores rupees in retail table
        const rawTotal = parseInt(row.total_price, 10) || 0;
        const rawSubtotal = parseInt(row.subtotal, 10) || 0;
        const rawShipping = parseInt(row.shipping_charge, 10) || 0;
        const rawDiscount = parseInt(row.discount_total, 10) || 0;

        const totalPriceRupees = isStore2 ? Math.round(rawTotal / 100) : rawTotal;
        const subtotalRupees = isStore2 ? Math.round(rawSubtotal / 100) : rawSubtotal;
        const shippingChargeRupees = isStore2 ? Math.round(rawShipping / 100) : rawShipping;
        const discountTotalRupees = isStore2 ? Math.round(rawDiscount / 100) : rawDiscount;

        candidateOrders.push({
          feed_id: feedId,
          order_id: row.id,
          order_number: row.order_number,
          store: isStore2 ? KNOWN_STORES[2] : KNOWN_STORES[1],
          category: isStore2 ? CATEGORIES.MARSHANS_RETAIL : CATEGORIES.CHIPAKK_RETAIL,
          created_at: createdAtIso,
          created_at_ms: createdAtDate.getTime(),
          cursor: buildCursor(createdAtIso, feedId),
          payment: {
            status: row.payment_status || 'pending',
            method: row.payment_method || 'COD'
          },
          fulfillment_status: row.fulfillment_status || 'pending',
          customer: {
            name: row.customer_name || 'Guest Customer',
            email: row.customer_email || null,
            phone: row.customer_phone || null
          },
          delivery: normalizeDeliveryAddress(row.shipping_address),
          pricing: {
            subtotal_rupees: subtotalRupees,
            shipping_charge_rupees: shippingChargeRupees,
            discount_total_rupees: discountTotalRupees,
            total_price_rupees: totalPriceRupees
          },
          items: [],
          is_acknowledged: false
        });
      }
    } catch (err) {
      console.error('[Alert Feed] Error querying retail orders:', err.message);
    }
  }

  // ===========================================================================
  // 2. QUERY CUSTOM FORGE ORDERS (Store 2: THE MARSHANS)
  // ===========================================================================
  if (shouldFetchCustomForge) {
    let cfTablesExist = false;
    try {
      cfTablesExist = await checkCustomForgeTablesExist();
    } catch (_) {
      cfTablesExist = false;
    }

    if (cfTablesExist) {
      const cfConditions = ['o.store_id = 2'];
      const cfParams = [];

      // Keyset pagination / Time filter / First install filter
      if (cursorInfo) {
        if (cursorInfo.type === 'custom_forge') {
          cfConditions.push('((o.created_at > ?) OR (o.created_at = ? AND o.id > ?))');
          cfParams.push(cursorInfo.sqlDatetime, cursorInfo.sqlDatetime, cursorInfo.numericId);
        } else {
          // Cursor was Retail at this timestamp. Custom Forge at this timestamp already passed.
          cfConditions.push('(o.created_at > ?)');
          cfParams.push(cursorInfo.sqlDatetime);
        }
      } else if (sinceDate) {
        cfConditions.push('(o.created_at >= ?)');
        cfParams.push(toSqlDatetime(sinceDate));
      } else {
        // First installation without cursor and without since: retrieve unacknowledged Custom Forge orders without 24h cutoff!
        cfConditions.push('NOT EXISTS (SELECT 1 FROM custom_forge_order_status_history h WHERE h.order_id = o.id AND h.note = "ORDER_ACKNOWLEDGED")');
      }

      const whereClause = cfConditions.length > 0 ? `WHERE ${cfConditions.join(' AND ')}` : '';

      const cfQuery = `
        SELECT
          o.id,
          o.order_number,
          o.store_id,
          o.customer_id,
          o.customer_name,
          o.customer_email,
          o.customer_phone,
          o.shipping_address,
          o.payment_method,
          o.payment_status,
          o.production_status,
          o.subtotal,
          o.shipping_charge,
          o.total_price,
          o.created_at,
          o.updated_at
        FROM custom_forge_orders o
        ${whereClause}
        ORDER BY o.created_at ASC, o.id ASC
        LIMIT ?
      `;

      try {
        const [cfRows] = await pool.execute(cfQuery, [...cfParams, fetchLimit]);

        for (const row of cfRows) {
          const feedId = `custom_forge_${row.id}`;
          const createdAtDate = new Date(row.created_at);
          const createdAtIso = createdAtDate.toISOString();

          // Custom Forge stores money fields in integer paise
          const rawTotal = parseInt(row.total_price, 10) || 0;
          const rawSubtotal = parseInt(row.subtotal, 10) || 0;
          const rawShipping = parseInt(row.shipping_charge, 10) || 0;

          candidateOrders.push({
            feed_id: feedId,
            order_id: row.id,
            order_number: row.order_number,
            store: KNOWN_STORES[2],
            category: CATEGORIES.MARSHANS_CUSTOM_FORGE,
            created_at: createdAtIso,
            created_at_ms: createdAtDate.getTime(),
            cursor: buildCursor(createdAtIso, feedId),
            payment: {
              status: row.payment_status || 'pending',
              method: row.payment_method || 'ONLINE'
            },
            fulfillment_status: row.production_status || 'order_placed',
            production_status: row.production_status || 'order_placed',
            customer: {
              name: row.customer_name || 'Customer',
              email: row.customer_email || null,
              phone: row.customer_phone || null
            },
            delivery: normalizeDeliveryAddress(row.shipping_address),
            pricing: {
              subtotal_rupees: Math.round(rawSubtotal / 100),
              shipping_charge_rupees: Math.round(rawShipping / 100),
              discount_total_rupees: 0,
              total_price_rupees: Math.round(rawTotal / 100)
            },
            items: [],
            is_acknowledged: false
          });
        }
      } catch (err) {
        console.error('[Alert Feed] Error querying Custom Forge orders:', err.message);
      }
    }
  }

  // ===========================================================================
  // 3. MERGE & DETERMINISTIC SORT (created_at ASC, feed_id ASC)
  // ===========================================================================
  candidateOrders.sort(compareAlertOrders);

  // Apply strict cursor boundary filtering: item must be strictly > cursor
  let filteredOrders = candidateOrders;
  if (cursorInfo) {
    const cursorOrderStub = {
      created_at_ms: cursorInfo.timeMs,
      feed_id: cursorInfo.feedId,
      order_id: cursorInfo.numericId
    };
    filteredOrders = candidateOrders.filter(o => compareAlertOrders(o, cursorOrderStub) > 0);
  }

  // Slice to requested page limit
  const pagedOrders = filteredOrders.slice(0, parsedLimit);
  const hasMore = filteredOrders.length > parsedLimit;
  const nextCursor = pagedOrders.length > 0 ? pagedOrders[pagedOrders.length - 1].cursor : (cursor || null);

  // ===========================================================================
  // 4. BATCH POPULATE LINE ITEMS & CUSTOM FORGE PERSONALIZATION
  // ===========================================================================
  const retailOrderIds = pagedOrders
    .filter(o => o.category !== CATEGORIES.MARSHANS_CUSTOM_FORGE)
    .map(o => o.order_id);

  const cfOrderIds = pagedOrders
    .filter(o => o.category === CATEGORIES.MARSHANS_CUSTOM_FORGE)
    .map(o => o.order_id);

  // 4A. Retail Line Items
  if (retailOrderIds.length > 0) {
    try {
      const placeholders = retailOrderIds.map(() => '?').join(',');
      const [itemRows] = await pool.execute(`
        SELECT
          oi.id,
          oi.order_id,
          oi.product_name,
          oi.sku,
          oi.variant_options,
          oi.unit_price,
          oi.quantity,
          oi.total_price
        FROM order_items oi
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.id ASC
      `, retailOrderIds);

      const itemsByOrderId = {};
      for (const item of itemRows) {
        if (!itemsByOrderId[item.order_id]) itemsByOrderId[item.order_id] = [];
        itemsByOrderId[item.order_id].push(item);
      }

      for (const order of pagedOrders) {
        if (order.category !== CATEGORIES.MARSHANS_CUSTOM_FORGE && itemsByOrderId[order.order_id]) {
          const isStore2 = order.store.id === 2;
          order.items = itemsByOrderId[order.order_id].map(it => {
            const rawUnit = parseInt(it.unit_price, 10) || 0;
            const rawTot = parseInt(it.total_price, 10) || 0;
            return {
              id: it.id,
              product_name: it.product_name,
              sku: it.sku,
              variant_options: it.variant_options,
              quantity: it.quantity,
              unit_price_rupees: isStore2 ? Math.round(rawUnit / 100) : rawUnit,
              total_price_rupees: isStore2 ? Math.round(rawTot / 100) : rawTot,
              customization: null
            };
          });
        }
      }
    } catch (err) {
      console.warn('[Alert Feed] Could not batch fetch retail line items:', err.message);
    }
  }

  // 4B. Custom Forge Line Items & Personalizations
  if (cfOrderIds.length > 0) {
    try {
      let hasSecondCols = false;
      try {
        const [colCheck] = await pool.execute(
          "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_forge_order_customizations' AND COLUMN_NAME = 'second_customer_name' LIMIT 1"
        );
        hasSecondCols = colCheck && colCheck.length > 0;
      } catch (_) {
        hasSecondCols = false;
      }

      const secondColsSql = hasSecondCols
        ? 'oc.second_customer_name, oc.second_customer_designation,'
        : 'NULL AS second_customer_name, NULL AS second_customer_designation,';

      const placeholders = cfOrderIds.map(() => '?').join(',');
      const [cfItemRows] = await pool.execute(`
        SELECT
          oi.id,
          oi.order_id,
          oi.product_name_snapshot,
          oi.variant_sku_snapshot,
          oi.size_label_snapshot,
          oi.height_mm_snapshot,
          oi.unit_price,
          oi.quantity,
          oi.total_price,
          oc.custom_mode_enabled,
          oc.customer_name AS engraved_name,
          oc.customer_designation AS engraved_designation,
          ${secondColsSql}
          oc.nameplate_material
        FROM custom_forge_order_items oi
        LEFT JOIN custom_forge_order_customizations oc ON oc.order_item_id = oi.id
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.id ASC
      `, cfOrderIds);

      const cfItemsByOrderId = {};
      for (const item of cfItemRows) {
        if (!cfItemsByOrderId[item.order_id]) cfItemsByOrderId[item.order_id] = [];
        cfItemsByOrderId[item.order_id].push(item);
      }

      for (const order of pagedOrders) {
        if (order.category === CATEGORIES.MARSHANS_CUSTOM_FORGE && cfItemsByOrderId[order.order_id]) {
          order.items = cfItemsByOrderId[order.order_id].map(it => {
            const isCustom = Boolean(it.custom_mode_enabled);
            return {
              id: it.id,
              product_name: it.product_name_snapshot,
              sku: it.variant_sku_snapshot,
              size_label: it.size_label_snapshot,
              height_mm: it.height_mm_snapshot,
              quantity: it.quantity,
              unit_price_rupees: Math.round((parseInt(it.unit_price, 10) || 0) / 100),
              total_price_rupees: Math.round((parseInt(it.total_price, 10) || 0) / 100),
              customization: isCustom ? {
                custom_mode_enabled: true,
                name: it.engraved_name || null,
                designation: it.engraved_designation || null,
                second_name: it.second_customer_name || null,
                second_designation: it.second_customer_designation || null,
                material: it.nameplate_material || null
              } : null
            };
          });
        }
      }
    } catch (err) {
      console.warn('[Alert Feed] Could not batch fetch Custom Forge line items:', err.message);
    }
  }

  // ===========================================================================
  // 5. BATCH CHECK ACKNOWLEDGEMENT STATUS
  // ===========================================================================
  // 5A. Check retail order_status_history for ORDER_ACKNOWLEDGED
  if (retailOrderIds.length > 0) {
    try {
      const placeholders = retailOrderIds.map(() => '?').join(',');
      const [histRows] = await pool.execute(`
        SELECT order_id
        FROM order_status_history
        WHERE order_id IN (${placeholders}) AND note = 'ORDER_ACKNOWLEDGED'
      `, retailOrderIds);

      const ackSet = new Set((histRows || []).map(r => r.order_id));
      for (const order of pagedOrders) {
        if (order.category !== CATEGORIES.MARSHANS_CUSTOM_FORGE) {
          order.is_acknowledged = ackSet.has(order.order_id);
        }
      }
    } catch (_) {
      // order_status_history table may not have entries yet
    }
  }

  // 5B. Check Custom Forge custom_forge_order_status_history for ORDER_ACKNOWLEDGED
  if (cfOrderIds.length > 0) {
    try {
      const placeholders = cfOrderIds.map(() => '?').join(',');
      const [cfHistRows] = await pool.execute(`
        SELECT order_id
        FROM custom_forge_order_status_history
        WHERE order_id IN (${placeholders}) AND note = 'ORDER_ACKNOWLEDGED'
      `, cfOrderIds);

      const cfAckSet = new Set((cfHistRows || []).map(r => r.order_id));
      for (const order of pagedOrders) {
        if (order.category === CATEGORIES.MARSHANS_CUSTOM_FORGE) {
          order.is_acknowledged = cfAckSet.has(order.order_id);
        }
      }
    } catch (_) {
      // custom_forge_order_status_history may not have entries yet
    }
  }

  // Strip internal helper field created_at_ms before responding
  for (const o of pagedOrders) {
    delete o.created_at_ms;
  }

  return {
    orders: pagedOrders,
    pagination: {
      limit: parsedLimit,
      returned: pagedOrders.length,
      next_cursor: nextCursor,
      has_more: hasMore
    },
    timestamp: new Date().toISOString()
  };
};

/**
 * Acknowledges one or more orders from the alert dashboard.
 * Supports both feed_ids (e.g. ['retail_101', 'custom_forge_12']) and { order_ids, category }.
 *
 * Guarantees:
 * - Direct acknowledgment for all Custom Forge payment statuses (pending, paid, failed, COD).
 * - Direct acknowledgment for all Retail payment statuses.
 * - Records ORDER_ACKNOWLEDGED in respective status history tables without altering production/fulfillment status.
 * - Idempotent against duplicate calls or retries.
 * - Strict partition by ID prefix prevents cross-category collision.
 */
const acknowledgeAlertOrders = async ({
  feed_ids = [],
  order_ids = [],
  category = null,
  actor = 'Alert Operator'
} = {}) => {
  const targetRetailIds = new Set();
  const targetCfIds = new Set();

  // 1. Process feed_ids
  if (Array.isArray(feed_ids)) {
    for (const fid of feed_ids) {
      if (typeof fid !== 'string') continue;
      const clean = fid.trim();
      if (clean.startsWith('retail_')) {
        const id = parseInt(clean.replace('retail_', ''), 10);
        if (!isNaN(id) && id > 0) targetRetailIds.add(id);
      } else if (clean.startsWith('custom_forge_')) {
        const id = parseInt(clean.replace('custom_forge_', ''), 10);
        if (!isNaN(id) && id > 0) targetCfIds.add(id);
      }
    }
  }

  // 2. Process order_ids with category hint
  if (Array.isArray(order_ids)) {
    for (const oid of order_ids) {
      const id = parseInt(oid, 10);
      if (isNaN(id) || id <= 0) continue;
      if (category === CATEGORIES.MARSHANS_CUSTOM_FORGE) {
        targetCfIds.add(id);
      } else {
        targetRetailIds.add(id);
      }
    }
  }

  const acknowledgedRetail = [];
  const acknowledgedCf = [];

  // Acknowledge Custom Forge orders directly (pending, paid, failed, COD)
  if (targetCfIds.size > 0) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const cfId of targetCfIds) {
        const [existing] = await connection.execute(
          'SELECT id FROM custom_forge_order_status_history WHERE order_id = ? AND note = "ORDER_ACKNOWLEDGED" LIMIT 1',
          [cfId]
        );

        if (!existing || existing.length === 0) {
          const [orderRows] = await connection.execute(
            'SELECT o.id, o.production_status FROM custom_forge_orders o WHERE o.id = ? AND o.store_id = 2 LIMIT 1',
            [cfId]
          );

          if (orderRows && orderRows.length > 0) {
            const currentStatus = orderRows[0].production_status || 'order_placed';
            await connection.execute(`
              INSERT INTO custom_forge_order_status_history (
                order_id, previous_status, new_status, changed_by, note
              ) VALUES (?, ?, ?, ?, 'ORDER_ACKNOWLEDGED')
            `, [cfId, currentStatus, currentStatus, actor]);
            acknowledgedCf.push(cfId);
          }
        } else {
          // Already acknowledged, idempotent
          acknowledgedCf.push(cfId);
        }
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      console.error('[Alert Feed] Custom Forge direct acknowledge error:', err.message);
    } finally {
      connection.release();
    }
  }

  // Acknowledge Retail orders
  if (targetRetailIds.size > 0) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const rId of targetRetailIds) {
        const [existing] = await connection.execute(
          'SELECT id FROM order_status_history WHERE order_id = ? AND note = "ORDER_ACKNOWLEDGED" LIMIT 1',
          [rId]
        );

        if (!existing || existing.length === 0) {
          const [orderRows] = await connection.execute(
            'SELECT o.id, o.fulfillment_status FROM orders o WHERE o.id = ? LIMIT 1',
            [rId]
          );

          if (orderRows && orderRows.length > 0) {
            const currentStatus = orderRows[0].fulfillment_status || 'pending';
            await connection.execute(`
              INSERT INTO order_status_history (order_id, status, changed_by, note)
              VALUES (?, ?, ?, 'ORDER_ACKNOWLEDGED')
            `, [rId, currentStatus, actor]);
            acknowledgedRetail.push(rId);
          }
        } else {
          // Already acknowledged
          acknowledgedRetail.push(rId);
        }
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      console.error('[Alert Feed] Retail acknowledge error:', err.message);
    } finally {
      connection.release();
    }
  }

  return {
    acknowledged_retail_ids: acknowledgedRetail,
    acknowledged_custom_forge_ids: acknowledgedCf,
    total_acknowledged: acknowledgedRetail.length + acknowledgedCf.length
  };
};

module.exports = {
  CATEGORIES,
  toSqlDatetime,
  buildCursor,
  parseCursor,
  compareAlertOrders,
  normalizeDeliveryAddress,
  getAlertFeed,
  acknowledgeAlertOrders
};
