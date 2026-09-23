/**
 * server/services/paymentService.js promoteCouponReservation() -- coupon usage_count double-increment race guard.
 *
 * BUG THIS GUARDS (found 2026-09-23 during a full-repo production audit, static code reading): verifyPayment()
 * (browser-triggered, after Razorpay checkout) and handleWebhook() (Razorpay's independent server-to-server
 * webhook) both call promoteCouponReservation(orderId, connection) for the SAME order, each inside its own
 * transaction, and commonly both fire for one payment. The original code did a plain
 * `SELECT id, coupon_id FROM coupon_usage WHERE order_id = ? AND status = 'reserved'` with no lock, then
 * unconditionally `UPDATE ... SET status='consumed' WHERE status='reserved'`, then looped the PRE-fetched rows
 * incrementing `coupons.usage_count` -- with no check that its own UPDATE actually changed anything. If both
 * calls' SELECTs ran before either committed, both would see status='reserved', both would loop and increment
 * usage_count, over-counting a single redemption by one -- which can prematurely trip a coupon's usage_limit and
 * lock out legitimate future customers. Fixed by adding `FOR UPDATE` to the SELECT: since both call sites already
 * run inside a real transaction (beginTransaction/commit/rollback), this makes the second caller's SELECT block
 * until the first commits, then re-read the now-'consumed' rows and correctly see none to act on.
 *
 * A full concurrent-transaction test would need real MySQL row-locking semantics, which this repo's lightweight
 * in-memory fake pool (tests/helpers/fake_db.js) does not model -- it has no notion of blocking or commit
 * visibility between two "connections". So this is a static verification (matching this suite's existing
 * "STATIC" test pattern, e.g. in tests/test_gst_legal_supplier.js) of the two preconditions that together make
 * the fix correct: (1) the SELECT uses FOR UPDATE, and (2) both call sites pass a real transactional connection,
 * not the bare pool, so that lock actually has a transaction boundary to serialize against.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`[PASS] ${name}`); }
  catch (err) { results.push({ name, pass: false, err }); console.error(`[FAIL] ${name}\n       ${err && err.stack ? err.stack : err}`); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'paymentService.js'), 'utf8');
const fnMatch = SRC.match(/const promoteCouponReservation = async[\s\S]*?\n\};/);
assert.ok(fnMatch, 'promoteCouponReservation must exist in server/services/paymentService.js');
const body = fnMatch[0];

test('STATIC :: promoteCouponReservation locks the reserved coupon_usage rows with FOR UPDATE', () => {
  assert.ok(/SELECT id, coupon_id FROM coupon_usage WHERE order_id = \? AND status = 'reserved' FOR UPDATE/.test(body),
    'the SELECT must end in FOR UPDATE so a concurrent caller for the same order blocks instead of also reading status=\'reserved\'');
});

test('STATIC :: both verifyPayment and handleWebhook call promoteCouponReservation with a real transactional connection, not the bare pool', () => {
  const verifyPaymentFn = SRC.match(/const verifyPayment = async[\s\S]*?\n\};/)[0];
  const handleWebhookFn = SRC.match(/const handleWebhook = async[\s\S]*?\n\};/)[0];
  for (const [name, fn] of [['verifyPayment', verifyPaymentFn], ['handleWebhook', handleWebhookFn]]) {
    assert.ok(/promoteCouponReservation\(order\.id, connection\)/.test(fn), `${name} must pass its transactional 'connection', not the module-level pool -- FOR UPDATE only serializes within a transaction`);
    assert.ok(/connection\.beginTransaction\(\)/.test(fn), `${name} must open a transaction before calling promoteCouponReservation`);
    assert.ok(/connection\.commit\(\)/.test(fn), `${name} must commit that transaction (releasing the FOR UPDATE lock) after promoteCouponReservation`);
  }
});

test('STATIC :: the increment loop is still gated behind a non-empty locked read (usage_count is never incremented unconditionally)', () => {
  assert.ok(/if \(usageRows && usageRows\.length > 0\)/.test(body), 'the UPDATE + increment must stay inside the "rows were actually found reserved" guard');
});

const failed = results.filter((r) => !r.pass);
console.log(`\nCOUPON PROMOTION RACE GUARD: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error('FAILED:\n' + failed.map((f) => ` - ${f.name}`).join('\n')); process.exit(1); }
process.exit(0);
