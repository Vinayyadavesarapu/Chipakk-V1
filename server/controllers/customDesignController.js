const path = require('path');
const fs = require('fs');
const customDesignService = require('../services/customDesignService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Custom Artwork Designs for an Order Item Handler
 * GET /api/admin/custom-designs/items/:orderItemId
 */
const getCustomDesignsByOrderItemHandler = async (req, res, next) => {
  try {
    const { orderItemId } = req.params;

    const numOrderItemId = parseInt(orderItemId, 10);
    if (isNaN(numOrderItemId)) {
      return sendError(res, 'Invalid order item ID format. Expected numeric BIGINT ID.', 400);
    }

    const result = await customDesignService.getCustomDesignsByOrderItemId(numOrderItemId);

    if (!result.orderItemExists) {
      return sendError(res, `Order item '${orderItemId}' not found`, 404);
    }

    return sendSuccess(res, result.designs, 'Custom artwork designs retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Upload Custom Artwork Design File & Store Metadata Handler
 * POST /api/admin/custom-designs/items/:orderItemId
 */
const uploadCustomDesignHandler = async (req, res, next) => {
  try {
    const { orderItemId } = req.params;
    const { file_role } = req.body;

    const numOrderItemId = parseInt(orderItemId, 10);
    if (isNaN(numOrderItemId)) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return sendError(res, 'Invalid order item ID format. Expected numeric BIGINT ID.', 400);
    }

    const rawRole = String(file_role || 'original_upload').trim().toLowerCase();
    if (!customDesignService.ALLOWED_FILE_ROLES.includes(rawRole)) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return sendError(
        res,
        `Invalid file role. Allowed values: ${customDesignService.ALLOWED_FILE_ROLES.join(', ')}`,
        400
      );
    }

    if (!req.file) {
      return sendError(res, 'Artwork image file is required.', 400);
    }

    // Check if order item exists before saving record
    const checkResult = await customDesignService.getCustomDesignsByOrderItemId(numOrderItemId);
    if (!checkResult.orderItemExists) {
      if (fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return sendError(res, `Order item '${orderItemId}' not found`, 404);
    }

    let createdDesign;
    try {
      createdDesign = await customDesignService.createCustomDesign({
        order_item_id: numOrderItemId,
        file_role: rawRole,
        storage_path: `uploads/${req.file.filename}`,
        image_url: `/uploads/${req.file.filename}`,
        original_filename: path.basename(req.file.originalname),
        file_type: req.file.mimetype,
        file_size_bytes: req.file.size
      });
    } catch (dbErr) {
      if (fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      throw dbErr;
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'custom_design.uploaded',
        'order_item_custom_design',
        createdDesign.id,
        {
          design_id: createdDesign.id,
          order_item_id: numOrderItemId,
          file_role: rawRole,
          file_type: req.file.mimetype,
          file_size_bytes: req.file.size
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, createdDesign, 'Custom artwork design uploaded successfully', 201);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    return next(error);
  }
};

/**
 * Verify Custom Artwork Design Status Handler
 * PUT /api/admin/custom-designs/:designId/verify
 */
const verifyCustomDesignHandler = async (req, res, next) => {
  try {
    const { designId } = req.params;
    const { verification_status, verification_notes } = req.body;

    const numDesignId = parseInt(designId, 10);
    if (isNaN(numDesignId)) {
      return sendError(res, 'Invalid custom design ID format. Expected numeric BIGINT ID.', 400);
    }

    if (!verification_status || typeof verification_status !== 'string' || !verification_status.trim()) {
      return sendError(res, 'Verification status is required.', 400);
    }

    const rawStatus = verification_status.trim().toUpperCase();
    if (!customDesignService.ALLOWED_VERIFICATION_STATUSES.includes(rawStatus)) {
      return sendError(
        res,
        `Invalid verification status. Allowed values: ${customDesignService.ALLOWED_VERIFICATION_STATUSES.join(', ')}`,
        400
      );
    }

    const existingDesign = await customDesignService.getCustomDesignById(numDesignId);
    if (!existingDesign) {
      return sendError(res, `Custom design record with ID ${designId} not found`, 404);
    }

    const previousStatus = existingDesign.verification_status;
    const adminUid = req.user ? req.user.uid : null;

    const updatedDesign = await customDesignService.verifyCustomDesign(numDesignId, {
      verification_status: rawStatus,
      verification_notes,
      admin_id: adminUid
    });

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'custom_design.verified',
        'order_item_custom_design',
        numDesignId,
        {
          design_id: numDesignId,
          order_item_id: existingDesign.order_item_id,
          previous_verification_status: previousStatus,
          new_verification_status: updatedDesign.verification_status,
          verification_notes: updatedDesign.verification_notes || null
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedDesign, 'Custom artwork verification status updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Download / View Protected Private Custom Artwork File (Admin Only)
 * GET /api/admin/custom-designs/file/:filename
 */
const downloadCustomDesignFileHandler = async (req, res, next) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);

    if (!safeFilename.startsWith('custom-artwork-')) {
      return sendError(res, 'Invalid custom design filename format.', 400);
    }

    const filePath = path.join(__dirname, '..', 'uploads', safeFilename);

    if (!fs.existsSync(filePath)) {
      return sendError(res, `Custom artwork file '${safeFilename}' not found`, 404);
    }

    return res.sendFile(filePath);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCustomDesignsByOrderItemHandler,
  uploadCustomDesignHandler,
  verifyCustomDesignHandler,
  downloadCustomDesignFileHandler
};
