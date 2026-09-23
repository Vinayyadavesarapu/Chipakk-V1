const customRequestService = require('../services/customRequestService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const getCustomRequestsHandler = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const storeId = req.storeId || 2;
    const requests = await customRequestService.getCustomRequests({
      storeId,
      status,
      search
    });
    return sendSuccess(res, requests, 'Custom requests retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const getCustomRequestByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await customRequestService.getCustomRequestById(id, req.storeId || 2);
    if (!request) {
      return sendError(res, `Custom request #${id} not found`, 404);
    }
    return sendSuccess(res, request, 'Custom request retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const createCustomRequestHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 2;
    const request = await customRequestService.createCustomRequest({
      ...req.body,
      store_id: storeId
    });
    return sendSuccess(res, request, 'Custom request submitted successfully', 201);
  } catch (error) {
    return next(error);
  }
};

const updateCustomRequestStatusHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    if (!status) {
      return sendError(res, 'Target status is required', 400);
    }
    const updated = await customRequestService.updateCustomRequestStatus(id, status, admin_notes, req.storeId || 2);
    return sendSuccess(res, updated, `Custom request updated to status '${status}'`);
  } catch (error) {
    return next(error);
  }
};

const setCustomRequestQuoteHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { quote_amount, quote_lead_days, admin_notes } = req.body;
    const updated = await customRequestService.setCustomRequestQuote(id, {
      quote_amount,
      quote_lead_days,
      admin_notes
    }, req.storeId || 2);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'SET_CUSTOM_QUOTE',
      entity: 'custom_3d_requests',
      entityId: String(id),
      details: { quote_amount, quote_lead_days },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, updated, 'Quotation sent successfully');
  } catch (error) {
    return next(error);
  }
};

const convertCustomRequestToOrderHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await customRequestService.convertCustomRequestToOrder(id, req.storeId || 2);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'CONVERT_CUSTOM_TO_ORDER',
      entity: 'custom_3d_requests',
      entityId: String(id),
      details: { production_job_id: result.production_job?.id },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, result, 'Custom request converted to order and job dispatched');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCustomRequestsHandler,
  getCustomRequestByIdHandler,
  createCustomRequestHandler,
  updateCustomRequestStatusHandler,
  setCustomRequestQuoteHandler,
  convertCustomRequestToOrderHandler
};
