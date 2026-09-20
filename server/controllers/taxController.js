/**
 * GST administration + invoices.
 *   GET  /api/admin/tax-profile           resolved tax profile of the ACTIVE store (+ what is still missing)
 *   GET  /api/admin/legal-supplier        the one registered entity shared by both stores
 *   PUT  /api/admin/legal-supplier        create/update it (validated: GSTIN format + check digit, state must match)
 *   POST /api/admin/orders/:id/invoice    issue (idempotent) the tax invoice for an order of the active store
 *   GET  /api/admin/orders/:id/invoice    read it
 *   GET  /api/orders/:id/invoice          a customer reads THEIR OWN order's invoice
 */
const { sendSuccess, sendError } = require('../utils/responseHandler');
const taxProfileService = require('../services/taxProfileService');
const invoiceService = require('../services/invoiceService');
const orderService = require('../services/orderService');
const { writeAuditLog } = require('../services/auditService');

const audit = (req, action, entityType, entityId, details) => {
  if (req.user && req.user.uid) {
    writeAuditLog(req.user.uid, req.user.email || null, action, entityType, entityId, details)
      .catch((e) => console.error('[Audit Log Error]', e.message));
  }
};

const getTaxProfileHandler = async (req, res, next) => {
  try {
    const profile = await taxProfileService.getTaxProfile(req.storeId || 1);
    return sendSuccess(res, {
      profile: { ...profile, gstin: profile.gstin },
      readiness: taxProfileService.describeReadiness(profile)
    }, 'Tax profile retrieved successfully');
  } catch (error) { return next(error); }
};

const getLegalSupplierHandler = async (req, res, next) => {
  try {
    const suppliers = await taxProfileService.getLegalSupplier();
    return sendSuccess(res, { supplier: suppliers.length === 1 ? suppliers[0] : null, active_count: suppliers.length }, 'Legal supplier retrieved successfully');
  } catch (error) { return next(error); }
};

const saveLegalSupplierHandler = async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') return sendError(res, 'Legal supplier payload is required.', 400);
    const saved = await taxProfileService.saveLegalSupplier(req.body);
    // GSTIN / legal name are legally significant: record who changed them (values, not just the fact)
    audit(req, 'legal_supplier.saved', 'legal_suppliers', saved.id, { gstin: saved.gstin, legal_name: saved.legal_name, state_code: saved.state_code });
    return sendSuccess(res, { supplier: saved }, 'Legal supplier saved successfully');
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 409) return sendError(res, error.message, error.statusCode);
    return next(error);
  }
};

const issueInvoiceHandler = async (req, res, next) => {
  try {
    const orderId = await invoiceService.resolveOrderId(req.params.id, req.storeId);
    if (!orderId) return sendError(res, 'Order not found.', 404);
    const invoice = await invoiceService.issueInvoice(orderId, { issuedBy: (req.user && (req.user.email || req.user.uid)) || null, storeId: req.storeId });
    if (!invoice.already_issued) audit(req, 'invoice.issued', 'invoices', invoice.invoice_number, { order_id: orderId, total_value: invoice.totals.total_value });
    return sendSuccess(res, invoice, invoice.already_issued ? 'Invoice already issued' : 'Invoice issued successfully', invoice.already_issued ? 200 : 201);
  } catch (error) {
    if ([400, 404, 409].includes(error.statusCode)) return sendError(res, error.message, error.statusCode);
    return next(error);
  }
};

const getInvoiceHandler = async (req, res, next) => {
  try {
    const orderId = await invoiceService.resolveOrderId(req.params.id, req.storeId);
    if (!orderId) return sendError(res, 'Order not found.', 404);
    const invoice = await invoiceService.getInvoiceByOrderId(orderId, { storeId: req.storeId });
    if (!invoice) return sendError(res, 'No invoice has been issued for this order yet.', 404);
    return sendSuccess(res, invoice, 'Invoice retrieved successfully');
  } catch (error) {
    if (error.statusCode === 404) return sendError(res, error.message, 404);
    return next(error);
  }
};

const getCustomerInvoiceHandler = async (req, res, next) => {
  try {
    if (!req.user || !req.user.uid) return sendError(res, 'Authentication required.', 401);
    const order = await orderService.getCustomerOrderById(req.params.id, req.user.uid); // ownership check
    if (!order) return sendError(res, 'Order not found or access denied.', 404);
    const invoice = await invoiceService.getInvoiceByOrderId(order.id);
    if (!invoice) return sendError(res, 'An invoice has not been issued for this order yet.', 404);
    return sendSuccess(res, invoice, 'Invoice retrieved successfully');
  } catch (error) { return next(error); }
};

module.exports = { getTaxProfileHandler, getLegalSupplierHandler, saveLegalSupplierHandler, issueInvoiceHandler, getInvoiceHandler, getCustomerInvoiceHandler };
