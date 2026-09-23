const productionJobService = require('../services/productionJobService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const getProductionJobsHandler = async (req, res, next) => {
  try {
    const { stage, search } = req.query;
    const storeId = req.storeId || 2;
    const jobs = await productionJobService.getProductionJobs({
      storeId,
      stage,
      search
    });
    return sendSuccess(res, jobs, 'Production jobs retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const getProductionJobByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const job = await productionJobService.getProductionJobById(id, req.storeId || 2);
    if (!job) {
      return sendError(res, `Production job #${id} not found`, 404);
    }
    return sendSuccess(res, job, 'Production job retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

const createProductionJobHandler = async (req, res, next) => {
  try {
    const storeId = req.storeId || 2;
    const job = await productionJobService.createProductionJob({
      ...req.body,
      store_id: storeId
    });

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'CREATE_PRODUCTION_JOB',
      entity: 'production_jobs',
      entityId: String(job.id),
      details: { job_number: job.job_number, product_name: job.product_name },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, job, 'Production job created successfully', 201);
  } catch (error) {
    return next(error);
  }
};

const updateProductionJobStageHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stage, stage_notes } = req.body;
    if (!stage) {
      return sendError(res, 'Target stage is required', 400);
    }

    const updated = await productionJobService.updateProductionJobStage(id, stage, stage_notes, req.storeId || 2);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'UPDATE_JOB_STAGE',
      entity: 'production_jobs',
      entityId: String(id),
      details: { stage, stage_notes },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, updated, `Job #${id} updated to stage '${stage}'`);
  } catch (error) {
    return next(error);
  }
};

const advanceProductionJobStageHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await productionJobService.advanceProductionJobStage(id, req.storeId || 2);

    writeAuditLog({
      actorId: req.user?.uid || 'admin',
      action: 'ADVANCE_JOB_STAGE',
      entity: 'production_jobs',
      entityId: String(id),
      details: { stage: updated.stage },
      ipAddress: req.ip
    }).catch(() => {});

    return sendSuccess(res, updated, `Job advanced to stage '${updated.stage}'`);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getProductionJobsHandler,
  getProductionJobByIdHandler,
  createProductionJobHandler,
  updateProductionJobStageHandler,
  advanceProductionJobStageHandler
};
