/**
 * Tax profile: who is the legal supplier, under which trade name, and how is GST applied for a store.
 *
 * BUSINESS MODEL
 *   CHIPAKK is a trade name of the same GST-registered legal entity as THE MARSHANS (one registration, one GSTIN).
 *   The entity is stored ONCE (`legal_suppliers`) and both stores resolve to it. Nothing in code knows a GSTIN,
 *   legal name, address or state: unset values stay unset and are reported in `missing_*` instead of invented.
 *
 * READINESS (both are computed, neither is guessed)
 *   checkout_ready : GST is off, OR a structurally valid GSTIN + a seller state that agrees with it exist.
 *                    Orders are refused (503) when GST is on and this is false: an order without a supplier
 *                    identity would carry a wrong tax snapshot that cannot be repaired later.
 *   invoice_ready  : checkout_ready + legal name + address. Invoices cannot be issued until then.
 *
 * SOURCES (first that yields a valid supplier wins)
 *   1. legal_suppliers row linked from stores.legal_supplier_id
 *   2. the single active legal_suppliers row (both stores share it)
 *   3. legacy store_settings keys (gstin, seller_state, ...) -- only when they VALIDATE; the sample GSTIN that older
 *      migrations seeded is rejected, so it is reported as "not configured" rather than trusted.
 */
const { pool } = require('../config/database');
const settingsService = require('./settingsService');
const taxUtils = require('../utils/taxUtils');
const core = require('../utils/taxCore');

const HSN_PATTERN = /^\d{4}(\d{2}(\d{2})?)?$/;

/** '' / null -> {valid:true, value:null} (unset is allowed); otherwise 4, 6 or 8 digits. Never guesses. */
const validateHsn = (input) => {
  if (input === undefined || input === null || String(input).trim() === '') return { valid: true, value: null };
  const v = String(input).trim();
  if (!HSN_PATTERN.test(v)) return { valid: false, value: null, reason: 'HSN code must be 4, 6 or 8 digits.' };
  return { valid: true, value: v };
};

/** '' / null -> {valid:true, value:null} (inherit); otherwise a number 0..100 with at most 2 decimals. */
const validateGstRate = (input) => {
  if (input === undefined || input === null || String(input).trim() === '') return { valid: true, value: null };
  const n = Number(input);
  if (!isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) / 100 !== n) return { valid: false, value: null, reason: 'GST rate must be a number between 0 and 100 (max 2 decimals).' };
  return { valid: true, value: n };
};

const finiteOrNull = (...vals) => {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (isFinite(n) && n >= 0) return n;
  }
  return null;
};

const nonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The supplier row for a store, or null. Tolerates a database that has not run migration 017. */
const readSupplierRow = async (db, storeId) => {
  try {
    const [linked] = await db.execute(
      'SELECT ls.* FROM stores s JOIN legal_suppliers ls ON ls.id = s.legal_supplier_id WHERE s.id = ? AND ls.is_active = 1 LIMIT 1',
      [storeId]
    );
    if (linked && linked.length) return linked[0];
    const [active] = await db.execute('SELECT * FROM legal_suppliers WHERE is_active = 1 ORDER BY id LIMIT 2');
    if (active && active.length === 1) return active[0]; // one registered entity shared by both stores
    return null; // none configured, or ambiguous (several active rows and no link)
  } catch (_) {
    return null; // legal_suppliers / stores not present yet
  }
};

