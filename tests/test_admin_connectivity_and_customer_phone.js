/**
 * Comprehensive Admin Panel Connectivity & Customer Phone Identity Verification Suite
 * tests/test_admin_connectivity_and_customer_phone.js
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizeIndianPhoneNumber } = require('../server/utils/phoneUtils');
const customerService = require('../server/services/customerService');
const { getAdminDashboardHandler } = require('../server/controllers/adminController');

console.log('=================================================================');
console.log('🚀  ADMIN PANEL CONNECTIVITY & CUSTOMER PHONE VERIFICATION SUITE');
console.log('=================================================================\n');

let totalChecks = 0;
let passedChecks = 0;

function check(desc, fn) {
  totalChecks++;
  try {
    fn();
    passedChecks++;
    console.log(`[PASS] ${desc}`);
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

async function asyncCheck(desc, fn) {
  totalChecks++;
  try {
    await fn();
    passedChecks++;
    console.log(`[PASS] ${desc}`);
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

async function runSuite() {
  // ---------------------------------------------------------------------------
  // SUITE 1: CUSTOMER PHONE NORMALIZATION (10-Digit Indian Mobile Numbers)
  // ---------------------------------------------------------------------------
  console.log('--- SUITE 1: PHONE NUMBER NORMALIZATION & VALIDATION ---');

  check('1.1 Standard 10-digit number (9876543210)', () => {
    const res = normalizeIndianPhoneNumber('9876543210');
    assert.equal(res.valid, true);
    assert.equal(res.phone, '9876543210');
  });

  check('1.2 Number with +91 country code (+919876543210)', () => {
    const res = normalizeIndianPhoneNumber('+919876543210');
    assert.equal(res.valid, true);
    assert.equal(res.phone, '9876543210');
  });

  check('1.3 Number with 91 prefix without plus (919876543210)', () => {
    const res = normalizeIndianPhoneNumber('919876543210');
    assert.equal(res.valid, true);
    assert.equal(res.phone, '9876543210');
  });

  check('1.4 Number with leading zero (09876543210)', () => {
    const res = normalizeIndianPhoneNumber('09876543210');
    assert.equal(res.valid, true);
    assert.equal(res.phone, '9876543210');
  });

  check('1.5 Formatted number with spaces and hyphens (+91 98765-43210)', () => {
    const res = normalizeIndianPhoneNumber('+91 98765-43210');
    assert.equal(res.valid, true);
    assert.equal(res.phone, '9876543210');
  });

  check('1.6 Numbers starting with 6, 7, 8, and 9 are all valid', () => {
    assert.equal(normalizeIndianPhoneNumber('6123456789').valid, true);
    assert.equal(normalizeIndianPhoneNumber('7123456789').valid, true);
    assert.equal(normalizeIndianPhoneNumber('8123456789').valid, true);
    assert.equal(normalizeIndianPhoneNumber('9123456789').valid, true);
  });

  check('1.7 Invalid Indian numbers (starting with 1-5, short, or alphabetical) are safely flagged', () => {
    assert.equal(normalizeIndianPhoneNumber('5123456789').valid, false);
    assert.equal(normalizeIndianPhoneNumber('12345').valid, false);
    assert.equal(normalizeIndianPhoneNumber('abcdefghij').valid, false);
    assert.equal(normalizeIndianPhoneNumber('').valid, false);
    assert.equal(normalizeIndianPhoneNumber(null).valid, false);
  });

  // ---------------------------------------------------------------------------
  // SUITE 2: CUSTOMER IDENTITY RESOLUTION & PHONE LINKING (In-Memory Mock DB)
  // ---------------------------------------------------------------------------
  console.log('\n--- SUITE 2: CUSTOMER IDENTITY RESOLUTION & REPEAT ORDER LINKING ---');

  // Realistic mock database connection simulating MySQL table operations
  let mockUsers = [];
  let nextUserId = 1;

  const mockConnection = {
    execute: async (query, params = []) => {
      const q = query.trim();

      // SELECT from users by firebase_uid
      if (q.includes('FROM users WHERE firebase_uid = ?')) {
        const uid = params[0];
        const rows = mockUsers.filter(u => u.firebase_uid === uid);
        return [rows];
      }

      // SELECT from users by phone
      if (q.includes('FROM users WHERE phone = ?')) {
        const phone = params[0];
        const rows = mockUsers.filter(u => u.phone === phone);
        return [rows];
      }

      // SELECT from users by email
      if (q.includes('FROM users WHERE email IS NOT NULL AND LOWER(email) = LOWER(?)')) {
        const email = String(params[0] || '').toLowerCase();
        const rows = mockUsers.filter(u => (u.email || '').toLowerCase() === email);
        return [rows];
      }

      // UPDATE users
      if (q.startsWith('UPDATE users SET')) {
        // Find which user we are updating by WHERE id = ? or WHERE firebase_uid = ?
        const idMatch = q.match(/WHERE id = \?/i);
        const uidMatch = q.match(/WHERE firebase_uid = \?/i);
        if (idMatch) {
          const targetId = params[params.length - 1];
          const user = mockUsers.find(u => u.id === targetId);
          if (user) {
            // Apply updates
            if (q.includes('firebase_uid = ?')) user.firebase_uid = params[0];
            if (q.includes('phone = ?') || q.includes('phone = COALESCE(phone, ?)')) {
              // Extract phone param
              const phoneVal = params.find(p => typeof p === 'string' && /^\d{10}$/.test(p));
              if (phoneVal) user.phone = phoneVal;
            }
            if (q.includes('full_name = ?') || q.includes('full_name = COALESCE(full_name, ?)')) {
              const nameVal = params.find(p => typeof p === 'string' && p.length >= 2 && !/^\d{10}$/.test(p) && !p.includes('@'));
              if (nameVal) user.full_name = nameVal;
            }
          }
        }
        return [{ affectedRows: 1 }];
      }

      // INSERT INTO users
      if (q.startsWith('INSERT INTO users')) {
        const [uid, email, name, phone] = params;
        const newRecord = {
          id: nextUserId++,
          firebase_uid: uid,
          email: email || '',
          full_name: name || null,
          phone: phone || null,
          created_at: new Date()
        };
        mockUsers.push(newRecord);
        return [{ insertId: newRecord.id }];
      }

      return [[]];
    }
  };

  await asyncCheck('2.1 Initial customer provisioned with normalized phone', async () => {
    mockUsers = [];
    nextUserId = 1;
    const res = await customerService.resolveOrCreateCustomer(
      { uid: 'fire-user-001', email: 'alice@example.com' },
      { full_name: 'Alice Sharma', phone: '+91 98765-43210' },
      mockConnection
    );
    assert.equal(res.id, 1);
    assert.equal(res.firebase_uid, 'fire-user-001');
    assert.equal(res.phone, '9876543210');
    assert.equal(res.full_name, 'Alice Sharma');
  });

  await asyncCheck('2.2 Repeat order from same Firebase UID returns existing customer record', async () => {
    const res = await customerService.resolveOrCreateCustomer(
      { uid: 'fire-user-001', email: 'alice@example.com' },
      { full_name: 'Alice Sharma', phone: '9876543210' },
      mockConnection
    );
    assert.equal(res.id, 1); // Preserves exact same ID
    assert.equal(mockUsers.length, 1); // Zero duplicate rows
  });

  await asyncCheck('2.3 Ordering as guest or linking by normalized phone with matching email reuses customer', async () => {
    // Simulated guest user created earlier with phone
    mockUsers.push({
      id: 2,
      firebase_uid: 'guest_temp_99',
      email: 'bob@example.com',
      full_name: 'Bob Verma',
      phone: '9123456780',
      created_at: new Date()
    });

    // Bob now logs in with real Firebase account and places order
    const res = await customerService.resolveOrCreateCustomer(
      { uid: 'fire-user-002', email: 'bob@example.com' },
      { full_name: 'Bob Verma', phone: '+91 91234 56780' },
      mockConnection
    );
    assert.equal(res.id, 2); // Linked to existing row 2!
    assert.equal(res.firebase_uid, 'fire-user-002');
  });

  await asyncCheck('2.4 Separate users with distinct verified accounts sharing a family phone are NOT merged', async () => {
    // User Charlie has phone 9876543210 (shared phone with Alice) but distinct email charlie@family.com
    const res = await customerService.resolveOrCreateCustomer(
      { uid: 'fire-user-charlie', email: 'charlie@family.com' },
      { full_name: 'Charlie Sharma', phone: '9876543210' },
      mockConnection
    );
    // Charlie receives their own distinct customer ID and does NOT hijack Alice's ID 1
    assert.notEqual(res.id, 1);
    assert.equal(res.firebase_uid, 'fire-user-charlie');
  });

  // ---------------------------------------------------------------------------
  // SUITE 3: STORE 2 DASHBOARD STATS WITH CUSTOM FORGE INTEGRATION
  // ---------------------------------------------------------------------------
  console.log('\n--- SUITE 3: STORE 2 DASHBOARD METRICS WITH CUSTOM FORGE ---');

  check('3.1 adminController includes Custom Forge in Store 2 dashboard', () => {
    const adminControllerCode = fs.readFileSync(path.join(__dirname, '../server/controllers/adminController.js'), 'utf8');
    assert.ok(adminControllerCode.includes('checkCustomForgeTablesExist'), 'Must import checkCustomForgeTablesExist');
    assert.ok(adminControllerCode.includes('custom_forge_orders WHERE store_id = 2'), 'Must query custom_forge_orders for Store 2');
    assert.ok(adminControllerCode.includes('ROUND(total_price / 100)'), 'Must convert Custom Forge paise to rupees for revenue metrics');
    assert.ok(adminControllerCode.includes('cfRecentRows'), 'Must include Custom Forge in Store 2 recent orders');
  });

  // ---------------------------------------------------------------------------
  // SUITE 4: CUSTOMER SERVICE STORE 2 CUSTOM FORGE INTEGRATION
  // ---------------------------------------------------------------------------
  console.log('\n--- SUITE 4: CUSTOMER LIST & RECENT ORDERS UNIFICATION ---');

  check('4.1 customerService getCustomers unions Custom Forge orders for Store 2', () => {
    const customerServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/customerService.js'), 'utf8');
    assert.ok(customerServiceCode.includes('custom_forge_orders WHERE store_id = 2'), 'Must include custom_forge_orders in Store 2 customer listing');
    assert.ok(customerServiceCode.includes('orderTableSource'), 'Must use unified orderTableSource');
  });

  check('4.2 customerService getCustomerById returns both retail and Custom Forge orders', () => {
    const customerServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/customerService.js'), 'utf8');
    assert.ok(customerServiceCode.includes('allRecentOrders'), 'Must merge all recent orders across retail and Custom Forge');
    assert.ok(customerServiceCode.includes('is_custom_forge: true'), 'Must tag Custom Forge orders');
  });

  // ---------------------------------------------------------------------------
  // SUITE 5: ADMIN PANEL UI & CONNECTIVITY
  // ---------------------------------------------------------------------------
  console.log('\n--- SUITE 5: ADMIN PANEL UI CONNECTIVITY & CACHE BUSTING ---');

  check('5.1 admin.js loads categories with administrative privileges (/admin/categories)', () => {
    const adminJsCode = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(!adminJsCode.includes("apiClient.get('/categories')"), "Must not call public /categories; should use /admin/categories");
    assert.ok(adminJsCode.includes("apiClient.get('/admin/categories')"), "Must use /admin/categories");
  });

  check('5.2 openCustomerModal matches across both retail and Custom Forge orders', () => {
    const adminJsCode = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(adminJsCode.includes('customForgeOrders'), 'openCustomerModal must check customForgeOrders');
    assert.ok(adminJsCode.includes('normalizePhoneDigits'), 'openCustomerModal must match orders by phone digits');
    assert.ok(adminJsCode.includes('apiClient.get(`/admin/customers/'), 'openCustomerModal must enrich from /admin/customers/:id');
  });

  check('5.3 admin.html has cache-buster v>=3.5.5', () => {
    const adminHtmlCode = fs.readFileSync(path.join(__dirname, '../web/admin.html'), 'utf8');
    assert.match(adminHtmlCode, /<script\s+type="module"\s+src="js\/admin\.js\?v=3\.5\.[5-9]"><\/script>/);
  });

  console.log('\n=================================================================');
  console.log(`TOTAL CHECKS: ${totalChecks}`);
  console.log(`PASSED:       ${passedChecks}`);
  console.log(`FAILED:       0`);
  console.log('=================================================================');
  console.log('✅ ALL ADMIN CONNECTIVITY & CUSTOMER PHONE CHECKS PASSED!\n');
}

runSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
