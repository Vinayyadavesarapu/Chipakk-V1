/**
 * Regression Test Suite for Announcement Bar Claude Review Findings
 * 
 * 1. HIGH: Fix stale announcement toggle on store switching (Admin UI flow)
 * 2. MEDIUM: Preserve announcement active state when only text is updated (and vice-versa)
 * 3. LOW: Add consistent no-cache headers to public store-builder responses
 */

const assert = require('assert');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

// In-memory MySQL mock for hermetic testing
const memorySiteSettings = new Map();
const memoryStoreSettings = new Map();

const mockPool = {
  execute: async (sql, params = []) => {
    const trimmed = sql.trim();

    // SELECT setting_value FROM site_settings WHERE setting_key = ?
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

    // SELECT setting_value FROM store_settings WHERE store_id = ? AND setting_key = ?
    if (/SELECT setting_value FROM store_settings WHERE store_id = \? AND setting_key = \?/i.test(trimmed)) {
      const storeId = Number(params[0]);
      const key = params[1];
      const compositeKey = `${storeId}:::${key}`;
      if (memoryStoreSettings.has(compositeKey)) {
        return [[{ setting_value: memoryStoreSettings.get(compositeKey) }]];
      }
      return [[]];
    }

    // SELECT setting_key, setting_value FROM store_settings WHERE store_id = ?
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
      return [[
        {
          id: 1,
          store_id: storeId,
          name: storeId === 2 ? 'Standard 3D Delivery' : 'Standard Delivery',
          standard_fee: storeId === 2 ? 10000 : 50,
          free_shipping_threshold: storeId === 2 ? 0 : 300,
          is_enabled: 1
        }
      ]];
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
  getConnection: async () => {
    return {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      execute: async (sql, params) => mockPool.execute(sql, params)
    };
  }
};

const dbModule = require(path.join(ROOT, 'server/config/database'));
dbModule.pool = mockPool;

const app = require(path.join(ROOT, 'server/app'));
const settingsService = require('../server/services/settingsService');
const storeBuilderService = require('../server/services/storeBuilderService');

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
    failCount++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🔬 REGRESSION SUITE: 3 CLAUDE-REVIEWED ANNOUNCEMENT BAR FIXES');
  console.log('===============================================================');

  // -------------------------------------------------------------------------
  // SUITE 1: PRESERVE ANNOUNCEMENT STATE ON TEXT-ONLY UPDATES
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 1: PRESERVE ANNOUNCEMENT STATE ON TEXT-ONLY UPDATES ---');

  // Initialize Store 1 = ON, Store 2 = OFF
  await settingsService.updateStoreSettings(1, {
    announcement_text: 'CHIPAKK Initial Announcement',
    announcement_active: true
  });
  await settingsService.updateStoreSettings(2, {
    announcement_text: 'THE MARSHANS Initial Announcement',
    announcement_active: false
  });

  await test('1.1 Text-only update while announcement is OFF preserves OFF state', async () => {
    // Update only text for Store 2 (which is currently OFF)
    await settingsService.updateStoreSettings(2, {
      announcement_text: 'THE MARSHANS New Text While OFF'
    });

    const store2Settings = await settingsService.getStoreSettings(2);
    assert.strictEqual(store2Settings.announcement_text, 'THE MARSHANS New Text While OFF');
    assert.strictEqual(store2Settings.announcement_active, false, 'announcement_active must remain false!');

    // Public store builder must also stay disabled
    const publicStore2 = await storeBuilderService.getPublicStoreBuilderData(2);
    assert.strictEqual(publicStore2.announcement_bar.enabled, false);
    assert.strictEqual(publicStore2.announcement_bar.text, '');
  });

  await test('1.2 Text-only update while announcement is ON preserves ON state', async () => {
    // Update only text for Store 1 (which is currently ON)
    await settingsService.updateStoreSettings(1, {
      announcement_text: 'CHIPAKK New Text While ON'
    });

    const store1Settings = await settingsService.getStoreSettings(1);
    assert.strictEqual(store1Settings.announcement_text, 'CHIPAKK New Text While ON');
    assert.strictEqual(store1Settings.announcement_active, true, 'announcement_active must remain true!');

    const publicStore1 = await storeBuilderService.getPublicStoreBuilderData(1);
    assert.strictEqual(publicStore1.announcement_bar.enabled, true);
    assert.strictEqual(publicStore1.announcement_bar.text, 'CHIPAKK New Text While ON');
  });

  await test('1.3 Explicit toggle OFF disables announcement and preserves text', async () => {
    // Toggle Store 1 OFF without passing text
    await settingsService.updateStoreSettings(1, {
      announcement_active: false
    });

    const store1Settings = await settingsService.getStoreSettings(1);
    assert.strictEqual(store1Settings.announcement_active, false);
    assert.strictEqual(store1Settings.announcement_text, 'CHIPAKK New Text While ON', 'Existing text must be preserved, not cleared!');

    const publicStore1 = await storeBuilderService.getPublicStoreBuilderData(1);
    assert.strictEqual(publicStore1.announcement_bar.enabled, false);
  });

  await test('1.4 Explicit toggle ON enables announcement and preserves text', async () => {
    // Toggle Store 1 back ON without passing text
    await settingsService.updateStoreSettings(1, {
      announcement_active: true
    });

    const store1Settings = await settingsService.getStoreSettings(1);
    assert.strictEqual(store1Settings.announcement_active, true);
    assert.strictEqual(store1Settings.announcement_text, 'CHIPAKK New Text While ON');

    const publicStore1 = await storeBuilderService.getPublicStoreBuilderData(1);
    assert.strictEqual(publicStore1.announcement_bar.enabled, true);
    assert.strictEqual(publicStore1.announcement_bar.text, 'CHIPAKK New Text While ON');
  });

  await test('1.5 Store isolation is strictly maintained across partial updates', async () => {
    // Confirm Store 2 remained completely untouched by Store 1 toggles
    const store2Settings = await settingsService.getStoreSettings(2);
    assert.strictEqual(store2Settings.announcement_text, 'THE MARSHANS New Text While OFF');
    assert.strictEqual(store2Settings.announcement_active, false);

    // Toggle Store 2 ON
    await settingsService.updateStoreSettings(2, {
      announcement_active: true
    });
    const updatedStore2 = await settingsService.getStoreSettings(2);
    assert.strictEqual(updatedStore2.announcement_active, true);

    // Confirm Store 1 is still ON with its own text
    const store1Settings = await settingsService.getStoreSettings(1);
    assert.strictEqual(store1Settings.announcement_active, true);
    assert.strictEqual(store1Settings.announcement_text, 'CHIPAKK New Text While ON');
  });

  // -------------------------------------------------------------------------
  // SUITE 2: GET /api/store-builder NO-CACHE HTTP HEADERS
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 2: GET /api/store-builder NO-CACHE HTTP HEADERS ---');

  await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;

      try {
        await test('2.1 GET /api/store-builder (Store 1) emits no-cache headers', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/store-builder`, {
            headers: { 'X-Store-ID': '1' }
          });
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
          assert.strictEqual(res.headers.get('pragma'), 'no-cache');
          assert.strictEqual(res.headers.get('expires'), '0');

          const body = await res.json();
          assert.strictEqual(body.data.store_id, 1);
        });

        await test('2.2 GET /api/store-builder (Store 2) emits no-cache headers', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/store-builder`, {
            headers: { 'X-Store-ID': '2' }
          });
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
          assert.strictEqual(res.headers.get('pragma'), 'no-cache');
          assert.strictEqual(res.headers.get('expires'), '0');

          const body = await res.json();
          assert.strictEqual(body.data.store_id, 2);
        });
      } finally {
        server.close(resolve);
      }
    });
  });

  // -------------------------------------------------------------------------
  // SUITE 3: STORE-SWITCHING REPRODUCTION & TOGGLE PRESERVATION TEST
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 3: STORE-SWITCHING REPRODUCTION & TOGGLE PRESERVATION TEST ---');

  await test('3.1 Full store-switch reproduction sequence: ON -> switch to OFF -> save unchanged -> verify isolation', async () => {
    // 1. Start with CHIPAKK (Store 1) announcement ON
    await settingsService.updateStoreSettings(1, {
      announcement_text: 'CHIPAKK SPECIAL SALE 20% OFF',
      announcement_active: true
    });

    // 2. Set THE MARSHANS (Store 2) announcement OFF
    await settingsService.updateStoreSettings(2, {
      announcement_text: 'MARSHANS INDUSTRIAL 3D LAB',
      announcement_active: false
    });

    // Mock DOM elements for Admin Panel
    const dom = {
      elements: {
        'set-announcement': { value: '' },
        'set-announcement-active': { value: 'true' },
        'announcement-store-badge': { textContent: 'CHIPAKK' },
        'save-announcement-btn': { disabled: false, textContent: 'SAVE ANNOUNCEMENT BANNER' }
      },
      getElementById(id) {
        return this.elements[id] || null;
      }
    };

    // Client state tracking in admin.js
    let activeStoreId = 1;
    let siteSettings = {};
    let announcementBarConfig = null;
    let heroConfig = null;

    // Simulate loadSystemSettings from admin.js
    function loadSystemSettings() {
      const isMarshans = activeStoreId === 2;
      const annBadge = dom.getElementById('announcement-store-badge');
      if (annBadge) annBadge.textContent = isMarshans ? 'THE MARSHANS' : 'CHIPAKK';

      const annInput = dom.getElementById('set-announcement');
      if (annInput) annInput.value = siteSettings.announcement_text || '';

      const activeSelect = dom.getElementById('set-announcement-active');
      if (activeSelect) {
        const isActive = siteSettings.announcement_active !== undefined
          ? (siteSettings.announcement_active === true || siteSettings.announcement_active === 'true' || siteSettings.announcement_active === 1)
          : (announcementBarConfig && announcementBarConfig.enabled !== undefined ? Boolean(announcementBarConfig.enabled) : true);
        activeSelect.value = String(isActive);
      }
    }

    // Simulate renderStoreBuilder from admin.js
    function renderStoreBuilder() {
      if (announcementBarConfig) {
        const textInput = dom.getElementById('set-announcement');
        const activeSelect = dom.getElementById('set-announcement-active');
        if (textInput && announcementBarConfig.text !== undefined && !textInput.value) {
          textInput.value = announcementBarConfig.text;
        }
        if (activeSelect) {
          if (siteSettings && siteSettings.announcement_active !== undefined) {
            activeSelect.value = String(siteSettings.announcement_active === true || siteSettings.announcement_active === 'true' || siteSettings.announcement_active === 1);
          } else if (announcementBarConfig.enabled !== undefined) {
            activeSelect.value = String(announcementBarConfig.enabled);
          }
        }
      }
    }

    // Simulate refreshSettingsFromAPI
    async function refreshSettingsFromAPI() {
      const res = await settingsService.getStoreSettings(activeStoreId);
      delete siteSettings.announcement_active;
      delete siteSettings.announcement_text;
      siteSettings = { ...siteSettings, ...res };
      loadSystemSettings();
    }

    // Simulate refreshStoreBuilderFromAPI
    async function refreshStoreBuilderFromAPI() {
      const res = await storeBuilderService.getStoreBuilderAdminData(activeStoreId);
      if (res.announcement_bar) announcementBarConfig = res.announcement_bar;
      else announcementBarConfig = null;
      renderStoreBuilder();
    }

    // Simulate switchActiveStore
    async function switchActiveStore(targetId) {
      activeStoreId = targetId;
      announcementBarConfig = null;
      heroConfig = null;
      delete siteSettings.announcement_active;
      delete siteSettings.announcement_text;

      await refreshSettingsFromAPI();
      // Asynchronously trigger refreshStoreBuilder
      await refreshStoreBuilderFromAPI();
    }

    // Simulate clicking Save Announcement Banner
    async function handleSaveAnnouncement() {
      const text = dom.getElementById('set-announcement').value.trim();
      const active = dom.getElementById('set-announcement-active').value === 'true';
      await settingsService.updateStoreSettings(activeStoreId, {
        announcement_text: text,
        announcement_active: active
      });
    }

    // Initial setup: Load Store 1 (CHIPAKK)
    await switchActiveStore(1);
    assert.strictEqual(dom.getElementById('set-announcement-active').value, 'true', 'Store 1 must start with toggle ON');
    assert.strictEqual(dom.getElementById('set-announcement').value, 'CHIPAKK SPECIAL SALE 20% OFF');

    // 3. Switch from CHIPAKK to THE MARSHANS
    await switchActiveStore(2);

    // 4. Confirm the toggle remains OFF after every asynchronous refresh completes
    assert.strictEqual(dom.getElementById('set-announcement-active').value, 'false', 'Toggle must remain OFF for Store 2 after all async refreshes!');
    assert.strictEqual(dom.getElementById('set-announcement').value, 'MARSHANS INDUSTRIAL 3D LAB');

    // 5. Click Save without changing anything
    await handleSaveAnnouncement();

    // 6. Confirm THE MARSHANS remains OFF and CHIPAKK remains ON in database
    const finalStore2 = await settingsService.getStoreSettings(2);
    const finalStore1 = await settingsService.getStoreSettings(1);

    assert.strictEqual(finalStore2.announcement_active, false, 'THE MARSHANS must still be OFF in database');
    assert.strictEqual(finalStore1.announcement_active, true, 'CHIPAKK must still be ON in database');

    // 7. Repeat the test in reverse: Switch from THE MARSHANS to CHIPAKK
    await switchActiveStore(1);
    assert.strictEqual(dom.getElementById('set-announcement-active').value, 'true', 'Toggle must be ON for Store 1');
    assert.strictEqual(dom.getElementById('set-announcement').value, 'CHIPAKK SPECIAL SALE 20% OFF');

    // Click Save without changing anything
    await handleSaveAnnouncement();

    const reverseStore1 = await settingsService.getStoreSettings(1);
    const reverseStore2 = await settingsService.getStoreSettings(2);
    assert.strictEqual(reverseStore1.announcement_active, true, 'CHIPAKK must remain ON');
    assert.strictEqual(reverseStore2.announcement_active, false, 'THE MARSHANS must remain OFF');
  });

  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('===============================================================');

  if (failCount > 0) process.exit(1);
}

runTests();
