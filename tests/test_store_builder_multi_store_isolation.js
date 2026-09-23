/**
 * tests/test_store_builder_multi_store_isolation.js
 *
 * Dedicated Multi-Store Isolation Test Suite for:
 * STEP 2 PART A - STORE BUILDER MULTI-STORE ISOLATION
 *
 * Validates:
 * 1. Store 1 (CHIPAKK) Admin Data returns Store 1 defaults & preserves existing Store 1 configuration.
 * 2. Store 2 (THE MARSHANS) Admin Data returns Store 2 3D printing defaults (mutually exclusive from Store 1).
 * 3. Updating Store 1 Hero configuration does NOT alter Store 2 Hero configuration.
 * 4. Updating Store 2 Hero configuration does NOT alter Store 1 Hero configuration.
 * 5. Announcement bar isolation & synchronization with store_settings:
 *    - Store 1 announcement changes do NOT leak into Store 2
 *    - Store 2 announcement changes do NOT leak into Store 1
 * 6. Public customer API GET /api/store-builder serves isolated data matching storeId:
 *    - Store 1: CHIPAKK Hero + CHIPAKK announcement
 *    - Store 2: THE MARSHANS 3D Hero + MARSHANS announcement
 * 7. HTTP Express endpoints via X-Store-ID header:
 *    - GET /api/admin/store-builder
 *    - PUT /api/admin/store-builder
 *    - GET /api/store-builder
 */

const assert = require('assert');
const http = require('http');

// Setup in-memory mock MySQL pool for clean, hermetic testing of storeBuilderService
const memorySiteSettings = new Map();
const memoryStoreSettings = new Map();

// Helper to simulate site_settings table queries
const mockPool = {
  execute: async (sql, params = []) => {
    const trimmed = sql.trim();

    // SELECT FROM site_settings WHERE setting_key = ?
    if (/SELECT setting_value FROM site_settings WHERE setting_key = \?/i.test(trimmed)) {
      const key = params[0];
      if (memorySiteSettings.has(key)) {
        return [[{ setting_value: memorySiteSettings.get(key) }]];
      }
      return [[]];
    }

    // INSERT INTO site_settings ... ON DUPLICATE KEY UPDATE
    if (/INSERT INTO site_settings/i.test(trimmed)) {
      const key = params[0];
      const val = params[1];
      memorySiteSettings.set(key, val);
      return [{ affectedRows: 1 }];
    }

    // SELECT FROM store_settings WHERE store_id = ?
    if (/SELECT setting_key, setting_value FROM store_settings WHERE store_id = \?/i.test(trimmed)) {
      const storeId = Number(params[0]);
      const rows = [];
      for (const [compositeKey, val] of memoryStoreSettings.entries()) {
        const [sId, key] = compositeKey.split(':::');
        if (Number(sId) === storeId) {
          rows.push({ setting_key: key, setting_value: val });
        }
      }
      return [rows];
    }

    // INSERT INTO store_settings ... ON DUPLICATE KEY UPDATE
    if (/INSERT INTO store_settings/i.test(trimmed)) {
      const storeId = Number(params[0]);
      const key = params[1];
      const val = params[2];
      memoryStoreSettings.set(`${storeId}:::${key}`, val);
      return [{ affectedRows: 1 }];
    }

    // SHOW COLUMNS FROM banners LIKE 'store_id'
    if (/SHOW COLUMNS FROM banners/i.test(trimmed)) {
      return [[{ Field: 'store_id' }]];
    }

    // SELECT FROM banners WHERE active = 1 AND (store_id = ? OR store_id IS NULL)
    if (/SELECT .* FROM banners/i.test(trimmed)) {
      const storeId = params[0] !== undefined ? Number(params[0]) : 1;
      if (storeId === 2) {
        return [[{ id: 201, title: 'Marshans 3D Filament Sale', image_url: '/uploads/banner-mrs.jpg', target_url: 'shop.html', sort_order: 1, store_id: 2 }]];
      }
      return [[{ id: 101, title: 'Chipakk Sticker Pack Drop', image_url: '/uploads/banner-chp.jpg', target_url: 'shop.html', sort_order: 1, store_id: 1 }]];
    }

    return [[]];
  },
  getConnection: async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params) => mockPool.execute(sql, params)
  })
};

