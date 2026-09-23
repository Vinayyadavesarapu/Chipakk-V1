-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 018: CHIPAKK Production-Material Inventory System & Stock Movements
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS MODEL
--   Tracks raw physical materials used in CHIPAKK (Store ID 1) sticker manufacturing
--   (vinyl, matte paper, glossy paper, transparent film, lamination, packaging boxes/bags).
--   Reuses existing `materials` table by adding SKU, reorder_quantity, supplier.
--   Adds immutable `material_stock_movements` table to record every inventory change
--   (PURCHASE, CONSUMPTION, WASTE, ADJUSTMENT, RETURN).
--
-- SAFETY GUARANTEES
--   1. Reuses existing `materials` table with zero destruction of Store 2 (Marshans) data.
--   2. Purely additive DDL with idempotent INFORMATION_SCHEMA guards.
--   3. Does NOT alter finished goods retail product variants / inventory tables.
-- =============================================================================

USE `u781826529_chipakk`;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. EXTEND `materials` TABLE FOR PRODUCTION MATERIAL TRACKING
-- -----------------------------------------------------------------------------

-- Add `sku` column
SET @has_sku := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'sku'
);
SET @sql := IF(@has_sku = 0,
  'ALTER TABLE `materials` ADD COLUMN `sku` VARCHAR(100) DEFAULT NULL COMMENT "Material SKU / Code" AFTER `name`',
  'SELECT "materials.sku: column already exists" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add `reorder_quantity` column
SET @has_reorder := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'reorder_quantity'
);
SET @sql := IF(@has_reorder = 0,
  'ALTER TABLE `materials` ADD COLUMN `reorder_quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT "Suggested reorder quantity when low" AFTER `safety_stock`',
  'SELECT "materials.reorder_quantity: column already exists" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add `supplier` column
SET @has_supplier := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'supplier'
);
SET @sql := IF(@has_supplier = 0,
  'ALTER TABLE `materials` ADD COLUMN `supplier` VARCHAR(255) DEFAULT NULL COMMENT "Primary raw material supplier / vendor" AFTER `reorder_quantity`',
  'SELECT "materials.supplier: column already exists" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Modify `color` to allow NULL (so sticker materials without color requirements are not forced to specify filament colors)
SET @is_color_nullable := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'color' AND IS_NULLABLE = 'YES'
);
SET @sql := IF(@is_color_nullable = 0,
  'ALTER TABLE `materials` MODIFY COLUMN `color` VARCHAR(100) DEFAULT NULL COMMENT "Color name (optional for sticker media)"',
  'SELECT "materials.color: already nullable" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add UNIQUE index on (store_id, sku)
SET @has_sku_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND INDEX_NAME = 'uk_materials_store_sku'
);
SET @sql := IF(@has_sku_idx = 0,
  'ALTER TABLE `materials` ADD UNIQUE KEY `uk_materials_store_sku` (`store_id`, `sku`)',
  'SELECT "materials: uk_materials_store_sku already exists" AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2. CREATE `material_stock_movements` AUDIT TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `material_stock_movements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `material_id` BIGINT NOT NULL,
  `store_id` BIGINT NOT NULL,
  `type` ENUM('PURCHASE', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'RETURN') NOT NULL COMMENT 'Movement reason',
  `quantity` DECIMAL(12, 2) NOT NULL COMMENT 'Movement quantity (always positive absolute number)',
  `previous_stock` DECIMAL(12, 2) NOT NULL COMMENT 'Stock balance before movement',
  `resulting_stock` DECIMAL(12, 2) NOT NULL COMMENT 'Stock balance after movement',
  `cost_per_unit` BIGINT DEFAULT NULL COMMENT 'Cost per unit in paise at time of movement',
  `reference_id` VARCHAR(100) DEFAULT NULL COMMENT 'PO number, Batch ID, or Production Job ID',
  `notes` TEXT DEFAULT NULL COMMENT 'Operational details or reason for adjustment',
  `created_by` VARCHAR(100) DEFAULT NULL COMMENT 'Admin UID or operator email',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_msm_material` (`material_id`, `created_at`),
  KEY `idx_msm_store` (`store_id`, `created_at`),
  KEY `idx_msm_type` (`type`),
  CONSTRAINT `fk_msm_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_msm_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. SEED DEFAULT CHIPAKK PRODUCTION MATERIALS (Store ID 1)
-- -----------------------------------------------------------------------------
INSERT INTO `materials` (
  `store_id`, `name`, `sku`, `type`, `color`, `stock`, `unit`, `cost`, `safety_stock`, `reorder_quantity`, `supplier`, `active`
) VALUES
  (1, 'Premium Glossy Vinyl Roll', 'CHP-MAT-VINYL-GLOSS', 'Vinyl', 'White', 250.00, 'meters', 12000, 50.00, 100.00, 'Avery Dennison', 1),
  (1, 'Matte Finish Vinyl Sheets (A4)', 'CHP-MAT-VINYL-MATTE', 'Paper', 'White', 500.00, 'sheets', 4500, 100.00, 250.00, 'Oracle Graphics', 1),
  (1, 'Transparent Ultra-Clear Vinyl Film', 'CHP-MAT-VINYL-TRANS', 'Vinyl', 'Clear', 150.00, 'meters', 15000, 30.00, 50.00, '3M Commercial', 1),
  (1, 'Thermal UV Protective Lamination Roll', 'CHP-MAT-LAM-THERM', 'Lamination', 'Clear', 300.00, 'meters', 8500, 60.00, 100.00, 'GBC Lamination', 1),
  (1, 'Rigid Stay-Flat Shipping Envelopes', 'CHP-MAT-PKG-ENV', 'Packaging', 'Kraft', 1200.00, 'units', 1200, 200.00, 500.00, 'Packman Packaging', 1),
  (1, 'Eco Glassine Protective Packaging Bags', 'CHP-MAT-PKG-BAG', 'Packaging', 'Translucent', 2000.00, 'units', 350, 400.00, 1000.00, 'EcoCraft Packaging', 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `type` = VALUES(`type`),
  `unit` = VALUES(`unit`),
  `supplier` = VALUES(`supplier`);

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;
