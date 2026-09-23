const finishingService = require('../services/finishingService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const getFinishingOptionsHandler = async (req, res, next) => {
  try {
    const { activeOnly } = req.query;
    const storeId = req.storeId || 2;
    const options = await finishingService.getFinishingOptions({
      storeId,
      activeOnly: activeOnly === 'true' || activeOnly === 1
    });
    return sendSuccess(res, options, 'Finishing options retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const getFinishingOptionByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const option = await finishingService.getFinishingOptionById(id, req.storeId || 2);
    if (!option) {
      return sendError(res, `Finishing option #${id} not found`, 404);
    }
    return sendSuccess(res, option, 'Finishing option retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const createFinishingOptionHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 2;
    const option = await finishingService.createFinishingOption({
      ...req.body,
      store_id: storeId
    });

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'CREATE_FINISHING_OPTION',
      entity: 'finishing_options',
      entityId: String(option.id),
      details: { name: option.name, price_modifier: option.price_modifier },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, option, 'Finishing option created successfully', 201);
  } catch (error) {
    return next(error);
  }
};

const updateFinishingOptionHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await finishingService.updateFinishingOption(id, req.body, req.storeId || 2);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'UPDATE_FINISHING_OPTION',
      entity: 'finishing_options',
      entityId: String(id),
      details: req.body,
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, updated, 'Finishing option updated successfully');
  } catch (error) {
    return next(error);
  }
};

const deleteFinishingOptionHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const success = await finishingService.deleteFinishingOption(id, req.storeId || 2);
    if (!success) {
      return sendError(res, `Finishing option #${id} not found`, 404);
    }

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'DEACTIVATE_FINISHING_OPTION',
      entity: 'finishing_options',
      entityId: String(id),
      details: { active: 0 },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, { id, deactivated: true }, 'Finishing option deactivated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getFinishingOptionsHandler,
  getFinishingOptionByIdHandler,
  createFinishingOptionHandler,
  updateFinishingOptionHandler,
  deleteFinishingOptionHandler
};