const buildProfile = (storeId, settings, row) => {
  // GST is permanently inactive for the current production release for both CHIPAKK and THE MARSHANS.
  // Existing GST values in the database are ignored.
  const gstEnabled = false;
  const defaultRate = 0;
  const warnings = [];
  if (settings.tax_pricing_mode !== undefined && String(settings.tax_pricing_mode).toLowerCase() !== 'inclusive') {
    warnings.push(`tax_pricing_mode "${settings.tax_pricing_mode}" is not supported; prices are treated as GST-inclusive.`);
  }

  let source = 'none';
  let legalName = null; let gstin = null; let address = null; let stateName = null; let stateCode = null;
  if (row) {
    source = 'legal_suppliers';
    legalName = nonEmpty(row.legal_name); gstin = nonEmpty(row.gstin); address = nonEmpty(row.address);
    stateName = nonEmpty(row.state); stateCode = nonEmpty(row.state_code);
  } else {
    // legacy keys kept in store_settings by earlier versions (read-only fallback)
    gstin = nonEmpty(settings.gstin);
    address = nonEmpty(settings.seller_address);
    legalName = nonEmpty(settings.legal_supplier_name);
    stateName = nonEmpty(settings.seller_state) || nonEmpty(settings.store_state);
    stateCode = nonEmpty(settings.seller_state_code);
    if (gstin || stateName || legalName || address) source = 'store_settings';
  }

  const gstinCheck = taxUtils.validateGstin(gstin);
  const explicitCode = core.resolveStateCode(stateCode) || core.resolveStateCode(stateName);
  const sellerStateCode = explicitCode || (gstinCheck.valid ? gstinCheck.state_code : '');
  const missingForCheckout = [];
  const missingForInvoice = [];
  if (!legalName) missingForInvoice.push({ field: 'legal_supplier_name', reason: 'Registered legal name is not configured.' });
  if (!address) missingForInvoice.push({ field: 'seller_address', reason: 'Supplier address is not configured.' });
  if (!gstinCheck.valid) missingForInvoice.push({ field: 'gstin', reason: gstinCheck.reason });

  const prefix = nonEmpty(settings.invoice_prefix) ? String(settings.invoice_prefix).trim().toUpperCase() : (storeId === 2 ? 'MRS' : 'CHP');
  return {
    store_id: storeId,
    trade_name: nonEmpty(settings.trade_name) || (storeId === 2 ? 'THE MARSHANS' : 'CHIPAKK'),
    legal_supplier_name: legalName,
    gstin: gstinCheck.valid ? gstinCheck.gstin : null,
    seller_address: address,
    seller_state: sellerStateCode ? core.stateNameFromCode(sellerStateCode) : null,
    seller_state_code: sellerStateCode || null,
    gst_enabled: false,
    default_gst_rate: 0,
    default_gst_rate_source: 'disabled',
    tax_pricing_mode: 'inclusive',
    invoice_prefix: prefix,
    // custom stickers have no catalogue record: explicit store settings, else unset (never guessed)
    custom_item_hsn: null,
    custom_item_gst_rate: 0,
    source,
    checkout_ready: true,
    invoice_ready: missingForInvoice.length === 0,
    missing_for_checkout: [],
    missing_for_invoice: missingForInvoice,
    warnings
  };
};

/** The resolved tax profile for a store. `db` may be a transaction connection. */
const getTaxProfile = async (storeId = 1, { db = pool, settings = null } = {}) => {
  const sid = parseInt(storeId, 10) === 2 ? 2 : 1;
  const s = settings || await settingsService.getStoreSettings(sid);
  const row = await readSupplierRow(db, sid);
  return buildProfile(sid, s, row);
};

/** Throws a customer-safe 503 when GST is on but the supplier identity is unusable. Ops detail goes to the log. */
const assertCheckoutReady = (profile) => {
  if (!profile.gst_enabled || profile.checkout_ready) return;
  console.error(`[GST] Store ${profile.store_id}: checkout blocked, tax configuration incomplete: ` +
    profile.missing_for_checkout.map((m) => `${m.field} (${m.reason})`).join('; '));
  const err = new Error('Checkout is temporarily unavailable while our tax details are being updated. Please try again shortly.');
  err.statusCode = 503;
  err.code = 'TAX_CONFIGURATION_INCOMPLETE';
  throw err;
};

/**
 * HSN + GST rate for one order line: product > category > store default rate. HSN is NEVER defaulted:
 * unset stays null (the order is still accepted, but no invoice can be issued for that line until it is set).
 */
const resolveLineTaxConfig = (row, profile) => {
  if (!profile || profile.gst_enabled === false) {
    return { hsn: null, hsn_source: 'disabled', rate: 0, rate_source: 'disabled' };
  }
  const productHsn = validateHsn(row && row.hsn_code); const categoryHsn = validateHsn(row && row.category_hsn_code);
  const productRate = validateGstRate(row && row.gst_rate); const categoryRate = validateGstRate(row && row.category_gst_rate);
  const hsn = (productHsn.valid && productHsn.value) || (categoryHsn.valid && categoryHsn.value) || null;
  const hsnSource = productHsn.valid && productHsn.value ? 'product' : (categoryHsn.valid && categoryHsn.value ? 'category' : 'unset');
  let rate = profile.default_gst_rate; let rateSource = 'store_default';
  if (productRate.valid && productRate.value !== null) { rate = productRate.value; rateSource = 'product'; }
  else if (categoryRate.valid && categoryRate.value !== null) { rate = categoryRate.value; rateSource = 'category'; }
  return { hsn, hsn_source: hsnSource, rate, rate_source: rateSource };
};

// --------------------------------------------------------------------------------------------
// Product / category configuration helpers (shared by the four catalogue services)
// --------------------------------------------------------------------------------------------
/**
 * Validate the hsn_code / gst_rate fields of an admin create/update payload.
 * Returns { hsn_code: {provided, value}, gst_rate: {provided, value} }. `provided:false` = leave the column alone;
 * an empty string / null = clear it (inherit). Invalid input throws a 400, it is never coerced or guessed.
 */
