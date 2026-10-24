/**
 * Test Suite: CHIPAKK Storefront Legal Policies & Customer Navigation
 * Verifies the implementation, routing, footer integration, and content compliance
 * of Shipping Policy, Refund Policy, Privacy Policy, and Terms & Conditions.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const CW_DIR = path.join(ROOT, 'customer-workspace');

let passedTests = 0;
let totalTests = 0;

function runCheck(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('\n--- 1. Legal Policy Files Existence & Non-Empty Check ---');

const policyFiles = [
  'shipping-policy.html',
  'refund-policy.html',
  'privacy-policy.html',
  'terms.html'
];

policyFiles.forEach(file => {
  runCheck(`${file} exists and is non-empty`, () => {
    const filePath = path.join(CW_DIR, file);
    assert(fs.existsSync(filePath), `File not found: ${filePath}`);
    const stat = fs.statSync(filePath);
    assert(stat.size > 1000, `File size unexpectedly small (${stat.size} bytes)`);
  });
});

console.log('\n--- 2. Metadata, SEO & Open Graph Verification ---');

const expectedMeta = {
  'shipping-policy.html': {
    title: 'Shipping Policy — CHIPAKK',
    canonical: 'https://chipakk.shop/shipping-policy.html'
  },
  'refund-policy.html': {
    title: 'Refund &amp; Cancellation Policy — CHIPAKK',
    canonical: 'https://chipakk.shop/refund-policy.html'
  },
  'privacy-policy.html': {
    title: 'Privacy Policy — CHIPAKK',
    canonical: 'https://chipakk.shop/privacy-policy.html'
  },
  'terms.html': {
    title: 'Terms &amp; Conditions — CHIPAKK',
    canonical: 'https://chipakk.shop/terms.html'
  }
};

policyFiles.forEach(file => {
  const content = fs.readFileSync(path.join(CW_DIR, file), 'utf8');
  const meta = expectedMeta[file];

  runCheck(`${file} contains correct title, canonical link, and Open Graph tags`, () => {
    assert(content.includes(`<title>${meta.title}</title>`), `Missing or incorrect title tag in ${file}`);
    assert(content.includes(`<link rel="canonical" href="${meta.canonical}" />`), `Missing canonical tag in ${file}`);
    assert(content.includes('<meta property="og:site_name" content="CHIPAKK" />'), `Missing og:site_name in ${file}`);
    assert(content.includes('<meta name="twitter:card" content="summary_large_image" />'), `Missing twitter:card in ${file}`);
    assert(content.includes('"@context": "https://schema.org"'), `Missing JSON-LD in ${file}`);
  });
});

console.log('\n--- 3. Verified Contact Information & No Unresolved Placeholders ---');

policyFiles.forEach(file => {
  const content = fs.readFileSync(path.join(CW_DIR, file), 'utf8');

  runCheck(`${file} uses verified support email and contains no placeholder contacts`, () => {
    assert(content.includes('support@chipakk.shop'), `Missing support@chipakk.shop in ${file}`);
    assert(!content.includes('[Email'), `Unresolved [Email placeholder found in ${file}`);
    assert(!content.includes('[WhatsApp'), `Unresolved [WhatsApp placeholder found in ${file}`);
    assert(!content.includes('98765 00000'), `Dummy placeholder phone number found in ${file}`);
    assert(!content.includes('TODO: ADD') || content.includes('TODO: ADD INSTAGRAM') || content.includes('TODO: ADD YOUTUBE') || content.includes('TODO: ADD FAQ'), `Unexpected TODO placeholders found in ${file}`);
  });
});

console.log('\n--- 4. Policy Content & Legal Accuracy ---');

runCheck('shipping-policy.html contains processing times, transit estimates, RTO rules, and dynamic checkout shipping calculation', () => {
  const content = fs.readFileSync(path.join(CW_DIR, 'shipping-policy.html'), 'utf8');
  assert(content.includes('1–3 business days') || content.includes('1 to 3 business days'), 'Missing standard processing timeframe');
  assert(content.includes('3–7 business days') || content.includes('3 to 7 business days'), 'Missing delivery transit timeframe');
  assert(content.includes('Shipping charges are calculated at checkout based on the delivery location and order details'), 'Missing dynamic checkout shipping charges statement');
  assert(content.includes('3 attempts'), 'Missing 3 delivery attempts RTO rule');
  assert(content.includes('Return-to-Origin') || content.includes('RTO'), 'Missing RTO section');
  assert(content.includes('48 hours of delivery'), 'Missing 48-hour damage reporting window');
  assert(!content.includes('FREE SHIPPING ON ORDERS ₹300+'), 'Must not hardcode unverified free-shipping threshold in policy text');
  assert(!content.includes('flat standard shipping fee of ₹50'), 'Must not hardcode unverified flat shipping fee in policy text');
});

runCheck('refund-policy.html contains 48-hr reporting, evidence requirements, 5-7 day timeline, and accurate payment methods without unverified cancellation window or wallet claims', () => {
  const content = fs.readFileSync(path.join(CW_DIR, 'refund-policy.html'), 'utf8');
  assert(content.includes('48 hours of delivery'), 'Missing 48-hour claim requirement');
  assert(content.includes('photos/videos') || content.includes('photos or an uncut unboxing video'), 'Missing photo/video evidence requirement');
  assert(content.includes('5–7 business days') || content.includes('5 to 7 business days'), 'Missing 5-7 business days refund timeline');
  assert(content.includes('original payment method'), 'Missing original payment method clause');
  assert(content.includes('Cash on Delivery (COD)'), 'Missing COD refund clarification');
  assert(!content.includes('2 to 4 hours'), 'Must not invent unverified 2-4 hour cancellation window');
  assert(!content.includes('CHIPAKK! Wallet (store credit)'), 'Must not claim non-existent automated wallet balance system');
});

runCheck('privacy-policy.html contains data categories, third-party payment gateway, and no-sale policy without unsupported statutory or security claims', () => {
  const content = fs.readFileSync(path.join(CW_DIR, 'privacy-policy.html'), 'utf8');
  assert(content.includes('name, phone number, email address, shipping address'), 'Missing data categories reference');
  assert(content.includes('third-party payment gateway'), 'Missing payment gateway reference');
  assert(content.includes('do not sell, rent, or share') || content.includes('not sell, rent, or share'), 'Missing no-sale data commitment');
  assert(!content.includes('PCI-DSS'), 'Must not include unverified PCI-DSS compliance claims');
  assert(!content.includes('Digital Personal Data Protection Act'), 'Must not assert unsupported DPDPA statutory claims');
  assert(!content.includes('Information Technology Act, 2000'), 'Must not assert unsupported IT Act statutory claims');
});

runCheck('terms.html contains custom sticker production rules and screen-print differences without invented jurisdiction or liability clauses', () => {
  const content = fs.readFileSync(path.join(CW_DIR, 'terms.html'), 'utf8');
  assert(content.includes('Custom orders cannot be changed or cancelled once production begins'), 'Missing custom order non-cancellation rule');
  assert(content.includes('screen and printing differences'), 'Missing screen vs print color tolerance explanation');
  assert(!content.includes('laws of India'), 'Must not invent unverified governing law clause');
  assert(!content.includes('Limitation of Liability'), 'Must not invent unverified limitation of liability clause');
  assert(!content.includes('±1mm') && !content.includes('&plusmn;1mm'), 'Must not invent unverified manufacturing tolerances');
});

console.log('\n--- 5. Customer Storefront Footer Navigation ---');

const storefrontPages = [
  'index.html',
  'shop.html',
  'product.html',
  'categories.html',
  'custom-stickers.html',
  'account.html'
];

storefrontPages.forEach(page => {
  const content = fs.readFileSync(path.join(CW_DIR, page), 'utf8');

  runCheck(`${page} footer links directly to all 4 legal policies with no placeholder toasts`, () => {
    assert(content.includes('href="shipping-policy.html"'), `Missing shipping-policy.html link in ${page}`);
    assert(content.includes('href="refund-policy.html"'), `Missing refund-policy.html link in ${page}`);
    assert(content.includes('href="privacy-policy.html"'), `Missing privacy-policy.html link in ${page}`);
    assert(content.includes('href="terms.html"'), `Missing terms.html link in ${page}`);

    assert(!content.includes('data-placeholder="TODO: ADD SHIPPING POLICY URL"'), `Placeholder remains in ${page}`);
    assert(!content.includes('data-placeholder="TODO: ADD REFUND POLICY URL"'), `Placeholder remains in ${page}`);
    assert(!content.includes('data-placeholder="TODO: ADD PRIVACY POLICY URL"'), `Placeholder remains in ${page}`);
    assert(!content.includes('data-placeholder="TODO: ADD TERMS URL"'), `Placeholder remains in ${page}`);
  });
});

runCheck('checkout.html contains live agreement links to terms.html and privacy-policy.html', () => {
  const content = fs.readFileSync(path.join(CW_DIR, 'checkout.html'), 'utf8');
  assert(content.includes('href="terms.html"'), 'checkout.html does not link to terms.html');
  assert(content.includes('href="privacy-policy.html"'), 'checkout.html does not link to privacy-policy.html');
});

console.log('\n--- 6. Routing & Sitemap Integration ---');

runCheck('.htaccess has rewrite rules for all 4 policy URLs', () => {
  const htaccess = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
  assert(htaccess.includes('shipping-policy'), 'Missing shipping-policy rewrite in .htaccess');
  assert(htaccess.includes('refund-policy'), 'Missing refund-policy rewrite in .htaccess');
  assert(htaccess.includes('privacy-policy'), 'Missing privacy-policy rewrite in .htaccess');
  assert(htaccess.includes('terms'), 'Missing terms rewrite in .htaccess');
});

runCheck('sitemap.xml includes canonical entries for all 4 policy pages', () => {
  const sitemap = fs.readFileSync(path.join(CW_DIR, 'sitemap.xml'), 'utf8');
  assert(sitemap.includes('https://chipakk.shop/shipping-policy.html'), 'Missing shipping-policy in sitemap.xml');
  assert(sitemap.includes('https://chipakk.shop/refund-policy.html'), 'Missing refund-policy in sitemap.xml');
  assert(sitemap.includes('https://chipakk.shop/privacy-policy.html'), 'Missing privacy-policy in sitemap.xml');
  assert(sitemap.includes('https://chipakk.shop/terms.html'), 'Missing terms in sitemap.xml');
});

console.log('\n--- 7. Store 2 (THE MARSHANS) Isolation Safeguard ---');

runCheck('Store 2 configuration is completely preserved and isolated', () => {
  const settingsService = fs.readFileSync(path.join(ROOT, 'server/services/settingsService.js'), 'utf8');
  assert(settingsService.includes("store_name: 'THE MARSHANS'"), 'Store 2 branding isolation altered');
  assert(settingsService.includes("support_email: 'support@themarshans.shop'"), 'Store 2 support email altered');
  assert(settingsService.includes("store_name: 'CHIPAKK Stickers'"), 'Store 1 branding isolation altered');
  assert(settingsService.includes("support_email: 'support@chipakk.shop'"), 'Store 1 support email altered');
});

console.log('\n--- 8. Live HTTP Storefront Delivery ---');

async function runAsyncChecks() {
  const http = require('http');
  const app = require('../server/app');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

  const routes = [
    '/shipping-policy',
    '/shipping-policy.html',
    '/refund-policy',
    '/refund-policy.html',
    '/privacy-policy',
    '/privacy-policy.html',
    '/terms',
    '/terms.html',
    '/terms-and-conditions',
    '/terms-and-conditions.html'
  ];

  for (const route of routes) {
    totalTests++;
    try {
      const res = await fetch(`http://localhost:${port}${route}`);
      assert.strictEqual(res.status, 200, `Expected 200 for ${route}, got ${res.status}`);
      const text = await res.text();
      assert(text.includes('<!DOCTYPE html>'), `${route} did not return valid HTML`);
      assert(text.includes('support@chipakk.shop'), `${route} missing support email`);
      console.log(`  ✓ GET ${route} serves valid policy HTML (200 OK)`);
      passedTests++;
    } catch (err) {
      console.error(`  ✗ FAIL: GET ${route}`);
      console.error(`    ${err.message}`);
    }
  }

  server.close();

  console.log(`\n========================================`);
  console.log(`Test Results: ${passedTests} / ${totalTests} checks passed.`);
  console.log(`========================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAsyncChecks().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
