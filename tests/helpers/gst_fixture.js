/**
 * TEST FIXTURE ONLY. A structurally valid but fictitious supplier identity for tests.
 * The GSTIN below is generated (with the official check character) from a made-up PAN; it is not a real
 * registration, and NOTHING under server/ or customer-workspace/ references this file.
 */
const taxUtils = require('../../server/utils/taxUtils');

const makeGstin = (stateCode, pan10, entity = '1') => {
  const first14 = `${stateCode}${pan10}${entity}Z`;
  return first14 + taxUtils.gstinCheckChar(first14);
};

const FIXTURE_STATE = { code: '27', name: 'Maharashtra' };
const FIXTURE_GSTIN = makeGstin(FIXTURE_STATE.code, 'ABCDE1234F');

const supplierRow = (over = {}) => ({
  id: 1,
  legal_name: 'Fixture Trading Private Limited',
  gstin: FIXTURE_GSTIN,
  address: '1 Fixture Road, Fixture Nagar, Pune 411001',
  state: FIXTURE_STATE.name,
  state_code: FIXTURE_STATE.code,
  pincode: '411001',
  is_active: 1,
  ...over
});

/** fake-DB handlers that make the fixture supplier the configured legal supplier for both stores */
const supplierHandlers = (row = supplierRow()) => [
  [/FROM stores s JOIN legal_suppliers/, () => [[row]]],
  [/FROM legal_suppliers WHERE is_active/, () => [[row]]]
];

module.exports = { makeGstin, FIXTURE_GSTIN, FIXTURE_STATE, supplierRow, supplierHandlers };
