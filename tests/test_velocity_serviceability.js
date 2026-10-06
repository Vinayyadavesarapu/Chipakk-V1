/**
 * THE MARSHANS — Velocity serviceability regression tests
 *
 * Drives the real orderController.checkOrderServiceabilityHandler + velocityService against a mocked
 * global fetch (no network, no real credentials) and verifies the three-state contract:
 *   serviceable (carriers returned) / not_serviceable (empty carriers) / unavailable (config, auth, network, API failure)
 *
 * Run: node --test tests/test_velocity_serviceability.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const velocityService = require('../server/services/velocityService');
const { checkOrderServiceabilityHandler } = require('../server/controllers/orderController');

const AUTH_URL = 'https://velocity.test/custom/api/v1/auth-token';
const SERVICEABILITY_URL = 'https://velocity.test/custom/api/v1/serviceability';
const ENV_KEYS = ['VELOCITY_USERNAME', 'VELOCITY_PASSWORD', 'MARSHANS_PICKUP_PINCODE', 'VELOCITY_BASE_URL'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = global.fetch;
const realWarn = console.warn;

function configure(overrides = {}) {
  Object.assign(process.env, {
    VELOCITY_USERNAME: 'test-user',
    VELOCITY_PASSWORD: 'test-pass',
    MARSHANS_PICKUP_PINCODE: '500090',
    VELOCITY_BASE_URL: 'https://velocity.test'
  }, overrides);
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
}

/** Mock fetch: `serviceability` is a list of responses (or Errors) returned in order. */
function mockVelocity({ serviceability = [], authStatus = 200 } = {}) {
  const calls = [];
  let authCount = 0;
  global.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: init.headers && init.headers.Authorization });
    if (url === AUTH_URL) {
      authCount += 1;
      return { ok: authStatus === 200, status: authStatus, json: async () => (authStatus === 200 ? { token: `token-${authCount}` } : { message: 'bad credentials' }) };
    }
    if (url === SERVICEABILITY_URL) {
      const next = serviceability.shift();
      if (!next) throw new Error('unexpected extra serviceability call');
      if (next instanceof Error) throw next;
      return { ok: next.status === 200, status: next.status, json: async () => next.body };
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return calls;
}

async function callHandler({ storeId = 2, pincode = '521456', payment_mode } = {}) {
  const req = { storeId, body: { pincode, ...(payment_mode ? { payment_mode } : {}) } };
  const out = {};
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; }
  };
  let nextErr = null;
  await checkOrderServiceabilityHandler(req, res, (e) => { nextErr = e; });
  if (nextErr) throw nextErr;
  return out;
}

const carriersBody = { result: { serviceability_results: [
  { carrier_id: 'CR1', carrier_name: 'Carrier One' },
  { carrier_id: 'CR2', carrier_name: 'Carrier Two' }
] } };
const ok = (body) => ({ status: 200, body });
const serviceabilityCalls = (calls) => calls.filter((c) => c.url === SERVICEABILITY_URL);
const authCalls = (calls) => calls.filter((c) => c.url === AUTH_URL);

test.beforeEach(() => {
  velocityService.resetTokenCache();
  console.warn = () => {};
  configure();
});

test.after(() => {
  global.fetch = realFetch;
  console.warn = realWarn;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});

test('1. Velocity credentials missing -> unavailable, no Velocity call', async () => {
  configure({ VELOCITY_USERNAME: undefined, VELOCITY_PASSWORD: undefined });
  const calls = mockVelocity();
  const { status, body } = await callHandler();
  assert.equal(status, 200);
  assert.equal(body.data.status, 'unavailable');
  assert.equal(body.data.serviceable, false);
  assert.deepEqual(body.data.carriers, []);
  assert.equal(body.data.message, 'Shipping serviceability is temporarily unavailable. Please try again later.');
  assert.equal(calls.length, 0);
});

test('2. Missing or invalid pickup PIN -> unavailable, no Velocity call', async () => {
  for (const pin of [undefined, '', '5000', 'abcdef']) {
    velocityService.resetTokenCache();
    configure({ MARSHANS_PICKUP_PINCODE: pin });
    const calls = mockVelocity();
    const { body } = await callHandler();
    assert.equal(body.data.status, 'unavailable', `pickup PIN ${JSON.stringify(pin)}`);
    assert.equal(calls.length, 0);
  }
});

test('3. Velocity returns carriers -> serviceable=true with carrier details', async () => {
  const calls = mockVelocity({ serviceability: [ok(carriersBody)] });
  const { body } = await callHandler();
  assert.equal(body.data.status, 'serviceable');
  assert.equal(body.data.serviceable, true);
  assert.deepEqual(body.data.carriers, [
    { carrier_id: 'CR1', carrier_name: 'Carrier One' },
    { carrier_id: 'CR2', carrier_name: 'Carrier Two' }
  ]);
  assert.equal(serviceabilityCalls(calls)[0].body.from, '500090');
  assert.equal(serviceabilityCalls(calls)[0].body.to, '521456');
});

