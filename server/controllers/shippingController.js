const shippingService = require('../services/shippingService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Shipping Rules List Handler
 * GET /api/admin/shipping-rules
 */
const getShippingRulesHandler = async (req, res, next) => {
  try {
    const { is_enabled, limit, offset } = req.query;

    const result = await shippingService.getShippingRules({
      is_enabled,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Shipping rules retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Get Shipping Rule by ID Handler
 * GET /api/admin/shipping-rules/:id
 */
const getShippingRuleByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid shipping rule ID format. Expected numeric BIGINT ID.', 400);
    }

    const rule = await shippingService.getShippingRuleById(numId);

    if (!rule) {
      return sendError(res, `Shipping rule '${id}' not found`, 404);
    }

    return sendSuccess(res, rule, 'Shipping rule retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create Shipping Rule Handler
 * POST /api/admin/shipping-rules
 */
const createShippingRuleHandler = async (req, res, next) => {
  try {
    const ruleData = req.body;

    if (ruleData.free_shipping_threshold !== undefined && isNaN(Number(ruleData.free_shipping_threshold))) {
      return sendError(res, 'Free shipping threshold must be a valid numeric integer in paise.', 400);
    }

    if (ruleData.standard_fee !== undefined && isNaN(Number(ruleData.standard_fee))) {
      return sendError(res, 'Standard fee must be a valid numeric integer in paise.', 400);
    }

    const rule = await shippingService.createShippingRule(ruleData);

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'shipping_rule.created',
        'shipping_rule',
        rule.id,
        {
          name: rule.name,
          standard_fee: rule.standard_fee,
          free_shipping_threshold: rule.free_shipping_threshold,
          is_enabled: rule.is_enabled
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, rule, 'Shipping rule created successfully', 201);
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Shipping Rule Handler
 * PUT /api/admin/shipping-rules/:id
 */
const updateShippingRuleHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ruleData = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid shipping rule ID format. Expected numeric BIGINT ID.', 400);
    }

    const updatedRule = await shippingService.updateShippingRule(numId, ruleData);

    if (!updatedRule) {
      return sendError(res, `Shipping rule with ID ${id} not found`, 404);
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'shipping_rule.updated',
        'shipping_rule',
        numId,
        {
          name: updatedRule.name,
          standard_fee: updatedRule.standard_fee,
          free_shipping_threshold: updatedRule.free_shipping_threshold,
          is_enabled: updatedRule.is_enabled
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedRule, 'Shipping rule updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Delete / Deactivate Shipping Rule Handler
 * DELETE /api/admin/shipping-rules/:id
 */
const deleteShippingRuleHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid shipping rule ID format. Expected numeric BIGINT ID.', 400);
    }

    const success = await shippingService.deleteShippingRule(numId);

    if (!success) {
      return sendError(res, `Shipping rule with ID ${id} not found`, 404);
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'shipping_rule.deactivated',
        'shipping_rule',
        numId,
        { action: 'deactivated', is_enabled: 0 }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, { deactivated: true, id: numId }, 'Shipping rule deactivated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Calculate Shipping Fee Handler
 * POST /api/admin/shipping-rules/calculate
 */
const calculateShippingFeeHandler = async (req, res, next) => {
  try {
    const { subtotal, region, rule_id } = req.body;

    if (subtotal === undefined || isNaN(Number(subtotal)) || Number(subtotal) < 0) {
      return sendError(res, 'Order subtotal is required and must be a non-negative integer in paise.', 400);
    }

    const calculation = await shippingService.calculateShippingFee({
      subtotal,
      region,
      rule_id
    });

    return sendSuccess(res, calculation, 'Shipping fee calculated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getShippingRulesHandler,
  getShippingRuleByIdHandler,
  createShippingRuleHandler,
  updateShippingRuleHandler,
  deleteShippingRuleHandler,
  calculateShippingFeeHandler
};
