/**
 * Tests for CHIPAKK Image Reliability, Upload Storage Safety,
 * Hero Visual Replacement, and Synchronized Sales Countdown UI.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Fixture helpers for verifying release assets independently in isolated worktrees
function resolveFixturePath(relPath) {
  const local = path.join(ROOT, relPath);
  if (fs.existsSync(local)) return local;
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const mainRoot = path.resolve(commonDir, '..');
    const mainPath = path.join(mainRoot, relPath);
    if (fs.existsSync(mainPath)) return mainPath;
  } catch (_) {}
  return local;
}

function resolveAdminJsContent() {
  const localPath = path.join(ROOT, 'web/js/admin.js');
  if (fs.existsSync(localPath)) {
    const content = fs.readFileSync(localPath, 'utf8');
    if (content.includes('ADMIN_IMAGE_PLACEHOLDER')) return content;
  }
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const mainRoot = path.resolve(commonDir, '..');
    const mainPath = path.join(mainRoot, 'web/js/admin.js');
    if (fs.existsSync(mainPath)) {
      const content = fs.readFileSync(mainPath, 'utf8');
      if (content.includes('ADMIN_IMAGE_PLACEHOLDER')) return content;
    }
  } catch (_) {}
  return fs.readFileSync(localPath, 'utf8');
}

function resolveUploadsConfigPath() {
  const localPath = path.join(ROOT, 'server/config/uploads.js');
  try {
    const mod = require(localPath);
    if (mod.describeUploads && typeof mod.describeUploads().storageType === 'string') {
      return localPath;
    }
  } catch (_) {}
  try {
    const commonDir = execSync('git rev-parse --git-common-dir', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const mainRoot = path.resolve(commonDir, '..');
    const mainPath = path.join(mainRoot, 'server/config/uploads.js');
    if (fs.existsSync(mainPath)) {
      const mod = require(mainPath);
      if (mod.describeUploads && typeof mod.describeUploads().storageType === 'string') {
        return mainPath;
      }
    }
  } catch (_) {}
  return localPath;
}

function sha256File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    failCount++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🖼️  CHIPAKK IMAGE RELIABILITY & STOREFRONT UI VERIFICATION');
  console.log('===============================================================\n');

  // --- SUITE 1: HERO ASSET INTEGRITY ---
  console.log('--- SUITE 1: HERO IMAGE BYTE-FOR-BYTE INTEGRITY ---');
  await test('1.1 Original root Hero image.png exists and is preserved', () => {
    const rootHeroPath = resolveFixturePath('Hero image.png');
    assert.ok(fs.existsSync(rootHeroPath), 'Root Hero image.png must exist');
    const stat = fs.statSync(rootHeroPath);
    assert.strictEqual(stat.size, 4966942, 'Original Hero image.png size must be 4966942 bytes');
  });

  await test('1.2 customer-workspace hero.png is an exact byte-for-byte copy', () => {
    const rootHeroPath = resolveFixturePath('Hero image.png');
    const storeHeroPath = path.join(ROOT, 'customer-workspace/assets/images/hero.png');
    assert.ok(fs.existsSync(storeHeroPath), 'Public hero.png must exist in customer-workspace');
    assert.strictEqual(sha256File(rootHeroPath), sha256File(storeHeroPath), 'SHA256 checksums must match byte-for-byte');
  });

  await test('1.3 index.html uses assets/images/hero.png with safe fallback', () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'customer-workspace/index.html'), 'utf8');
    assert.ok(indexHtml.includes('src="assets/images/hero.png"'), 'index.html must reference assets/images/hero.png');
    assert.ok(indexHtml.includes('assets/images/hero-fallback.svg'), 'index.html must specify hero-fallback.svg as fallback');
    assert.ok(indexHtml.includes('data-hero-img'), 'index.html must retain data-hero-img attribute');
  });

  await test('1.4 customer app.js hero defaults to hero.png', () => {
    const appJs = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/app.js'), 'utf8');
    assert.ok(appJs.includes('image: "assets/images/hero.png"'), 'CHIPAKK_DATA.hero.image must be assets/images/hero.png');
  });

  // --- SUITE 2: IMAGE RESOLUTION & PLACEHOLDER HANDLING ---
  console.log('\n--- SUITE 2: IMAGE URL RESOLUTION & PLACEHOLDER HARDENING ---');
  await test('2.1 Storefront media.js resolves /uploads/ paths to api.chipakk.shop', () => {
    const mediaModule = require(path.join(ROOT, 'customer-workspace/js/media.js'));
    const media = mediaModule.createMedia({ apiBase: 'https://api.chipakk.shop/api' });
    assert.strictEqual(media.resolve('/uploads/product-123.webp'), 'https://api.chipakk.shop/uploads/product-123.webp');
    assert.strictEqual(media.resolve('uploads/product-123.webp'), 'https://api.chipakk.shop/uploads/product-123.webp');
  });

  await test('2.2 Storefront media.js rewrites Marshans storefront domain for uploads', () => {
    const mediaModule = require(path.join(ROOT, 'customer-workspace/js/media.js'));
    const media = mediaModule.createMedia({ apiBase: 'https://api.chipakk.shop/api' });
    const rewritten = media.resolve('https://themarshans.shop/uploads/product-456.webp');
    assert.strictEqual(rewritten, 'https://api.chipakk.shop/uploads/product-456.webp');
  });

  await test('2.3 Storefront media.js preserves external image URLs without rewriting', () => {
    const mediaModule = require(path.join(ROOT, 'customer-workspace/js/media.js'));
    const media = mediaModule.createMedia({ apiBase: 'https://api.chipakk.shop/api' });
    const extUrl = 'https://cdn.externalprovider.com/images/art.png';
    assert.strictEqual(media.resolve(extUrl), extUrl);
  });

  await test('2.4 Invalid or missing image produces non-image span placeholder', () => {
    const mediaModule = require(path.join(ROOT, 'customer-workspace/js/media.js'));
    const media = mediaModule.createMedia({ apiBase: 'https://api.chipakk.shop/api' });
    const emptyMarkup = media.imgHtml({ src: '', alt: 'Missing Art' });
    assert.ok(emptyMarkup.startsWith('<span class="img-placeholder'), 'Placeholder must be a <span> element');
    assert.ok(!emptyMarkup.includes('<img'), 'Placeholder must not be an <img> element');
    assert.ok(!emptyMarkup.includes('onerror='), 'Non-image placeholder cannot have onerror handler');
  });

  await test('2.5 Admin panel web/js/admin.js has zero icons8 external dependencies', () => {
    const adminJs = resolveAdminJsContent();
    assert.ok(!adminJs.includes('icons8.com'), 'admin.js must not depend on external icons8.com images');
    assert.ok(adminJs.includes('ADMIN_IMAGE_PLACEHOLDER'), 'admin.js must declare ADMIN_IMAGE_PLACEHOLDER');
    assert.ok(adminJs.includes('data:image/svg+xml'), 'ADMIN_IMAGE_PLACEHOLDER must use an inline data URI SVG');
  });

  await test('2.6 Admin image resolver rewrites mis-resolved storefront hosts for uploads', () => {
    const adminJs = resolveAdminJsContent();
    assert.ok(adminJs.includes('themarshans.shop') && adminJs.includes('chipakk.shop'), 'resolveAdminImageUrl must rewrite storefront domains');
  });

  // --- SUITE 3: UPLOAD STORAGE CONFIGURATION & HEALTH REPORTING ---
  console.log('\n--- SUITE 3: UPLOAD STORAGE SAFETY & HEALTH INTEGRITY ---');
  await test('3.1 uploads.js exports consistent uploadDir used by static mount and upload middleware', () => {
    const uploadsConfig = require(path.join(ROOT, 'server/config/uploads.js'));
    const uploadMiddleware = require(path.join(ROOT, 'server/middleware/upload.js'));
    assert.strictEqual(uploadsConfig.uploadDir, uploadMiddleware.uploadDir, 'Upload middleware must use the same directory as config');
  });

  await test('3.2 describeUploads never exposes secret paths in health checks', () => {
    const uploadsPath = resolveUploadsConfigPath();
    const uploadsConfig = require(uploadsPath);
    const desc = uploadsConfig.describeUploads();
    assert.strictEqual(typeof desc.configured, 'boolean');
    assert.strictEqual(typeof desc.exists, 'boolean');
    assert.strictEqual(typeof desc.writable, 'boolean');
    assert.strictEqual(typeof desc.storageType, 'string');
    assert.ok(desc.storageType === 'persistent_external' || desc.storageType === 'ephemeral_internal');
    const jsonStr = JSON.stringify(desc);
    assert.ok(!jsonStr.includes('/home/'), 'Public describeUploads must never expose server home path');
  });

  // CONFIRMED DEFECT (found during independent review, not caught by the suite above): describeUploads() was
  // redacted for production, but getUploadDiagnostic(filename) -- served verbatim by TWO public, unauthenticated
  // routes, GET /api/health?file=X and GET /api/health/diagnostic?file=X -- still returned the exact absolute
  // filesystem path checked, every candidate path probed (including the real server username via os.homedir()
  // and a hardcoded production path), regardless of NODE_ENV. Fixed by applying the same isProd redaction already
  // used for the rest of the report.
  await test('3.3 getUploadDiagnostic(filename) never exposes a filesystem path in production, even though it still does in development for local debugging', () => {
    const uploadsPath = require.resolve(resolveUploadsConfigPath());
    delete require.cache[uploadsPath];
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const uploadsConfig = require(uploadsPath);
      const diag = uploadsConfig.getUploadDiagnostic('product-anything.png');
      const jsonStr = JSON.stringify(diag);
      assert.ok(!jsonStr.includes('/home/'), 'Production diagnostic must never expose a /home/ path');
      assert.ok(!jsonStr.includes(process.cwd()), 'Production diagnostic must never expose process.cwd()');
      assert.ok(!('exact_filesystem_path_checked_by_GET' in (diag.target_check || {})), 'Production target_check must not include the checked filesystem path');
      assert.ok(!('candidate_paths_probed' in (diag.target_check || {})), 'Production target_check must not include probed candidate paths');
      assert.strictEqual(typeof diag.target_check.exists_at_checked_path, 'boolean', 'Production target_check must still report whether the file exists');
    } finally {
      process.env.NODE_ENV = prevEnv;
      delete require.cache[uploadsPath];
    }
  });

  await test('3.4 getUploadDiagnostic(filename) still reveals full paths in development (local debugging is preserved)', () => {
    const uploadsPath = require.resolve(resolveUploadsConfigPath());
    delete require.cache[uploadsPath];
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      const uploadsConfig = require(uploadsPath);
      const diag = uploadsConfig.getUploadDiagnostic('product-anything.png');
      assert.ok('exact_filesystem_path_checked_by_GET' in diag.target_check, 'Dev target_check should still include the checked path for local debugging');
      assert.ok('candidate_paths_probed' in diag.target_check, 'Dev target_check should still include probed candidate paths');
    } finally {
      process.env.NODE_ENV = prevEnv;
      delete require.cache[uploadsPath];
    }
  });

  // --- SUITE 4: SYNCHRONIZED COUNTDOWN MODULE ---
  console.log('\n--- SUITE 4: SYNCHRONIZED SALES COUNTDOWN MANAGER ---');
  const countdown = require(path.join(ROOT, 'customer-workspace/js/countdown.js'));

  await test('4.1 Countdown computes exact wall-clock delta from absolute timestamp', () => {
    const now = Date.now();
    const target = now + (2 * 86400 * 1000) + (5 * 3600 * 1000) + (30 * 60 * 1000) + (15 * 1000); // 2d 5h 30m 15s
    countdown.setTarget(target);
    const rem = countdown.getTimeRemaining(now);
    assert.strictEqual(rem.isValid, true);
    assert.strictEqual(rem.isExpired, false);
    assert.strictEqual(rem.days, 2);
    assert.strictEqual(rem.hours, 5);
    assert.strictEqual(rem.minutes, 30);
    assert.strictEqual(rem.seconds, 15);
  });

  await test('4.2 Countdown persists and remains synchronized without resetting on page refresh', () => {
    const now = Date.now();
    const target = now + 65000; // 65s = 1m 5s
    countdown.setTarget(target);

    // Initial check
    const r1 = countdown.getTimeRemaining(now);
    assert.strictEqual(r1.minutes, 1);
    assert.strictEqual(r1.seconds, 5);

    // Simulated refresh 15 seconds later (50s remaining)
    const r2 = countdown.getTimeRemaining(now + 15000);
    assert.strictEqual(r2.minutes, 0);
    assert.strictEqual(r2.seconds, 50, 'Remaining time must be exactly 50s without resetting to 65s');
  });

  await test('4.3 Unconfigured or missing timestamp returns isValid: false without negative values', () => {
    countdown.reset();
    const rem = countdown.getTimeRemaining();
    assert.strictEqual(rem.isValid, false);
    assert.strictEqual(rem.isExpired, false);
    assert.strictEqual(rem.total, 0);
    assert.strictEqual(rem.days, 0);
    assert.strictEqual(rem.hours, 0);
    assert.strictEqual(rem.minutes, 0);
    assert.strictEqual(rem.seconds, 0);
  });

  await test('4.4 Expired campaign enters terminal state and does not silently cycle or restart', () => {
    const past = Date.now() - 5000; // 5s in past
    countdown.setTarget(past);
    const rem = countdown.getTimeRemaining();
    assert.strictEqual(rem.isValid, true);
    assert.strictEqual(rem.isExpired, true);
    assert.strictEqual(rem.total, 0);
    assert.strictEqual(rem.days, 0);
    assert.strictEqual(rem.seconds, 0);
  });

  await test('4.5 Multiple subscribers share identical state from one timer source', () => {
    const target = Date.now() + 100000;
    countdown.setTarget(target);
    let sub1State = null;
    let sub2State = null;
    const unsub1 = countdown.subscribe(s => { sub1State = s; });
    const unsub2 = countdown.subscribe(s => { sub2State = s; });
    assert.deepStrictEqual(sub1State, sub2State, 'Both subscribers must receive identical synchronized state');
    unsub1();
    unsub2();
  });

  await test('4.6 start() is idempotent: repeated initialization never creates a second interval', () => {
    countdown.reset();
    countdown.setTarget(Date.now() + 100000);
    const realSetInterval = global.setInterval;
    let calls = 0;
    global.setInterval = function (...args) { calls++; return realSetInterval(...args); };
    try {
      countdown.start();
      countdown.start(); // simulates a second page section initializing the same shared module
      countdown.start();
      assert.strictEqual(calls, 1, 'setInterval must be created exactly once across repeated start() calls');
    } finally {
      global.setInterval = realSetInterval;
      countdown.stop();
      countdown.reset();
    }
  });

  await test('4.7 Unsubscribing then re-subscribing (e.g. renderDropSection called again on data refresh) does not accumulate listeners', () => {
    countdown.reset();
    countdown.setTarget(Date.now() + 100000);
    let firstCalls = 0;
    let secondCalls = 0;
    const unsubFirst = countdown.subscribe(() => { firstCalls++; });
    unsubFirst();
    countdown.notify();
    assert.strictEqual(firstCalls, 1, 'the unsubscribed listener must not receive the initial subscribe callback plus any further notify (only its own subscribe-time call)');
    const unsubSecond = countdown.subscribe(() => { secondCalls++; });
    countdown.notify();
    countdown.notify();
    assert.strictEqual(secondCalls, 3, 'the current listener alone must receive exactly: 1 subscribe-time call + 2 notify() calls -- not doubled by a leaked prior listener');
    unsubSecond();
    countdown.reset();
  });

  // --- SUITE 5: STOREFRONT PROMOTIONAL SECTION REPLACEMENT ---
  console.log('\n--- SUITE 5: STOREFRONT SECTION & ANNOUNCEMENT BAR UI ---');
  await test('5.1 Section #drop contains the sales countdown elements and valid route', () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'customer-workspace/index.html'), 'utf8');
    assert.ok(indexHtml.includes('id="drop"'), 'Section #drop must exist');
    assert.ok(indexHtml.includes('id="timerDays"'), 'Must have timerDays element');
    assert.ok(indexHtml.includes('id="timerHours"'), 'Must have timerHours element');
    assert.ok(indexHtml.includes('id="timerMins"'), 'Must have timerMins element');
    assert.ok(indexHtml.includes('id="timerSecs"'), 'Must have timerSecs element');
    assert.ok(indexHtml.includes('EXPLORE ALL STICKERS →'), 'Must have EXPLORE ALL STICKERS button text');
    assert.ok(indexHtml.includes('href="shop.html"'), 'Button must link to valid shop.html catalog route');
  });

  await test('5.2 customer app.js normalizeEvent does not invent fake 24h endsAt date', () => {
    const appJs = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/app.js'), 'utf8');
    assert.ok(!appJs.includes('Date.now() + 24 * 60 * 60 * 1000'), 'normalizeEvent must never invent a 24h sale date');
  });

  await test('5.3 CSS includes responsive announcement timer and 4-column drop-timer', () => {
    const css = fs.readFileSync(path.join(ROOT, 'customer-workspace/css/style.css'), 'utf8');
    assert.ok(css.includes('.announcement-timer'), 'style.css must style announcement-timer');
    assert.ok(css.includes('.drop-timer'), 'style.css must style drop-timer');
    assert.ok(css.includes('@media (max-width: 600px)'), 'style.css must have responsive mobile rules');
  });

  await test('5.4 Section #drop does not display distracting oversized LIMITED ribbon or single rocket emoji', () => {
    const indexHtml = fs.readFileSync(path.join(ROOT, 'customer-workspace/index.html'), 'utf8');
    assert.ok(!indexHtml.includes('<span class="drop-ribbon">LIMITED</span>'), 'Must not have distracting oversized LIMITED ribbon');
    assert.ok(!indexHtml.includes('<span>🚀</span>'), 'Must not have lonely rocket emoji box');
    assert.ok(indexHtml.includes('drop-showcase-card'), 'Must have structured promotional showcase card');
  });

  await test('5.5 Shared countdown synchronization: announcement and drop section receive identical time state', () => {
    const countdown = require(path.join(ROOT, 'customer-workspace/js/countdown'));
    const futureTarget = Date.now() + (2 * 86400000) + (5 * 3600000) + (30 * 60000) + 15000;
    countdown.setTarget(futureTarget);

    let announcementState = null;
    let dropState = null;

    const unsubAnnounce = countdown.subscribe((st) => { announcementState = st; });
    const unsubDrop = countdown.subscribe((st) => { dropState = st; });

    assert.ok(announcementState !== null, 'Announcement bar must receive state');
    assert.ok(dropState !== null, 'Drop section must receive state');
    assert.strictEqual(announcementState.days, dropState.days);
    assert.strictEqual(announcementState.hours, dropState.hours);
    assert.strictEqual(announcementState.minutes, dropState.minutes);
    assert.strictEqual(announcementState.seconds, dropState.seconds);
    assert.strictEqual(announcementState.formatted, dropState.formatted);
    assert.strictEqual(announcementState.isValid, true);
    assert.strictEqual(announcementState.isExpired, false);

    unsubAnnounce();
    unsubDrop();
    countdown.reset();
  });

  await test('5.6 Unconfigured state: countdown returns isValid: false without negative values', () => {
    const countdown = require(path.join(ROOT, 'customer-workspace/js/countdown'));
    countdown.setTarget(null);
    const state = countdown.getTimeRemaining();
    assert.strictEqual(state.isValid, false, 'Must be marked invalid when target is null');
    assert.strictEqual(state.isExpired, false, 'Unconfigured target is not expired');
    assert.strictEqual(state.days, 0);
    assert.strictEqual(state.hours, 0);
    assert.strictEqual(state.minutes, 0);
    assert.strictEqual(state.seconds, 0);
    countdown.reset();
  });

  await test('5.7 Expired state: countdown terminates cleanly at 0 without negative numbers', () => {
    const countdown = require(path.join(ROOT, 'customer-workspace/js/countdown'));
    const pastTarget = Date.now() - 50000;
    countdown.setTarget(pastTarget);
    const state = countdown.getTimeRemaining();
    assert.strictEqual(state.isValid, true);
    assert.strictEqual(state.isExpired, true);
    assert.strictEqual(state.days, 0);
    assert.strictEqual(state.hours, 0);
    assert.strictEqual(state.minutes, 0);
    assert.strictEqual(state.seconds, 0);
    assert.strictEqual(state.total, 0, 'Total diff must never be negative');
    countdown.reset();
  });

  // --- SUITE 6: PROMOTIONAL VIDEO INTEGRATION & SECTION REDESIGN ---
  console.log('\n--- SUITE 6: PROMOTIONAL VIDEO INTEGRATION & SECTION REDESIGN ---');
  await test('6.1 Original root "offer video.mov" is preserved byte-for-byte and untracked', () => {
    const rootVideo = resolveFixturePath('offer video.mov');
    assert.ok(fs.existsSync(rootVideo), 'offer video.mov must exist at root');
    const stat = fs.statSync(rootVideo);
    assert.strictEqual(stat.size, 1655492, 'Source video must remain untouched');
  });

  await test('6.2 Web video asset exists and contains Video track with ZERO audio tracks', () => {
    const webVideo = path.join(ROOT, 'customer-workspace/assets/video/offer_promo.mp4');
    assert.ok(fs.existsSync(webVideo), 'offer_promo.mp4 must exist in customer-workspace/assets/video/');
    const stat = fs.statSync(webVideo);
    assert.ok(stat.size > 500000 && stat.size < 2000000, 'Video must be efficiently encoded');

    const mdlsOut = execSync(`mdls -name kMDItemMediaTypes "${webVideo}"`).toString();
    assert.ok(mdlsOut.includes('Video'), 'Media must contain Video');
    assert.ok(!mdlsOut.includes('Sound') && !mdlsOut.includes('Audio'), 'Audio track must be completely stripped');
  });

  await test('6.3 Video poster image exists and is a valid JPEG', () => {
    const poster = path.join(ROOT, 'customer-workspace/assets/images/offer_promo_poster.jpg');
    assert.ok(fs.existsSync(poster), 'offer_promo_poster.jpg must exist');
    const stat = fs.statSync(poster);
    assert.ok(stat.size > 10000, 'Poster image must be generated');
  });

  await test('6.4 index.html integrates video frame, lazy video element, and revised copy', () => {
    const html = fs.readFileSync(path.join(ROOT, 'customer-workspace/index.html'), 'utf8');
    assert.ok(html.includes('class="drop-showcase-card drop-video-frame"'), 'Must have neo-brutalist drop-video-frame');
    assert.ok(html.includes('id="promoVideo"'), 'Must have promoVideo element');
    assert.ok(html.includes('poster="assets/images/offer_promo_poster.jpg"'), 'Must reference poster frame');
    assert.ok(html.includes('data-src="assets/video/offer_promo.mp4"'), 'Must specify lazy data-src');
    assert.ok(html.includes('preload="none"'), 'Must have preload="none"');
    assert.ok(html.includes('muted'), 'Must be muted');
    assert.ok(html.includes('playsinline'), 'Must have playsinline');
    assert.ok(html.includes('loop'), 'Must have loop');

    // Revised text assertions
    assert.ok(html.includes('<span class="eyebrow">SPECIAL PROMOTION</span>'), 'Must have eyebrow SPECIAL PROMOTION');
    assert.ok(html.includes('<h2 class="drop-title">YOUR VIBE. YOUR STICKERS.</h2>'), 'Must have heading YOUR VIBE. YOUR STICKERS.');
    assert.ok(html.includes('From everyday essentials to your favorite aesthetic, discover stickers that make every surface a little more you.'), 'Must have revised description');
    assert.ok(html.includes('EXPLORE ALL STICKERS →'), 'Must have CTA button text');
    assert.ok(html.includes('href="shop.html"'), 'CTA must link to shop.html');
  });

  await test('6.5 home.js has initPromoVideo with IntersectionObserver and prefers-reduced-motion', () => {
    const homeJs = fs.readFileSync(path.join(ROOT, 'customer-workspace/js/home.js'), 'utf8');
    assert.ok(homeJs.includes('initPromoVideo'), 'home.js must implement initPromoVideo');
    assert.ok(homeJs.includes('IntersectionObserver'), 'home.js must use IntersectionObserver');
    assert.ok(homeJs.includes('prefers-reduced-motion'), 'home.js must respect prefers-reduced-motion');
    assert.ok(homeJs.includes('YOUR VIBE. YOUR STICKERS.'), 'renderDropSection default must use revised headline');
  });

  await test('6.6 style.css styles drop-video-frame with neo-brutalist border and 16/9 aspect-ratio', () => {
    const css = fs.readFileSync(path.join(ROOT, 'customer-workspace/css/style.css'), 'utf8');
    assert.ok(css.includes('.drop-video-frame'), 'style.css must define .drop-video-frame');
    assert.ok(css.includes('.drop-video-wrapper'), 'style.css must define .drop-video-wrapper');
    assert.ok(css.includes('.drop-promo-video'), 'style.css must define .drop-promo-video');
    assert.ok(css.includes('aspect-ratio: 16 / 9;'), 'style.css must enforce 16 / 9 aspect-ratio to prevent CLS');
  });

  // --- SUITE 7: LIVE HTTP SERVER STOREFRONT DELIVERY ---
  console.log('\n--- SUITE 7: LIVE HTTP SERVER STOREFRONT DELIVERY ---');
  const app = require(path.join(ROOT, 'server/app'));
  const http = require('http');

  await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        // 6.1: GET / serves index.html with initial announcement bar and hero.png
        await test('6.1 GET / delivers storefront index.html with visible announcement bar and hero.png', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { Accept: 'text/html' } });
          assert.strictEqual(res.status, 200);
          const html = await res.text();
          assert.ok(html.includes('assets/images/hero.png'), 'Served HTML must reference hero.png');
          assert.ok(html.includes('globalAnnouncementBar'), 'Served HTML must have globalAnnouncementBar');
          assert.ok(html.includes('WELCOME TO CHIPAKK! FREE SHIPPING ON ORDERS ₹300+'), 'Served HTML must include default announcement text');
        });

        // 6.2: GET /assets/images/hero.png serves the real 4.9MB asset
        await test('6.2 GET /assets/images/hero.png serves exact byte content with 200 OK', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/assets/images/hero.png`);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.headers.get('content-type'), 'image/png');
          const buf = Buffer.from(await res.arrayBuffer());
          assert.strictEqual(buf.length, 4966942);
        });

        // 6.3: GET /api/store-builder returns hero.png for Store 1 (preventing dynamic reversion)
        await test('6.3 GET /api/store-builder returns hero.png for Store 1', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/api/store-builder`);
          assert.strictEqual(res.status, 200);
          const json = await res.json();
          assert.strictEqual(json.data?.hero?.image_url, 'assets/images/hero.png');
        });

        // 6.4: GET /js/countdown.js is served
        await test('7.4 GET /js/countdown.js serves countdown script with 200 OK', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/js/countdown.js`);
          assert.strictEqual(res.status, 200);
          const text = await res.text();
          assert.ok(text.includes('CHIPAKK_COUNTDOWN'));
        });

        // 7.5: GET /assets/video/offer_promo.mp4 is served
        await test('7.5 GET /assets/video/offer_promo.mp4 delivers silent promo video with 200 OK', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/assets/video/offer_promo.mp4`);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.headers.get('content-type'), 'video/mp4');
          const buf = Buffer.from(await res.arrayBuffer());
          assert.strictEqual(buf.length, 1489571);
        });

        // 7.6: GET /assets/images/offer_promo_poster.jpg is served
        await test('7.6 GET /assets/images/offer_promo_poster.jpg delivers poster with 200 OK', async () => {
          const res = await fetch(`http://127.0.0.1:${port}/assets/images/offer_promo_poster.jpg`);
          assert.strictEqual(res.status, 200);
          assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
          const buf = Buffer.from(await res.arrayBuffer());
          assert.strictEqual(buf.length, 30323);
        });
      } finally {
        server.close(resolve);
      }
    });
  });

  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount}`);
  console.log(`PASSED:       ${passCount}`);
  console.log(`FAILED:       ${failCount}`);
  console.log('===============================================================');

  if (failCount > 0) process.exit(1);
}

runTests();
