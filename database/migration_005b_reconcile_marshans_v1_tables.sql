-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 005b: Non-Destructive Reconciliation for MARSHANS V1 Tables
-- Database: u781826529_chipakk
-- Engine: MariaDB 11.8+ / MySQL 8.0+
-- 
-- PURPOSE:
-- Reconciles schema differences between migration_005_multi_store.sql and
-- migration_006_marshans_v1.sql for:
--   1. `materials`
--   2. `production_jobs`
--   3. `custom_3d_requests`
-- 
-- STRICT SAFETY GUARANTEES:
-- - NO DROP TABLE statements.
-- - Purely ALTER TABLE (ADD, MODIFY, CHANGE, RENAME INDEX).
-- - Preserves existing PRIMARY KEYs, AUTO_INCREMENT counters, and Foreign Keys.
-- - Preserves all existing table rows (0% data loss).
-- - 100% idempotent: Safe to execute multiple times without error.
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. RECONCILE `materials` TABLE
-- -----------------------------------------------------------------------------

-- 1.1 Align `material_type` -> `type`
SET @exist_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'type'
);
SET @exist_old_mat_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'material_type'
);

SET @sql := CASE
  WHEN @exist_type = 0 AND @exist_old_mat_type > 0 THEN
    'ALTER TABLE `materials` CHANGE COLUMN `material_type` `type` VARCHAR(100) NOT NULL COMMENT "e.g., PLA, PETG, ABS, Resin, Nylon, TPU, Carbon Fiber";'
  WHEN @exist_type = 0 AND @exist_old_mat_type = 0 THEN
    'ALTER TABLE `materials` ADD COLUMN `type` VARCHAR(100) NOT NULL DEFAULT "PLA" COMMENT "e.g., PLA, PETG, ABS, Resin, Nylon, TPU, Carbon Fiber" AFTER `name`;'
  ELSE
    'SELECT "Column type already exists in materials" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.2 Align `color_name` -> `color`
SET @exist_color := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'color'
);
SET @exist_old_color := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'color_name'
);

SET @sql := CASE
  WHEN @exist_color = 0 AND @exist_old_color > 0 THEN
    'ALTER TABLE `materials` CHANGE COLUMN `color_name` `color` VARCHAR(100) NOT NULL COMMENT "e.g., Matte Black, Signal White, Space Grey";'
  WHEN @exist_color = 0 AND @exist_old_color = 0 THEN
    'ALTER TABLE `materials` ADD COLUMN `color` VARCHAR(100) NOT NULL DEFAULT "Black" AFTER `type`;'
  ELSE
    'SELECT "Column color already exists in materials" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.3 Align `stock_weight_grams` -> `stock`
SET @exist_stock := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'stock'
);
SET @exist_old_stock := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'stock_weight_grams'
);

SET @sql := CASE
  WHEN @exist_stock = 0 AND @exist_old_stock > 0 THEN
    'ALTER TABLE `materials` CHANGE COLUMN `stock_weight_grams` `stock` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT "Current available stock in units";'
  WHEN @exist_stock = 0 AND @exist_old_stock = 0 THEN
    'ALTER TABLE `materials` ADD COLUMN `stock` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `color_hex`;'
  ELSE
    'SELECT "Column stock already exists in materials" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.4 Add `unit` column
SET @exist_unit := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'unit'
);
SET @sql := IF(@exist_unit = 0,
  'ALTER TABLE `materials` ADD COLUMN `unit` VARCHAR(50) NOT NULL DEFAULT "grams" COMMENT "e.g., grams, kg, ml, liters, units" AFTER `stock`;',
  'SELECT "Column unit already exists in materials" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.5 Align `cost_per_gram` -> `cost`
SET @exist_cost := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'cost'
);
SET @exist_old_cost := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'cost_per_gram'
);

