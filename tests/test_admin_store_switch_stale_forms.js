/**
 * Admin panel store-switcher (web/js/admin.js) -- open edit forms / detail modals must not survive a store switch.
 *
 * BUG THIS GUARDS (found 2026-09-23 during a full-repo production audit, static code reading): switchActiveStore()
 * re-fetched every tab's LIST data for the newly active store, but never closed a currently-OPEN edit form or
 * cleared its editingXId module state, and never closed the order-detail modal / cleared activeOrderViewing.
 * Concretely: open the Product edit form on CHIPAKK for product #42 (editingProductId=42, form populated with
 * CHIPAKK values) -> switch to THE MARSHANS without closing the form -> the form is still visible showing stale
 * CHIPAKK data -> click Save -> saveProductForm() builds a THE-MARSHANS-shaped payload (it reads the NEW active
 * store) but PUTs it to /admin/products/42, i.e. a cross-store write using CHIPAKK's id under Marshans' header.
 * Same risk for the order-detail modal's Update Status / Save Courier Details actions using the stale
 * activeOrderViewing.id. Fixed by having switchActiveStore() hide every known edit-form container, null every
 * editingXId variable, and close the order-detail / customer-detail modals before loading the new store's data.
 *
 * admin.js is a large (6000+ line), DOM-and-many-globals-coupled legacy file with no existing VM test harness (no
 * admin_vm.js equivalent of tests/helpers/storefront_vm.js exists in this repo), and building one is out of
 * proportion to this fix. This test instead statically verifies the exact reset code is present in
 * switchActiveStore()'s body -- weaker than a full behavioral test, but it directly guards against this specific
 * reset being silently removed or only partially applied in a future edit, which is what actually broke here.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`[PASS] ${name}`); }
  catch (err) { results.push({ name, pass: false, err }); console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`); }
}

const ADMIN_JS = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'admin.js'), 'utf8');
const fnMatch = ADMIN_JS.match(/async function switchActiveStore\(targetStoreId\) \{[\s\S]*?\n    \}\n/);
assert.ok(fnMatch, 'switchActiveStore(targetStoreId) function must exist in web/js/admin.js');
const body = fnMatch[0];

test('STATIC :: switchActiveStore() hides every known edit-form container before loading new-store data', () => {
  const containers = ['product-form-container', 'category-form-container', 'coupon-form-container',
    'shipping-form-container', 'event-form-container', 'material-form-container', 'finishing-form-container',
    'inventory-form-container', 'hero-slide-form-container', 'banner-form-container', 'team-form-container'];
  for (const id of containers) {
    assert.ok(body.includes(`'${id}'`), `switchActiveStore() must reference and close #${id}`);
  }
});

test('STATIC :: switchActiveStore() nulls every editingXId module variable, not just editingProductId', () => {
  const vars = ['editingProductId', 'editingCategoryId', 'editingEventId', 'editingCouponId', 'editingShippingId',
    'editingMaterialId', 'editingFinishingId', 'editingHeroSlideId', 'editingBannerId'];
  for (const v of vars) {
    assert.ok(new RegExp(`\\b${v}\\s*=\\s*null`).test(body), `switchActiveStore() must reset ${v} = null`);
  }
});

test('STATIC :: switchActiveStore() closes the order-detail modal and clears activeOrderViewing (the stale-order-id write risk)', () => {
  assert.ok(body.includes("'order-detail-modal'"), 'switchActiveStore() must reference #order-detail-modal');
  assert.ok(/activeOrderViewing\s*=\s*null/.test(body), 'switchActiveStore() must reset activeOrderViewing = null');
});

test('STATIC :: the reset happens BEFORE the new store\'s data is fetched (Promise.allSettled), not after', () => {
  const resetIdx = body.indexOf('editingProductId = null');
  const fetchIdx = body.indexOf('Promise.allSettled');
  assert.ok(resetIdx !== -1 && fetchIdx !== -1 && resetIdx < fetchIdx, 'reset must precede the new-store data fetch so no stale form is visible even momentarily while new data loads');
});

const failed = results.filter((r) => !r.pass);
console.log(`\nADMIN STORE-SWITCH STALE FORMS: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.name}`).join('\n')); process.exit(1); }
process.exit(0);
