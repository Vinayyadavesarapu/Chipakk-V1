/**
 * Lightweight, dependency-free regression suite.
 *
 * No test framework is installed in this project (no jest/mocha in package.json,
 * no prior test files existed anywhere in the repo). This suite uses only Node's
 * built-in `assert` and an in-memory fake `mysql2` pool so it can run with
 * `node tests/regression.test.js` and no database connection.
 *
 * It codifies the store-isolation and money-model invariants found broken during
 * the 2026-09-16 adversarial review, so they cannot silently regress:
 *   - productService: Store 1 requests must never read/write Store-2-owned rows
 *     left behind in the shared `products` table (migration 012 explicitly
 *     preserves old rows rather than deleting them).
 *   - categoryService: same isolation guarantee for categories.
 *   - shippingService.updateShippingRule: previously crashed with a
 *     ReferenceError on every real invocation (undeclared `hasStoreId`).
 *   - imageUtils.sanitizeProductImageUrl: base64 uploads must be restricted to
 *     the same safe extension whitelist and size cap as the multer upload path,
 *     and must never accept SVG (stored-XSS vector) or oversized payloads.
 */

const assert = require('assert');
const path = require('path');

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
}

function installFakePool(execute) {
  const dbPath = path.join(__dirname, '..', 'server', 'config', 'database.js');
  require.cache[require.resolve(dbPath)] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      pool: {
        execute,
        getConnection: async () => ({
          beginTransaction: async () => {},
          commit: async () => {},
          rollback: async () => {},
          release: () => {},
          execute
        })
      }
    }
  };
}

function freshRequire(modPath) {
  const full = require.resolve(modPath);
  delete require.cache[full];
  return require(full);
}