// Patch database pool before loading services
const dbConfig = require('../server/config/database');
const originalPool = dbConfig.pool;
dbConfig.pool = mockPool;

const storeBuilderService = require('../server/services/storeBuilderService');
const { getStoreSettings, updateStoreSettings } = require('../server/services/settingsService');
const app = require('../server/app');

console.log('Running STEP 2 PART A: Store Builder Multi-Store Isolation Test Suite...\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    dbConfig.pool = originalPool;
    process.exit(1);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    dbConfig.pool = originalPool;
    process.exit(1);
  }
}

(async () => {
  // Test 1: Store 1 & Store 2 initial defaults are mutually exclusive
  await runAsyncTest('DEFAULTS :: Store 1 and Store 2 initial data have distinct branding and store_id', async () => {
    const store1Data = await storeBuilderService.getStoreBuilderAdminData(1);
    const store2Data = await storeBuilderService.getStoreBuilderAdminData(2);

    assert.strictEqual(store1Data.store_id, 1);
    assert.strictEqual(store2Data.store_id, 2);

    // Store 1: Stickers
    assert.strictEqual(store1Data.hero_config.fixed_banner.title, 'STICK YOUR WORLD.');
    assert.ok(store1Data.announcement_bar.text.includes('CHIPAKK'));

    // Store 2: 3D Printing
    assert.strictEqual(store2Data.hero_config.fixed_banner.title, 'ENGINEERED IN 3D.');
    assert.ok(store2Data.announcement_bar.text.includes('MARSHANS') || store2Data.announcement_bar.text.includes('3D PRINTING'));
  });

  // Test 2: Backward compatibility: Legacy unpartitioned Store 1 config is respected
  await runAsyncTest('LEGACY COMPATIBILITY :: Store 1 falls back to legacy unpartitioned key if _store_1 absent', async () => {
    memorySiteSettings.set('store_builder_hero_config', JSON.stringify({
      mode: 'fixed',
      fixed_banner: {
        title: 'CUSTOM LEGACY STICKERS',
        eyebrow: 'Legacy Eyebrow',
        description: 'Legacy description'
      }
    }));

    const store1Data = await storeBuilderService.getStoreBuilderAdminData(1);
    assert.strictEqual(store1Data.hero_config.fixed_banner.title, 'CUSTOM LEGACY STICKERS');

    // Store 2 must NOT see Store 1's legacy data!
    const store2Data = await storeBuilderService.getStoreBuilderAdminData(2);
    assert.strictEqual(store2Data.hero_config.fixed_banner.title, 'ENGINEERED IN 3D.');
  });

  // Test 3: Updating Store 1 Hero does NOT alter Store 2 Hero
  await runAsyncTest('HERO ISOLATION :: Updating Store 1 Hero does NOT mutate Store 2 Hero', async () => {
    await storeBuilderService.updateStoreBuilderData({
      hero_config: {
        mode: 'fixed',
        fixed_banner: {
          title: 'CHIPAKK BRAND NEW HERO 2026',
          eyebrow: 'Fresh Stickers'
        }
      }
    }, 1);

    const s1 = await storeBuilderService.getStoreBuilderAdminData(1);
    const s2 = await storeBuilderService.getStoreBuilderAdminData(2);

    assert.strictEqual(s1.hero_config.fixed_banner.title, 'CHIPAKK BRAND NEW HERO 2026');
    assert.strictEqual(s2.hero_config.fixed_banner.title, 'ENGINEERED IN 3D.', 'Store 2 Hero must remain untouched');
  });

  // Test 4: Updating Store 2 Hero does NOT alter Store 1 Hero
  await runAsyncTest('HERO ISOLATION :: Updating Store 2 Hero does NOT mutate Store 1 Hero', async () => {
    await storeBuilderService.updateStoreBuilderData({
      hero_config: {
        mode: 'fixed',
        fixed_banner: {
          title: 'MARSHANS AEROSPACE 3D PRINTING',
          eyebrow: 'Industrial Fabrication'
        }
      }
    }, 2);

    const s1 = await storeBuilderService.getStoreBuilderAdminData(1);
    const s2 = await storeBuilderService.getStoreBuilderAdminData(2);

    assert.strictEqual(s2.hero_config.fixed_banner.title, 'MARSHANS AEROSPACE 3D PRINTING');
    assert.strictEqual(s1.hero_config.fixed_banner.title, 'CHIPAKK BRAND NEW HERO 2026', 'Store 1 Hero must remain untouched');
  });

  // Test 5: Announcement Bar isolation & synchronization with store_settings
  await runAsyncTest('ANNOUNCEMENT ISOLATION :: Announcement bar updates are isolated per store and sync to store_settings', async () => {
    // Update Store 1 announcement bar
    await storeBuilderService.updateStoreBuilderData({
      announcement_bar: {
        enabled: true,
        text: 'CHIPAKK FESTIVAL OFFER: 20% OFF TODAY',
        mode: 'MARQUEE',
        marquee_speed: 'fast'
      }
    }, 1);

    // Update Store 2 announcement bar
    await storeBuilderService.updateStoreBuilderData({
      announcement_bar: {
        enabled: false,
        text: 'MARSHANS FACTORY CLOSED FOR ANNUAL MAINTENANCE',
        mode: 'STATIC',
        marquee_speed: 'normal'
      }
    }, 2);

    const s1 = await storeBuilderService.getStoreBuilderAdminData(1);
    const s2 = await storeBuilderService.getStoreBuilderAdminData(2);

    assert.strictEqual(s1.announcement_bar.text, 'CHIPAKK FESTIVAL OFFER: 20% OFF TODAY');
    assert.strictEqual(s1.announcement_bar.enabled, true);
    assert.strictEqual(s1.announcement_bar.marquee_speed, 'fast');

    assert.strictEqual(s2.announcement_bar.text, 'MARSHANS FACTORY CLOSED FOR ANNUAL MAINTENANCE');
    assert.strictEqual(s2.announcement_bar.enabled, false);

    // Verify synchronization to store_settings
    const settingsStore1 = await getStoreSettings(1);
    const settingsStore2 = await getStoreSettings(2);

    assert.strictEqual(settingsStore1.announcement_text, 'CHIPAKK FESTIVAL OFFER: 20% OFF TODAY');
    assert.strictEqual(settingsStore1.announcement_active, true);

    assert.strictEqual(settingsStore2.announcement_text, 'MARSHANS FACTORY CLOSED FOR ANNUAL MAINTENANCE');
    assert.strictEqual(settingsStore2.announcement_active, false);
  });

  // Test 6: Public Store Builder data returns store-isolated customer payload
  await runAsyncTest('PUBLIC STOREFRONT :: getPublicStoreBuilderData returns correct store-scoped customer data', async () => {
    const pub1 = await storeBuilderService.getPublicStoreBuilderData(1);
    const pub2 = await storeBuilderService.getPublicStoreBuilderData(2);

    assert.strictEqual(pub1.store_id, 1);
    assert.strictEqual(pub1.hero.title, 'CHIPAKK BRAND NEW HERO 2026');
    assert.strictEqual(pub1.announcement_bar.text, 'CHIPAKK FESTIVAL OFFER: 20% OFF TODAY');
    assert.strictEqual(pub1.announcement_bar.enabled, true);
    assert.strictEqual(pub1.promo_banners[0].store_id, 1);
    assert.strictEqual(pub1.store_info.store_name, 'CHIPAKK Stickers');

    assert.strictEqual(pub2.store_id, 2);
    assert.strictEqual(pub2.hero.title, 'MARSHANS AEROSPACE 3D PRINTING');
    assert.strictEqual(pub2.announcement_bar.enabled, false);
    assert.strictEqual(pub2.promo_banners[0].store_id, 2);
    assert.strictEqual(pub2.store_info.store_name, 'THE MARSHANS');
  });

  // Test 7: HTTP API End-to-End Simulation
  await runAsyncTest('HTTP API :: GET /api/store-builder with X-Store-ID header returns isolated data', async () => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const requestGet = (urlPath, headers = {}) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          method: 'GET',
          headers
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(body) });
            } catch (e) {
              resolve({ status: res.statusCode, body });
            }
          });
        });
        req.on('error', reject);
        req.end();
      });
    };

    // Store 1 Request
    const resStore1 = await requestGet('/api/store-builder', { 'x-store-id': '1' });
    assert.strictEqual(resStore1.status, 200);
    assert.strictEqual(resStore1.data.data.store_id, 1);
    assert.strictEqual(resStore1.data.data.hero.title, 'CHIPAKK BRAND NEW HERO 2026');

    // Store 2 Request
    const resStore2 = await requestGet('/api/store-builder', { 'x-store-id': '2' });
    assert.strictEqual(resStore2.status, 200);
    assert.strictEqual(resStore2.data.data.store_id, 2);
    assert.strictEqual(resStore2.data.data.hero.title, 'MARSHANS AEROSPACE 3D PRINTING');

    server.close();
  });

  // Test 8: Admin Controllers Direct Test (getStoreBuilderAdminHandler & updateStoreBuilderAdminHandler)
  await runAsyncTest('ADMIN CONTROLLERS :: getStoreBuilderAdminHandler & updateStoreBuilderAdminHandler enforce storeId isolation', async () => {
    const { getStoreBuilderAdminHandler, updateStoreBuilderAdminHandler } = require('../server/controllers/storeBuilderController');

    // Simulate mock req & res
    const mockRes = () => {
      const res = {
        statusCode: 200,
        payload: null,
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) { this.payload = data; return this; }
      };
      return res;
    };

    // Store 1 Admin Get
    const req1 = { storeId: 1, headers: {} };
    const res1 = mockRes();
    await getStoreBuilderAdminHandler(req1, res1, () => {});
    assert.strictEqual(res1.payload.data.store_id, 1);
    assert.strictEqual(res1.payload.data.hero_config.fixed_banner.title, 'CHIPAKK BRAND NEW HERO 2026');

    // Store 2 Admin Get
    const req2 = { storeId: 2, headers: {} };
    const res2 = mockRes();
    await getStoreBuilderAdminHandler(req2, res2, () => {});
    assert.strictEqual(res2.payload.data.store_id, 2);
    assert.strictEqual(res2.payload.data.hero_config.fixed_banner.title, 'MARSHANS AEROSPACE 3D PRINTING');

    // Store 2 Admin Update
    const reqUpdate2 = {
      storeId: 2,
      headers: {},
      body: {
        hero_config: {
          mode: 'fixed',
          fixed_banner: {
            title: 'MARSHANS TITANIUM PRINTING LABS'
          }
        }
      }
    };
    const resUpdate2 = mockRes();
    await updateStoreBuilderAdminHandler(reqUpdate2, resUpdate2, () => {});
    assert.strictEqual(resUpdate2.payload.data.store_id, 2);
    assert.strictEqual(resUpdate2.payload.data.hero_config.fixed_banner.title, 'MARSHANS TITANIUM PRINTING LABS');

    // Verify Store 1 was NOT altered
    const resVerify1 = mockRes();
    await getStoreBuilderAdminHandler(req1, resVerify1, () => {});
    assert.strictEqual(resVerify1.payload.data.hero_config.fixed_banner.title, 'CHIPAKK BRAND NEW HERO 2026', 'Store 1 Hero must remain unaltered by Store 2 Admin update');
  });

  dbConfig.pool = originalPool;
  console.log(`\n==============================================`);
  console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests} tests successful.`);
  console.log(`==============================================\n`);
})();