SET @sql := CASE
  WHEN @exist_cost = 0 AND @exist_old_cost > 0 THEN
    'ALTER TABLE `materials` CHANGE COLUMN `cost_per_gram` `cost` BIGINT NOT NULL DEFAULT 0 COMMENT "Cost per unit in paise (e.g. 250 paise = ₹2.50)";'
  WHEN @exist_cost = 0 AND @exist_old_cost = 0 THEN
    'ALTER TABLE `materials` ADD COLUMN `cost` BIGINT NOT NULL DEFAULT 0 AFTER `unit`;'
  ELSE
    'SELECT "Column cost already exists in materials" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.6 Align `safety_stock_grams` -> `safety_stock`
SET @exist_safety := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'safety_stock'
);
SET @exist_old_safety := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'safety_stock_grams'
);

SET @sql := CASE
  WHEN @exist_safety = 0 AND @exist_old_safety > 0 THEN
    'ALTER TABLE `materials` CHANGE COLUMN `safety_stock_grams` `safety_stock` DECIMAL(12, 2) NOT NULL DEFAULT 200.00 COMMENT "Low inventory alert threshold";'
  WHEN @exist_safety = 0 AND @exist_old_safety = 0 THEN
    'ALTER TABLE `materials` ADD COLUMN `safety_stock` DECIMAL(12, 2) NOT NULL DEFAULT 200.00 AFTER `cost`;'
  ELSE
    'SELECT "Column safety_stock already exists in materials" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.7 Relax 005 legacy columns `category` and `spool_weight_grams` to NULLABLE
