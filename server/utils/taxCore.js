/**
 * GST core: pure, dependency-free tax arithmetic shared by the API and the storefront.
 *
 * !! customer-workspace/js/tax.js MUST stay byte-identical to this file (tests/test_gst_legal_supplier.js
 * !! enforces it). The API (api.chipakk.shop) and the storefront (chipakk.shop) deploy separately, so the
 * !! storefront cannot require() this file at runtime; identical copies + a test are how "client and server
 * !! agree" is guaranteed instead of two hand-written formulas.
 *
 * Rules implemented (Store 1 = whole rupees, Store 2 = integer paise; every function is unit-agnostic):
 *  - Prices are GST-INCLUSIVE:  tax = V - round(V * 100 / (100 + R))   (== V*R/(100+R), rounded consistently)
 *  - GST is never added on top of a displayed price.
 *  - A coupon discount reduces the taxable value; it is allocated across lines in proportion to line value.
 *  - Shipping charged with the goods is a composite supply: it takes the rate of the principal supply, and for a
 *    mixed-rate order the HIGHEST rate applies (s.8 CGST Act). Confirm with your tax adviser before relying on it.
 *  - Tax is computed per RATE GROUP on the amount actually payable, then allocated back to lines/shipping with
 *    the largest-remainder method, so line taxes always sum EXACTLY to the order tax.
 *  - Same state (supplier state code == place-of-supply state code): CGST + SGST (SGST takes the odd unit).
 *    Different state: IGST. If either state cannot be resolved the split is reported as UNDETERMINED (never guessed).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CHIPAKK_TAX = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // GST state / UT codes (first two characters of a GSTIN). 97 / 99 are the statutory non-state jurisdictions.
  var GST_STATE_CODES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
    "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
    "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
    "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "28": "Andhra Pradesh (Old)",
    "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory", "99": "Centre Jurisdiction"
  };

  // Alternative spellings and postal abbreviations customers actually type. Keys are lower-case letters/digits only.
  var STATE_ALIASES = {
    dl: "07", newdelhi: "07", nctofdelhi: "07", nctdelhi: "07", delhincr: "07",
    jk: "01", jammukashmir: "01", jammuandkashmir: "01",
    hp: "02", pb: "03", ch: "04", uk: "05", ut: "05", uttaranchal: "05", hr: "06", rj: "08", up: "09", br: "10",
    sk: "11", ar: "12", nl: "13", mn: "14", mz: "15", tr: "16", ml: "17", as: "18", wb: "19", bengal: "19",
    jh: "20", od: "21", or: "21", orissa: "21", cg: "22", ct: "22", chattisgarh: "22", mp: "23", gj: "24",
    dn: "26", dd: "26", dnh: "26", dnhdd: "26", damananddiu: "26", damandiu: "26", dadranagarhaveli: "26", dadraandnagarhaveli: "26", dadranagarhavelidamandiu: "26",
    mh: "27", ka: "29", ga: "30", ld: "31", kl: "32", tn: "33", py: "34", pondicherry: "34", puducherry: "34",
    an: "35", andamannicobar: "35", tg: "36", ts: "36", ap: "37", la: "38"
  };

  function squash(s) { return String(s === undefined || s === null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  var NAME_INDEX = null;
  function nameIndex() {
    if (NAME_INDEX) return NAME_INDEX;
    NAME_INDEX = {};
    Object.keys(GST_STATE_CODES).forEach(function (code) {
      NAME_INDEX[squash(GST_STATE_CODES[code])] = code;
    });
    NAME_INDEX[squash("Andhra Pradesh")] = "37"; // the current code wins over the "(Old)" entry
    NAME_INDEX[squash("Jammu & Kashmir")] = "01";
    return NAME_INDEX;
  }

  /** "Delhi", "delhi ", "DL", "07", "Delhi (07)", "New Delhi", "Orissa" -> "07" / "21"; unknown -> "". */
  function resolveStateCode(input) {
    if (input === undefined || input === null) return "";
    var raw = String(input).trim();
    if (!raw) return "";
    var key = squash(raw);
    if (!key) return "";
    if (/^\d{2}$/.test(key)) return GST_STATE_CODES[key] ? key : "";
    var idx = nameIndex();
    if (idx[key]) return idx[key];
    if (STATE_ALIASES[key]) return STATE_ALIASES[key];
    // "Delhi (07)", "07 - Delhi": strip a bracketed/leading code and retry
    var stripped = squash(raw.replace(/[(\[]?\b\d{2}\b[)\]]?/g, ""));
    if (stripped && stripped !== key) return idx[stripped] || STATE_ALIASES[stripped] || "";
    return "";
  }

  function stateNameFromCode(code) { return GST_STATE_CODES[String(code)] || ""; }

  /** Whole-unit inclusive tax contained in `amount` at `rate` percent. */
  function inclusiveTax(amount, rate) {
    var a = Math.max(Math.round(Number(amount) || 0), 0);
    var r = Number(rate);
    if (!isFinite(r) || r <= 0 || a === 0) return 0;
    return a - Math.round((a * 100) / (100 + r));
  }

  /**
   * Split `total` (integer) across `weights` (non-negative integers) so the parts sum EXACTLY to total.
   * Largest-remainder method; ties go to the earlier index. All-zero weights allocate nothing.
   */
  function allocateProportional(total, weights) {
    var t = Math.max(Math.round(Number(total) || 0), 0);
    var w = (weights || []).map(function (x) { return Math.max(Math.round(Number(x) || 0), 0); });
    var sum = w.reduce(function (a, b) { return a + b; }, 0);
    var out = w.map(function () { return 0; });
    if (!t || !sum) return out;
    var rems = [];
    var given = 0;
    w.forEach(function (x, i) {
      var num = t * x;
      out[i] = Math.floor(num / sum);
      rems.push({ i: i, r: num % sum });
      given += out[i];
    });
    rems.sort(function (a, b) { return b.r - a.r || a.i - b.i; });
    for (var k = 0; k < t - given; k++) out[rems[k % rems.length].i] += 1;
    return out;
  }

  function splitTax(tax, sameState) {
    if (!tax) return { cgst: 0, sgst: 0, igst: 0 };
    if (sameState) { var c = Math.floor(tax / 2); return { cgst: c, sgst: tax - c, igst: 0 }; }
    return { cgst: 0, sgst: 0, igst: tax };
  }

  /**
   * computeOrderTax({
   *   lines:    [{ key, gross, rate?, hsn? }]   gross = unit price * qty in store units (pre-discount, GST-inclusive)
   *   discount: coupon/discount amount (store units)          shipping: shipping charged (store units)
   *   gstEnabled: boolean                                    defaultRate: rate for lines without their own
   *   sellerState / customerState: name, alias or 2-digit code (only used for the CGST/SGST/IGST split)
   * }) -> { pricing_mode, gst_enabled, supply_type, lines[], shipping{}, totals{} }
   */
  function computeOrderTax(input) {
    input = input || {};
    var gstEnabled = input.gstEnabled !== false;
    var defaultRate = Number(input.defaultRate);
    if (!isFinite(defaultRate) || defaultRate < 0) defaultRate = 0;
    var src = Array.isArray(input.lines) ? input.lines : [];
    var grossVals = src.map(function (l) { return Math.max(Math.round(Number(l && l.gross) || 0), 0); });
    var merchandise = grossVals.reduce(function (a, b) { return a + b; }, 0);
    var discount = Math.min(Math.max(Math.round(Number(input.discount) || 0), 0), merchandise);
    var shipping = Math.max(Math.round(Number(input.shipping) || 0), 0);

    var sellerCode = resolveStateCode(input.sellerState);
    var customerCode = resolveStateCode(input.customerState);
    var determined = !!(sellerCode && customerCode);
    var sameState = determined && sellerCode === customerCode;
    var supplyType = !gstEnabled ? "NONE" : (!determined ? "UNDETERMINED" : (sameState ? "INTRA" : "INTER"));

    var discShare = allocateProportional(discount, grossVals);
    var lines = src.map(function (l, i) {
      var r = gstEnabled ? (l && l.rate !== undefined && l.rate !== null && l.rate !== "" && isFinite(Number(l.rate)) && Number(l.rate) >= 0 ? Number(l.rate) : defaultRate) : 0;
      return { key: l ? l.key : undefined, hsn: l && l.hsn ? String(l.hsn) : null, gross: grossVals[i], discount_allocated: discShare[i], net: grossVals[i] - discShare[i], rate: r, tax: 0 };
    });

    var shipRate = 0;
    lines.forEach(function (l) { if (l.rate > shipRate) shipRate = l.rate; });
    if (!gstEnabled) shipRate = 0;

    // amounts by rate group (shipping joins the group of the highest rate)
    var groups = {};
    lines.forEach(function (l, i) { (groups[l.rate] = groups[l.rate] || []).push({ kind: "line", i: i, amount: l.net }); });
    if (shipping > 0) (groups[shipRate] = groups[shipRate] || []).push({ kind: "ship", amount: shipping });
    var shipTax = 0;
    Object.keys(groups).forEach(function (rateKey) {
      var members = groups[rateKey];
      var amount = members.reduce(function (a, m) { return a + m.amount; }, 0);
      var groupTax = inclusiveTax(amount, Number(rateKey));
      var shares = allocateProportional(groupTax, members.map(function (m) { return m.amount; }));
      members.forEach(function (m, k) { if (m.kind === "line") lines[m.i].tax = shares[k]; else shipTax = shares[k]; });
    });

    var totals = { gross_merchandise: merchandise, discount: discount, shipping: shipping, total_value: merchandise - discount + shipping,
      taxable_value: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 };
    lines.forEach(function (l) {
      var s = splitTax(l.tax, sameState);
      l.taxable = l.net - l.tax; l.cgst = s.cgst; l.sgst = s.sgst; l.igst = s.igst;
      // an UNDETERMINED supply carries the tax total but no split (the caller must resolve the states first)
      if (!determined && gstEnabled) { l.cgst = 0; l.sgst = 0; l.igst = 0; }
      totals.taxable_value += l.taxable; totals.tax += l.tax; totals.cgst += l.cgst; totals.sgst += l.sgst; totals.igst += l.igst;
    });
    var ss = splitTax(shipTax, sameState);
    if (!determined && gstEnabled) ss = { cgst: 0, sgst: 0, igst: 0 };
    var shippingOut = { amount: shipping, rate: shipRate, taxable: shipping - shipTax, tax: shipTax, cgst: ss.cgst, sgst: ss.sgst, igst: ss.igst };
    totals.taxable_value += shippingOut.taxable; totals.tax += shipTax; totals.cgst += ss.cgst; totals.sgst += ss.sgst; totals.igst += ss.igst;

    return { pricing_mode: "inclusive", gst_enabled: gstEnabled, supply_type: supplyType, supplier_state_code: sellerCode, place_of_supply_code: customerCode,
      lines: lines, shipping: shippingOut, totals: totals };
  }

  return {
    GST_STATE_CODES: GST_STATE_CODES,
    resolveStateCode: resolveStateCode,
    stateNameFromCode: stateNameFromCode,
    inclusiveTax: inclusiveTax,
    allocateProportional: allocateProportional,
    computeOrderTax: computeOrderTax
  };
});