test('4. Velocity returns empty serviceability_results -> not_serviceable', async () => {
  mockVelocity({ serviceability: [ok({ result: { serviceability_results: [] } })] });
  const { body } = await callHandler();
  assert.equal(body.data.status, 'not_serviceable');
  assert.equal(body.data.serviceable, false);
  assert.deepEqual(body.data.carriers, []);
  assert.equal(body.data.message, 'Delivery is not available for this PIN code.');
});

test('4b. Undocumented response shape is never treated as serviceable', async () => {
  for (const shape of [{}, { serviceable: true }, { result: {} }, { result: { serviceability_results: 'yes' } }]) {
    velocityService.resetTokenCache();
    mockVelocity({ serviceability: [ok(shape)] });
    const { body } = await callHandler();
    assert.equal(body.data.status, 'unavailable', JSON.stringify(shape));
    assert.equal(body.data.serviceable, false);
  }
});

test('5. Token rejected -> cache cleared, fresh token fetched, retried once', async () => {
  const calls = mockVelocity({ serviceability: [{ status: 401, body: { message: 'token expired' } }, ok(carriersBody)] });
  const { body } = await callHandler();
  assert.equal(body.data.status, 'serviceable');
  assert.equal(authCalls(calls).length, 2, 'a fresh token was requested');
  const svc = serviceabilityCalls(calls);
  assert.equal(svc.length, 2, 'retried exactly once');
  assert.equal(svc[0].auth, 'Bearer token-1');
  assert.equal(svc[1].auth, 'Bearer token-2');
});

test('6. Second token rejection -> unavailable, no further retries', async () => {
  const calls = mockVelocity({ serviceability: [{ status: 401, body: {} }, { status: 401, body: {} }] });
  const { body } = await callHandler();
  assert.equal(body.data.status, 'unavailable');
  assert.equal(serviceabilityCalls(calls).length, 2);
  assert.equal(authCalls(calls).length, 2);
});

test('6b. Velocity auth-token endpoint rejects credentials -> unavailable', async () => {
  const calls = mockVelocity({ authStatus: 401 });
  const { body } = await callHandler();
  assert.equal(body.data.status, 'unavailable');
  assert.equal(serviceabilityCalls(calls).length, 0);
});

test('7. Non-auth Velocity failures -> unavailable without retry', async () => {
  for (const failure of [{ status: 500, body: { message: 'boom' } }, { status: 400, body: {} }, new Error('ECONNRESET')]) {
    velocityService.resetTokenCache();
    const calls = mockVelocity({ serviceability: [failure] });
    const { body } = await callHandler();
    assert.equal(body.data.status, 'unavailable');
    assert.equal(serviceabilityCalls(calls).length, 1, 'no retry for non-auth failure');
    assert.ok(!/boom|ECONNRESET/.test(body.data.message), 'Velocity internals are not shown to customers');
  }
});

test('8. COD sends payment_mode=cod', async () => {
  const calls = mockVelocity({ serviceability: [ok(carriersBody)] });
  await callHandler({ payment_mode: 'cod' });
  assert.equal(serviceabilityCalls(calls)[0].body.payment_mode, 'cod');
});

test('9. Prepaid (and missing/unknown mode) sends payment_mode=prepaid', async () => {
  for (const mode of ['prepaid', undefined, 'upi']) {
    velocityService.resetTokenCache();
    const calls = mockVelocity({ serviceability: [ok(carriersBody)] });
    await callHandler({ payment_mode: mode });
    assert.equal(serviceabilityCalls(calls)[0].body.payment_mode, 'prepaid', String(mode));
  }
});

test('10. shipment_type is always forward', async () => {
  const calls = mockVelocity({ serviceability: [ok(carriersBody)] });
  await callHandler();
  assert.equal(serviceabilityCalls(calls)[0].body.shipment_type, 'forward');
  assert.deepEqual(Object.keys(serviceabilityCalls(calls)[0].body).sort(), ['from', 'payment_mode', 'shipment_type', 'to']);
});

test('11. Store 1 cannot use the Store 2 serviceability endpoint', async () => {
  const calls = mockVelocity();
  const { status, body } = await callHandler({ storeId: 1 });
  assert.equal(status, 403);
  assert.equal(body.success, false);
  assert.equal(calls.length, 0);
});

test('11b. Invalid customer PIN is rejected with 400 before calling Velocity', async () => {
  for (const pin of ['52145', '5214567', '52a456', '']) {
    const calls = mockVelocity();
    const { status } = await callHandler({ pincode: pin });
    assert.equal(status, 400, pin);
    assert.equal(calls.length, 0);
  }
});