SET @exist_cat := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'category'
);
SET @sql := IF(@exist_cat > 0,
  'ALTER TABLE `materials` MODIFY COLUMN `category` ENUM("filament", "resin", "powder", "packaging", "consumable") NULL DEFAULT NULL;',
  'SELECT "Column category not present in materials" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist_spool := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'spool_weight_grams'
);
SET @sql := IF(@exist_spool > 0,
  'ALTER TABLE `materials` MODIFY COLUMN `spool_weight_grams` INT NULL DEFAULT NULL;',
  'SELECT "Column spool_weight_grams not present in materials" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.8 Ensure index `idx_materials_type`
SET @exist_idx_type := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND INDEX_NAME = 'idx_materials_type'
);
SET @sql := IF(@exist_idx_type = 0,
  'ALTER TABLE `materials` ADD KEY `idx_materials_type` (`type`);',
  'SELECT "Index idx_materials_type already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.9 Ensure index `idx_materials_store_active`
SET @exist_idx_sa := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND INDEX_NAME = 'idx_materials_store_active'
);
SET @sql := IF(@exist_idx_sa = 0,
  'ALTER TABLE `materials` ADD KEY `idx_materials_store_active` (`store_id`, `active`);',
  'SELECT "Index idx_materials_store_active already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- 2. RECONCILE `production_jobs` TABLE
-- -----------------------------------------------------------------------------

-- 2.1 Add `product_name`
SET @exist_pname := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_jobs' AND COLUMN_NAME = 'product_name'
);
SET @sql := IF(@exist_pname = 0,
  'ALTER TABLE `production_jobs` ADD COLUMN `product_name` VARCHAR(255) NOT NULL DEFAULT "" AFTER `custom_request_id`;',
  'SELECT "Column product_name already exists in production_jobs" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.2 Add `material_name`
SET @exist_mname := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_jobs' AND COLUMN_NAME = 'material_name'
);
SET @sql := IF(@exist_mname = 0,
  'ALTER TABLE `production_jobs` ADD COLUMN `material_name` VARCHAR(255) DEFAULT NULL AFTER `product_name`;',
  'SELECT "Column material_name already exists in production_jobs" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.3 Add `finishing_name`
SET @exist_fname := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_jobs' AND COLUMN_NAME = 'finishing_name'
);
SET @sql := IF(@exist_fname = 0,
  'ALTER TABLE `production_jobs` ADD COLUMN `finishing_name` VARCHAR(255) DEFAULT NULL AFTER `material_name`;',
  'SELECT "Column finishing_name already exists in production_jobs" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.4 Add `assigned_operator`
SET @exist_op := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_jobs' AND COLUMN_NAME = 'assigned_operator'
);
SET @sql := IF(@exist_op = 0,
  'ALTER TABLE `production_jobs` ADD COLUMN `assigned_operator` VARCHAR(100) DEFAULT NULL AFTER `stage_notes`;',
  'SELECT "Column assigned_operator already exists in production_jobs" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.5 Reconcile `stage` ENUM (Superset -> Data Map -> V1 Enum)
-- Step A: Expand ENUM to contain all values
ALTER TABLE `production_jobs` MODIFY COLUMN `stage` ENUM(
  'PENDING', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK', 'READY_TO_SHIP',
  'Order Received', 'Preparing', 'Printing', 'Finishing', 'Quality Check', 'Ready', 'Completed'
) NOT NULL DEFAULT 'Order Received';

-- Step B: Map any existing legacy records cleanly
UPDATE `production_jobs` SET `stage` = 'Order Received' WHERE `stage` = 'PENDING';
UPDATE `production_jobs` SET `stage` = 'Printing' WHERE `stage` = 'PRINTING';
UPDATE `production_jobs` SET `stage` = 'Preparing' WHERE `stage` = 'POST_PROCESSING';
UPDATE `production_jobs` SET `stage` = 'Quality Check' WHERE `stage` = 'QUALITY_CHECK';
UPDATE `production_jobs` SET `stage` = 'Ready' WHERE `stage` = 'READY_TO_SHIP';

-- Step C: Lock in V1 ENUM definition
ALTER TABLE `production_jobs` MODIFY COLUMN `stage` ENUM(
  'Order Received', 'Preparing', 'Printing', 'Finishing', 'Quality Check', 'Ready', 'Completed'
) NOT NULL DEFAULT 'Order Received';

-- 2.6 Add index `idx_prod_jobs_store_stage`
SET @exist_idx_stage := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_jobs' AND INDEX_NAME = 'idx_prod_jobs_store_stage'
);
SET @sql := IF(@exist_idx_stage = 0,
  'ALTER TABLE `production_jobs` ADD KEY `idx_prod_jobs_store_stage` (`store_id`, `stage`);',
  'SELECT "Index idx_prod_jobs_store_stage already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- -----------------------------------------------------------------------------
-- 3. RECONCILE `custom_3d_requests` TABLE
-- -----------------------------------------------------------------------------

-- 3.1 Align `original_filename` -> `file_name`
SET @exist_fname := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND COLUMN_NAME = 'file_name'
);
SET @exist_old_fname := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND COLUMN_NAME = 'original_filename'
);

SET @sql := CASE
  WHEN @exist_fname = 0 AND @exist_old_fname > 0 THEN
    'ALTER TABLE `custom_3d_requests` CHANGE COLUMN `original_filename` `file_name` VARCHAR(255) NOT NULL;'
  WHEN @exist_fname = 0 AND @exist_old_fname = 0 THEN
    'ALTER TABLE `custom_3d_requests` ADD COLUMN `file_name` VARCHAR(255) NOT NULL AFTER `file_url`;'
  ELSE
    'SELECT "Column file_name already exists in custom_3d_requests" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.2 Relax `guest_phone` to NULLABLE
ALTER TABLE `custom_3d_requests` MODIFY COLUMN `guest_phone` VARCHAR(50) DEFAULT NULL;

