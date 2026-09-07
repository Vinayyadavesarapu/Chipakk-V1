const { pool } = require('../config/database');

/**
 * Helper to parse JSON values safely
 */
const safeJsonParse = (val, fallback = null) => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return fallback;
  }
};

/**
 * Derive event status dynamically based on current server time
 * - active == 0 -> INACTIVE
 * - NOW < start_time -> UPCOMING
 * - NOW >= start_time AND NOW <= end_time -> LIVE
 * - NOW > end_time -> ENDED
 */
const deriveEventStatus = (eventRow) => {
  if (!eventRow.active) return 'INACTIVE';
  
  const now = new Date();
  const startTime = new Date(eventRow.start_time);
  const endTime = new Date(eventRow.end_time);

  if (now < startTime) return 'UPCOMING';
  if (now >= startTime && now <= endTime) return 'LIVE';
  return 'ENDED';
};

/**
 * Fetch list of promotional events with pagination and filtering
 */
const getEvents = async ({
  search,
  active,
  event_type,
  status,
  limit = 50,
  offset = 0
} = {}) => {
  const conditions = [];
  const params = [];

  if (active !== undefined && active !== null && active !== '') {
    conditions.push('e.active = ?');
    params.push(active === 'true' || active === 1 || active === '1' ? 1 : 0);
  }

  if (event_type && String(event_type).trim()) {
    conditions.push('e.event_type = ?');
    params.push(String(event_type).trim().toLowerCase());
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('e.name LIKE ?');
    params.push(term);
  }

  if (status && String(status).trim()) {
    const st = String(status).trim().toLowerCase();
    const nowISO = new Date().toISOString().slice(0, 19).replace('T', ' ');

    if (st === 'live') {
      conditions.push('e.active = 1 AND e.start_time <= ? AND e.end_time >= ?');
      params.push(nowISO, nowISO);
    } else if (st === 'upcoming') {
      conditions.push('e.active = 1 AND e.start_time > ?');
      params.push(nowISO);
    } else if (st === 'ended') {
      conditions.push('e.active = 1 AND e.end_time < ?');
      params.push(nowISO);
    } else if (st === 'inactive') {
      conditions.push('e.active = 0');
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  // Total matching count query
  const countQuery = `SELECT COUNT(*) AS total FROM events e ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const query = `
    SELECT 
      e.id,
      e.name,
      e.event_type,
      e.start_time,
      e.end_time,
      e.discount_percent,
      e.target_products,
      e.target_categories,
      e.active,
      e.created_at,
      e.updated_at
    FROM events e
    ${whereClause}
    ORDER BY e.start_time DESC, e.id DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(query, queryParams);

  const events = rows.map(r => ({
    ...r,
    target_products: safeJsonParse(r.target_products, []),
    target_categories: safeJsonParse(r.target_categories, []),
    status: deriveEventStatus(r)
  }));

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    events
  };
};

/**
 * Fetch a single event by numeric BIGINT ID
 */
const getEventById = async (eventId) => {
  if (!eventId) return null;

  const numId = parseInt(eventId, 10);
  if (isNaN(numId)) return null;

  const query = `
    SELECT 
      e.id,
      e.name,
      e.event_type,
      e.start_time,
      e.end_time,
      e.discount_percent,
      e.target_products,
      e.target_categories,
      e.active,
      e.created_at,
      e.updated_at
    FROM events e
    WHERE e.id = ?
    LIMIT 1
  `;

  const [rows] = await pool.execute(query, [numId]);
  if (!rows || rows.length === 0) {
    return null;
  }

  const r = rows[0];
  return {
    ...r,
    target_products: safeJsonParse(r.target_products, []),
    target_categories: safeJsonParse(r.target_categories, []),
    status: deriveEventStatus(r)
  };
};

/**
 * Create a new promotional event in MySQL
 */
const createEvent = async (eventData) => {
  const {
    name,
    event_type = 'drop',
    start_time,
    end_time,
    discount_percent = 0,
    target_products = [],
    target_categories = [],
    active = 1
  } = eventData;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Event name is required');
  }

  if (!start_time || !end_time) {
    throw new Error('Start time and end time are required');
  }

  const startDate = new Date(start_time);
  const endDate = new Date(end_time);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format for start_time or end_time.');
  }

  if (endDate < startDate) {
    throw new Error('End time cannot be earlier than start time.');
  }

  const discountVal = Math.min(Math.max(parseInt(discount_percent, 10) || 0, 0), 100);
  const startTimeISO = startDate.toISOString().slice(0, 19).replace('T', ' ');
  const endTimeISO = endDate.toISOString().slice(0, 19).replace('T', ' ');

  const targetProdsJson = JSON.stringify(Array.isArray(target_products) ? target_products : []);
  const targetCatsJson = JSON.stringify(Array.isArray(target_categories) ? target_categories : []);

  const query = `
    INSERT INTO events (
      name, event_type, start_time, end_time, discount_percent, target_products, target_categories, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    name.trim(),
    String(event_type || 'drop').trim().toLowerCase(),
    startTimeISO,
    endTimeISO,
    discountVal,
    targetProdsJson,
    targetCatsJson,
    active ? 1 : 0
  ];

  const [result] = await pool.execute(query, params);
  return getEventById(result.insertId);
};

/**
 * Update an existing event in MySQL
 */
const updateEvent = async (id, eventData) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid event ID format.');
  }

  const existing = await getEventById(numId);
  if (!existing) {
    return null;
  }

  const {
    name,
    event_type,
    start_time,
    end_time,
    discount_percent,
    target_products,
    target_categories,
    active
  } = eventData;

  const updates = [];
  const params = [];

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Event name cannot be empty');
    }
    updates.push('name = ?');
    params.push(name.trim());
  }

  if (event_type !== undefined) {
    updates.push('event_type = ?');
    params.push(String(event_type || 'drop').trim().toLowerCase());
  }

  let finalStart = existing.start_time;
  let finalEnd = existing.end_time;

  if (start_time !== undefined) {
    const sDate = new Date(start_time);
    if (isNaN(sDate.getTime())) throw new Error('Invalid start_time date format');
    finalStart = sDate.toISOString().slice(0, 19).replace('T', ' ');
    updates.push('start_time = ?');
    params.push(finalStart);
  }

  if (end_time !== undefined) {
    const eDate = new Date(end_time);
    if (isNaN(eDate.getTime())) throw new Error('Invalid end_time date format');
    finalEnd = eDate.toISOString().slice(0, 19).replace('T', ' ');
    updates.push('end_time = ?');
    params.push(finalEnd);
  }

  if (new Date(finalEnd) < new Date(finalStart)) {
    throw new Error('End time cannot be earlier than start time.');
  }

  if (discount_percent !== undefined) {
    const discountVal = Math.min(Math.max(parseInt(discount_percent, 10) || 0, 0), 100);
    updates.push('discount_percent = ?');
    params.push(discountVal);
  }

  if (target_products !== undefined) {
    updates.push('target_products = ?');
    params.push(JSON.stringify(Array.isArray(target_products) ? target_products : []));
  }

  if (target_categories !== undefined) {
    updates.push('target_categories = ?');
    params.push(JSON.stringify(Array.isArray(target_categories) ? target_categories : []));
  }

  if (active !== undefined) {
    updates.push('active = ?');
    params.push(active ? 1 : 0);
  }

  if (updates.length > 0) {
    const query = `UPDATE events SET ${updates.join(', ')} WHERE id = ?`;
    params.push(numId);
    await pool.execute(query, params);
  }

  return getEventById(numId);
};

/**
 * Deactivate a promotional event (soft deactivation preserving reporting history)
 */
const deleteEvent = async (id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    throw new Error('Invalid event ID format.');
  }

  const [result] = await pool.execute('UPDATE events SET active = 0 WHERE id = ?', [numId]);
  return result.affectedRows > 0;
};

module.exports = {
  deriveEventStatus,
  getEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent
};