// ---------------------------------------------------------------------------
// productService store isolation
// ---------------------------------------------------------------------------
async function runProductIsolationTests() {
  const products = {
    10: { id: 10, store_id: 1, admin_product_id: 'CK-1', category_id: null, name: 'Chipakk Sticker', sku: 'SKU-CK-1', description: '', price: 15, compare_at_price: 0, tags: '[]', active: 1, featured: 0, scheduled_drop_time: null, created_at: new Date(), updated_at: new Date() },
    99: { id: 99, store_id: 2, admin_product_id: 'LEGACY-MRSH-1', category_id: null, name: 'Legacy Marshans Lamp', sku: 'SKU-LEGACY-99', description: '', price: 1500, compare_at_price: 0, tags: '[]', active: 1, featured: 0, scheduled_drop_time: null, created_at: new Date(), updated_at: new Date() }
  };

  const execute = async (sql, params = []) => {
    if (sql.includes('SHOW COLUMNS')) return [[{ Field: 'store_id' }]];
    if (sql.includes('FROM products p') && sql.trim().startsWith('SELECT')) {
      const id = params[0];
      const row = products[id];
      if (!row) return [[]];
      if (sql.includes('p.store_id = ? OR p.store_id IS NULL')) {
        const storeId = params[1];
        if (!(row.store_id === storeId || row.store_id === null)) return [[]];
      }
      return [[{ ...row }]];
    }
    if (sql.includes('FROM product_images')) return [[]];
    if (sql.includes('FROM product_variants')) return [[]];
    if (sql.includes('FROM product_materials')) return [[]];
    if (sql.includes('FROM product_finishing_options')) return [[]];
    if (sql.includes('FROM reviews')) return [[{ average_rating: 0, review_count: 0 }]];
    if (sql.startsWith('UPDATE products SET active = 0')) {
      const id = params[0];
      const row = products[id];
      if (!row) return [{ affectedRows: 0 }];
      if (sql.includes('store_id = ? OR store_id IS NULL')) {
        const storeId = params[1];
        if (!(row.store_id === storeId || row.store_id === null)) return [{ affectedRows: 0 }];
      }
      row.active = 0;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  };

  installFakePool(execute);
  const productService = freshRequire('../server/services/productService.js');

  await test('productService: Store 1 can read its own product', async () => {
    const p = await productService.getProductById(10, 1);
    assert.ok(p && p.id === 10);
  });

  await test('productService: Store 1 CANNOT read a legacy Store 2 product by ID', async () => {
    const p = await productService.getProductById(99, 1);
    assert.strictEqual(p, null);
  });

  await test('productService: Store 2 (legacy mode) can read its own legacy product', async () => {
    const p = await productService.getProductById(99, 2);
    assert.ok(p && p.id === 99);
  });

  await test('productService: Store 1 CANNOT deactivate a Store 2 product', async () => {
    const ok = await productService.deleteProduct(99, 1);
    assert.strictEqual(ok, false);
  });

  await test('productService: Store 2 CAN deactivate its own product', async () => {
    const ok = await productService.deleteProduct(99, 2);
    assert.strictEqual(ok, true);
  });
}

// ---------------------------------------------------------------------------
// categoryService store isolation
// ---------------------------------------------------------------------------
async function runCategoryIsolationTests() {
  const categories = {
    5: { id: 5, store_id: 1, name: 'Chipakk Category' },
    77: { id: 77, store_id: 2, name: 'Legacy Marshans Category' }
  };

  // categoryService.deleteCategory has since grown a product-reassignment/active-product guard and now selects
  // `id, name, image_url` (not `store_id`) for its ownership check -- this mock previously matched only the OLD
  // query shape, so every real call fell through to the catch-all `[[]]` and deleteCategory always returned
  // false, regardless of store. Match the CURRENT real query text/shape instead of the SQL string verbatim.
  const execute = async (sql, params = []) => {
    if (sql.includes("SHOW COLUMNS FROM categories LIKE 'store_id'")) return [[{ Field: 'store_id' }]];
    if (sql.includes("SHOW COLUMNS FROM categories LIKE 'image_url'")) return [[]];
    if (sql.includes("SHOW COLUMNS FROM categories LIKE 'experience_id'")) return [[]];
    if (/^SELECT id, name, image_url FROM categories WHERE id = \?/.test(sql)) {
      const row = categories[params[0]];
      if (!row) return [[]];
      if (sql.includes('(store_id = 1 OR store_id IS NULL)') && !(row.store_id === 1 || row.store_id === null)) return [[]];
      if (/store_id = \?\s*$/.test(sql) && row.store_id !== params[1]) return [[]];
      return [[{ id: row.id, name: row.name, image_url: null }]];
    }
    if (sql.startsWith('SELECT COUNT(*) AS active_count FROM products')) return [[{ active_count: 0 }]];
    if (sql.startsWith('UPDATE products SET category_id = NULL')) return [{ affectedRows: 0 }];
    if (sql.startsWith('DELETE FROM category_media')) return [{ affectedRows: 0 }];
    if (sql.startsWith('DELETE FROM categories WHERE id = ?')) {
      const id = params[0];
      const row = categories[id];
      if (!row) return [{ affectedRows: 0 }];
      if (sql.includes('(store_id = 1 OR store_id IS NULL)')) {
        if (!(row.store_id === 1 || row.store_id === null)) return [{ affectedRows: 0 }];
      } else if (sql.includes('store_id = ?')) {
        const storeId = params[1];
        if (row.store_id !== storeId) return [{ affectedRows: 0 }];
      }
      delete categories[id];
      return [{ affectedRows: 1 }];
    }
    return [[]];
  };

  installFakePool(execute);
  const categoryService = freshRequire('../server/services/categoryService.js');

  await test('categoryService: Store 1 CANNOT delete a Store 2 category', async () => {
    const ok = await categoryService.deleteCategory(77, 1);
    assert.strictEqual(ok, false);
  });

  await test('categoryService: Store 2 CAN delete its own category', async () => {
    const ok = await categoryService.deleteCategory(77, 2);
    assert.strictEqual(ok, true);
  });
}

// ---------------------------------------------------------------------------
// shippingService.updateShippingRule must not crash
// ---------------------------------------------------------------------------
async function runShippingTests() {
  const execute = async (sql) => {
    if (sql.includes('SHOW COLUMNS')) return [[{ Field: 'store_id' }]];
    if (sql.trim().startsWith('SELECT')) {
      return [[{ id: 1, store_id: 1, name: 'Standard', free_shipping_threshold: 499, standard_fee: 50, is_enabled: 1, regional_overrides: null }]];
    }
    return [{ affectedRows: 1 }];
  };

  installFakePool(execute);
  const shippingService = freshRequire('../server/services/shippingService.js');

  await test('shippingService.updateShippingRule does not throw ReferenceError', async () => {
    const result = await shippingService.updateShippingRule(1, { standard_fee: 60 }, 1);
    assert.ok(result && result.id === 1);
  });
}

// ---------------------------------------------------------------------------
// imageUtils base64 sanitizer
// ---------------------------------------------------------------------------
async function runImageUtilsTests() {
  const { sanitizeProductImageUrl } = freshRequire('../server/utils/imageUtils.js');
  const fs = require('fs');
  const writtenFiles = [];

  await test('imageUtils: accepts a valid small PNG and writes a file', async () => {
    const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const result = sanitizeProductImageUrl(validPng);
    assert.ok(result.startsWith('/uploads/product-b64-') && result.endsWith('.png'));
    const filePath = path.join(__dirname, '..', 'server', result);
    assert.ok(fs.existsSync(filePath));
    writtenFiles.push(filePath);
  });

  await test('imageUtils: rejects SVG (stored-XSS vector)', async () => {
    const svgXss = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)></svg>').toString('base64');
    assert.strictEqual(sanitizeProductImageUrl(svgXss), '');
  });

  await test('imageUtils: rejects unrecognized MIME subtype', async () => {
    assert.strictEqual(sanitizeProductImageUrl('data:image/x-evil;base64,AAAA'), '');
  });

  await test('imageUtils: rejects payload larger than 5MB', async () => {
    const bigBuf = Buffer.alloc(6 * 1024 * 1024, 1);
    const bigB64 = 'data:image/png;base64,' + bigBuf.toString('base64');
    assert.strictEqual(sanitizeProductImageUrl(bigB64), '');
  });

  await test('imageUtils: passes through Google Drive share links as direct view URLs', async () => {
    const result = sanitizeProductImageUrl('https://drive.google.com/file/d/ABC123/view');
    assert.strictEqual(result, 'https://drive.google.com/uc?export=view&id=ABC123');
  });

  // Cleanup files this test run wrote to server/uploads
  for (const f of writtenFiles) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
}

(async () => {
  await runProductIsolationTests();
  await runCategoryIsolationTests();
  await runShippingTests();
  await runImageUtilsTests();

  const failed = results.filter(r => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} - ${r.name}${r.pass ? '' : ` :: ${r.error}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length > 0 ? 1 : 0);
})();
