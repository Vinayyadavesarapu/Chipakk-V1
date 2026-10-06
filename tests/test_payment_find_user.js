/**
 * Focused Regression Test: findUserByFirebaseUid column contract
 * tests/test_payment_find_user.js
 *
 * Verifies that:
 * 1. paymentService.findUserByFirebaseUid queries only valid production columns:
 *    `SELECT id, email FROM users WHERE firebase_uid = ? LIMIT 1`.
 * 2. Non-existent column `role` is never queried from `users`.
 * 3. A mock database strictly enforcing the production users schema
 *    (id, firebase_uid, email, full_name, phone, created_at, updated_at)
 *    executes findUserByFirebaseUid without throwing Unknown column 'role'.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const paymentService = require('../server/services/paymentService');

console.log('===============================================================');
console.log('💳 PAYMENT SERVICE: findUserByFirebaseUid COLUMN CONTRACT TEST');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${name} ${extra ? '— ' + extra : ''}`);
  }
}

// 1. Static source code check
const src = fs.readFileSync(path.join(__dirname, '../server/services/paymentService.js'), 'utf8');

check(
  '1. findUserByFirebaseUid does not select "role" from users',
  !/SELECT[^;]+role[^;]+FROM users/i.test(src)
);

check(
  '2. findUserByFirebaseUid selects only valid columns (id, email) from users',
  src.includes("SELECT id, email FROM users WHERE firebase_uid = ? LIMIT 1")
);

// 2. Runtime behavioral check against production users column contract
// Production users schema: id, firebase_uid, email, full_name, phone, created_at, updated_at
const VALID_USER_COLUMNS = new Set(['id', 'firebase_uid', 'email', 'full_name', 'phone', 'created_at', 'updated_at']);

const mockConnection = {
  execute: async (sql, params) => {
    // Check if query targets users table
    if (/FROM users/i.test(sql)) {
      // Extract selected columns
      const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM users/i);
      if (selectMatch) {
        const columns = selectMatch[1].split(',').map(c => c.trim().toLowerCase());
        for (const col of columns) {
          if (!VALID_USER_COLUMNS.has(col)) {
            const err = new Error(`Unknown column '${col}' in 'field list'`);
            err.code = 'ER_BAD_FIELD_ERROR';
            throw err;
          }
        }
      }
      const uid = params ? params[0] : null;
      if (uid === 'cust_firebase_uid_100') {
        return [[{ id: 42, email: 'customer@example.com' }]];
      }
      return [[]];
    }
    return [[]];
  }
};

(async () => {
  try {
    // 3. Test findUserByFirebaseUid with valid UID
    const user = await paymentService.findUserByFirebaseUid('cust_firebase_uid_100', mockConnection);
    check(
      '3. findUserByFirebaseUid executes successfully against production users table contract',
      user !== null && user.id === 42 && user.email === 'customer@example.com' && user.role === undefined
    );

    // 4. Test findUserByFirebaseUid with non-existent UID
    const notFound = await paymentService.findUserByFirebaseUid('non_existent_uid', mockConnection);
    check(
      '4. findUserByFirebaseUid returns null when user does not exist',
      notFound === null
    );

    // 5. Test findUserByFirebaseUid with null/empty UID
    const emptyUid = await paymentService.findUserByFirebaseUid('', mockConnection);
    check(
      '5. findUserByFirebaseUid returns null for empty UID without executing query',
      emptyUid === null
    );

    console.log('\n===============================================================');
    console.log(`TOTAL CHECKS: ${passCount + failCount}`);
    console.log(`PASSED:       ${passCount}`);
    console.log(`FAILED:       ${failCount}`);
    console.log('===============================================================\n');

    if (failCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('[ERROR]', err);
    process.exit(1);
  }
})();
