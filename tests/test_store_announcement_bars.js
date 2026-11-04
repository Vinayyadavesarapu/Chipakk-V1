/**
 * Comprehensive Test Suite for CHIPAKK & THE MARSHANS Dynamic Store-Specific Announcement Bars
 */

const assert = require('assert');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

// Setup in-memory mock MySQL pool for clean, hermetic testing
const memorySiteSettings = new Map();
const memoryStoreSettings = new Map();

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

    // Shipping rules query
    if (/SELECT .* FROM shipping_rules/i.test(trimmed)) {
      const storeId = params[0] !== undefined ? Number(params[0]) : 1;
      return [[{
        id: storeId,
        store_id: storeId,
        fee: storeId === 2 ? 10000 : 50,
        standard_fee: storeId === 2 ? 10000 : 50,
        standard_fee_rupees: storeId === 2 ? 100 : 50,
        is_free_enabled: storeId === 1 ? 1 : 0,
        free_shipping_enabled: storeId === 1 ? 1 : 0,
        free_shipping_threshold: storeId === 1 ? 300 : 0,
        free_shipping_threshold_rupees: storeId === 1 ? 300 : 0,
        free_shipping_calculation: 'gross_subtotal'
      }]];
    }

    // SHOW COLUMNS FROM banners LIKE 'store_id'
    if (/SHOW COLUMNS FROM banners/i.test(trimmed)) {
      return [[{ Field: 'store_id' }]];
    }

    // SELECT FROM banners WHERE active = 1 AND (store_id = ? OR store_id IS NULL)
    if (/SELECT .* FROM banners/i.test(trimmed)) {
      return [[]];
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

// Patch database pool before loading app and services
const dbModule = require(path.join(ROOT, 'server/config/database'));
dbModule.pool = mockPool;

const settingsService = require(path.join(ROOT, 'server/services/settingsService'));
const storeBuilderService = require(path.join(ROOT, 'server/services/storeBuilderService'));
const shippingService = require(path.join(ROOT, 'server/services/shippingService'));
const app = require(path.join(ROOT, 'server/app'));

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    failCount++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('📢 DYNAMIC STORE-SPECIFIC ANNOUNCEMENT BAR VERIFICATION');
  console.log('===============================================================');

  // Seed initial memory store settings
  memoryStoreSettings.set('1:::announcement_text', 'WELCOME TO CHIPAKK! FREE SHIPPING ON ORDERS ₹300+');
  memoryStoreSettings.set('1:::announcement_active', true);
  memoryStoreSettings.set('2:::announcement_text', 'PRECISION 3D PRINTING & CUSTOM ON-DEMAND MANUFACTURING');
  memoryStoreSettings.set('2:::announcement_active', true);

  // --- SUITE 1: DEFAULTS & ISOLATION AT SERVICE LEVEL ---
  console.log('\n--- SUITE 1: DEFAULTS & ISOLATION AT SERVICE LEVEL ---');

  await test('1.1 Store 1 defaults to CHIPAKK announcement', async () => {
    const s1 = await settingsService.getStoreSettings(1);
    assert.ok(s1.announcement_text.includes('CHIPAKK') || s1.announcement_text.includes('FREE SHIPPING'));
    assert.strictEqual(Boolean(s1.announcement_active), true);
  });

  await test('1.2 Store 2 defaults to THE MARSHANS announcement', async () => {
    const s2 = await settingsService.getStoreSettings(2);
    assert.ok(s2.announcement_text.includes('3D PRINTING') || s2.announcement_text.includes('MARSHANS'));
    assert.strictEqual(Boolean(s2.announcement_active), true);
  });

  await test('1.3 Toggling Store 1 announcement OFF does not affect Store 2', async () => {
    await settingsService.updateStoreSettings(1, { announcement_active: false });
    const s1 = await settingsService.getStoreSettings(1);
    const s2 = await settingsService.getStoreSettings(2);

    assert.strictEqual(s1.announcement_active, false, 'Store 1 must be toggled off');
    assert.strictEqual(s2.announcement_active, true, 'Store 2 must remain active');
  });

  await test('1.4 Toggling Store 2 announcement OFF does not affect Store 1', async () => {
    // Re-enable Store 1 first
    await settingsService.updateStoreSettings(1, { announcement_active: true, announcement_text: 'CHIPAKK ACTIVE BANNER' });
    // Disable Store 2
    await settingsService.updateStoreSettings(2, { announcement_active: false });

    const s1 = await settingsService.getStoreSettings(1);
    const s2 = await settingsService.getStoreSettings(2);

    assert.strictEqual(s1.announcement_active, true, 'Store 1 must remain active');
    assert.strictEqual(s1.announcement_text, 'CHIPAKK ACTIVE BANNER');
    assert.strictEqual(s2.announcement_active, false, 'Store 2 must be toggled off');
  });

  await test('1.5 Updating announcement text on Store 2 is strictly isolated from Store 1', async () => {
    await settingsService.updateStoreSettings(2, {
      announcement_active: true,
      announcement_text: 'MARSHANS AEROSPACE 3D PRINTING LAB'
    });

    const s1 = await settingsService.getStoreSettings(1);
    const s2 = await settingsService.getStoreSettings(2);

    assert.strictEqual(s1.announcement_text, 'CHIPAKK ACTIVE BANNER');
    assert.strictEqual(s2.announcement_text, 'MARSHANS AEROSPACE 3D PRINTING LAB');
    assert.strictEqual(s2.announcement_active, true);
  });

  // --- SUITE 2: VALIDATION & ERROR DEFENSE ---
  console.log('\n--- SUITE 2: VALIDATION & ERROR DEFENSE ---');

  await test('2.1 Announcement text exceeding 500 characters is rejected with 400', async () => {
    const tooLong = 'A'.repeat(501);
    await assert.rejects(
      async () => {
        await settingsService.updateStoreSettings(1, { announcement_text: tooLong });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes('500 characters'));
        return true;
      }
    );
  });

  await test('2.2 Non-string announcement text is rejected with 400', async () => {
    await assert.rejects(
      async () => {
        await settingsService.updateStoreSettings(1, { announcement_text: { invalid: true } });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes('must be a string'));
        return true;
      }
    );
  });

  await test('2.3 Shipping rules remain completely unchanged by announcement text', async () => {
    // Save announcement mentioning a higher threshold
    await settingsService.updateStoreSettings(1, { announcement_text: 'FREE SHIPPING ON ORDERS OVER ₹999' });
    const policy1 = await shippingService.getShippingPolicy(1);
    // Shipping threshold must remain the genuine configured ₹300, NOT ₹999
    assert.strictEqual(policy1.free_shipping_threshold_rupees, 300, 'Announcement text must never alter real shipping policy');
  });

  // --- SUITE 3: PUBLIC API & HTTP CACHE HEADERS ---
  console.log('\n--- SUITE 3: PUBLIC API & HTTP CACHE HEADERS ---');

  await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        // 3.1: GET /api/settings for Store 1 returns Store 1 settings with Cache-Control: no-cache
        await test('3.1 GET /api/settings (Store 1) returns Store 1 announcement with no-cache headers', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            headers: { 'X-Store-ID': '1', 'Accept': 'application/json' }
          });
          assert.strictEqual(res.status, 200);
          assert.ok(res.headers.get('cache-control')?.includes('no-cache'));
          const json = await res.json();
          assert.strictEqual(json.data.settings.store_id, 1);
          assert.strictEqual(json.data.settings.announcement_active, true);
          assert.strictEqual(json.data.settings.announcement_text, 'FREE SHIPPING ON ORDERS OVER ₹999');
        });

        // 3.2: GET /api/settings for Store 2 returns Store 2 settings
        await test('3.2 GET /api/settings (Store 2) returns Store 2 announcement', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/settings`, {
            headers: { 'X-Store-ID': '2', 'Accept': 'application/json' }
          });
          assert.strictEqual(res.status, 200);
          const json = await res.json();
          assert.strictEqual(json.data.settings.store_id, 2);
          assert.strictEqual(json.data.settings.announcement_active, true);
          assert.strictEqual(json.data.settings.announcement_text, 'MARSHANS AEROSPACE 3D PRINTING LAB');
        });

        // 3.3: GET /api/settings via store query parameter (?store=marshans) routes to Store 2
        await test('3.3 GET /api/settings?store=marshans routes correctly to Store 2', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/settings?store=marshans`, {
            headers: { 'Accept': 'application/json' }
          });
          assert.strictEqual(res.status, 200);
          const json = await res.json();
          assert.strictEqual(json.data.settings.store_id, 2);
          assert.strictEqual(json.data.settings.announcement_text, 'MARSHANS AEROSPACE 3D PRINTING LAB');
        });

        // 3.4: GET /api/store-builder echoes synchronized announcement_bar with no-cache headers
        await test('3.4 GET /api/store-builder returns synchronized announcement_bar with no-cache headers', async () => {
          const res1 = await fetch(`http://127.0.0.1:${port}/api/store-builder`, {
            headers: { 'X-Store-ID': '1' }
          });
          const res2 = await fetch(`http://127.0.0.1:${port}/api/store-builder`, {
            headers: { 'X-Store-ID': '2' }
          });

          assert.strictEqual(res1.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
          assert.strictEqual(res1.headers.get('pragma'), 'no-cache');
          assert.strictEqual(res1.headers.get('expires'), '0');
          assert.strictEqual(res2.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
          assert.strictEqual(res2.headers.get('pragma'), 'no-cache');
          assert.strictEqual(res2.headers.get('expires'), '0');

          const json1 = await res1.json();
          const json2 = await res2.json();

          assert.strictEqual(json1.data.store_id, 1);
          assert.strictEqual(json1.data.announcement_bar.text, 'FREE SHIPPING ON ORDERS OVER ₹999');
          assert.strictEqual(json1.data.announcement_bar.enabled, true);

          assert.strictEqual(json2.data.store_id, 2);
          assert.strictEqual(json2.data.announcement_bar.text, 'MARSHANS AEROSPACE 3D PRINTING LAB');
          assert.strictEqual(json2.data.announcement_bar.enabled, true);
        });

        // 3.5: Unauthorized callers cannot modify settings
        await test('3.5 PUT /api/admin/settings rejects unauthenticated requests with 401', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ announcement_text: 'HACKED' })
          });
          assert.strictEqual(res.status, 401);
        });

      } finally {
        server.close(resolve);
      }
    });
  });

  // --- SUITE 4: STOREFRONT CLIENT NORMALIZATION & CLIENT FALLBACKS ---
  console.log('\n--- SUITE 4: STOREFRONT CLIENT NORMALIZATION & CLIENT FALLBACKS ---');

  await test('4.1 customer app.js normalizes empty announcement text to disabled (no blank bar)', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/app.js'), 'utf8');
    assert.ok(appJs.includes('announcementActive'), 'app.js must compute announcementActive');
    assert.ok(appJs.includes('Boolean(announcementText)'), 'app.js must check Boolean(announcementText)');
  });

  await test('4.2 customer app.js sets bar.style.display = "none" when announcement is disabled', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/app.js'), 'utf8');
    assert.ok(appJs.includes('bar.style.display = "none"'), 'app.js must hide bar when disabled');
  });

  await test('4.3 admin.html includes store badge in announcement header', () => {
    const fs = require('fs');
    const adminHtml = fs.readFileSync(path.join(ROOT, 'web/admin.html'), 'utf8');
    assert.ok(adminHtml.includes('id="announcement-store-badge"'), 'admin.html must have announcement-store-badge');
  });

  await test('4.4 admin.js has unified save-announcement-btn handler with store isolation', () => {
    const fs = require('fs');
    const adminJs = fs.readFileSync(path.join(ROOT, 'web/js/admin.js'), 'utf8');
    assert.ok(adminJs.includes("isMarshans ? 'THE MARSHANS' : 'CHIPAKK'") || adminJs.includes("id === 2 ? 'THE MARSHANS' : 'CHIPAKK'"), 'admin.js must provide store feedback');
    assert.ok(!adminJs.includes('announcement-text-input'), 'admin.js must not reference non-existent announcement-text-input');
  });

  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('===============================================================');

  if (failCount > 0) process.exit(1);
}

runTests();
