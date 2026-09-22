/**
 * GST tax invoices.
 *
 * Numbering:   <PREFIX>/<YY-YY>/<6-digit sequence>   e.g. CHP/25-26/000001  (16 characters = GST Rule 46 limit)
 *   - the sequence is per (series prefix, financial year), starts at 1 and has no gaps: the counter row is locked
 *     FOR UPDATE and incremented in the SAME transaction that inserts the invoice, so a rollback never burns a number
 *   - invoice_number, (series, FY, sequence) and order_id are all UNIQUE: one invoice per order, never a duplicate
 *
 * What an invoice carries (all snapshotted; later edits to products, settings or the supplier record never change it):
 *   supplier legal name, trade name, GSTIN, address, state / code . invoice number + date . recipient name, address,
 *   GSTIN (if given), place of supply . per line: description, HSN, quantity, unit price, discount, taxable value, GST rate,
 *   CGST / SGST / IGST . shipping as its own taxable line . totals
 *
 * Nothing is invented: if the supplier, an HSN or the tax snapshot is missing, issuing FAILS with a message that says
 * exactly what to configure.
 */
const { pool } = require('../config/database');
const taxUtils = require('../utils/taxUtils');
const core = require('../utils/taxCore');
const taxProfileService = require('./taxProfileService');

const NON_INVOICEABLE = ['CANCELLED', 'RETURNED', 'REFUNDED'];

const fail = (message, statusCode = 409, code) => { const e = new Error(message); e.statusCode = statusCode; if (code) e.code = code; return e; };

/** "2025-26" + prefix "CHP" + 12 -> "CHP/25-26/000012" */
const formatInvoiceNumber = (prefix, financialYear, sequence) => {
  const yy = `${financialYear.slice(2, 4)}-${financialYear.slice(5, 7)}`;
  const number = `${prefix}/${yy}/${String(sequence).padStart(6, '0')}`;
  if (number.length > 16) throw fail(`Invoice number "${number}" exceeds the 16-character GST limit; shorten the invoice prefix.`, 400);
  return number;
};

const toUnits = (v) => parseInt(v, 10) || 0;
const rupees = (v, unit) => (unit === 'paise' ? Math.round(v) / 100 : v);
const parseJson = (v, fallback = {}) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return fallback; } };

/** Pure: assemble the invoice document from the stored invoice row + the order snapshot + its lines. */
const buildInvoiceDocument = ({ invoice, order, items }) => {
  const unit = invoice.money_unit;
  const lines = items.map((it, i) => {
    const gross = toUnits(it.total_price); const discount = toUnits(it.discount_allocated);
    return {
      line_no: i + 1, description: it.product_name, sku: it.sku || null, hsn_code: null, quantity: toUnits(it.quantity),
      unit_price: toUnits(it.unit_price), gross_value: gross, discount, taxable_value: gross - discount,
      tax_rate: null,
      cgst: 0, sgst: 0, igst: 0, tax: 0, line_total: gross - discount
    };
  });
  const shippingCharge = toUnits(invoice.shipping_charge);
  const shipping = shippingCharge > 0 ? {
    description: 'Shipping / delivery charges', hsn_code: null,
    taxable_value: shippingCharge, tax_rate: 0,
    cgst: 0, sgst: 0, igst: 0,
    tax: 0, line_total: shippingCharge
  } : null;
  const totals = {
    gross_merchandise: lines.reduce((a, l) => a + l.gross_value, 0), discount: toUnits(invoice.discount_total),
    shipping: shippingCharge, taxable_value: toUnits(invoice.total_value),
    cgst: 0, sgst: 0, igst: 0,
    total_tax: 0, total_value: toUnits(invoice.total_value)
  };
  const addr = parseJson(order.shipping_address, {});
  return {
    invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date, financial_year: invoice.financial_year, status: invoice.status,
    order_number: order.order_number, store_id: toUnits(invoice.store_id), money_unit: unit, currency: 'INR', pricing_mode: 'inclusive',
    supplier: { legal_name: invoice.supplier_legal_name, trade_name: invoice.supplier_trade_name, gstin: invoice.supplier_gstin,
      address: invoice.supplier_address, state: invoice.supplier_state, state_code: invoice.supplier_state_code },
    recipient: { name: invoice.recipient_name, address: invoice.recipient_address, gstin: invoice.recipient_gstin || null,
      pincode: addr.pincode || null },
    place_of_supply: invoice.place_of_supply, place_of_supply_code: invoice.place_of_supply_code, supply_type: 'NONE',
    lines, shipping, totals,
    totals_rupees: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, rupees(v, unit)]))
  };
};