-- 3.3 Relax `storage_path` to NULLABLE (preserves column, allows V1 inserts without storage_path)
SET @exist_spath := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND COLUMN_NAME = 'storage_path'
);
SET @sql := IF(@exist_spath > 0,
  'ALTER TABLE `custom_3d_requests` MODIFY COLUMN `storage_path` VARCHAR(500) NULL DEFAULT NULL;',
  'SELECT "Column storage_path not present in custom_3d_requests" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.4 Widen `preferred_material` to VARCHAR(100)
ALTER TABLE `custom_3d_requests` MODIFY COLUMN `preferred_material` VARCHAR(100) DEFAULT NULL;

-- 3.5 Add `preferred_finishing`
SET @exist_pfinish := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND COLUMN_NAME = 'preferred_finishing'
);
SET @sql := IF(@exist_pfinish = 0,
  'ALTER TABLE `custom_3d_requests` ADD COLUMN `preferred_finishing` VARCHAR(100) DEFAULT NULL AFTER `preferred_material`;',
  'SELECT "Column preferred_finishing already exists in custom_3d_requests" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.6 Add `quote_lead_days`
SET @exist_qld := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND COLUMN_NAME = 'quote_lead_days'
);
SET @sql := IF(@exist_qld = 0,
  'ALTER TABLE `custom_3d_requests` ADD COLUMN `quote_lead_days` INT DEFAULT NULL AFTER `quote_amount`;',
  'SELECT "Column quote_lead_days already exists in custom_3d_requests" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.7 Reconcile `status` ENUM (Superset -> Data Map -> V1 Enum)
-- Step A: Expand ENUM to contain all values
ALTER TABLE `custom_3d_requests` MODIFY COLUMN `status` ENUM(
  'submitted', 'analyzing', 'quoted', 'approved', 'rejected', 'ordered',
  'Upload', 'Review', 'Quotation', 'Approval', 'Order', 'Rejected'
) NOT NULL DEFAULT 'Upload';

-- Step B: Map any existing legacy records cleanly
UPDATE `custom_3d_requests` SET `status` = 'Upload' WHERE `status` = 'submitted';
UPDATE `custom_3d_requests` SET `status` = 'Review' WHERE `status` = 'analyzing';
UPDATE `custom_3d_requests` SET `status` = 'Quotation' WHERE `status` = 'quoted';
UPDATE `custom_3d_requests` SET `status` = 'Approval' WHERE `status` = 'approved';
UPDATE `custom_3d_requests` SET `status` = 'Order' WHERE `status` = 'ordered';
UPDATE `custom_3d_requests` SET `status` = 'Rejected' WHERE `status` = 'rejected';

-- Step C: Lock in V1 ENUM definition
ALTER TABLE `custom_3d_requests` MODIFY COLUMN `status` ENUM(
  'Upload', 'Review', 'Quotation', 'Approval', 'Order', 'Rejected'
) NOT NULL DEFAULT 'Upload';

-- 3.8 Ensure unique key `uk_custom_requests_num`
SET @exist_uk_new := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND INDEX_NAME = 'uk_custom_requests_num'
);
SET @exist_uk_old := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND INDEX_NAME = 'uk_custom_3d_requests_num'
);

SET @sql := CASE
  WHEN @exist_uk_new = 0 AND @exist_uk_old > 0 THEN
    'ALTER TABLE `custom_3d_requests` RENAME INDEX `uk_custom_3d_requests_num` TO `uk_custom_requests_num`;'
  WHEN @exist_uk_new = 0 AND @exist_uk_old = 0 THEN
    'ALTER TABLE `custom_3d_requests` ADD UNIQUE KEY `uk_custom_requests_num` (`request_number`);'
  ELSE
    'SELECT "Unique key uk_custom_requests_num already exists" AS msg;'
END;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.9 Ensure index `idx_custom_requests_store_status`
SET @exist_idx_status := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_3d_requests' AND INDEX_NAME = 'idx_custom_requests_store_status'
);
SET @sql := IF(@exist_idx_status = 0,
  'ALTER TABLE `custom_3d_requests` ADD KEY `idx_custom_requests_store_status` (`store_id`, `status`);',
  'SELECT "Index idx_custom_requests_store_status already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 005b (Non-Destructive Reconciliation) Completed Successfully
-- =============================================================================
