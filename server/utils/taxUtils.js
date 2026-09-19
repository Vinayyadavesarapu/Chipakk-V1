/**
 * Commercial GST Calculation & Statutory Tax Split Utilities
 *
 * Complies with the Indian CGST / SGST / IGST Act 2017.
 * All calculations use integer-safe arithmetic in the project's native money units:
 * - Store 1 (CHIPAKK): Whole Indian Rupees (₹1 = 1)
 * - Store 2 (THE MARSHANS): Integer Paise (₹1.00 = 100 paise)
 *
 * Strict Guarantees:
 * 1. Zero floating-point drift: Uses Math.round / Math.floor on integer units.
 * 2. Exact reconciliation: taxable + tax === totalAmount.
 * 3. Exact tax split reconciliation: cgst + sgst === tax (or igst === tax).
 */

const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh'
};

/**
 * Standardize state names for robust case-insensitive comparison
 */
const normalizeState = (stateStr) => {
  if (!stateStr || typeof stateStr !== 'string') return '';
  const clean = stateStr.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  if (clean === 'delhi' || clean === 'newdelhi' || clean === 'nctofdelhi' || clean === 'dl') {
    return 'delhi';
  }
  if (clean === 'maharashtra' || clean === 'mh') return 'maharashtra';
  if (clean === 'karnataka' || clean === 'ka') return 'karnataka';
  if (clean === 'tamilnadu' || clean === 'tn') return 'tamilnadu';
  if (clean === 'telangana' || clean === 'ts' || clean === 'tg') return 'telangana';
  if (clean === 'uttarpradesh' || clean === 'up') return 'uttarpradesh';
  if (clean === 'haryana' || clean === 'hr') return 'haryana';
  if (clean === 'westbengal' || clean === 'wb') return 'westbengal';
  if (clean === 'gujarat' || clean === 'gj') return 'gujarat';
  if (clean === 'rajasthan' || clean === 'rj') return 'rajasthan';

  return clean;
};

/**
 * Resolve the authoritative seller state from store settings / GSTIN
 *
 * Order of Precedence:
 * 1. Explicit store_settings.seller_state or store_settings.store_state
 * 2. 2-Digit State Code prefix from store_settings.gstin (e.g. '07' -> 'Delhi')
 * 3. Documented safe default: 'Delhi'
 *
 * @param {Object} settings - Store settings map
 * @returns {string} Normalized seller state name
 */
const resolveSellerState = (settingsOrGstin = {}) => {
  if (typeof settingsOrGstin === 'string') {
    const trimmed = settingsOrGstin.trim().toUpperCase();
    if (trimmed.length >= 2 && GST_STATE_CODES[trimmed.slice(0, 2)]) {
      return GST_STATE_CODES[trimmed.slice(0, 2)];
    }
    return trimmed;
  }
  const settings = settingsOrGstin || {};
  if (settings.seller_state && typeof settings.seller_state === 'string' && settings.seller_state.trim()) {
    return settings.seller_state.trim();
  }
  if (settings.store_state && typeof settings.store_state === 'string' && settings.store_state.trim()) {
    return settings.store_state.trim();
  }

  // Derive from GSTIN prefix if present
  const gstin = settings.gstin && typeof settings.gstin === 'string' ? settings.gstin.trim().toUpperCase() : '';
  if (gstin && gstin.length >= 2) {
    const code = gstin.slice(0, 2);
    if (GST_STATE_CODES[code]) {
      return GST_STATE_CODES[code];
    }
  }

  // Documented fallback based on registered merchant profile
  return 'Delhi';
};

/**
 * Authoritative 18% Inclusive GST and State Split Calculation
 *
 * Supports both object options { amount, gstRate, sellerState, customerState }
 * and positional parameters (amount, gstRate, { sellerState, customerState }).
 */
const calculateInclusiveGst = (optionsOrAmount = {}, maybeGstRate = 18, maybeOptions = {}) => {
  let amount = 0;
  let gstRate = 18;
  let sellerState = 'Delhi';
  let customerState = '';

  if (typeof optionsOrAmount === 'object' && optionsOrAmount !== null) {
    amount = optionsOrAmount.amount;
    gstRate = optionsOrAmount.gstRate !== undefined ? optionsOrAmount.gstRate : 18;
    sellerState = optionsOrAmount.sellerState || optionsOrAmount.seller_state || 'Delhi';
    customerState = optionsOrAmount.customerState || optionsOrAmount.customer_state || optionsOrAmount.buyerState || optionsOrAmount.buyer_state || '';
  } else {
    amount = optionsOrAmount;
    gstRate = typeof maybeGstRate === 'number' ? maybeGstRate : 18;
    const opts = typeof maybeOptions === 'object' && maybeOptions !== null ? maybeOptions : {};
    sellerState = opts.sellerState || opts.seller_state || 'Delhi';
    customerState = opts.customerState || opts.customer_state || opts.buyerState || opts.buyer_state || '';
  }

  const parsedAmount = Math.max(parseInt(amount, 10) || 0, 0);
  const rate = typeof gstRate === 'number' && gstRate >= 0 ? gstRate : 18;

  if (parsedAmount === 0 || rate === 0) {
    return {
      taxable_amount: parsedAmount,
      taxableAmount: parsedAmount,
      tax_amount: 0,
      taxAmount: 0,
      cgst_amount: 0,
      cgstAmount: 0,
      sgst_amount: 0,
      sgstAmount: 0,
      igst_amount: 0,
      igstAmount: 0,
      tax_rate: rate,
      taxRate: rate,
      is_same_state: false,
      isSameState: false,
      is_inter_state: true,
      isInterState: true,
      seller_state: sellerState,
      sellerState,
      customer_state: customerState,
      customerState
    };
  }

  // Calculate inclusive taxable base and total tax
  const taxableAmount = Math.round((parsedAmount * 100) / (100 + rate));
  const taxAmount = parsedAmount - taxableAmount;

  // Determine State Tax Split
  const normSeller = normalizeState(sellerState);
  const normCustomer = normalizeState(customerState);
  const isSameState = Boolean(normSeller && normCustomer && normSeller === normCustomer);

  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (isSameState) {
    cgstAmount = Math.floor(taxAmount / 2);
    sgstAmount = taxAmount - cgstAmount; // Reconciles exact sum: cgst + sgst === taxAmount
    igstAmount = 0;
  } else {
    igstAmount = taxAmount;
    cgstAmount = 0;
    sgstAmount = 0;
  }

  return {
    taxable_amount: taxableAmount,
    taxableAmount,
    tax_amount: taxAmount,
    taxAmount,
    cgst_amount: cgstAmount,
    cgstAmount,
    sgst_amount: sgstAmount,
    sgstAmount,
    igst_amount: igstAmount,
    igstAmount,
    tax_rate: rate,
    taxRate: rate,
    is_same_state: isSameState,
    isSameState,
    is_inter_state: !isSameState,
    isInterState: !isSameState,
    seller_state: sellerState,
    sellerState,
    customer_state: customerState,
    customerState
  };
};

module.exports = {
  GST_STATE_CODES,
  normalizeState,
  resolveSellerState,
  calculateInclusiveGst
};
