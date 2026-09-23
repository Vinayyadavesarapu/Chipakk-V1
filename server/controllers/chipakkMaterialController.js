const chipakkMaterialService = require('../services/chipakkMaterialInventoryService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Resolves effective storeId and verifies Store 1 authorization
 */
const verifyChipakkStore = (req, res) => {
  let storeId = 1;
  if (req.storeId) {
    storeId = parseInt(req.storeId, 10);
  } else if (req.headers['x-store-id'] || req.headers['x-store']) {
    storeId = parseInt(req.headers['x-store-id'] || req.headers['x-store'], 10);
  } else if (req.query && (req.query.store_id || req.query.store)) {
    const q = String(req.query.store_id || req.query.store).toLowerCase();
    if (q === '2' || q === 'marshans' || q === 'themarshans') storeId = 2;
  }

  if (storeId !== 1) {
    sendError(res, 'Access denied: CHIPAKK production material inventory is restricted to Store 1 (CHIPAKK)', 403);
    return false;
  }
  return true;
};

/**
 * GET /api/admin/production-inventory/materials
 * List materials with search and filters
 */
const getMaterialsHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const { search, type, activeOnly, lowStockOnly } = req.query;
    const materials = await chipakkMaterialService.listMaterials({
      search,
      type,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
      lowStockOnly: lowStockOnly === 'true' || lowStockOnly === '1'
    });

    return sendSuccess(res, materials, 'CHIPAKK production materials retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/production-inventory/materials/:id
 * Get single material by ID
 */
const getMaterialByIdHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return sendError(res, 'Invalid material ID', 400);
    }

    const material = await chipakkMaterialService.getMaterialById(id);
    if (!material) {
      return sendError(res, `Material ${id} not found in CHIPAKK`, 404);
    }

    return sendSuccess(res, material, 'Material retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/production-inventory/materials
 * Create a new material
 */
const createMaterialHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const adminUid = req.user?.uid || req.user?.id || 'admin';
    const material = await chipakkMaterialService.createMaterial(req.body, adminUid);

    await writeAuditLog({
      action: 'CHIPAKK_MATERIAL_CREATED',
      actor_id: adminUid,
      store_id: 1,
      target_type: 'material',
      target_id: material.id,
      details: {
        name: material.name,
        sku: material.sku,
        type: material.type,
        stock: material.stock,
        unit: material.unit
      }
    }).catch(err => console.warn('[Audit Log Warning]', err.message));

    return sendSuccess(res, material, 'Production material created successfully', 201);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    next(error);
  }
};

/**
 * PUT /api/admin/production-inventory/materials/:id
 * Update material metadata
 */
const updateMaterialHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return sendError(res, 'Invalid material ID', 400);
    }

    const adminUid = req.user?.uid || req.user?.id || 'admin';
    const material = await chipakkMaterialService.updateMaterial(id, req.body, adminUid);

    await writeAuditLog({
      action: 'CHIPAKK_MATERIAL_UPDATED',
      actor_id: adminUid,
      store_id: 1,
      target_type: 'material',
      target_id: material.id,
      details: {
        name: material.name,
        sku: material.sku,
        type: material.type
      }
    }).catch(err => console.warn('[Audit Log Warning]', err.message));

    return sendSuccess(res, material, 'Production material updated successfully');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    next(error);
  }
};

/**
 * DELETE /api/admin/production-inventory/materials/:id
 * Deactivate (soft-delete) material
 */
const deleteMaterialHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return sendError(res, 'Invalid material ID', 400);
    }

    const adminUid = req.user?.uid || req.user?.id || 'admin';
    const material = await chipakkMaterialService.setMaterialActive(id, false);

    await writeAuditLog({
      action: 'CHIPAKK_MATERIAL_DEACTIVATED',
      actor_id: adminUid,
      store_id: 1,
      target_type: 'material',
      target_id: material.id,
      details: { name: material.name, sku: material.sku }
    }).catch(err => console.warn('[Audit Log Warning]', err.message));

    return sendSuccess(res, material, 'Production material deactivated successfully');
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    next(error);
  }
};

/**
 * POST /api/admin/production-inventory/movements
 * Record a stock movement (PURCHASE, CONSUMPTION, WASTE, ADJUSTMENT, RETURN)
 */
const recordStockMovementHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const { materialId, material_id, type, quantity, direction, costPerUnit, cost_per_unit, referenceId, reference_id, notes } = req.body;
    const effectiveMaterialId = parseInt(materialId || material_id, 10);

    if (!effectiveMaterialId || isNaN(effectiveMaterialId)) {
      return sendError(res, 'A valid materialId is required', 400);
    }

    const adminUid = req.user?.uid || req.user?.id || req.user?.email || 'admin';

    const result = await chipakkMaterialService.recordStockMovement({
      materialId: effectiveMaterialId,
      type,
      quantity,
      direction,
      costPerUnit: costPerUnit !== undefined ? costPerUnit : cost_per_unit,
      referenceId: referenceId || reference_id,
      notes,
      createdBy: adminUid
    });

    await writeAuditLog({
      action: `CHIPAKK_MATERIAL_STOCK_${type.toUpperCase()}`,
      actor_id: adminUid,
      store_id: 1,
      target_type: 'material_stock_movement',
      target_id: result.movement_id,
      details: {
        material_id: effectiveMaterialId,
        type,
        quantity,
        previous_stock: result.movement.previous_stock,
        resulting_stock: result.movement.resulting_stock
      }
    }).catch(err => console.warn('[Audit Log Warning]', err.message));

    return sendSuccess(res, result, `Stock movement "${type}" recorded successfully`, 201);
  } catch (error) {
    if (error.statusCode) {
      return sendError(res, error.message, error.statusCode);
    }
    next(error);
  }
};

/**
 * GET /api/admin/production-inventory/movements
 * Fetch stock movement history
 */
const getStockMovementsHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const { materialId, material_id, type, limit, offset } = req.query;
    const data = await chipakkMaterialService.getStockMovements({
      materialId: materialId || material_id ? parseInt(materialId || material_id, 10) : null,
      type,
      limit,
      offset
    });

    return sendSuccess(res, data, 'Stock movement history retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/production-inventory/low-stock
 * Fetch low stock alerts
 */
const getLowStockAlertsHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const alerts = await chipakkMaterialService.getLowStockAlerts();
    return sendSuccess(res, alerts, 'Low stock alerts retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/production-inventory/types
 * Fetch distinct material types
 */
const getMaterialTypesHandler = async (req, res, next) => {
  try {
    if (!verifyChipakkStore(req, res)) return;

    const types = await chipakkMaterialService.getMaterialTypes();
    return sendSuccess(res, types, 'Material types retrieved successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMaterialsHandler,
  getMaterialByIdHandler,
  createMaterialHandler,
  updateMaterialHandler,
  deleteMaterialHandler,
  recordStockMovementHandler,
  getStockMovementsHandler,
  getLowStockAlertsHandler,
  getMaterialTypesHandler
};