const parseTaxConfigInput = (data) => {
  const d = data || {};
  const out = { hsn_code: { provided: d.hsn_code !== undefined, value: null }, gst_rate: { provided: d.gst_rate !== undefined, value: null } };
  if (out.hsn_code.provided) {
    const h = validateHsn(d.hsn_code);
    if (!h.valid) { const e = new Error(h.reason); e.statusCode = 400; throw e; }
    out.hsn_code.value = h.value;
  }
  if (out.gst_rate.provided) {
    const r = validateGstRate(d.gst_rate);
    if (!r.valid) { const e = new Error(r.reason); e.statusCode = 400; throw e; }
    out.gst_rate.value = r.value;
  }
  return out;
};

/** Public/admin output fields for a product row: existing GST values in DB are ignored for the production release. */
const shapeTaxConfig = (row) => {
  return {
    hsn_code: null,
    gst_rate: null,
    category_hsn_code: null,
    category_gst_rate: null,
    effective_hsn_code: null,
    effective_gst_rate: 0
  };
};

// --------------------------------------------------------------------------------------------
// Admin: the shared legal supplier record
// --------------------------------------------------------------------------------------------
const validateSupplierPayload = (p) => {
  const errors = [];
  const legalName = nonEmpty(p && p.legal_name);
  const address = nonEmpty(p && p.address);
  const g = taxUtils.validateGstin(p && p.gstin);
  if (!legalName) errors.push('Legal name is required (exactly as on the GST registration).');
  else if (legalName.length > 255) errors.push('Legal name is too long (max 255 characters).');
  if (!address) errors.push('Registered address is required.');
  else if (address.length > 1000) errors.push('Address is too long (max 1000 characters).');
  if (!g.valid) errors.push(g.reason);
  if (g.valid && p.state_code && core.resolveStateCode(p.state_code) !== g.state_code) errors.push(`State code ${p.state_code} does not match the GSTIN (${g.state_code}).`);
  if (g.valid && p.state && core.resolveStateCode(p.state) && core.resolveStateCode(p.state) !== g.state_code) errors.push(`State "${p.state}" does not match the GSTIN state (${g.state}).`);
  const pincode = nonEmpty(p && p.pincode);
  if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) errors.push('PIN code must be 6 digits.');
  if (errors.length) { const e = new Error(errors.join(' ')); e.statusCode = 400; throw e; }
  return { legal_name: legalName, address, gstin: g.gstin, state: g.state, state_code: g.state_code, pincode: pincode || null };
};

const getLegalSupplier = async (db = pool) => {
  try {
    const [rows] = await db.execute('SELECT id, legal_name, gstin, address, state, state_code, pincode, is_active FROM legal_suppliers WHERE is_active = 1 ORDER BY id');
    return rows || [];
  } catch (_) { return []; }
};

/** Create or update THE single active supplier and link both stores to it. Returns the saved row. */
const saveLegalSupplier = async (payload) => {
  const v = validateSupplierPayload(payload);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [active] = await conn.execute('SELECT id FROM legal_suppliers WHERE is_active = 1 ORDER BY id FOR UPDATE');
    let id;
    if (active && active.length > 1) {
      const e = new Error('More than one active legal supplier exists. There must be exactly one registered entity; deactivate the others first.');
      e.statusCode = 409; throw e;
    }
    if (active && active.length === 1) {
      id = active[0].id;
      await conn.execute('UPDATE legal_suppliers SET legal_name = ?, gstin = ?, address = ?, state = ?, state_code = ?, pincode = ? WHERE id = ?',
        [v.legal_name, v.gstin, v.address, v.state, v.state_code, v.pincode, id]);
    } else {
      const [ins] = await conn.execute('INSERT INTO legal_suppliers (legal_name, gstin, address, state, state_code, pincode, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [v.legal_name, v.gstin, v.address, v.state, v.state_code, v.pincode]);
      id = ins.insertId;
    }
    await conn.execute('UPDATE stores SET legal_supplier_id = ? WHERE id IN (1, 2)', [id]);
    await conn.commit();
    return { id, ...v, is_active: 1 };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
};

/** Non-sensitive summary for /api/health and admin screens (no GSTIN, no address). */
const describeReadiness = (profile) => ({
  gst_enabled: profile.gst_enabled,
  checkout_ready: profile.checkout_ready,
  invoice_ready: profile.invoice_ready,
  source: profile.source,
  missing_for_checkout: profile.missing_for_checkout.map((m) => m.field),
  missing_for_invoice: profile.missing_for_invoice.map((m) => m.field)
});

module.exports = {
  HSN_PATTERN,
  validateHsn,
  validateGstRate,
  buildProfile,
  getTaxProfile,
  assertCheckoutReady,
  resolveLineTaxConfig,
  parseTaxConfigInput,
  shapeTaxConfig,
  validateSupplierPayload,
  getLegalSupplier,
  saveLegalSupplier,
  describeReadiness
};
