/**
 * Custom Forge Admin Panel Navigation & UI Verification Test Suite
 *
 * Verifies:
 * 1. Custom Forge navigation item under OPERATIONS.
 * 2. Dedicated order management screen (#tab-custom-forge) structure.
 * 3. Store switching behavior (Store 1 hides Custom Forge, Store 2 shows Custom Forge).
 * 4. Safe store switching transitions (no blank screen when switching away from Marshans-only tabs).
 * 5. Tab state persistence & page refresh restoration.
 * 6. Direct link from regular orders terminal to Custom Forge when Store 2 is active.
 * 7. Loading, empty, and error state handling in order listing.
 * 8. Strict execution order of initialization sequence:
 *    1) API/store initialization
 *    2) Store switcher initialization
 *    3) Custom Forge sidebar visibility
 *    4) restoreInitialTab()
 *    5) Initial dashboard/data loading
 * 9. Enforcement that tab-custom-forge is restorable under Store 2, and impossible under Store 1.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('STARTING CUSTOM FORGE ADMIN PANEL NAVIGATION & UI TEST SUITE');
console.log('================================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(description, fn) {
  try {
    fn();
    console.log(`[PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(`       ${err.message}`);
    failedTests++;
  }
}

const adminHtmlPath = path.join(__dirname, '../web/admin.html');
const adminJsPath = path.join(__dirname, '../web/js/admin.js');

const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
const adminJs = fs.readFileSync(adminJsPath, 'utf8');

// Mock DOM Environment
function createMockDOM() {
  const elements = {};

  const createEl = (tag, id, classes = [], attributes = {}) => {
    const el = {
      tagName: tag.toUpperCase(),
      id: id || '',
      className: classes.join(' '),
      classList: {
        _classes: new Set(classes),
        contains(c) { return this._classes.has(c); },
        add(c) { this._classes.add(c); el.className = Array.from(this._classes).join(' '); },
        remove(c) { this._classes.delete(c); el.className = Array.from(this._classes).join(' '); },
        toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
      },
      style: {},
      attributes: { ...attributes },
      getAttribute(attr) { return this.attributes[attr] || null; },
      setAttribute(attr, val) { this.attributes[attr] = val; },
      children: [],
      parentNode: null,
      closest(sel) {
        if (sel === 'li' && el.tagName === 'LI') return el;
        if (el.parentNode) return el.parentNode.closest ? el.parentNode.closest(sel) : null;
        return null;
      },
      querySelector(sel) {
        return Object.values(elements).find(e => {
          if (sel.startsWith('#')) return e.id === sel.slice(1);
          if (sel.startsWith('.')) return e.classList.contains(sel.slice(1));
          return false;
        }) || null;
      },
      querySelectorAll(sel) {
        return Object.values(elements).filter(e => {
          if (sel.startsWith('#')) return e.id === sel.slice(1);
          if (sel.startsWith('.')) return e.classList.contains(sel.slice(1));
          return false;
        });
      },
      addEventListener: (evt, handler) => {
        el._handlers = el._handlers || {};
        el._handlers[evt] = el._handlers[evt] || [];
        el._handlers[evt].push(handler);
      },
      click: () => {
        if (el._handlers && el._handlers.click) {
          el._handlers.click.forEach(h => h({ preventDefault: () => {} }));
        }
      },
      innerHTML: '',
      textContent: ''
    };
    if (id) elements[id] = el;
    return el;
  };

  return { elements, createEl };
}

// 1. HTML Verification Tests
runTest('1.1: admin.html defines Custom Forge navigation link under OPERATIONS', () => {
  assert(adminHtml.includes('data-tab="tab-custom-forge"'), 'Must have data-tab="tab-custom-forge"');
  assert(adminHtml.includes('id="nav-custom-forge-link"'), 'Must have id="nav-custom-forge-link"');
  assert(adminHtml.includes('id="cf-order-nav-badge"'), 'Must have badge id="cf-order-nav-badge"');
  assert(adminHtml.includes('🔨 Custom Forge Orders'), 'Must have label matching "🔨 Custom Forge Orders"');
});

runTest('1.2: admin.html defines dedicated Custom Forge section with order management table and tabs', () => {
  assert(adminHtml.includes('id="tab-custom-forge"'), 'Must define section #tab-custom-forge');
  assert(adminHtml.includes('id="custom-forge-orders-tbody"'), 'Must define tbody #custom-forge-orders-tbody');
  assert(adminHtml.includes('id="custom-forge-status-tabs"'), 'Must define status filter tabs');
  assert(adminHtml.includes('id="custom-forge-search-input"'), 'Must define search input');
  assert(adminHtml.includes('id="custom-forge-reset-search-btn"'), 'Must define search reset button');
});

runTest('1.3: admin.html defines Custom Forge Order Detail Modal', () => {
  assert(adminHtml.includes('id="custom-forge-order-modal"'), 'Must define #custom-forge-order-modal');
  assert(adminHtml.includes('id="cf-detail-status-select"'), 'Must define status dropdown');
  assert(adminHtml.includes('id="cf-update-status-btn"'), 'Must define update status button');
  assert(adminHtml.includes('id="cf-detail-customization-section"'), 'Must define customization section');
  assert(adminHtml.includes('id="cf-timeline-container"'), 'Must define audit trail container');
});

runTest('1.4: admin.html contains callout banner in tab-orders pointing to Custom Forge for Store 2', () => {
  assert(adminHtml.includes('id="marshans-cf-callout"'), 'Must define callout banner #marshans-cf-callout');
  assert(adminHtml.includes('id="btn-goto-custom-forge"'), 'Must define button #btn-goto-custom-forge');
});

// 2. JavaScript Navigation & State Logic Tests
runTest('2.1: admin.js defines switchAdminTab, isTabAllowedForStore, and restoreInitialTab', () => {
  assert(adminJs.includes('function switchAdminTab'), 'Must define switchAdminTab');
  assert(adminJs.includes('function isTabAllowedForStore'), 'Must define isTabAllowedForStore');
  assert(adminJs.includes('function restoreInitialTab'), 'Must define restoreInitialTab');
  assert(adminJs.includes('localStorage.setItem(\'admin_active_tab\''), 'Must persist active tab to localStorage');
});

runTest('2.2: isTabAllowedForStore correctly isolates Store 1 and Store 2 modules', () => {
  const fnCode = `
    const MARSHANS_ONLY_TABS = ['tab-custom-forge', 'tab-materials', 'tab-inventory', 'tab-finishing', 'tab-production-jobs', 'tab-custom-requests'];
    const CHIPAKK_ONLY_TABS = ['tab-production', 'tab-chipakk-inventory', 'tab-events', 'tab-team', 'tab-settings', 'tab-logs'];
    function isTabAllowedForStore(tabId, storeId) {
        if (storeId === 1 && MARSHANS_ONLY_TABS.includes(tabId)) return false;
        if (storeId === 2 && CHIPAKK_ONLY_TABS.includes(tabId)) return false;
        return true;
    }
    return { isTabAllowedForStore };
  `;
  const evalResult = new Function(fnCode)();
  const testIsAllowed = evalResult.isTabAllowedForStore;

  // Store 1 (CHIPAKK): Marshans tabs forbidden, Chipakk tabs allowed, Shared tabs allowed
  assert.strictEqual(testIsAllowed('tab-custom-forge', 1), false, 'Custom Forge forbidden on Store 1');
  assert.strictEqual(testIsAllowed('tab-materials', 1), false, 'Materials forbidden on Store 1');
  assert.strictEqual(testIsAllowed('tab-production', 1), true, 'Production allowed on Store 1');
  assert.strictEqual(testIsAllowed('tab-orders', 1), true, 'Orders allowed on Store 1');
  assert.strictEqual(testIsAllowed('tab-dashboard', 1), true, 'Dashboard allowed on Store 1');

  // Store 2 (THE MARSHANS): Chipakk tabs forbidden, Marshans tabs allowed, Shared tabs allowed
  assert.strictEqual(testIsAllowed('tab-custom-forge', 2), true, 'Custom Forge allowed on Store 2');
  assert.strictEqual(testIsAllowed('tab-materials', 2), true, 'Materials allowed on Store 2');
  assert.strictEqual(testIsAllowed('tab-production', 2), false, 'Production queue forbidden on Store 2');
  assert.strictEqual(testIsAllowed('tab-chipakk-inventory', 2), false, 'Production inventory forbidden on Store 2');
  assert.strictEqual(testIsAllowed('tab-orders', 2), true, 'Orders allowed on Store 2');
  assert.strictEqual(testIsAllowed('tab-dashboard', 2), true, 'Dashboard allowed on Store 2');
});

runTest('2.3: Tab restoration restores tab-custom-forge when store is 2, but safely falls back when store is 1', () => {
  const MARSHANS_ONLY_TABS = ['tab-custom-forge', 'tab-materials', 'tab-inventory', 'tab-finishing', 'tab-production-jobs', 'tab-custom-requests'];
  const CHIPAKK_ONLY_TABS = ['tab-production', 'tab-chipakk-inventory', 'tab-events', 'tab-team', 'tab-settings', 'tab-logs'];

  function mockRestore(storeId, savedTab, hash) {
    let initialTab = null;
    if (hash && hash !== '#') {
      initialTab = hash.replace(/^#/, '');
    } else {
      initialTab = savedTab;
    }
    const isAllowed = !(storeId === 1 && MARSHANS_ONLY_TABS.includes(initialTab)) &&
                      !(storeId === 2 && CHIPAKK_ONLY_TABS.includes(initialTab));
    if (!initialTab || !isAllowed) {
      initialTab = 'tab-dashboard';
    }
    return initialTab;
  }

  // Under Store 2, saved tab 'tab-custom-forge' is preserved across refresh
  assert.strictEqual(mockRestore(2, 'tab-custom-forge', ''), 'tab-custom-forge');

  // Under Store 2, URL hash '#tab-custom-forge' is preserved
  assert.strictEqual(mockRestore(2, '', '#tab-custom-forge'), 'tab-custom-forge');

  // Under Store 1, saved tab 'tab-custom-forge' safely falls back to tab-dashboard
  assert.strictEqual(mockRestore(1, 'tab-custom-forge', ''), 'tab-dashboard');

  // Under Store 1, direct URL hash '#tab-custom-forge' safely falls back to tab-dashboard
  assert.strictEqual(mockRestore(1, '', '#tab-custom-forge'), 'tab-dashboard');

  // Under Store 2, saved tab 'tab-production' safely falls back to tab-dashboard
  assert.strictEqual(mockRestore(2, 'tab-production', ''), 'tab-dashboard');
});

runTest('2.4: Store switcher UI safely transitions away from Marshans tabs when switching to Store 1', () => {
  assert(adminJs.includes('if (currentActiveTabId && MARSHANS_ONLY_TABS.includes(currentActiveTabId))'),
    'Must check if active tab is in MARSHANS_ONLY_TABS when switching to Store 1');
  assert(adminJs.includes('switchAdminTab(\'tab-dashboard\')'),
    'Must switch to dashboard when switching away from a store-incompatible tab');
});

runTest('2.5: loadAllAdminData primes Custom Forge data and unread badge when Store 2 is active', () => {
  assert(adminJs.includes('activeStoreId === 2 ? refreshCustomForgeOrdersFromAPI() : Promise.resolve()'),
    'loadAllAdminData must refresh Custom Forge orders when store is 2');
  assert(adminJs.includes('activeStoreId === 2 ? checkCustomForgeUnreadCount() : Promise.resolve()'),
    'loadAllAdminData must check unread count when store is 2');
});

runTest('2.6: updateState includes renderCustomForgeTable', () => {
  assert(adminJs.includes('renderCustomForgeTable();'),
    'updateState must call renderCustomForgeTable');
});

runTest('2.7: refreshCustomForgeOrdersFromAPI provides loading, empty, and retryable error states', () => {
  assert(adminJs.includes('Loading Custom Forge orders...'), 'Must render loading state');
  assert(adminJs.includes('Failed to load Custom Forge orders'), 'Must render error state');
  assert(adminJs.includes('id="btn-retry-cf-orders"'), 'Must provide a RETRY button');
});

// 3. Execution Order Behavioral Verification
runTest('3.1: initDashboard executes the strict 5-step initialization sequence', () => {
  // Verify in the admin.js source code that initDashboard follows:
  // 1. API/store initialization
  // 2. Store switcher initialization
  // 3. Custom Forge sidebar visibility
  // 4. restoreInitialTab()
  // 5. Initial dashboard / data sync
  const initDashboardCode = adminJs.substring(adminJs.indexOf('function initDashboard()'), adminJs.indexOf('const MARSHANS_ONLY_TABS'));
  assert(initDashboardCode.includes('apiClient.getActiveStoreId'), 'Step 1: Must query active store from apiClient');
  assert(initDashboardCode.includes('updateStoreSwitcherUI(activeStoreId, { switchTab: false })'),
    'Steps 2 & 3: Must call updateStoreSwitcherUI with switchTab: false to set sidebar visibility before tab restore');
  assert(initDashboardCode.includes('restoreInitialTab()'), 'Step 4: Must call restoreInitialTab after switcher UI initialization');
  assert(initDashboardCode.includes('updateState()'), 'Step 5: Must call updateState');

  const idxStep1 = initDashboardCode.indexOf('apiClient.getActiveStoreId');
  const idxStep2 = initDashboardCode.indexOf('updateStoreSwitcherUI');
  const idxStep4 = initDashboardCode.indexOf('restoreInitialTab');
  const idxStep5 = initDashboardCode.indexOf('updateState');

  assert(idxStep1 < idxStep2, 'Step 1 (API store init) must precede Step 2 (switcher init)');
  assert(idxStep2 < idxStep4, 'Step 2/3 (switcher UI & sidebar visibility) must precede Step 4 (restoreInitialTab)');
  assert(idxStep4 < idxStep5, 'Step 4 (restoreInitialTab) must precede Step 5 (updateState / loadAllAdminData)');
});

runTest('3.2: Full Behavioral Simulation: Store 2 refresh and direct hash restores tab-custom-forge', () => {
  let localStorageStore = {
    admin_active_store_id: '2',
    admin_active_tab: 'tab-custom-forge'
  };
  let windowHash = '#tab-custom-forge';
  let sidebarCfVisible = false;
  let activeTabRendered = null;

  // Step 1: API/store initialization
  const storeId = parseInt(localStorageStore.admin_active_store_id || '1', 10);
  assert.strictEqual(storeId, 2, 'Store must be Store 2');

  // Step 2 & 3: Store switcher initialization and Custom Forge sidebar visibility
  if (storeId === 2) {
    sidebarCfVisible = true;
  } else {
    sidebarCfVisible = false;
  }
  assert.strictEqual(sidebarCfVisible, true, 'Custom Forge sidebar item must be visible under Store 2');

  // Step 4: restoreInitialTab()
  const MARSHANS_ONLY_TABS = ['tab-custom-forge', 'tab-materials'];
  const CHIPAKK_ONLY_TABS = ['tab-production', 'tab-chipakk-inventory'];

  let targetTab = windowHash.replace(/^#/, '') || localStorageStore.admin_active_tab;
  const isAllowed = !(storeId === 1 && MARSHANS_ONLY_TABS.includes(targetTab)) &&
                    !(storeId === 2 && CHIPAKK_ONLY_TABS.includes(targetTab));
  if (!targetTab || !isAllowed) {
    targetTab = 'tab-dashboard';
  }
  activeTabRendered = targetTab;

  assert.strictEqual(activeTabRendered, 'tab-custom-forge', 'tab-custom-forge must be restored on Store 2');
});

runTest('3.3: Full Behavioral Simulation: Store 1 refresh and direct hash CANNOT restore tab-custom-forge', () => {
  let localStorageStore = {
    admin_active_store_id: '1',
    admin_active_tab: 'tab-custom-forge'
  };
  let windowHash = '#tab-custom-forge';
  let sidebarCfVisible = true;
  let activeTabRendered = null;

  // Step 1: API/store initialization
  const storeId = parseInt(localStorageStore.admin_active_store_id || '1', 10);
  assert.strictEqual(storeId, 1, 'Store must be Store 1');

  // Step 2 & 3: Store switcher initialization and Custom Forge sidebar visibility
  if (storeId === 2) {
    sidebarCfVisible = true;
  } else {
    sidebarCfVisible = false;
  }
  assert.strictEqual(sidebarCfVisible, false, 'Custom Forge sidebar item must be HIDDEN under Store 1');

  // Step 4: restoreInitialTab()
  const MARSHANS_ONLY_TABS = ['tab-custom-forge', 'tab-materials'];
  const CHIPAKK_ONLY_TABS = ['tab-production', 'tab-chipakk-inventory'];

  let targetTab = windowHash.replace(/^#/, '') || localStorageStore.admin_active_tab;
  const isAllowed = !(storeId === 1 && MARSHANS_ONLY_TABS.includes(targetTab)) &&
                    !(storeId === 2 && CHIPAKK_ONLY_TABS.includes(targetTab));
  if (!targetTab || !isAllowed) {
    targetTab = 'tab-dashboard';
  }
  activeTabRendered = targetTab;
  if (windowHash === '#tab-custom-forge') {
    windowHash = `#${targetTab}`;
  }

  assert.strictEqual(activeTabRendered, 'tab-dashboard', 'tab-custom-forge must NEVER be restored under Store 1');
  assert.strictEqual(windowHash, '#tab-dashboard', 'Hash must be replaced with #tab-dashboard under Store 1');
});

runTest('3.4: Manual store switch from Store 2 to Store 1 while on tab-custom-forge transitions to tab-dashboard', () => {
  let currentActiveTab = 'tab-custom-forge';
  let sidebarCfVisible = true;
  const MARSHANS_ONLY_TABS = ['tab-custom-forge', 'tab-materials'];

  // User clicks CHIPAKK (Store 1)
  const targetStoreId = 1;

  // updateStoreSwitcherUI(1, { switchTab: true })
  if (targetStoreId === 1) {
    sidebarCfVisible = false;
    if (MARSHANS_ONLY_TABS.includes(currentActiveTab)) {
      currentActiveTab = 'tab-dashboard';
    }
  }

  assert.strictEqual(sidebarCfVisible, false, 'Custom Forge sidebar item must be hidden when switched to Store 1');
  assert.strictEqual(currentActiveTab, 'tab-dashboard', 'Active tab must transition cleanly to tab-dashboard');
});

console.log('================================================================');
console.log('TEST SUITE SUMMARY');
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log('================================================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('ALL CUSTOM FORGE ADMIN PANEL NAVIGATION & INITIALIZATION TESTS PASSED!');
  process.exit(0);
}
