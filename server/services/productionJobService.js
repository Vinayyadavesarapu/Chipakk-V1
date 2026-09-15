const { pool } = require('../config/database');

const STAGES = [
  'Order Received',
  'Preparing',
  'Printing',
  'Finishing',
  'Quality Check',
  'Ready',
  'Completed'
];

/**
 * Fetch 3D production jobs
 */
const getProductionJobs = async ({ storeId = 2, stage = null, search = null } = {}) => {
  const conditions = [];
  const params = [];

  if (storeId) {
    conditions.push('pj.store_id = ?');
    params.push(storeId);
  }

  if (stage && stage !== 'ALL') {
    conditions.push('pj.stage = ?');
    params.push(stage);
  }

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push('(pj.job_number LIKE ? OR pj.product_name LIKE ? OR pj.material_name LIKE ?)');
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT 
      pj.id,
      pj.store_id,
      pj.job_number,
      pj.order_id,
      pj.order_item_id,
      pj.custom_request_id,
      pj.product_name,
      pj.material_name,
      pj.finishing_name,
      pj.stage,
      pj.stage_notes,
      pj.assigned_operator,
      pj.started_at,
      pj.completed_at,
      pj.created_at,
      pj.updated_at
    FROM production_jobs pj
    ${whereClause}
    ORDER BY pj.id DESC
  `;

  const [rows] = await pool.execute(query, params);
  return rows;
};

const getProductionJobById = async (id) => {
  const query = `SELECT * FROM production_jobs WHERE id = ?`;
  const [rows] = await pool.execute(query, [id]);
  return rows[0] || null;
};

const createProductionJob = async ({
  store_id = 2,
  order_id = null,
  order_item_id = null,
  custom_request_id = null,
  product_name,
  material_name = 'PLA Matte Black',
  finishing_name = 'Raw Print',
  assigned_operator = 'Tech Team',
  stage_notes = ''
}) => {
  if (!product_name || !product_name.trim()) throw new Error('Product name is required for production job');

  const jobNumber = `JOB-3D-${Date.now().toString().slice(-6)}`;
  const query = `
    INSERT INTO production_jobs
      (store_id, job_number, order_id, order_item_id, custom_request_id, product_name, material_name, finishing_name, stage, stage_notes, assigned_operator)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Order Received', ?, ?)
  `;
  const params = [
    store_id || 2,
    jobNumber,
    order_id || null,
    order_item_id || null,
    custom_request_id || null,
    product_name.trim(),
    material_name || 'Standard PLA',
    finishing_name || 'Raw Print',
    stage_notes || 'New 3D production job initiated',
    assigned_operator || 'Tech Team'
  ];

  const [result] = await pool.execute(query, params);
  return getProductionJobById(result.insertId);
};

const updateProductionJobStage = async (id, stage, stage_notes = null) => {
  if (!STAGES.includes(stage)) {
    throw new Error(`Invalid stage: '${stage}'. Must be one of: ${STAGES.join(', ')}`);
  }

  let updateExtra = '';
  const params = [stage];

  if (stage_notes !== null && stage_notes !== undefined) {
    updateExtra += ', stage_notes = ?';
    params.push(stage_notes);
  }

  if (stage === 'Printing') {
    updateExtra += ', started_at = IFNULL(started_at, NOW())';
  } else if (stage === 'Completed') {
    updateExtra += ', completed_at = NOW()';
  }

  params.push(id);
  const query = `UPDATE production_jobs SET stage = ? ${updateExtra} WHERE id = ?`;
  await pool.execute(query, params);

  return getProductionJobById(id);
};

const advanceProductionJobStage = async (id) => {
  const job = await getProductionJobById(id);
  if (!job) throw new Error(`Job #${id} not found`);

  const currentIndex = STAGES.indexOf(job.stage);
  if (currentIndex === -1 || currentIndex >= STAGES.length - 1) {
    return job; // Already at completed
  }

  const nextStage = STAGES[currentIndex + 1];
  return updateProductionJobStage(id, nextStage, `Advanced to ${nextStage}`);
};

module.exports = {
  STAGES,
  getProductionJobs,
  getProductionJobById,
  createProductionJob,
  updateProductionJobStage,
  advanceProductionJobStage
};