/** Every figure on an invoice must reconcile; a mismatch aborts issuing (nothing is stored). */
const assertReconciles = (doc) => {
  const t = doc.totals; const errs = [];
  const lineTax = doc.lines.reduce((a, l) => a + l.tax, 0) + (doc.shipping ? doc.shipping.tax : 0);
  const lineTaxable = doc.lines.reduce((a, l) => a + l.taxable_value, 0) + (doc.shipping ? doc.shipping.taxable_value : 0);
  const splitTotal = doc.lines.reduce((a, l) => a + l.cgst + l.sgst + l.igst, 0) + (doc.shipping ? doc.shipping.cgst + doc.shipping.sgst + doc.shipping.igst : 0);
  if (lineTaxable !== t.taxable_value) errs.push(`line taxable values (${lineTaxable}) != invoice taxable value (${t.taxable_value})`);
  if (t.taxable_value + t.total_tax !== t.total_value) errs.push('taxable value + tax != total');
  if (splitTotal !== t.total_tax) errs.push(`CGST/SGST/IGST (${splitTotal}) != total tax (${t.total_tax})`);
  if (lineTax !== t.total_tax && doc.supply_type !== 'NONE') errs.push(`line taxes (${lineTax}) != total tax (${t.total_tax})`);
  if (t.gross_merchandise - t.discount + t.shipping !== t.total_value) errs.push('merchandise - discount + shipping != total');
  if (errs.length) throw fail(`Invoice figures do not reconcile: ${errs.join('; ')}`, 500, 'INVOICE_RECONCILIATION');
};

/** Fill an item's missing HSN from the CURRENT product / category configuration (never from a guess). */
const fillMissingHsn = async (conn, items) => {
  const missing = items.filter((it) => !it.hsn_code);
  if (!missing.length) return [];
  const filled = [];
  for (const it of missing) {
    let hsn = null;
    try {
      const table = it.marshans_product_id ? 'marshans_products' : 'products';
      const catTable = it.marshans_product_id ? 'marshans_categories' : 'categories';
      const id = it.marshans_product_id || it.product_id;
      if (id) {
        const [rows] = await conn.execute(
          `SELECT p.hsn_code, c.hsn_code AS category_hsn_code FROM ${table} p LEFT JOIN ${catTable} c ON c.id = p.category_id WHERE p.id = ? LIMIT 1`, [id]);
        const r = rows && rows[0];
        hsn = r ? (taxProfileService.validateHsn(r.hsn_code).value || taxProfileService.validateHsn(r.category_hsn_code).value || null) : null;
      }
    } catch (_) { hsn = null; }
    if (hsn) { await conn.execute('UPDATE order_items SET hsn_code = ? WHERE id = ?', [hsn, it.id]); it.hsn_code = hsn; filled.push(it.id); }
  }
  return filled;
};

