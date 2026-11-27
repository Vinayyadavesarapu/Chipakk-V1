const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Admin Panel Products & Categories Restoration & Race-Condition Suite', async (t) => {
  const adminJsContent = fs.readFileSync(path.join(__dirname, '../web/js/admin.js'), 'utf8');
  const adminHtmlContent = fs.readFileSync(path.join(__dirname, '../web/admin.html'), 'utf8');

  await t.test('1. Static Verifications: populateCategoryDropdowns, request IDs, and cache buster', () => {
    // 1.1 Cache buster updated to 3.5.5 in admin.html
    assert.match(
      adminHtmlContent,
      /<script\s+type="module"\s+src="js\/admin\.js\?v=3\.5\.[4-9]"><\/script>/,
      'admin.html must reference admin.js with fresh cache buster (v>=3.5.4)'
    );

    // 1.2 Function populateCategoryDropdowns is declared
    assert.match(
      adminJsContent,
      /function\s+populateCategoryDropdowns\s*\(\)\s*\{/,
      'populateCategoryDropdowns must be declared as a function in admin.js'
    );

    // 1.3 Monotonic request ID counters declared for product and category refreshes
    assert.match(
      adminJsContent,
      /let\s+currentProductFetchRequestId\s*=\s*0;/,
      'currentProductFetchRequestId counter must be declared'
    );
    assert.match(
      adminJsContent,
      /let\s+currentCategoryFetchRequestId\s*=\s*0;/,
      'currentCategoryFetchRequestId counter must be declared'
    );

    // 1.4 fetchAllAdminProducts accepts expectedStoreId and verifies active store
    assert.match(
      adminJsContent,
      /async\s+function\s+fetchAllAdminProducts\s*\(\s*expectedStoreId\s*=\s*null\s*\)/,
      'fetchAllAdminProducts must accept expectedStoreId parameter'
    );
    assert.match(
      adminJsContent,
      /if\s*\(currentStore\s*!==\s*storeId\)\s*\{\s*return\s+\[\];/,
      'fetchAllAdminProducts must abort if store changes during pagination'
    );

    // 1.5 switchAdminTab hooks tab-products and tab-categories
    assert.match(
      adminJsContent,
      /else\s+if\s*\(finalTabId\s*===\s*'tab-products'\)\s*\{\s*refreshProductsFromAPI\(\)/,
      'switchAdminTab must hook tab-products to refreshProductsFromAPI'
    );
    assert.match(
      adminJsContent,
      /else\s+if\s*\(finalTabId\s*===\s*'tab-categories'\)\s*\{\s*refreshCategoriesFromAPI\(\)/,
      'switchAdminTab must hook tab-categories to refreshCategoriesFromAPI'
    );
  });

  await t.test('2. DOM Simulation: populateCategoryDropdowns behavior', () => {
    function createMockElement(id, tagName = 'select') {
      const el = {
        id,
        tagName,
        innerHTML: '',
        value: '',
        options: [],
        listeners: {},
        addEventListener(evt, fn) {
          (this.listeners[evt] = this.listeners[evt] || []).push(fn);
        }
      };

      Object.defineProperty(el, 'innerHTML', {
        set(val) {
          this._innerHTML = val;
          const optRegex = /<option\s+value="([^"]*)"(?:[^>]*)>([^<]*)<\/option>/g;
          const opts = [];
          let m;
          while ((m = optRegex.exec(val)) !== null) {
            opts.push({ value: m[1], text: m[2] });
          }
          this.options = opts;
          if (this.value && !opts.some(o => o.value === this.value)) {
            this.value = opts.length > 0 ? opts[0].value : '';
          }
        },
        get() {
          return this._innerHTML || '';
        }
      });

      return el;
    }

    const mockElements = {
      'prod-category': createMockElement('prod-category'),
      'prod-filter-category': createMockElement('prod-filter-category'),
      'evt-filter-cat': createMockElement('evt-filter-cat')
    };

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    let categories = [
      { id: 1, name: 'Anime & Manga <Special>', slug: 'anime-manga' },
      { id: 2, name: 'Best Seller', slug: 'best-seller' }, // must be filtered out
      { id: 3, name: 'Gaming', slug: 'gaming' }
    ];

    function runPopulateCategoryDropdowns(customCategories) {
      const catsToUse = customCategories !== undefined ? customCategories : categories;
      const prodCatSelect = mockElements['prod-category'];
      const filterCatSelect = mockElements['prod-filter-category'];
      const evtCatSelect = mockElements['evt-filter-cat'];

      const currentProdVal = prodCatSelect?.value;
      const currentFilterVal = filterCatSelect?.value;
      const currentEvtVal = evtCatSelect?.value;

      const visibleCategories = Array.isArray(catsToUse)
        ? catsToUse.filter(c => c && (c.name || '').toLowerCase().trim() !== 'best seller' && (c.slug || '').toLowerCase().trim() !== 'best-seller')
        : [];

      const catOptions = visibleCategories.map(c => {
        const catName = c.name || '';
        const catId = c.id !== undefined && c.id !== null ? String(c.id) : '';
        const catSlug = c.slug || '';
        return `<option value="${escapeHtml(catName)}" data-id="${escapeHtml(catId)}" data-slug="${escapeHtml(catSlug)}">${escapeHtml(catName)}</option>`;
      }).join('');

      if (prodCatSelect) {
        prodCatSelect.innerHTML = catOptions ? `<option value="">Select Category</option>${catOptions}` : '<option value="">No categories available</option>';
        if (currentProdVal && Array.from(prodCatSelect.options).some(o => o.value === currentProdVal)) {
          prodCatSelect.value = currentProdVal;
        }
      }
      if (filterCatSelect) {
        filterCatSelect.innerHTML = `<option value="">All Categories</option>${catOptions}`;
        if (currentFilterVal !== undefined && Array.from(filterCatSelect.options).some(o => o.value === currentFilterVal)) {
          filterCatSelect.value = currentFilterVal;
        }
      }
      if (evtCatSelect) {
        evtCatSelect.innerHTML = `<option value="">All Categories</option>${catOptions}`;
        if (currentEvtVal !== undefined && Array.from(evtCatSelect.options).some(o => o.value === currentEvtVal)) {
          evtCatSelect.value = currentEvtVal;
        }
      }
    }

    // Test 2.1: Basic population filters out 'Best Seller' and escapes HTML
    runPopulateCategoryDropdowns();
    const filterCat = mockElements['prod-filter-category'];
    assert.equal(filterCat.options.length, 3, 'Filter should have "All Categories" + 2 categories');
    assert.equal(filterCat.options[0].value, '');
    assert.equal(filterCat.options[0].text, 'All Categories');
    assert.equal(filterCat.options[1].value, 'Anime &amp; Manga &lt;Special&gt;');
    assert.equal(filterCat.options[2].value, 'Gaming');
    assert.ok(!filterCat.options.some(o => o.text.toLowerCase().includes('best seller')), 'Best Seller must be excluded');

    // Test 2.2: Preserving selected filter value
    filterCat.value = 'Gaming';
    runPopulateCategoryDropdowns();
    assert.equal(filterCat.value, 'Gaming', 'Selected category filter must be preserved across repopulation');

    // Test 2.3: Safe empty array handling
    runPopulateCategoryDropdowns([]);
    const prodCat = mockElements['prod-category'];
    assert.equal(prodCat.options.length, 1);
    assert.equal(prodCat.options[0].text, 'No categories available');

    // Test 2.4: Safe null handling
    assert.doesNotThrow(() => {
      runPopulateCategoryDropdowns(null);
    }, 'Null categories array must not throw');
  });

  await t.test('3. Race-Condition Behavioral Simulation: Bidirectional & Rapid Switching', async () => {
    let activeStoreId = 1;
    let products = [];
    let currentProductFetchRequestId = 0;
    const discardedResponses = [];
    const appliedResponses = [];

    async function simulatedRefreshProductsFromAPI(simulatedDelayMs, storeIdAtRequest, mockData) {
      const fetchStoreId = activeStoreId;
      const requestId = ++currentProductFetchRequestId;
      try {
        await new Promise(r => setTimeout(r, simulatedDelayMs));
        const currentStoreId = activeStoreId;
        if (requestId !== currentProductFetchRequestId || currentStoreId !== fetchStoreId) {
          discardedResponses.push({ requestId, fetchStoreId, currentStoreId, currentLatestReq: currentProductFetchRequestId });
          return;
        }
        products = mockData;
        appliedResponses.push({ requestId, fetchStoreId, products });
      } catch (err) {}
    }

    // Direction 1: Store 1 starts (slow: 50ms) -> switch to Store 2 (fast: 15ms) -> Store 2 finishes -> Store 1 finishes late
    activeStoreId = 1;
    products = ['Initial S1'];
    const p1_s1 = simulatedRefreshProductsFromAPI(50, 1, ['Store 1 Data']);
    await new Promise(r => setTimeout(r, 10)); // user switches to Store 2 while S1 is in flight
    activeStoreId = 2;
    products = []; // switchActiveStore clears in-memory state
    const p1_s2 = simulatedRefreshProductsFromAPI(15, 2, ['Store 2 Data']);

    await Promise.all([p1_s1, p1_s2]);

    assert.equal(activeStoreId, 2, 'Active store must be 2');
    assert.deepEqual(products, ['Store 2 Data'], 'Store 2 data must be preserved; late Store 1 response must not overwrite Store 2');
    assert.ok(discardedResponses.some(d => d.fetchStoreId === 1), 'Store 1 response must have been discarded');

    // Direction 2: Store 2 starts (slow: 50ms) -> switch to Store 1 (fast: 15ms) -> Store 1 finishes -> Store 2 finishes late
    activeStoreId = 2;
    products = ['Initial S2'];
    const p2_s2 = simulatedRefreshProductsFromAPI(50, 2, ['Store 2 Late Data']);
    await new Promise(r => setTimeout(r, 10)); // user switches to Store 1 while S2 is in flight
    activeStoreId = 1;
    products = [];
    const p2_s1 = simulatedRefreshProductsFromAPI(15, 1, ['Store 1 Fresh Data']);

    await Promise.all([p2_s2, p2_s1]);

    assert.equal(activeStoreId, 1, 'Active store must be 1');
    assert.deepEqual(products, ['Store 1 Fresh Data'], 'Store 1 data must be preserved; late Store 2 response must not overwrite Store 1');
    assert.ok(discardedResponses.some(d => d.fetchStoreId === 2), 'Store 2 response must have been discarded');

    // Test 3.3: Rapid Repeated Switching (Store 1 -> 2 -> 1 -> 2 in quick succession)
    activeStoreId = 1;
    products = [];
    const promises = [];
    for (let i = 0; i < 4; i++) {
      const targetStore = (i % 2 === 0) ? 2 : 1;
      activeStoreId = targetStore;
      const delay = (4 - i) * 10; // Earlier requests are slower
      promises.push(simulatedRefreshProductsFromAPI(delay, targetStore, [`Data from request ${i + 1} (Store ${targetStore})`]));
      await new Promise(r => setTimeout(r, 5));
    }
    await Promise.all(promises);

    const finalApplied = appliedResponses[appliedResponses.length - 1];
    assert.equal(activeStoreId, 1, 'Final active store must be 1');
    assert.deepEqual(products, ['Data from request 4 (Store 1)'], 'Only the final request for the active store must prevail');

    // Test 3.4: Rapid repeated tab clicks within the same store
    activeStoreId = 1;
    const tabClicks = [];
    for (let c = 0; c < 5; c++) {
      const delay = (5 - c) * 10; // Earliest click takes 50ms, latest takes 10ms
      tabClicks.push(simulatedRefreshProductsFromAPI(delay, 1, [`Click ${c + 1} Data`]));
      await new Promise(r => setTimeout(r, 2));
    }
    await Promise.all(tabClicks);

    assert.deepEqual(products, ['Click 5 Data'], 'Latest click response must prevail; older responses discarded');
  });
});
