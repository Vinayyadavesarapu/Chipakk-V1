/**
 * In-memory stand-in for the mysql2 pool. Handlers are [regex, fn(sql, params) => result] pairs;
 * the first match wins, otherwise an empty result set. Install BEFORE requiring any server module.
 */
const path = require('path');

function createFakePool(handlers = []) {
  const calls = [];
  const execute = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: text, params });
    for (const [re, fn] of handlers) {
      if (re.test(text)) {
        const out = await fn(text, params);
        if (out !== undefined) return out;
      }
    }
    return [[]];
  };
  const connection = () => ({ execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  return { execute, getConnection: async () => connection(), calls, handlers };
}

function installFakePool(pool) {
  const dbPath = require.resolve(path.join(__dirname, '..', '..', 'server', 'config', 'database.js'));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool, testConnection: async () => ({ connected: true, message: 'ok', database: 'fake' }) } };
}

/** Parses "INSERT INTO t (a, b, c) VALUES (?, 'x', ?)" + params into { a: p0, b: 'x', c: p1 }. */
function parseInsert(sql, params) {
  const m = sql.match(/INSERT INTO \w+ \(([^)]+)\) VALUES \((.+)\)$/);
  if (!m) return null;
  const cols = m[1].split(',').map((c) => c.trim());
  const vals = m[2].split(',').map((v) => v.trim());
  const out = {};
  let pi = 0;
  cols.forEach((c, i) => { out[c] = vals[i] === '?' ? params[pi++] : vals[i].replace(/^'|'$/g, ''); });
  return out;
}

module.exports = { createFakePool, installFakePool, parseInsert };
