/**
 * Batch 2C Performance & Smoke Test Suite
 * Tests in-flight deduplication, session cache reuse, image attributes,
 * video preload="none", preconnect tags, and store-isolation safety.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${desc}`);
    failed++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('⚡ BATCH 2C PERFORMANCE & CRITICAL SMOKE TEST SUITE');
  console.log('===============================================================\n');

  const appJs = fs.readFileSync(path.join(__dirname, '../customer-workspace/js/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../customer-workspace/index.html'), 'utf8');
  const shopHtml = fs.readFileSync(path.join(__dirname, '../customer-workspace/shop.html'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../customer-workspace/css/style.css'), 'utf8');

  // 1. In-flight request deduplication
  assert(appJs.includes('const inflightRequests = new Map();'), 'app.js declares in-flight requests Map');
  assert(appJs.includes('inflightRequests.has(cacheKey)'), 'fetchApi checks inflightRequests before dispatching network calls');
  assert(appJs.includes('inflightRequests.set(cacheKey, requestPromise)'), 'fetchApi registers in-flight promise');
  assert(appJs.includes('inflightRequests.delete(cacheKey)'), 'fetchApi deletes in-flight promise in finally block');

  // 2. Store isolation in cache keys
  assert(appJs.includes('const cacheKey = `${options.method || "GET"}:store${storeId}:${url}`;'), 'cacheKey is store-aware (store1 vs store2 isolated)');
  assert(appJs.includes('isPrivateEndpoint'), 'fetchApi excludes private endpoints (orders, payments, cart, auth) from caching');

  // 3. getProducts catalog session caching
  assert(appJs.includes('isPlainCatalogQuery'), 'getProducts checks for plain un-filtered catalog query');
  assert(appJs.includes('Array.isArray(CHIPAKK_DATA.products) && CHIPAKK_DATA.products.length > 0'), 'getProducts reuses in-memory products on repeated calls');

  // 4. Branded video loading experience restored with lean metadata preload
  assert(indexHtml.includes('src="assets/video/loading_01.mp4"') && indexHtml.includes('preload="metadata"') && indexHtml.includes('autoplay'), 'index.html video has autoplay and preload="metadata"');
  assert(shopHtml.includes('src="assets/video/loading_01.mp4"') && shopHtml.includes('preload="metadata"') && shopHtml.includes('autoplay'), 'shop.html video has autoplay and preload="metadata"');
  assert(indexHtml.includes('class="loader-badge"'), 'index.html has lightweight CSS/SVG loader badge');
  assert(styleCss.includes('.loader-badge {'), 'style.css contains lightweight loader-badge animated styles');

  // 5. Loading overlay artificial delay removal (no blocking 750ms timer)
  assert(!appJs.includes('minTimer = setTimeout(hideOverlay, 750)'), 'initLoadingOverlay has zero artificial 750ms blocking delay');

  // 6. Preconnect to API origin
  assert(indexHtml.includes('<link rel="preconnect" href="https://api.chipakk.shop" crossorigin />'), 'index.html preconnects to api.chipakk.shop');
  assert(shopHtml.includes('<link rel="preconnect" href="https://api.chipakk.shop" crossorigin />'), 'shop.html preconnects to api.chipakk.shop');

  // 7. Product card image CLS prevention & async decoding
  const { createMedia } = require('../customer-workspace/js/media.js');
  const { createCatalog } = require('../customer-workspace/js/catalog.js');
  const cat = createCatalog({ media: createMedia({ apiBase: 'https://api.chipakk.shop/api' }), formatPrice: (n) => '₹' + n, storeId: 1 });
  const p = cat.normalizeProduct({ id: 1, name: 'A', price: 15, primary_image_url: '/uploads/a.webp' });
  const below = cat.productCardHtml(p, { priority: false });
  const above = cat.productCardHtml(p, { priority: true });
  assert(below.includes('width="300" height="300"'), 'rendered product card includes explicit width/height dimensions');
  assert(below.includes('decoding="async"'), 'rendered product card specifies async image decoding');
  assert(below.includes('loading="lazy"'), 'below-fold catalog cards load lazily');
  assert(above.includes('loading="eager"') && above.includes('fetchpriority="high"'), 'above-the-fold card image is prioritised');

  // 8. Functional deduplication test in Node VM
  let networkCalls = 0;
  const mockFetch = async (url) => {
    networkCalls++;
    await new Promise(r => setTimeout(r, 20));
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ id: 1, name: 'Sticker A' }] })
    };
  };

  const evalSandbox = new Function('fetch', `
    const API_BASE = "https://api.chipakk.shop/api";
    function getActiveStoreId() { return 1; }
    function extractApiErrorMessage(j) { return ""; }
    const apiCache = new Map();
    const inflightRequests = new Map();

    ${appJs.slice(appJs.indexOf('async function fetchApi('), appJs.indexOf('async function fetchAuthenticated('))}

    return { fetchApi };
  `);

  const { fetchApi } = evalSandbox(mockFetch);

  // Trigger 3 concurrent calls to same endpoint
  const [res1, res2, res3] = await Promise.all([
    fetchApi('/categories'),
    fetchApi('/categories'),
    fetchApi('/categories')
  ]);

  assert(networkCalls === 1, `Concurrent in-flight calls deduplicated to 1 network request (actual calls: ${networkCalls})`);
  assert(Array.isArray(res1) && res1[0].name === 'Sticker A', 'Deduplicated responses returned valid payload');

  // Subsequent call hits apiCache
  const res4 = await fetchApi('/categories');
  assert(networkCalls === 1, 'Subsequent call served from apiCache with 0 additional network requests');

  console.log('\n===============================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
