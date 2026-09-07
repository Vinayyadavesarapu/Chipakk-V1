const { pool } = require('../config/database');

/**
 * Reusable Audit Log Writer Service
 * Stores administrative activity tracking logs in the `audit_logs` MySQL table.
 *
 * @param {string} actorId - Firebase UID of acting admin or system identifier (e.g. 'SYSTEM')
 * @param {string|null} [actorEmail=null] - Email address of acting user/admin
 * @param {string} action - Action identifier string (e.g., 'product.create', 'order.update_status')
 * @param {string|null} [entityType=null] - Target entity name (e.g., 'products', 'orders')
 * @param {string|number|null} [entityId=null] - Target entity primary key or code
 * @param {object|string|null} [details=null] - Contextual metadata object or JSON string
 * @returns {Promise<{id: number, actor_id: string, action: string, created_at: string}>}
 */
const writeAuditLog = async (
  actorId,
  actorEmail = null,
  action,
  entityType = null,
  entityId = null,
  details = null
) => {
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('Audit log actorId is required');
  }

  if (!action || typeof action !== 'string') {
    throw new Error('Audit log action is required');
  }

  // Sanitize & format input parameters
  const safeActorId = actorId.trim();
  const safeActorEmail = actorEmail ? String(actorEmail).trim() : null;
  const safeAction = action.trim();
  const safeEntityType = entityType ? String(entityType).trim() : null;
  const safeEntityId = entityId !== null && entityId !== undefined ? String(entityId).trim() : null;

  // Safely serialize details JSON object if provided, redacting sensitive fields
  let jsonDetails = null;
  if (details !== null && details !== undefined) {
    if (typeof details === 'object') {
      try {
        const sanitized = { ...details };
        delete sanitized.password;
        delete sanitized.token;
        delete sanitized.idToken;
        delete sanitized.privateKey;
        delete sanitized.private_key;
        delete sanitized.authorization;
        jsonDetails = JSON.stringify(sanitized);
      } catch (err) {
        jsonDetails = JSON.stringify({ error: 'Serialization error' });
      }
    } else if (typeof details === 'string') {
      jsonDetails = details;
    }
  }

  const query = `
    INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const params = [
    safeActorId,
    safeActorEmail,
    safeAction,
    safeEntityType,
    safeEntityId,
    jsonDetails
  ];

  try {
    const [result] = await pool.execute(query, params);
    return {
      id: result.insertId,
      actor_id: safeActorId,
      actor_email: safeActorEmail,
      action: safeAction,
      entity_type: safeEntityType,
      entity_id: safeEntityId
    };
  } catch (error) {
    console.error('[Audit Log Service Error] Insert failed:', error.message);
    throw error;
  }
};

/**
 * Query Audit Logs with Pagination & Filtering
 *
 * @param {object} options
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @param {string} [options.actorId]
 * @param {string} [options.action]
 * @returns {Promise<{total: number, limit: number, offset: number, logs: Array}>}
 */
const getAuditLogs = async ({ limit = 50, offset = 0, actorId, action } = {}) => {
  const conditions = [];
  const params = [];

  if (actorId) {
    conditions.push('actor_id = ?');
    params.push(String(actorId).trim());
  }

  if (action) {
    conditions.push('action LIKE ?');
    params.push(`%${String(action).trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const countQuery = `SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`;
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0].total || 0;

  const logsQuery = `
    SELECT id, actor_id, actor_email, action, entity_type, entity_id, details, created_at
    FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;

  const logsParams = [...params, parsedLimit, parsedOffset];
  const [rows] = await pool.execute(logsQuery, logsParams);

  const logs = rows.map(r => {
    let parsedDetails = r.details;
    if (typeof r.details === 'string') {
      try {
        parsedDetails = JSON.parse(r.details);
      } catch (e) {
        parsedDetails = r.details;
      }
    }
    return {
      id: r.id,
      actor_id: r.actor_id,
      actor_email: r.actor_email,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      details: parsedDetails,
      created_at: r.created_at
    };
  });

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    logs
  };
};

module.exports = {
  writeAuditLog,
  getAuditLogs
};
