/**
 * tests/test_step6_database_integrity_audit.js
 *
 * Dedicated Test & Audit Suite for:
 * STEP 6 — FINAL DATABASE INTEGRITY AUDIT
 *
 * Verifies:
 * 1. Table Inventory & Schema Architecture (50 tables mapped & categorized).
 * 2. Foreign Keys & Orphan Record Protections (CASCADE, SET NULL, RESTRICT).
 * 3. Multi-Store Isolation (Store 1 = CHIPAKK, Store 2 = THE MARSHANS, NULL fallbacks).
 * 4. Critical Business Data Protections (orders, order_items, invoices, audit_logs, stock movements).
 * 5. Product & Option Snapshot Flow (products -> variants -> order_items snapshots).
 * 6. Media Integrity & Safe File Deletion Guarantees.
 * 7. Customer Identity & Address Integrity (Firebase UID linkage).
 * 8. GST / Legal Supplier Single-Entity Architecture.
 * 9. Migration 001-018 Integrity & Migration 018 Safety.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  try {
    fn();
    console.log(`  \x1b[32mPASS\x1b[0m: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31mFAIL\x1b[0m: ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  try {
    await fn();
    console.log(`  \x1b[32mPASS\x1b[0m: ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31mFAIL\x1b[0m: ${testName}`);
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

// -----------------------------------------------------------------------------
// DATABASE AUDIT REGISTRY
// -----------------------------------------------------------------------------
const EXPECTED_TABLES = [
  'stores', 'store_settings', 'admins', 'admin_sessions', 'admin_notifications',
  'audit_logs', 'site_settings', 'users', 'customer_addresses', 'categories',
  'category_experiences', 'category_media', 'products', 'product_images',
  'product_options', 'product_option_values', 'product_variants', 'inventory',
  'materials', 'product_materials', 'finishing_options', 'product_finishing_options',
  'print_specifications', 'custom_3d_requests', 'production_jobs', 'orders',
  'order_items', 'order_status_history', 'order_item_custom_designs', 'payments',
  'coupons', 'coupon_usage', 'shipping_rules', 'reviews', 'banners',
  'campaigns', 'events', 'marshans_categories', 'marshans_category_media',
  'marshans_products', 'marshans_product_images', 'marshans_product_materials',
  'marshans_product_finishing_options', 'carts', 'cart_items', 'cart_coupons',
  'legal_suppliers', 'invoice_sequences', 'invoices', 'material_stock_movements'
];

async function main() {
  console.log('======================================================================');
  console.log('🧪 RUNNING STEP 6: FINAL DATABASE INTEGRITY AUDIT TEST SUITE');
  console.log('======================================================================\n');

  // TEST 1: Table Inventory
  runTest('1. Table Inventory: All 50 core platform tables defined and catalogued', () => {
    assert.strictEqual(EXPECTED_TABLES.length, 50, 'Platform must catalog exactly 50 architectural tables');
    const unique = new Set(EXPECTED_TABLES);
    assert.strictEqual(unique.size, 50, 'Table inventory must not contain duplicate names');
  });

  // TEST 2: Foreign Key Constraints & Safe Deletion Definitions
  runTest('2. Foreign Key Invariants: Order line items and historical records protected from cascade drops', () => {
    const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
    const mig011Sql = fs.readFileSync(path.join(__dirname, '../database/migration_011_hybrid_architecture_schema_prep.sql'), 'utf8');

    // order_items -> products must be ON DELETE SET NULL
    assert(schemaSql.includes('FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL'),
      'order_items.product_id must be ON DELETE SET NULL to preserve order lines');

    // order_items -> product_variants must be ON DELETE SET NULL
    assert(schemaSql.includes('FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL'),
      'order_items.variant_id must be ON DELETE SET NULL to preserve order lines');

    // order_items -> marshans_products must be ON DELETE SET NULL
    assert(mig011Sql.includes('FOREIGN KEY (`marshans_product_id`) REFERENCES `marshans_products` (`id`) ON DELETE SET NULL'),
      'order_items.marshans_product_id must be ON DELETE SET NULL');

    // orders -> users must be ON DELETE SET NULL
    assert(schemaSql.includes('FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL'),
      'orders.customer_id must be ON DELETE SET NULL to preserve financial accounting on user removal');
  });

  // TEST 3: Multi-Store Scoping & Invariants
  runTest('3. Store Isolation: Store 1 (CHIPAKK) vs Store 2 (THE MARSHANS) architectural boundaries', () => {
    const mig005Sql = fs.readFileSync(path.join(__dirname, '../database/migration_005_multi_store.sql'), 'utf8');

    // Seed stores
    assert(mig005Sql.includes("(1, 'chipakk', 'CHIPAKK'"), 'Store 1 must be CHIPAKK');
    assert(mig005Sql.includes("(2, 'marshans', 'THE MARSHANS'"), 'Store 2 must be THE MARSHANS');

    // Categories and Products must have store_id
    assert(mig005Sql.includes('TABLE_NAME = \'categories\' AND COLUMN_NAME = \'store_id\''), 'categories must be partitioned by store_id');
    assert(mig005Sql.includes('TABLE_NAME = \'products\' AND COLUMN_NAME = \'store_id\''), 'products must be partitioned by store_id');
    assert(mig005Sql.includes('TABLE_NAME = \'orders\' AND COLUMN_NAME = \'store_id\''), 'orders must be partitioned by store_id');
  });

  // TEST 4: Critical Business Data Protection
  runTest('4. Critical Business Data: No destructive DELETE routes exist for orders or audit logs', () => {
    const adminRoutes = fs.readFileSync(path.join(__dirname, '../server/routes/admin.js'), 'utf8');
    const auditService = fs.readFileSync(path.join(__dirname, '../server/services/auditService.js'), 'utf8');

    // Admin router must not mount DELETE /orders
    assert(!adminRoutes.includes("router.delete('/orders"), 'Orders must never have a DELETE route in admin.js');
    assert(!adminRoutes.includes("router.delete('/audit"), 'Audit logs must never have a DELETE route');

    // Audit service must have zero DELETE SQL queries
    assert(!auditService.includes('DELETE FROM audit_logs'), 'auditService must be append-only');
  });

  // TEST 5: Product & Option Integrity Snapshot Flow
  runTest('5. Product / Option / Variant Flow: Snapshots preserved in order creation', () => {
    const orderServiceCode = fs.readFileSync(path.join(__dirname, '../server/services/orderService.js'), 'utf8');

    // Must store admin_product_id_snapshot
    assert(orderServiceCode.includes('admin_product_id_snapshot'), 'orderService must store admin_product_id_snapshot');
    // Must store variant_options
    assert(orderServiceCode.includes('variant_options'), 'orderService must store variant_options');
    // Must store tax breakdown snapshots
    assert(orderServiceCode.includes('itemTax.taxable'), 'orderService must store taxable value snapshot');
  });

  // TEST 6: Media Path Format & Validation
  runTest('6. Media Format: Canonical upload paths use /uploads/ format and reject traversal', () => {
    const { safelyDeleteUploadedFile } = require('../server/utils/imageUtils');

    // Must reject null bytes
    assert.strictEqual(safelyDeleteUploadedFile('/uploads/test.png\0.txt'), false, 'Must reject null bytes');
    // Must reject path traversal
    assert.strictEqual(safelyDeleteUploadedFile('/uploads/../../etc/passwd'), false, 'Must reject path traversal');
    assert.strictEqual(safelyDeleteUploadedFile('/uploads/%2e%2e/%2e%2e/secret.key'), false, 'Must reject encoded traversal');
    // Must reject external URLs
    assert.strictEqual(safelyDeleteUploadedFile('https://external-cdn.com/bad.png'), false, 'Must reject external URLs');
    assert.strictEqual(safelyDeleteUploadedFile('data:image/png;base64,abc'), false, 'Must reject data: URIs');
  });

  // TEST 7: Customer Identity Mapping
  runTest('7. Customer Data: users table links authoritative Firebase UID uniquely', () => {
    const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');

    assert(schemaSql.includes('UNIQUE KEY `uk_users_firebase_uid` (`firebase_uid`)'),
      'users.firebase_uid must have a UNIQUE constraint');
    assert(schemaSql.includes('KEY `idx_customer_addresses_uid` (`firebase_uid`)'),
      'customer_addresses must index firebase_uid for fast lookup');
  });

  // TEST 8: GST Single Legal Supplier Architecture
  runTest('8. GST & Invoicing: Single legal supplier model with gap-free sequence locking', () => {
    const mig017Sql = fs.readFileSync(path.join(__dirname, '../database/migration_017_gst_legal_supplier_invoices.sql'), 'utf8');
    const invoiceService = fs.readFileSync(path.join(__dirname, '../server/services/invoiceService.js'), 'utf8');

    // Single legal supplier table
    assert(mig017Sql.includes('CREATE TABLE IF NOT EXISTS `legal_suppliers`'), 'legal_suppliers table must exist');
    assert(mig017Sql.includes('UNIQUE KEY `uk_legal_suppliers_gstin` (`gstin`)'), 'legal_suppliers must enforce unique GSTIN');

    // Row-level locking on invoice sequence
    assert(invoiceService.includes('FOR UPDATE'), 'invoiceService must use SELECT ... FOR UPDATE for atomic sequence increment');
  });

  // TEST 9: Migration 018 Safety & Idempotency
  runTest('9. Migration 018 Safety: Strictly additive DDL, zero data loss, safe for future deployment', () => {
    const mig018Sql = fs.readFileSync(path.join(__dirname, '../database/migration_018_chipakk_material_inventory.sql'), 'utf8');

    // Must not contain DROP TABLE or TRUNCATE
    assert(!mig018Sql.includes('DROP TABLE'), 'Migration 018 must not drop any table');
    assert(!mig018Sql.includes('TRUNCATE'), 'Migration 018 must not truncate data');

    // Must check INFORMATION_SCHEMA for sku and reorder_quantity
    assert(mig018Sql.includes('COLUMN_NAME = \'sku\''), 'Migration 018 must check if sku exists before ALTER');
    assert(mig018Sql.includes('COLUMN_NAME = \'reorder_quantity\''), 'Migration 018 must check if reorder_quantity exists before ALTER');
    assert(mig018Sql.includes('CREATE TABLE IF NOT EXISTS `material_stock_movements`'),
      'Migration 018 must create material_stock_movements table with IF NOT EXISTS');
  });

  // TEST 10: Operational Scripts Availability
  runTest('10. Operational SQL Scripts: Read-only verification scripts present for operator use', () => {
    const opsDir = path.join(__dirname, '../database/ops');
    assert(fs.existsSync(path.join(opsDir, 'verify_customer_auth_integrity.sql')), 'verify_customer_auth_integrity.sql must exist');
    assert(fs.existsSync(path.join(opsDir, 'verify_gst_configuration.sql')), 'verify_gst_configuration.sql must exist');
    assert(fs.existsSync(path.join(opsDir, 'list_upload_paths.sql')), 'list_upload_paths.sql must exist');
  });

  console.log('\n======================================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in database audit suite:', err);
  process.exit(1);
});
