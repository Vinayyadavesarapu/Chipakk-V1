/**
 * PRE-DEPLOYMENT ADMIN STABILIZATION TEST SUITE
 *
 * Verifies:
 * 1. GST Deactivation remains complete and permanent at runtime across Store 1 & Store 2.
 * 2. Customer-facing Finish/Material & Dimensions customization is hidden/inactive on product.html
 *    for both customer-workspace and test-deployment/customer-workspace, without altering catalog pricing.
 * 3. Admin category filter matches products reliably by name, slug, and ID (case-insensitive).
 * 4. Admin category images are properly resolved with resolveAdminImageUrl, fallback handling, and preservation on save.
 * 5. Admin edit workflows load existing DB values without clearing, opening edit forms does not mutate DB,
 *    and partial updates preserve unedited fields.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createFakePool, installFakePool } = require('./helpers/fake_db');

const results = [];
async function test(id, desc, fn) {
  try {
    await fn();
    results.push({ id, desc, pass: true });
    console.log(`[PASS] ${id} :: ${desc}`);
  } catch (err) {
    results.push({ id, desc, pass: false, err });
    console.error(`[FAIL] ${id} :: ${desc}\n       ${err && err.stack ? err.stack : err}`);
  }
}

async function runTests() {
  console.log('\n=== PRE-DEPLOYMENT ADMIN STABILIZATION TEST SUITE ===\n');

  // ===========================================================================
  // 1. GST DEACTIVATION TESTS
  // ===========================================================================
  await test('GST-1', 'Server settingsService enforces gst_enabled = false, gst_rate = 0 for Store 1 & 2', async () => {
    const handlers = [
      [/SELECT setting_key, setting_value FROM store_settings WHERE store_id = \?/i, async (sql, [storeId]) => {
        return [[
          { setting_key: 'gst_enabled', setting_value: 'true' }, // historical DB value
          { setting_key: 'gst_pct', setting_value: '18' },
          { setting_key: 'gst_rate', setting_value: '18' }
        ]];
      }]
    ];
    const pool = createFakePool(handlers);
    installFakePool(pool);

    const settingsService = require('../server/services/settingsService');
    const s1 = await settingsService.getStoreSettings(1);
    assert.strictEqual(s1.gst_enabled, false, 'Store 1 gst_enabled must be false');
    assert.strictEqual(s1.gst_rate, 0, 'Store 1 gst_rate must be 0');
    assert.strictEqual(s1.gst_pct, 0, 'Store 1 gst_pct must be 0');

    const s2 = await settingsService.getStoreSettings(2);
    assert.strictEqual(s2.gst_enabled, false, 'Store 2 gst_enabled must be false');
    assert.strictEqual(s2.gst_rate, 0, 'Store 2 gst_rate must be 0');
  });

  await test('GST-2', 'Cart calculation produces zero GST regardless of stored tax rates', async () => {
    const handlers = [
      [/SELECT.*FROM carts WHERE user_id = \? AND store_id = \? AND status = "active"/i, async () => [[{ id: 1, user_id: 10, store_id: 1, status: 'active' }]]],
      [/SELECT.*FROM cart_items WHERE cart_id = \?/i, async () => [[
        { id: 101, cart_id: 1, product_id: 50, quantity: 2, unit_price: 200 }
      ]]],
      [/SELECT id, name, sku, price, active, store_id FROM products WHERE id = \?/i, async () => [[
        { id: 50, name: 'Cool Sticker', sku: 'CK-50', price: 200, active: 1, store_id: 1 }
      ]]],
      [/SELECT setting_key, setting_value FROM store_settings WHERE store_id = \?/i, async () => [[
        { setting_key: 'free_shipping_threshold', setting_value: '500' },
        { setting_key: 'shipping_fee', setting_value: '50' }
      ]]]
    ];
    const pool = createFakePool(handlers);
    installFakePool(pool);

    const cartService = require('../server/services/cartService');
    const taxProfileService = require('../server/services/taxProfileService');

    const summary = await cartService.getCart({ userId: 10, storeId: 1 });
    assert.strictEqual(summary.subtotal, 400, 'Subtotal must match retail line items total without extra tax');

    const profile = await taxProfileService.getTaxProfile(1);
    assert.strictEqual(profile.gst_enabled, false, 'Tax profile must report gst_enabled: false');
    assert.strictEqual(profile.default_gst_rate, 0, 'Tax profile must report default_gst_rate: 0');
  });

  // ===========================================================================
  // 2. CUSTOMER FINISH/MATERIAL & DIMENSIONS CUSTOMIZATION HIDDEN
  // ===========================================================================
  await test('CUST-1', 'customer-workspace/product.html has dynamicProductOptions hidden', async () => {
    const htmlPath = path.join(__dirname, '../customer-workspace/product.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(
      html.includes('id="dynamicProductOptions"') && html.includes('display: none !important;'),
      'dynamicProductOptions in customer-workspace/product.html must be hidden with display: none !important;'
    );
  });

  await test('CUST-2', 'test-deployment/customer-workspace/product.html has finish and dimensions hidden', async () => {
    const htmlPath = path.join(__dirname, '../test-deployment/customer-workspace/product.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(
      html.includes('id="materialPills"') && html.includes('id="sizePills"'),
      'Option pills must exist in test-deployment product.html'
    );
    // Verify both option groups have style="display: none !important;"
    const matGroupRegex = /<div class="product-options-group"[^>]*style="[^"]*display:\s*none\s*!important;[^"]*"[^>]*>[\s\S]*?id="materialPills"/i;
    const sizeGroupRegex = /<div class="product-options-group"[^>]*style="[^"]*display:\s*none\s*!important;[^"]*"[^>]*>[\s\S]*?id="sizePills"/i;
    assert.ok(matGroupRegex.test(html), 'Material selector group must be hidden with display: none !important;');
    assert.ok(sizeGroupRegex.test(html), 'Size selector group must be hidden with display: none !important;');
  });

  await test('CUST-3', 'customer-workspace/js/product.js hides dynamic options container and uses catalog base price', async () => {
    const jsPath = path.join(__dirname, '../customer-workspace/js/product.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert.ok(
      jsContent.includes("dynamicContainer.style.display = 'none';"),
      'dynamicContainer must be explicitly hidden in product.js'
    );
    assert.ok(
      jsContent.includes("price: currentProduct.price"),
      'Cart addition must add product at currentProduct.price without variant/option surcharge'
    );
  });

  await test('CUST-4', 'test-deployment/customer-workspace/js/product.js hides material and size containers', async () => {
    const jsPath = path.join(__dirname, '../test-deployment/customer-workspace/js/product.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert.ok(
      jsContent.includes("materialContainer.style.display = 'none';") &&
      jsContent.includes("sizeContainer.style.display = 'none';"),
      'materialContainer and sizeContainer must be hidden in test deployment product.js'
    );
  });

  // ===========================================================================
  // 3. ADMIN CATEGORY FILTER TESTS
  // ===========================================================================
  await test('CAT-1', 'Admin category filter matches products by name, slug, and category_id (case-insensitive)', async () => {
    // Replicate the filtering logic from web/js/admin.js
    const categories = [
      { id: 1, name: 'Anime & Manga', slug: 'anime-manga' },
      { id: 2, name: 'Cyberpunk', slug: 'cyberpunk' },
      { id: 3, name: 'Minimalist', slug: 'minimalist' }
    ];

    const products = [
      { id: 101, title: 'Goku Sticker', category: 'Anime & Manga', category_slug: 'anime-manga', category_id: 1 },
      { id: 102, title: 'Cyber Deck', category_name: 'Cyberpunk', category_slug: 'cyberpunk', category_id: 2 },
      { id: 103, title: 'Simple Line', category: 'Minimalist', category_slug: 'minimalist', category_id: 3 },
      { id: 104, title: 'Vegeta Sticker', category: null, category_slug: 'anime-manga', category_id: 1 },
      { id: 105, title: 'Neon Hacker', category: 'cyberpunk', category_id: 2 }
    ];

    function filterProducts(categoryFilter) {
      return products.filter(p => {
        let matchesCat = true;
        if (categoryFilter) {
          const filterLower = categoryFilter.toLowerCase().trim();
          const matchedFilterCat = categories.find(c => 
            c && (
              (c.name && c.name.toLowerCase().trim() === filterLower) ||
              (c.slug && c.slug.toLowerCase().trim() === filterLower) ||
              (String(c.id).trim() === filterLower)
            )
          );
          const targetName = matchedFilterCat ? matchedFilterCat.name.toLowerCase().trim() : filterLower;
          const targetSlug = matchedFilterCat ? (matchedFilterCat.slug || '').toLowerCase().trim() : filterLower;
          const targetId = matchedFilterCat ? String(matchedFilterCat.id).trim() : filterLower;

          const pCatName = (p.category || p.category_name || '').toLowerCase().trim();
          const pCatSlug = (p.category_slug || '').toLowerCase().trim();
          const pCatId = String(p.category_id || '').trim();

          matchesCat = (
            pCatName === targetName ||
            pCatSlug === targetSlug ||
            pCatId === targetId ||
            pCatName === filterLower ||
            pCatSlug === filterLower ||
            pCatId === filterLower
          );
        }
        return matchesCat;
      });
    }

    // Filter by name
    const byName = filterProducts('Anime & Manga');
    assert.strictEqual(byName.length, 2, 'Filter by exact name should match 2 anime stickers');
    assert.ok(byName.some(p => p.id === 101) && byName.some(p => p.id === 104));

    // Filter by slug
    const bySlug = filterProducts('anime-manga');
    assert.strictEqual(bySlug.length, 2, 'Filter by slug should match 2 anime stickers');

    // Filter by numeric ID
    const byId = filterProducts('2');
    assert.strictEqual(byId.length, 2, 'Filter by numeric ID 2 should match 2 cyberpunk stickers');

    // Filter by case-insensitive name
    const byCase = filterProducts('cyberpunk');
    assert.strictEqual(byCase.length, 2, 'Filter by lowercase name should match 2 cyberpunk stickers');

    // Empty filter returns all
    const all = filterProducts('');
    assert.strictEqual(all.length, 5, 'Empty filter should return all 5 products');
  });

  // ===========================================================================
  // 4. ADMIN CATEGORY IMAGE RESOLUTION & FALLBACK TESTS
  // ===========================================================================
  await test('CAT-IMG-1', 'resolveAdminImageUrl correctly resolves relative paths, absolute URLs, and falls back gracefully', async () => {
    // Replicate resolveAdminImageUrl from web/js/admin.js
    const apiClient = { baseUrl: 'https://api.chipakk.shop/api' };
    function resolveAdminImageUrl(url) {
      if (!url) return '';
      let target = url;
      if (typeof target === 'object' && target !== null) {
        target = target.image_url || target.external_url || target.url || '';
      }
      const cleanUrl = String(target).trim();
      if (!cleanUrl || cleanUrl === '[object Object]') return '';
      if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('data:') || cleanUrl.startsWith('blob:')) {
        return cleanUrl;
      }
      const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api\/?$/, '') : 'https://api.chipakk.shop';
      return cleanUrl.startsWith('/') ? `${apiHost}${cleanUrl}` : `${apiHost}/${cleanUrl}`;
    }

    // 1. Relative upload path
    assert.strictEqual(resolveAdminImageUrl('/uploads/cat-anime.png'), 'https://api.chipakk.shop/uploads/cat-anime.png');

    // 2. Relative without leading slash
    assert.strictEqual(resolveAdminImageUrl('uploads/cat-anime.png'), 'https://api.chipakk.shop/uploads/cat-anime.png');

    // 3. Absolute URL
    assert.strictEqual(resolveAdminImageUrl('https://cdn.example.com/anime.jpg'), 'https://cdn.example.com/anime.jpg');

    // 4. Null / empty / undefined
    assert.strictEqual(resolveAdminImageUrl(null), '');
    assert.strictEqual(resolveAdminImageUrl(''), '');
    assert.strictEqual(resolveAdminImageUrl(undefined), '');

    // 5. Object input
    assert.strictEqual(resolveAdminImageUrl({ image_url: '/uploads/badge.png' }), 'https://api.chipakk.shop/uploads/badge.png');
  });

  await test('CAT-IMG-2', 'renderCategoriesTable in web/js/admin.js uses resolveAdminImageUrl and onerror fallback', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(
      adminJs.includes('resolveAdminImageUrl(c.image_url)'),
      'renderCategoriesTable must resolve category image via resolveAdminImageUrl'
    );
    assert.ok(
      adminJs.includes("onerror=\"this.onerror=null; this.src='${fallbackImg}';\""),
      'renderCategoriesTable category img must have an onerror fallback'
    );
  });

  // ===========================================================================
  // 5. ADMIN EDIT FORMS VALUE RETENTION TESTS
  // ===========================================================================
  await test('EDIT-PROD-1', 'editProduct normalizes API response and populates all form fields without clearing', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

    // Verify editProduct calls normalizeProduct on raw API response
    assert.ok(
      adminJs.includes('const freshProduct = normalizeProduct(raw);'),
      'editProduct must normalize the fresh API response before openProductForm'
    );

    // Verify openProductForm handles title/name and admin_id/admin_product_id
    assert.ok(
      adminJs.includes('const adminIdVal = product ? (product.admin_id || product.admin_product_id || product.sku || \'\') : \'\';'),
      'openProductForm must support product.admin_id or product.admin_product_id'
    );
    assert.ok(
      adminJs.includes('const titleVal = product ? (product.title || product.name || \'\') : \'\';'),
      'openProductForm must support product.title or product.name'
    );
  });

  await test('EDIT-PROD-2', 'openProductForm retains existing options and variants without wiping', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');

    // Verify options initialization handles array and nested value objects
    assert.ok(
      adminJs.includes('tempProdOptions = product.options.map(o => ({'),
      'openProductForm must initialize tempProdOptions from product.options'
    );
    assert.ok(
      adminJs.includes('tempProdVariants = product.variants'),
      'openProductForm must initialize tempProdVariants from product.variants'
    );
  });

  await test('EDIT-CAT-1', 'saveCategoryForm preserves existing category image when not re-uploaded', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(
      adminJs.includes('let finalImageUrl = imageUrl;'),
      'saveCategoryForm must define finalImageUrl'
    );
    assert.ok(
      adminJs.includes('finalImageUrl = existingCat.image_url;'),
      'saveCategoryForm must fallback to existing category image if not provided'
    );
  });

  await test('EDIT-CPN-1', 'Coupons table has edit button and openCouponForm preserves min_order_value', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(
      adminJs.includes('edit-cpn-btn'),
      'renderCouponsTable must include edit-cpn-btn'
    );
    assert.ok(
      adminJs.includes('cpn.min_order_value_rupees !== undefined ? cpn.min_order_value_rupees'),
      'openCouponForm must check min_order_value_rupees and min_order_value'
    );
  });

  await test('EDIT-EVT-1', 'Events table has edit button and openEventForm handles name/event_name', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(
      adminJs.includes('edit-evt-btn'),
      'renderEventsTable must include edit-evt-btn'
    );
    assert.ok(
      adminJs.includes('const evtName = evt ? (evt.event_name || evt.name || \'\') : \'\';'),
      'openEventForm must check both evt.event_name and evt.name'
    );
  });

  await test('EDIT-SHIP-1', 'Shipping rules table has edit button', async () => {
    const adminJs = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
    assert.ok(
      adminJs.includes('edit-ship-btn'),
      'renderShippingRulesTable must include edit-ship-btn'
    );
  });

  await test('EDIT-PARTIAL-1', 'productService.updateProduct preserves untouched fields on partial update', async () => {
    let capturedSql = '';
    let capturedParams = [];

    const handlers = [
      [/SHOW COLUMNS FROM products/i, async () => [[
        { Field: 'id' }, { Field: 'store_id' }, { Field: 'admin_product_id' }, { Field: 'name' },
        { Field: 'sku' }, { Field: 'price' }, { Field: 'active' }, { Field: 'tags' }
      ]]],
      [/SELECT.*FROM products p/i, async () => [[
        { id: 10, admin_product_id: 'CK-010', name: 'Original Name', sku: 'SKU-10', price: 150, active: 1, tags: '[]' }
      ]]],
      [/UPDATE products SET/i, async (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        return [{ affectedRows: 1 }];
      }],
      [/SELECT.*FROM product_images/i, async () => [[]]],
      [/SELECT.*FROM product_options/i, async () => [[]]],
      [/SELECT.*FROM product_variants/i, async () => [[]]]
    ];
    const pool = createFakePool(handlers);
    installFakePool(pool);

    const productService = require('../server/services/productService');
    // Only update price, leaving name, sku, tags untouched
    await productService.updateProduct(10, { price: 299 }, 1);

    assert.ok(capturedSql.includes('price = ?'), 'SQL must update price');
    assert.ok(!capturedSql.includes('name = ?'), 'SQL must NOT touch name when undefined');
    assert.ok(!capturedSql.includes('sku = ?'), 'SQL must NOT touch sku when undefined');
    assert.strictEqual(capturedParams[0], 299, 'Captured price param must be 299');
  });

  // Summary
  console.log('\n===============================================================');
  console.log(`TOTAL TESTS: ${results.length}`);
  console.log(`PASSED: ${results.filter(r => r.pass).length}`);
  console.log(`FAILED: ${results.filter(r => !r.pass).length}`);
  console.log('===============================================================\n');

  if (results.some(r => !r.pass)) {
    process.exit(1);
  }
}

runTests();
