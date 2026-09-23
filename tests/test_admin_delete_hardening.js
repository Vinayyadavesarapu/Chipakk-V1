/**
 * tests/test_admin_delete_hardening.js
 *
 * Dedicated Test Suite for:
 * STEP 4 — ADMIN DELETE / DEACTIVATE / RECOVERY HARDENING
 *
 * Validates:
 * 1. Category Deletion & Product Orphaning Protection (Store 1):
 *    - Rejects deletion with 409 Conflict if category contains active products.
 *    - Allows deletion with reassignToCategoryId, updating active products atomically.
 * 2. Category Deletion & Product Orphaning Protection (Store 2 - Marshans):
 *    - Rejects deletion with 409 Conflict if marshans_category contains active products.
 *    - Allows deletion with reassignToCategoryId, updating marshans_products atomically.
 * 3. Media Durability & Reference Checking:
 *    - isMediaReferencedElsewhere detects references across products, categories, media tables, site_settings.
 *    - safelyDeleteUploadedFileIfUnreferenced refuses to unlink physical file if referenced elsewhere.
 * 4. Materials & Finishing Soft Deactivation:
 *    - deleteMaterial sets active = 0, preserving material_stock_movements.
 *    - deleteFinishingOption sets active = 0, preserving relations and history.
 * 5. Product Soft-Delete & Reactivation:
 *    - deleteProduct sets active = 0.
 *    - reactivateProduct sets active = 1 for product and its variants.
 * 6. Controller & HTTP Handlers:
 *    - deleteCategoryHandler returns 409 with active_products when orphaning would occur.
 *    - reactivateProductHandler returns 200 with reactivated product.
 *    - deleteMaterialHandler and deleteFinishingOptionHandler return soft-deactivation responses.
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
// In-Memory Database State for Hermetic Testing
// -----------------------------------------------------------------------------
const mockDb = {
  categories: [
    { id: 1, name: 'Stickers & Labels', slug: 'stickers-labels', store_id: 1, active: 1, image_url: '/uploads/shared-media.png' },
    { id: 2, name: 'Custom Decals', slug: 'custom-decals', store_id: 1, active: 1, image_url: null },
    { id: 3, name: 'Empty Category', slug: 'empty-cat', store_id: 1, active: 1, image_url: null }
  ],
  marshans_categories: [
    { id: 10, name: 'Utility Co.', slug: 'utility-co', store_id: 2, active: 1, image_url: '/uploads/mcat-image.png' },
    { id: 20, name: 'Fandom 3D', slug: 'fandom-3d', store_id: 2, active: 1, image_url: null },
    { id: 30, name: 'Empty Marshans Cat', slug: 'empty-mcat', store_id: 2, active: 1, image_url: null }
  ],
  products: [
    { id: 101, admin_product_id: 'P101', name: 'Vinyl Sticker Sheet', sku: 'SKU-101', category_id: 1, store_id: 1, active: 1, price: 19900, image_url: '/uploads/shared-media.png' }
  ],
  marshans_products: [
    { id: 201, name: 'Cable Organizer Clip', sku: 'MSH-ORG-01', slug: 'cable-clip', category_id: 10, store_id: 2, active: 1, base_price: 250000, image_url: null }
  ],
  product_images: [
    { id: 301, product_id: 101, image_url: '/uploads/shared-media.png', is_primary: 1, sort_order: 0 }
  ],
  category_media: [],
  marshans_product_images: [],
  marshans_category_media: [],
  events: [],
  site_settings: [
    { id: 1, setting_key: 'store_builder_hero_config_store_1', setting_value: '{"banner":"/uploads/banner.png"}' }
  ],
  materials: [
    { id: 401, name: 'PLA Matte Filament', store_id: 2, type: 'PLA', color: 'Matte Black', stock: 15.0, unit: 'kg', cost: 1800, safety_stock: 5, active: 1 }
  ],
  material_stock_movements: [
    { id: 501, material_id: 401, movement_type: 'PURCHASE', quantity: 15.0, notes: 'Initial order' }
  ],
  finishing_options: [
    { id: 601, name: 'Vapor Smoothing', price_modifier: 500, lead_time_days: 2, active: 1 }
  ],
  product_variants: [
    { id: 701, product_id: 101, variant_slug: '101-default', sku: 'SKU-101-DEF', price: 19900, active: 1 }
  ]
};

// Intercept MySQL Pool
const dbModule = require('../server/config/database');

const createMockConnection = () => {
  return {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params = []) => {
      return executeMockQuery(sql, params);
    }
  };
};

const executeMockQuery = async (sql, params = []) => {
  const clean = sql.trim().replace(/\s+/g, ' ');

  // SHOW COLUMNS
  if (clean.startsWith('SHOW COLUMNS')) {
    return [[{ Field: 'store_id' }, { Field: 'experience_id' }, { Field: 'hsn_code' }]];
  }

  // --- CATEGORIES (Store 1) ---
  if (clean.includes('SELECT id, name, image_url FROM categories WHERE id = ?')) {
    const numId = Number(params[0]);
    const found = mockDb.categories.filter(c => c.id === numId && (c.store_id === 1 || c.store_id === null));
    return [found.map(c => ({ ...c }))];
  }
  if (clean.includes('SELECT id, name FROM categories WHERE id = ?')) {
    const numId = Number(params[0]);
    const found = mockDb.categories.filter(c => c.id === numId && (c.store_id === 1 || c.store_id === null));
    return [found.map(c => ({ ...c }))];
  }
  if (clean.includes('COUNT(*) AS active_count FROM products WHERE category_id = ?')) {
    const numId = Number(params[0]);
    const count = mockDb.products.filter(p => p.category_id === numId && p.active === 1).length;
    return [[{ active_count: count }]];
  }
  if (clean.startsWith('UPDATE products SET category_id = ? WHERE category_id = ?')) {
    const targetId = Number(params[0]);
    const sourceId = Number(params[1]);
    let affected = 0;
    mockDb.products.forEach(p => {
      if (p.category_id === sourceId) {
        p.category_id = targetId;
        affected++;
      }
    });
    return [{ affectedRows: affected }];
  }
  if (clean.startsWith('UPDATE products SET category_id = NULL WHERE category_id = ?')) {
    const sourceId = Number(params[0]);
    mockDb.products.forEach(p => {
      if (p.category_id === sourceId) p.category_id = null;
    });
    return [{ affectedRows: 1 }];
  }
  if (clean.startsWith('DELETE FROM category_media WHERE category_id = ?')) {
    const catId = Number(params[0]);
    mockDb.category_media = mockDb.category_media.filter(cm => cm.category_id !== catId);
    return [{ affectedRows: 1 }];
  }
  if (clean.startsWith('DELETE FROM categories WHERE id = ?')) {
    const numId = Number(params[0]);
    const idx = mockDb.categories.findIndex(c => c.id === numId);
    if (idx !== -1) {
      mockDb.categories.splice(idx, 1);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  }

  // --- MARSHANS CATEGORIES (Store 2) ---
  if (clean.includes('SELECT id, name, image_url FROM marshans_categories WHERE id = ? AND store_id = 2')) {
    const numId = Number(params[0]);
    const found = mockDb.marshans_categories.filter(c => c.id === numId && c.store_id === 2);
    return [found.map(c => ({ ...c }))];
  }
  if (clean.includes('SELECT id, name FROM marshans_categories WHERE id = ? AND store_id = 2')) {
    const numId = Number(params[0]);
    const found = mockDb.marshans_categories.filter(c => c.id === numId && c.store_id === 2);
    return [found.map(c => ({ ...c }))];
  }
  if (clean.includes('COUNT(*) AS active_count FROM marshans_products WHERE category_id = ? AND store_id = 2')) {
    const numId = Number(params[0]);
    const count = mockDb.marshans_products.filter(p => p.category_id === numId && p.store_id === 2 && p.active === 1).length;
    return [[{ active_count: count }]];
  }
  if (clean.startsWith('UPDATE marshans_products SET category_id = ? WHERE category_id = ? AND store_id = 2')) {
    const targetId = Number(params[0]);
    const sourceId = Number(params[1]);
    let affected = 0;
    mockDb.marshans_products.forEach(p => {
      if (p.category_id === sourceId && p.store_id === 2) {
        p.category_id = targetId;
        affected++;
      }
    });
    return [{ affectedRows: affected }];
  }
  if (clean.startsWith('DELETE FROM marshans_category_media WHERE category_id = ?')) {
    return [{ affectedRows: 0 }];
  }
  if (clean.startsWith('DELETE FROM marshans_categories WHERE id = ? AND store_id = 2')) {
    const numId = Number(params[0]);
    const idx = mockDb.marshans_categories.findIndex(c => c.id === numId && c.store_id === 2);
    if (idx !== -1) {
      mockDb.marshans_categories.splice(idx, 1);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  }

  // --- PRODUCTS (Store 1) ---
  if (clean.includes('SELECT id FROM products WHERE id = ?')) {
    const numId = Number(params[0]);
    const found = mockDb.products.filter(p => p.id === numId);
    return [found.map(p => ({ ...p }))];
  }
  if (clean.includes('FROM products p') && clean.includes('p.id = ?')) {
    const numId = Number(params[0]);
    const found = mockDb.products.filter(p => p.id === numId);
    return [found.map(p => ({ ...p, is_active: p.active === 1 }))];
  }
  if (clean.startsWith('UPDATE products SET active = 0 WHERE id = ?')) {
    const numId = Number(params[0]);
    const prod = mockDb.products.find(p => p.id === numId);
    if (prod) prod.active = 0;
    return [{ affectedRows: prod ? 1 : 0 }];
  }
  if (clean.startsWith('UPDATE products SET active = 1 WHERE id = ?')) {
    const numId = Number(params[0]);
    const prod = mockDb.products.find(p => p.id === numId);
    if (prod) prod.active = 1;
    return [{ affectedRows: prod ? 1 : 0 }];
  }
  if (clean.startsWith('UPDATE product_variants SET active = 1 WHERE product_id = ?')) {
    const pId = Number(params[0]);
    mockDb.product_variants.forEach(pv => {
      if (pv.product_id === pId) pv.active = 1;
    });
    return [{ affectedRows: 1 }];
  }

  // --- PRODUCT IMAGES ---
  if (clean.includes('SELECT id, product_id, image_url, storage_path, sort_order, is_primary FROM product_images WHERE id = ?')) {
    const imgId = Number(params[0]);
    const pId = Number(params[1]);
    const found = mockDb.product_images.filter(pi => pi.id === imgId && pi.product_id === pId);
    return [found];
  }
  if (clean.startsWith('DELETE FROM product_images WHERE id = ? AND product_id = ?')) {
    const imgId = Number(params[0]);
    const pId = Number(params[1]);
    const idx = mockDb.product_images.findIndex(pi => pi.id === imgId && pi.product_id === pId);
    if (idx !== -1) {
      mockDb.product_images.splice(idx, 1);
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  }
  if (clean.includes('FROM product_images WHERE product_id = ?')) {
    const pId = Number(params[0]);
    return [mockDb.product_images.filter(pi => pi.product_id === pId)];
  }

  // --- MEDIA REFERENCE CHECKS ---
  if (clean.includes('FROM product_images WHERE image_url LIKE ?')) {
    const term = String(params[0]).replace(/%/g, '');
    const excludeId = params[1] ? Number(params[1]) : null;
    const matches = mockDb.product_images.filter(pi => pi.image_url.includes(term) && (!excludeId || pi.id !== excludeId));
    return [matches];
  }
  if (clean.includes('FROM products WHERE (image_url LIKE ?')) {
    const term = String(params[0]).replace(/%/g, '');
    const matches = mockDb.products.filter(p => (p.image_url && p.image_url.includes(term)));
    return [matches];
  }
  if (clean.includes('FROM categories WHERE image_url LIKE ?')) {
    const term = String(params[0]).replace(/%/g, '');
    const excludeId = params[1] ? Number(params[1]) : null;
    const matches = mockDb.categories.filter(c => (c.image_url && c.image_url.includes(term)) && (!excludeId || c.id !== excludeId));
    return [matches];
  }
  if (clean.includes('FROM marshans_categories WHERE image_url LIKE ?')) {
    const term = String(params[0]).replace(/%/g, '');
    const excludeId = params[1] ? Number(params[1]) : null;
    const matches = mockDb.marshans_categories.filter(c => (c.image_url && c.image_url.includes(term)) && (!excludeId || c.id !== excludeId));
    return [matches];
  }
  if (clean.includes('FROM site_settings WHERE setting_value LIKE ?')) {
    const term = String(params[0]).replace(/%/g, '');
    const matches = mockDb.site_settings.filter(s => s.setting_value.includes(term));
    return [matches];
  }

  // --- MATERIALS (Store 2) ---
  if (clean.includes('SELECT') && clean.includes('FROM materials') && clean.includes('id = ?')) {
    const id = Number(params[0]);
    const found = mockDb.materials.filter(m => m.id === id);
    return [found.map(m => ({ ...m }))];
  }
  if (clean.startsWith('UPDATE materials SET active = 0 WHERE id = ?')) {
    const id = Number(params[0]);
    const mat = mockDb.materials.find(m => m.id === id);
    if (mat) mat.active = 0;
    return [{ affectedRows: mat ? 1 : 0 }];
  }

  // --- FINISHING OPTIONS ---
  if (clean.includes('SELECT') && clean.includes('FROM finishing_options') && clean.includes('id = ?')) {
    const id = Number(params[0]);
    const found = mockDb.finishing_options.filter(fo => fo.id === id);
    return [found.map(fo => ({ ...fo }))];
  }
  if (clean.startsWith('UPDATE finishing_options SET active = 0 WHERE id = ?')) {
    const id = Number(params[0]);
    const fo = mockDb.finishing_options.find(f => f.id === id);
    if (fo) fo.active = 0;
    return [{ affectedRows: fo ? 1 : 0 }];
  }

  return [[]];
};

dbModule.pool.execute = executeMockQuery;
dbModule.pool.getConnection = async () => createMockConnection();

// Load modules under test
const categoryService = require('../server/services/categoryService');
const marshansCategoryService = require('../server/services/marshansCategoryService');
const productService = require('../server/services/productService');
const materialsService = require('../server/services/materialsService');
const finishingService = require('../server/services/finishingService');
const { isMediaReferencedElsewhere, safelyDeleteUploadedFileIfUnreferenced } = require('../server/utils/imageUtils');
const categoryController = require('../server/controllers/categoryController');
const productController = require('../server/controllers/productController');
const materialsController = require('../server/controllers/materialsController');
const finishingController = require('../server/controllers/finishingController');

async function main() {
  console.log('======================================================================');
  console.log('🧪 RUNNING STEP 4: ADMIN DELETE / DEACTIVATE / RECOVERY TEST SUITE');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Store 1 Category Deletion & Product Orphaning Protection
  // ---------------------------------------------------------------------------
  await runAsyncTest('1.1 Store 1: Category delete rejected with 409 Conflict when active products exist', async () => {
    let threw = false;
    try {
      // Category 1 contains product 101
      await categoryService.deleteCategory(1, 1);
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, 409, 'Must throw 409 Conflict');
      assert.strictEqual(err.active_products, 1, 'active_products must equal 1');
      assert.ok(err.message.includes('reassign'), 'Error message must prompt for reassignment');
    }
    assert.ok(threw, 'Should not allow deleting category with active products');
    assert.strictEqual(mockDb.categories.some(c => c.id === 1), true, 'Category 1 must remain intact in DB');
    assert.strictEqual(mockDb.products.find(p => p.id === 101).category_id, 1, 'Product 101 must remain in Category 1');
  });

  await runAsyncTest('1.2 Store 1: Category delete succeeds with reassignment and updates products atomically', async () => {
    // Reassign products from Category 1 to Category 2
    const success = await categoryService.deleteCategory(1, 1, { reassignToCategoryId: 2 });
    assert.strictEqual(success, true);
    assert.strictEqual(mockDb.products.find(p => p.id === 101).category_id, 2, 'Product 101 must be moved to Category 2');
    assert.strictEqual(mockDb.categories.some(c => c.id === 1), false, 'Category 1 must be deleted');
  });

  await runAsyncTest('1.3 Store 1: Empty category deletes without requiring reassignment', async () => {
    const success = await categoryService.deleteCategory(3, 1);
    assert.strictEqual(success, true);
    assert.strictEqual(mockDb.categories.some(c => c.id === 3), false, 'Empty Category 3 must be deleted');
  });

  // ---------------------------------------------------------------------------
  // 2. Store 2 (Marshans) Category Deletion & Product Orphaning Protection
  // ---------------------------------------------------------------------------
  await runAsyncTest('2.1 Store 2: Marshans category delete rejected with 409 Conflict when active products exist', async () => {
    let threw = false;
    try {
      // Marshans Category 10 contains product 201
      await marshansCategoryService.deleteCategory(10, 2);
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, 409, 'Must throw 409 Conflict');
      assert.strictEqual(err.active_products, 1);
    }
    assert.ok(threw, 'Should reject Marshans category delete with active products');
    assert.strictEqual(mockDb.marshans_categories.some(c => c.id === 10), true);
  });

  await runAsyncTest('2.2 Store 2: Marshans category delete succeeds with reassignment target', async () => {
    const success = await marshansCategoryService.deleteCategory(10, 2, { reassignToCategoryId: 20 });
    assert.strictEqual(success, true);
    assert.strictEqual(mockDb.marshans_products.find(p => p.id === 201).category_id, 20, 'Product 201 must be moved to Category 20');
    assert.strictEqual(mockDb.marshans_categories.some(c => c.id === 10), false, 'Category 10 must be deleted');
  });

  // ---------------------------------------------------------------------------
  // 3. Media Integrity & Reference-Guarded Deletion
  // ---------------------------------------------------------------------------
  await runAsyncTest('3.1 isMediaReferencedElsewhere accurately detects multiple DB references', async () => {
    const check = await isMediaReferencedElsewhere('/uploads/shared-media.png', dbModule.pool, { product_image_id: 999 });
    assert.strictEqual(check.isReferenced, true);
    assert.ok(check.references.length >= 1, 'Must find references in products');
  });

  await runAsyncTest('3.2 safelyDeleteUploadedFileIfUnreferenced protects files with active references', async () => {
    // Attempting to delete /uploads/shared-media.png should be refused because product 101 references it
    const deleted = await safelyDeleteUploadedFileIfUnreferenced('/uploads/shared-media.png', null, dbModule.pool, {});
    assert.strictEqual(deleted, false, 'Must refuse physical unlinking when file is referenced');
  });

  // ---------------------------------------------------------------------------
  // 4. Materials & Finishing Soft Deactivation (No Hard Deletes / Cascade)
  // ---------------------------------------------------------------------------
  await runAsyncTest('4.1 deleteMaterial sets active = 0 and preserves material_stock_movements', async () => {
    const success = await materialsService.deleteMaterial(401, 2);
    assert.strictEqual(success, true);

    const mat = mockDb.materials.find(m => m.id === 401);
    assert.strictEqual(mat.active, 0, 'Material must be marked active = 0');

    const movements = mockDb.material_stock_movements.filter(m => m.material_id === 401);
    assert.strictEqual(movements.length, 1, 'material_stock_movements MUST NOT be deleted');
    assert.strictEqual(movements[0].quantity, 15.0);
  });

  await runAsyncTest('4.2 deleteFinishingOption sets active = 0', async () => {
    const success = await finishingService.deleteFinishingOption(601);
    assert.strictEqual(success, true);

    const fo = mockDb.finishing_options.find(f => f.id === 601);
    assert.strictEqual(fo.active, 0, 'Finishing option must be marked active = 0');
  });

  // ---------------------------------------------------------------------------
  // 5. Product Soft-Delete & Reactivation
  // ---------------------------------------------------------------------------
  await runAsyncTest('5.1 deleteProduct soft-deactivates product (active = 0)', async () => {
    const success = await productService.deleteProduct(101, 1);
    assert.strictEqual(success, true);

    const prod = mockDb.products.find(p => p.id === 101);
    assert.strictEqual(prod.active, 0, 'Product must be inactive');
  });

  await runAsyncTest('5.2 reactivateProduct restores active = 1 on product and variants', async () => {
    const reactivated = await productService.reactivateProduct(101, 1);
    assert.ok(reactivated);

    const prod = mockDb.products.find(p => p.id === 101);
    assert.strictEqual(prod.active, 1, 'Product must be active = 1');

    const variant = mockDb.product_variants.find(pv => pv.product_id === 101);
    assert.strictEqual(variant.active, 1, 'Product variant must be active = 1');
  });

  // ---------------------------------------------------------------------------
  // 6. Controller HTTP & Response Integrity
  // ---------------------------------------------------------------------------
  await runAsyncTest('6.1 deleteCategoryHandler returns 409 Conflict with active_products count', async () => {
    // Re-create a category with an active product
    mockDb.categories.push({ id: 99, name: 'Active Cat', slug: 'active-cat', store_id: 1, active: 1 });
    mockDb.products.push({ id: 999, name: 'Active Sticker', category_id: 99, store_id: 1, active: 1 });

    const req = {
      params: { id: '99' },
      query: {},
      body: {},
      storeId: 1
    };

    let statusCode = null;
    let jsonBody = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => { jsonBody = body; }
        };
      },
      json: (body) => { jsonBody = body; }
    };

    await categoryController.deleteCategoryHandler(req, res, () => {});
    assert.strictEqual(statusCode, 409, 'Must respond with HTTP 409 Conflict');
    assert.strictEqual(jsonBody.success, false);
    assert.strictEqual(jsonBody.active_products, 1);
  });

  await runAsyncTest('6.2 reactivateProductHandler returns 200 with reactivated product payload', async () => {
    const req = {
      params: { id: '101' },
      storeId: 1,
      user: { uid: 'admin_test', email: 'admin@chipakk.shop' }
    };

    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => { jsonBody = body; }
        };
      },
      json: (body) => { jsonBody = body; }
    };

    await productController.reactivateProductHandler(req, res, () => {});
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonBody.success, true);
    assert.strictEqual(jsonBody.data.active, 1);
  });

  await runAsyncTest('6.3 deleteMaterialHandler returns soft deactivation confirmation', async () => {
    const req = {
      params: { id: '401' },
      storeId: 2,
      user: { uid: 'admin_test' }
    };

    let jsonBody = null;
    const res = {
      status: () => res,
      json: (body) => { jsonBody = body; }
    };

    await materialsController.deleteMaterialHandler(req, res, () => {});
    assert.strictEqual(jsonBody.success, true);
    assert.strictEqual(jsonBody.data.deactivated, true);
  });

  await runAsyncTest('6.4 deleteFinishingOptionHandler returns soft deactivation confirmation', async () => {
    const req = {
      params: { id: '601' },
      user: { uid: 'admin_test' }
    };

    let jsonBody = null;
    const res = {
      status: () => res,
      json: (body) => { jsonBody = body; }
    };

    await finishingController.deleteFinishingOptionHandler(req, res, () => {});
    assert.strictEqual(jsonBody.success, true);
    assert.strictEqual(jsonBody.data.deactivated, true);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`🏁 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test suite execution error:', err);
  process.exit(1);
});