const loadOrderForInvoice = async (conn, orderId, storeId, lock) => {
  const [rows] = await conn.execute(`SELECT * FROM orders WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [orderId]);
  const order = rows && rows[0];
  if (!order || (storeId && parseInt(order.store_id, 10) !== parseInt(storeId, 10))) throw fail('Order not found.', 404);
  return order;
};

/**
 * Issue (or return the already-issued) invoice for an order. Idempotent per order.
 * @param {number|string} orderId
 * @param {{issuedBy?: string, storeId?: number, now?: Date}} opts   storeId enforces store isolation
 */
const issueInvoice = async (orderId, { issuedBy = null, storeId = null, now = new Date() } = {}) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const order = await loadOrderForInvoice(conn, orderId, storeId, true);
    const existing = await conn.execute('SELECT * FROM invoices WHERE order_id = ? LIMIT 1', [order.id]);
    if (existing[0] && existing[0].length) {
      const [items] = await conn.execute('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
      await conn.commit();
      return { ...buildInvoiceDocument({ invoice: existing[0][0], order, items }), already_issued: true };
    }
    if (NON_INVOICEABLE.includes(String(order.fulfillment_status || '').toUpperCase().replace(/\s+/g, '_')) || String(order.payment_status || '').toLowerCase() === 'failed') {
      throw fail('This order is cancelled, returned, refunded or its payment failed, so no tax invoice can be issued.', 409, 'ORDER_NOT_INVOICEABLE');
    }
    const sid = parseInt(order.store_id, 10) === 2 ? 2 : 1;
    const unit = sid === 2 ? 'paise' : 'rupees';
    const profile = await taxProfileService.getTaxProfile(sid, { db: conn });
    if (order.tax_supply_type === undefined || order.tax_supply_type === null || (profile.gst_enabled && !order.supplier_gstin)) {
      throw fail('This order was placed before GST supplier snapshots existed (or without one), so an invoice cannot be generated automatically.', 409, 'NO_TAX_SNAPSHOT');
    }

    // Supplier identity: the purchase-time snapshot wins; only what the snapshot lacks (name, address) comes from configuration.
    const supplier = {
      legal_name: order.supplier_legal_name || profile.legal_supplier_name, trade_name: order.supplier_trade_name || profile.trade_name,
      gstin: order.supplier_gstin || profile.gstin, address: order.supplier_address || profile.seller_address,
      state: order.supplier_state || profile.seller_state, state_code: order.supplier_state_code || profile.seller_state_code
    };
    const missing = [];
    if (!supplier.legal_name) missing.push('legal supplier name');
    if (!supplier.address) missing.push('supplier address');
    if (profile.gst_enabled) {
      if (!supplier.gstin || !taxUtils.validateGstin(supplier.gstin).valid) missing.push('valid supplier GSTIN');
      if (!supplier.state_code) missing.push('supplier state');
    }
    if (missing.length) throw fail(`Cannot issue the invoice: ${missing.join(', ')} not configured. Set them under Admin -> Settings -> Business & Tax (legal supplier).`, 409, 'SUPPLIER_INCOMPLETE');

    const [items] = await conn.execute('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
    if (!items.length) throw fail('The order has no lines.', 409);
    if (profile.gst_enabled) {
      await fillMissingHsn(conn, items);
      const noHsn = items.filter((it) => !it.hsn_code);
      if (noHsn.length) {
        throw fail(`Cannot issue the invoice: no HSN code is configured for ${noHsn.map((i) => `"${i.product_name}"`).join(', ')}. Set the HSN on the product or its category (Admin -> Products / Categories); it is never guessed.`, 409, 'HSN_MISSING');
      }
    }

    const addr = parseJson(order.shipping_address, {});
    const recipientAddress = [addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
    const totalTax = toUnits(order.cgst_amount) + toUnits(order.sgst_amount) + toUnits(order.igst_amount);
    const fy = taxUtils.financialYear(now);
    const prefix = profile.invoice_prefix;
    if (!/^[A-Z0-9]{1,3}$/.test(prefix)) throw fail('The invoice prefix must be 1-3 letters/digits.', 400);

    // gap-free sequence: lock the counter row, increment, insert -- all inside this transaction
    await conn.execute('INSERT INTO invoice_sequences (series_prefix, financial_year, last_number) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE last_number = last_number', [prefix, fy]);
    const [seqRows] = await conn.execute('SELECT last_number FROM invoice_sequences WHERE series_prefix = ? AND financial_year = ? FOR UPDATE', [prefix, fy]);
    const seq = (parseInt(seqRows[0].last_number, 10) || 0) + 1;
    await conn.execute('UPDATE invoice_sequences SET last_number = ? WHERE series_prefix = ? AND financial_year = ?', [seq, prefix, fy]);
    const invoiceNumber = formatInvoiceNumber(prefix, fy, seq);

    const invoice = {
      invoice_number: invoiceNumber, series_prefix: prefix, financial_year: fy, sequence_no: seq, invoice_date: now, order_id: order.id, store_id: sid,
      status: 'ISSUED', money_unit: unit,
      supplier_legal_name: supplier.legal_name, supplier_trade_name: supplier.trade_name, supplier_gstin: supplier.gstin,
      supplier_address: supplier.address, supplier_state: supplier.state, supplier_state_code: supplier.state_code,
      recipient_name: addr.name || order.customer_name, recipient_address: recipientAddress || '-', recipient_gstin: order.recipient_gstin || null,
      place_of_supply: order.place_of_supply, place_of_supply_code: order.place_of_supply_code, supply_type: order.tax_supply_type,
      taxable_value: toUnits(order.total_price) - toUnits(order.tax_amount), discount_total: toUnits(order.discount_total), shipping_charge: toUnits(order.shipping_charge),
      cgst_amount: toUnits(order.cgst_amount), sgst_amount: toUnits(order.sgst_amount), igst_amount: toUnits(order.igst_amount), total_value: toUnits(order.total_price),
      issued_by: issuedBy
    };
    const doc = buildInvoiceDocument({ invoice, order, items });
    doc.totals.total_tax = totalTax;
    assertReconciles(doc);

    const cols = Object.keys(invoice);
    await conn.execute(`INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => invoice[c]));
    await conn.commit();
    return { ...doc, already_issued: false };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
};

/** The issued invoice document for an order, or null. `storeId` enforces isolation. */
const getInvoiceByOrderId = async (orderId, { storeId = null } = {}) => {
  const order = await loadOrderForInvoice(pool, orderId, storeId, false);
  const [inv] = await pool.execute('SELECT * FROM invoices WHERE order_id = ? LIMIT 1', [order.id]);
  if (!inv || !inv.length) return null;
  const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]);
  return buildInvoiceDocument({ invoice: inv[0], order, items });
};

/** Accepts a numeric id or an order number; returns the numeric id (store-scoped when storeId is given) or null. */
const resolveOrderId = async (ref, storeId = null) => {
  const text = String(ref === undefined || ref === null ? '' : ref).trim();
  if (!text) return null;
  const byNumber = !/^\d+$/.test(text);
  const [rows] = await pool.execute(
    `SELECT id, store_id FROM orders WHERE ${byNumber ? 'order_number' : 'id'} = ? LIMIT 1`, [byNumber ? text : parseInt(text, 10)]);
  const row = rows && rows[0];
  if (!row || (storeId && parseInt(row.store_id, 10) !== parseInt(storeId, 10))) return null;
  return row.id;
};

module.exports = { resolveOrderId, formatInvoiceNumber, buildInvoiceDocument, assertReconciles, issueInvoice, getInvoiceByOrderId };
