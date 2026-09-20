/**
 * GST utilities (server side).
 *
 * The arithmetic lives in ./taxCore.js (pure, shared byte-for-byte with the storefront). This module adds what
 * only the server needs: GSTIN validation, seller-state resolution, financial-year handling and the legacy
 * calculateInclusiveGst() facade that older callers and tests use.
 *
 * Nothing here knows a GSTIN, a legal name, an address or a seller state. Those are configuration
 * (see services/taxProfileService.js). There is deliberately NO default state.
 */
const core = require('./taxCore');

const GST_STATE_CODES = core.GST_STATE_CODES;

/** Kept for callers that compare states by a canonical lower-case token. Resolves aliases/codes when it can. */
const normalizeState = (stateStr) => {
  if (!stateStr || typeof stateStr !== 'string') return '';
  const code = core.resolveStateCode(stateStr);
  if (code) return core.stateNameFromCode(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  return stateStr.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
};

// --------------------------------------------------------------------------------------------
// GSTIN
// --------------------------------------------------------------------------------------------
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Official GSTIN check character (mod-36, alternating weights 1 and 2) for the first 14 characters. */
const gstinCheckChar = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const idx = GSTIN_ALPHABET.indexOf(first14[i]);
    if (idx < 0) return '';
    const v = idx * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36];
};

/**
 * Structural validation only (format + known state code + check digit). It cannot prove a GSTIN is registered.
 * Placeholder/sample values are rejected: a real PAN never has the serial 0000, so "AAAAA0000A"-style
 * placeholders (like the sample GSTIN that older migrations seeded) are not accepted.
 */
const validateGstin = (value) => {
  const gstin = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!gstin) return { valid: false, reason: 'GSTIN is missing.' };
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, reason: 'GSTIN must be 15 characters in the official format (e.g. 2 digits, 5 letters, 4 digits, 1 letter, 1 entity code, Z, 1 check character).' };
  if (!GST_STATE_CODES[gstin.slice(0, 2)]) return { valid: false, reason: `GSTIN state code ${gstin.slice(0, 2)} is not a valid GST state code.` };
  if (gstin.slice(7, 11) === '0000') return { valid: false, reason: 'GSTIN looks like a placeholder (PAN serial 0000). Enter the real registration number.' };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { valid: false, reason: 'GSTIN check character is wrong. Please re-check the number.' };
  return { valid: true, gstin, state_code: gstin.slice(0, 2), state: GST_STATE_CODES[gstin.slice(0, 2)] };
};

/**
 * Resolve the seller's state NAME, or '' when it is not configured. There is no default.
 * Precedence: explicit seller_state -> seller_state_code -> the 2-digit state code inside a valid GSTIN.
 * A string argument is treated as a GSTIN (state derived from its prefix, no other validation).
 */
const resolveSellerState = (settingsOrGstin = {}) => {
  if (typeof settingsOrGstin === 'string') {
    const trimmed = settingsOrGstin.trim().toUpperCase();
    if (trimmed.length >= 2 && GST_STATE_CODES[trimmed.slice(0, 2)]) return GST_STATE_CODES[trimmed.slice(0, 2)];
    return core.resolveStateCode(trimmed) ? core.stateNameFromCode(core.resolveStateCode(trimmed)) : '';
  }
  const s = settingsOrGstin || {};
  for (const explicit of [s.seller_state, s.store_state]) {
    if (typeof explicit === 'string' && explicit.trim()) {
      const code = core.resolveStateCode(explicit);
      return code ? core.stateNameFromCode(code) : explicit.trim();
    }
  }
  const byCode = core.resolveStateCode(s.seller_state_code);
  if (byCode) return core.stateNameFromCode(byCode);
  const g = typeof s.gstin === 'string' ? s.gstin.trim().toUpperCase() : '';
  if (g.length >= 2 && GST_STATE_CODES[g.slice(0, 2)]) return GST_STATE_CODES[g.slice(0, 2)];
  return '';
};

// --------------------------------------------------------------------------------------------
// Financial year (India: 1 April - 31 March), used for invoice numbering
// --------------------------------------------------------------------------------------------
/** "2025-26" for any date between 2025-04-01 and 2026-03-31 (evaluated in Asia/Kolkata, not the server zone). */
const financialYear = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(date instanceof Date ? date : new Date(date));
  const year = Number(parts.find((p) => p.type === 'year').value);
  const month = Number(parts.find((p) => p.type === 'month').value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

// --------------------------------------------------------------------------------------------
// Legacy facade: single-amount inclusive GST + state split (kept for existing callers/tests)
// --------------------------------------------------------------------------------------------
const calculateInclusiveGst = (optionsOrAmount = {}, maybeGstRate = 18, maybeOptions = {}) => {
  let amount; let gstRate; let sellerState = ''; let customerState = '';
  if (typeof optionsOrAmount === 'object' && optionsOrAmount !== null) {
    amount = optionsOrAmount.amount;
    gstRate = optionsOrAmount.gstRate !== undefined ? optionsOrAmount.gstRate : 18;
    sellerState = optionsOrAmount.sellerState || optionsOrAmount.seller_state || '';
    customerState = optionsOrAmount.customerState || optionsOrAmount.customer_state || optionsOrAmount.buyerState || optionsOrAmount.buyer_state || '';
  } else {
    amount = optionsOrAmount;
    gstRate = typeof maybeGstRate === 'number' ? maybeGstRate : 18;
    const opts = typeof maybeOptions === 'object' && maybeOptions !== null ? maybeOptions : {};
    sellerState = opts.sellerState || opts.seller_state || '';
    customerState = opts.customerState || opts.customer_state || opts.buyerState || opts.buyer_state || '';
  }
  const parsedAmount = Math.max(parseInt(amount, 10) || 0, 0);
  const rate = typeof gstRate === 'number' && gstRate >= 0 ? gstRate : 18;
  const r = core.computeOrderTax({ lines: [{ key: 'x', gross: parsedAmount, rate }], gstEnabled: rate > 0, defaultRate: rate, sellerState, customerState });
  const t = r.totals;
  const determined = r.supply_type === 'INTRA' || r.supply_type === 'INTER';
  const same = r.supply_type === 'INTRA';
  const out = {
    taxable_amount: t.taxable_value, tax_amount: t.tax, cgst_amount: t.cgst, sgst_amount: t.sgst, igst_amount: t.igst,
    tax_rate: rate, is_same_state: same, is_inter_state: r.supply_type === 'INTER', supply_type: rate > 0 ? r.supply_type : 'NONE',
    split_determined: determined || rate === 0, seller_state: sellerState, customer_state: customerState
  };
  return Object.assign(out, {
    taxableAmount: out.taxable_amount, taxAmount: out.tax_amount, cgstAmount: out.cgst_amount, sgstAmount: out.sgst_amount,
    igstAmount: out.igst_amount, taxRate: out.tax_rate, isSameState: out.is_same_state, isInterState: out.is_inter_state,
    sellerState, customerState
  });
};

module.exports = {
  GST_STATE_CODES,
  normalizeState,
  resolveStateCode: core.resolveStateCode,
  stateNameFromCode: core.stateNameFromCode,
  resolveSellerState,
  validateGstin,
  gstinCheckChar,
  financialYear,
  calculateInclusiveGst,
  computeOrderTax: core.computeOrderTax,
  inclusiveTax: core.inclusiveTax,
  allocateProportional: core.allocateProportional
};
