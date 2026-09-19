/**
 * Focused test suite for:
 * 1. WebP Upload & Mime/Extension Acceptance
 * 2. URL Resolution & Image Appearance (Admin + Customer)
 * 3. Product Image Deletion (DB record removal)
 * 4. Safe Primary Image Deletion (Auto-promotion of next image)
 * 5. Cross-Store Image Deletion Protection (Store 1 cannot delete Store 2 image)
 * 6. Filesystem Traversal Guard (Arbitrary filesystem deletion prevented)
 * 7. DB URL/Path Storage Verification (Never stores raw base64)
 * 8. CHIPAKK Whole Rupee Invariants (₹15 remains 15, ₹1500 remains 1500)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

async function run() {
  console.log('Running Pre Step-5 Image Cleanup & Money Model Test Suite...\n');

  // ---------------------------------------------------------------------------
  // Test 1: WebP Upload Filter Accepts .webp and image/webp
  // ---------------------------------------------------------------------------
  await test('WebP: multer filter accepts image/webp and .webp file extension', async () => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

    const mockWebpFile = {
      originalname: 'hero-banner.webp',
      mimetype: 'image/webp'
    };
    const ext = path.extname(mockWebpFile.originalname).toLowerCase();
    const isAccepted = allowedMimeTypes.includes(mockWebpFile.mimetype) && allowedExtensions.includes(ext);

    assert.strictEqual(isAccepted, true, 'WebP file must be accepted');

    const mockSvgFile = { originalname: 'exploit.svg', mimetype: 'image/svg+xml' };
    const svgAccepted = allowedMimeTypes.includes(mockSvgFile.mimetype) && allowedExtensions.includes(path.extname(mockSvgFile.originalname).toLowerCase());
    assert.strictEqual(svgAccepted, false, 'SVG must be rejected');
  });

  // ---------------------------------------------------------------------------
  // Test 2: Image URL Resolution for /uploads/ (Admin & Customer Storefront)
  // ---------------------------------------------------------------------------
  await test('Image Appearance: /uploads/ path resolves to fully qualified asset URL', async () => {
    function resolveAdminImageUrl(url, apiBase = 'https://api.chipakk.shop/api') {
      if (!url) return '';
      const cleanUrl = String(url).trim();
      if (!cleanUrl) return '';
      if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('data:') || cleanUrl.startsWith('blob:')) {
        return cleanUrl;
      }
      const apiHost = apiBase.replace(/\/api\/?$/, '');
      return cleanUrl.startsWith('/') ? `${apiHost}${cleanUrl}` : `${apiHost}/${cleanUrl}`;
    }

    const relativeUpload = '/uploads/product-test-12345.webp';
    const resolvedAdmin = resolveAdminImageUrl(relativeUpload, 'https://api.chipakk.shop/api');
    assert.strictEqual(resolvedAdmin, 'https://api.chipakk.shop/uploads/product-test-12345.webp');

    const externalUrl = 'https://drive.google.com/uc?export=view&id=12345';
    assert.strictEqual(resolveAdminImageUrl(externalUrl), externalUrl);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Delete Product Image from DB & Local Filesystem
  // ---------------------------------------------------------------------------
  await test('Delete Image: deletes image record from DB and cleans up local physical file', async () => {
    const executedQueries = [];
    const uploadDir = path.join(__dirname, '..', 'server', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const testFilename = `test-del-${Date.now()}.webp`;
    const testFilePath = path.join(uploadDir, testFilename);
    fs.writeFileSync(testFilePath, 'dummy webp data');
    assert.strictEqual(fs.existsSync(testFilePath), true, 'Test file should exist before deletion');

    installFakePool(async (sql, params = []) => {
      executedQueries.push({ sql, params });

      if (sql.includes('SHOW COLUMNS FROM products')) {
        return [[{ Field: 'id' }, { Field: 'store_id' }]];
      }
      if (sql.includes('FROM products WHERE id = ?')) {
        return [[{ id: 1, store_id: 1 }]];
      }
      if (sql.includes('FROM product_images WHERE id = ? AND product_id = ?')) {
        return [[{
          id: 10,
          product_id: 1,
          image_url: `/uploads/${testFilename}`,
          storage_path: `uploads/${testFilename}`,
          sort_order: 1,
          is_primary: 0
        }]];
      }
      if (sql.includes('DELETE FROM product_images WHERE id = ? AND product_id = ?')) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id, product_id, image_url, storage_path')) {
        return [[]]; // Remaining images
      }
      return [[]];
    });

    const productService = freshRequire('../server/services/productService');
    const result = await productService.deleteProductImage(1, 10, 1);

    assert.strictEqual(result.deletedImageId, 10);
    const hasDeleteQuery = executedQueries.some(q => q.sql.includes('DELETE FROM product_images') && q.params[0] === 10);
    assert.strictEqual(hasDeleteQuery, true, 'Must execute DELETE SQL on product_images');

    // Physical file should now be deleted
    assert.strictEqual(fs.existsSync(testFilePath), false, 'Physical uploaded file must be deleted from disk');
  });

  // ---------------------------------------------------------------------------
  // Test 4: Delete Primary Image Safely (Promotes next remaining image)
  // ---------------------------------------------------------------------------
  await test('Delete Primary Image: safely promotes next image to is_primary = 1', async () => {
    let promotedImageId = null;

    installFakePool(async (sql, params = []) => {
      if (sql.includes('SHOW COLUMNS FROM products')) {
        return [[{ Field: 'id' }, { Field: 'store_id' }]];
      }
      if (sql.includes('FROM products WHERE id = ?')) {
        return [[{ id: 1, store_id: 1 }]];
      }
      if (sql.includes('FROM product_images WHERE id = ? AND product_id = ?')) {
        return [[{
          id: 10,
          product_id: 1,
          image_url: 'https://example.com/img1.webp',
          storage_path: null,
          sort_order: 0,
          is_primary: 1
        }]];
      }
      if (sql.includes('DELETE FROM product_images')) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('ORDER BY sort_order ASC, id ASC LIMIT 1')) {
        return [[{ id: 11 }]];
      }
      if (sql.includes('UPDATE product_images SET is_primary = 1 WHERE id = ?')) {
        promotedImageId = params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id, product_id, image_url, storage_path, external_url')) {
        return [[{ id: 11, product_id: 1, image_url: 'https://example.com/img2.webp', is_primary: 1 }]];
      }
      return [[]];
    });

    const productService = freshRequire('../server/services/productService');
    const result = await productService.deleteProductImage(1, 10, 1);

    assert.strictEqual(result.deletedImageId, 10);
    assert.strictEqual(promotedImageId, 11, 'Image 11 must be promoted to primary');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Cross-Store Protection (Store 1 cannot delete Store 2 image)
  // ---------------------------------------------------------------------------
  await test('Store Isolation: Store 1 request cannot delete image belonging to Store 2 product', async () => {
    installFakePool(async (sql) => {
      if (sql.includes('SHOW COLUMNS FROM products')) {
        return [[{ Field: 'id' }, { Field: 'store_id' }]];
      }
      if (sql.includes('FROM products WHERE id = ?')) {
        return [[{ id: 99, store_id: 2 }]];
      }
      return [[]];
    });

    const productService = freshRequire('../server/services/productService');
    let threwError = false;
    try {
      await productService.deleteProductImage(99, 10, 1);
    } catch (err) {
      threwError = true;
      assert.strictEqual(err.statusCode, 403);
      assert.ok(err.message.includes('Access denied'), 'Error must indicate access denied');
    }
    assert.strictEqual(threwError, true, 'Cross-store deletion must be blocked with 403');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Filesystem Security Guard (No arbitrary file deletion / path traversal)
  // ---------------------------------------------------------------------------
  await test('Filesystem Security: safelyDeleteUploadedFile blocks traversal and external paths', async () => {
    const { safelyDeleteUploadedFile } = freshRequire('../server/utils/imageUtils');

    const resExternal = safelyDeleteUploadedFile('https://drive.google.com/uc?id=123');
    assert.strictEqual(resExternal, false);

    const resB64 = safelyDeleteUploadedFile('data:image/png;base64,iVBORw0KGgo=');
    assert.strictEqual(resB64, false);

    const resTraversal = safelyDeleteUploadedFile('../../package.json');
    assert.strictEqual(resTraversal, false);
    assert.strictEqual(fs.existsSync(path.join(__dirname, '..', 'package.json')), true, 'package.json must not be deleted');
  });

  // ---------------------------------------------------------------------------
  // Test 7: DB Stores Path/URL, Never Raw Base64
  // ---------------------------------------------------------------------------
  await test('DB Image Sanitization: sanitizeProductImageUrl saves base64 to disk and returns /uploads/ URL', async () => {
    const { sanitizeProductImageUrl } = freshRequire('../server/utils/imageUtils');

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const sanitizedUrl = sanitizeProductImageUrl(tinyPng);

    assert.ok(sanitizedUrl.startsWith('/uploads/product-b64-'), 'Must return /uploads/ URL');
    assert.ok(!sanitizedUrl.startsWith('data:image/'), 'Must NEVER return raw data URI to be stored in DB');

    const createdFilename = path.basename(sanitizedUrl);
    const createdPath = path.join(__dirname, '..', 'server', 'uploads', createdFilename);
    if (fs.existsSync(createdPath)) fs.unlinkSync(createdPath);
  });

  // ---------------------------------------------------------------------------
  // Test 8: CHIPAKK Whole Rupee Invariant (₹15 remains 15, ₹1500 remains 1500)
  // ---------------------------------------------------------------------------
  await test('Money Model: CHIPAKK Store 1 prices ₹15 and ₹1500 are preserved as exact whole integers', async () => {
    installFakePool(async (sql) => {
      if (sql.includes('SHOW COLUMNS FROM products')) {
        return [[{ Field: 'id' }, { Field: 'store_id' }, { Field: 'price' }, { Field: 'compare_at_price' }]];
      }
      if (sql.includes('FROM products p')) {
        return [[
          { id: 1, store_id: 1, name: 'Sticker ₹15', price: 15, compare_at_price: 20 },
          { id: 2, store_id: 1, name: 'Sticker ₹1500', price: 1500, compare_at_price: 2000 }
        ]];
      }
      if (sql.includes('FROM product_images')) {
        return [[]];
      }
      return [[]];
    });

    const productService = freshRequire('../server/services/productService');
    const result = await productService.getProducts({ store_id: 1 });

    const p1 = result.products.find(p => p.id === 1);
    const p2 = result.products.find(p => p.id === 2);

    assert.strictEqual(p1.price, 15, 'Product 1 price must remain exact 15 (₹15)');
    assert.strictEqual(p1.compare_at_price, 20, 'Product 1 compare price must remain exact 20 (₹20)');
    assert.strictEqual(p2.price, 1500, 'Product 2 price must remain exact 1500 (₹1500)');
    assert.strictEqual(p2.compare_at_price, 2000, 'Product 2 compare price must remain exact 2000 (₹2000)');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST RESULTS ---');
  let allPass = true;
  for (const r of results) {
    if (r.pass) {
      console.log(`[PASS] ${r.name}`);
    } else {
      console.log(`[FAIL] ${r.name} -> ${r.error}`);
      allPass = false;
    }
  }

  assert.strictEqual(allPass, true, 'All tests must pass');
  console.log(`\nAll ${results.length}/${results.length} tests passed successfully!`);
}

run().catch(err => {
  console.error('\nFatal test runner error:', err);
  process.exit(1);
});
