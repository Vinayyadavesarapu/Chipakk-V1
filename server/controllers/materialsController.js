const materialsService = require('../services/materialsService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const getMaterialsHandler = async (req, res, next) => {
  try {
    const { activeOnly, search } = req.query;
    const storeId = req.storeId || 2;
    const materials = await materialsService.getMaterials({
      storeId,
      activeOnly: activeOnly === 'true' || activeOnly === 1,
      search
    });
    return sendSuccess(res, materials, 'Materials retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const getMaterialByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const material = await materialsService.getMaterialById(id);
    if (!material) {
      return sendError(res, `Material #${id} not found`, 404);
    }
    return sendSuccess(res, material, 'Material retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const createMaterialHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 2;
    const material = await materialsService.createMaterial({
      ...req.body,
      store_id: storeId
    });

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'CREATE_MATERIAL',
      entity: 'materials',
      entityId: String(material.id),
      details: { name: material.name, type: material.type, store_id: storeId },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, material, 'Material created successfully', 201);
  } catch (error) {
    return next(error);
  }
};

const updateMaterialHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await materialsService.updateMaterial(id, req.body);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'UPDATE_MATERIAL',
      entity: 'materials',
      entityId: String(id),
      details: req.body,
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, updated, 'Material updated successfully');
  } catch (error) {
    return next(error);
  }
};

const adjustStockHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { delta } = req.body;
    if (delta === undefined || isNaN(Number(delta))) {
      return sendError(res, 'Numeric stock delta is required', 400);
    }
    const updated = await materialsService.adjustStock(id, delta);
    return sendSuccess(res, updated, 'Material stock adjusted successfully');
  } catch (error) {
    return next(error);
  }
};

const deleteMaterialHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    await materialsService.deleteMaterial(id);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'DELETE_MATERIAL',
      entity: 'materials',
      entityId: String(id),
      details: {},
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, { id }, 'Material deleted successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getMaterialsHandler,
  getMaterialByIdHandler,
  createMaterialHandler,
  updateMaterialHandler,
  adjustStockHandler,
  deleteMaterialHandler
};
