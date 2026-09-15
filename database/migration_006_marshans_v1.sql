-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 006: THE MARSHANS V1 Business Platform Refinements
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. FLEXIBLE MATERIALS TABLE
-- Supports any material/filament/resin without hardcoded ENUM limitations.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materials` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `name` VARCHAR(255) NOT NULL COMMENT 'e.g., eSUN PLA+ Black, Siraya Tech Fast Navy Grey',
  `type` VARCHAR(100) NOT NULL COMMENT 'e.g., PLA, PETG, ABS, Resin, Nylon, TPU, Carbon Fiber',
  `color` VARCHAR(100) NOT NULL COMMENT 'e.g., Matte Black, Signal White, Space Grey',
  `color_hex` VARCHAR(10) DEFAULT '#000000',
  `stock` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT 'Current available stock in units',
  `unit` VARCHAR(50) NOT NULL DEFAULT 'grams' COMMENT 'e.g., grams, kg, ml, liters, units',
  `cost` BIGINT NOT NULL DEFAULT 0 COMMENT 'Cost per unit in paise (e.g. 250 paise = ₹2.50)',
  `safety_stock` DECIMAL(12, 2) NOT NULL DEFAULT 200.00 COMMENT 'Low inventory alert threshold',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_materials_store_active` (`store_id`, `active`),
  KEY `idx_materials_type` (`type`),
  CONSTRAINT `fk_materials_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Default 3D Printing Materials for Store 2 (THE MARSHANS)
INSERT INTO `materials` (`store_id`, `name`, `type`, `color`, `color_hex`, `stock`, `unit`, `cost`, `safety_stock`, `active`) VALUES
  (2, 'Bambu Lab PLA Basic - Matte Black', 'PLA', 'Matte Black', '#111111', 4500.00, 'grams', 220, 500.00, 1),
  (2, 'Bambu Lab PLA Basic - Signal White', 'PLA', 'Signal White', '#ffffff', 3800.00, 'grams', 220, 500.00, 1),
  (2, 'eSUN PETG Solid - Space Silver', 'PETG', 'Space Silver', '#9ca3af', 2500.00, 'grams', 260, 400.00, 1),
  (2, 'Polymaker PolyLite ABS - Fire Red', 'ABS', 'Fire Red', '#dc2626', 1200.00, 'grams', 280, 300.00, 1),
  (2, 'Elegoo Standard 8K Resin - Space Grey', 'Resin', 'Space Grey', '#6b7280', 1000.00, 'ml', 350, 250.00, 1),
  (2, 'SainSmart TPU 95A - Electric Blue', 'TPU', 'Electric Blue', '#2563eb', 850.00, 'grams', 380, 200.00, 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- -----------------------------------------------------------------------------
-- 2. PRODUCT MATERIAL MAPPING TABLE
-- Allows a 3D product to be manufactured in multiple materials.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `product_materials` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `material_id` BIGINT NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `price_modifier` BIGINT NOT NULL DEFAULT 0 COMMENT 'Additional price modifier in paise',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_material` (`product_id`, `material_id`),
  KEY `idx_pm_product` (`product_id`),
  KEY `idx_pm_material` (`material_id`),
  CONSTRAINT `fk_pm_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pm_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. FINISHING OPTIONS TABLE
-- Post-processing, painting, smoothing, and assembly options.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `finishing_options` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `name` VARCHAR(255) NOT NULL COMMENT 'e.g., Raw Print, Sanded & Primed, Painted, Premium Painted, Assembly',
  `description` TEXT DEFAULT NULL,
  `price_modifier` BIGINT NOT NULL DEFAULT 0 COMMENT 'Price in paise (e.g. 0 for Raw, 35000 for ₹350 Painted)',
  `lead_time_days` INT NOT NULL DEFAULT 0 COMMENT 'Additional manufacturing days required',
  `sort_order` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_finishing_store_active` (`store_id`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Default Finishing Options for Store 2 (THE MARSHANS)
INSERT INTO `finishing_options` (`store_id`, `name`, `description`, `price_modifier`, `lead_time_days`, `sort_order`, `active`) VALUES
  (2, 'Raw Print', 'Unfinished freshly printed part with support structures cleanly removed.', 0, 0, 1, 1),
  (2, 'Sanded & Primed', 'Supports removed, seams sanded smooth, and coated with high-adhesion grey primer.', 15000, 1, 2, 1),
  (2, 'Painted', 'Sanded, primed, and professionally airbrushed with single/two-tone acrylic and matte coat.', 35000, 2, 3, 1),
  (2, 'Premium Painted', 'Hand-detailed art finish with shading, metallic highlights, weathering, and UV topcoat.', 75000, 4, 4, 1),
  (2, 'Assembly', 'Multi-part mechanical assembly, heat-set brass threaded inserts, and fastener installation.', 20000, 1, 5, 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- -----------------------------------------------------------------------------
-- 4. PRODUCT FINISHING OPTIONS MAPPING TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `product_finishing_options` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `finishing_option_id` BIGINT NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_finishing` (`product_id`, `finishing_option_id`),
  CONSTRAINT `fk_pfo_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pfo_finishing` FOREIGN KEY (`finishing_option_id`) REFERENCES `finishing_options` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. UPGRADE PRODUCTS TABLE
-- Add 3D manufacturing specifications: short description, weight, dimensions, notes.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'short_description'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` ADD COLUMN `short_description` TEXT DEFAULT NULL AFTER `sku`;',
  'SELECT "Column short_description already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'weight_grams'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` ADD COLUMN `weight_grams` DECIMAL(10, 2) DEFAULT NULL AFTER `price`;',
  'SELECT "Column weight_grams already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'dimensions_mm'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` ADD COLUMN `dimensions_mm` JSON DEFAULT NULL AFTER `weight_grams`;',
  'SELECT "Column dimensions_mm already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'material_info'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` ADD COLUMN `material_info` TEXT DEFAULT NULL AFTER `dimensions_mm`;',
  'SELECT "Column material_info already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'production_notes'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` ADD COLUMN `production_notes` TEXT DEFAULT NULL AFTER `material_info`;',
  'SELECT "Column production_notes already exists" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 6. PRODUCTION JOBS V1 TABLE
-- Simplified 7-stage manufacturing workflow:
-- Order Received -> Preparing -> Printing -> Finishing -> Quality Check -> Ready -> Completed
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `production_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `job_number` VARCHAR(64) NOT NULL COMMENT 'e.g. JOB-3D-1001',
  `order_id` BIGINT DEFAULT NULL,
  `order_item_id` BIGINT DEFAULT NULL,
  `custom_request_id` BIGINT DEFAULT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `material_name` VARCHAR(255) DEFAULT NULL,
  `finishing_name` VARCHAR(255) DEFAULT NULL,
  `stage` ENUM('Order Received', 'Preparing', 'Printing', 'Finishing', 'Quality Check', 'Ready', 'Completed') NOT NULL DEFAULT 'Order Received',
  `stage_notes` TEXT DEFAULT NULL,
  `assigned_operator` VARCHAR(100) DEFAULT NULL,
  `started_at` DATETIME DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_production_jobs_num` (`job_number`),
  KEY `idx_prod_jobs_store_stage` (`store_id`, `stage`),
  KEY `idx_prod_jobs_order` (`order_id`),
  CONSTRAINT `fk_prod_jobs_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. CUSTOM 3D REQUESTS TABLE
-- 5-stage customer file upload & quotation workflow:
-- Upload -> Review -> Quotation -> Approval -> Order
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_3d_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `request_number` VARCHAR(64) NOT NULL COMMENT 'e.g. REQ-3D-5001',
  `customer_id` BIGINT DEFAULT NULL,
  `guest_name` VARCHAR(255) NOT NULL,
  `guest_email` VARCHAR(255) NOT NULL,
  `guest_phone` VARCHAR(50) DEFAULT NULL,
  `file_url` VARCHAR(1000) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_format` VARCHAR(20) NOT NULL COMMENT 'STL, OBJ, STEP, 3MF',
  `file_size_bytes` BIGINT NOT NULL DEFAULT 0,
  `preferred_material` VARCHAR(100) DEFAULT NULL,
  `preferred_finishing` VARCHAR(100) DEFAULT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `customer_notes` TEXT DEFAULT NULL,
  `admin_notes` TEXT DEFAULT NULL,
  `status` ENUM('Upload', 'Review', 'Quotation', 'Approval', 'Order', 'Rejected') NOT NULL DEFAULT 'Upload',
  `quote_amount` BIGINT DEFAULT NULL COMMENT 'Quoted price in paise',
  `quote_lead_days` INT DEFAULT NULL,
  `quote_valid_until` DATETIME DEFAULT NULL,
  `converted_order_id` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_custom_requests_num` (`request_number`),
  KEY `idx_custom_requests_store_status` (`store_id`, `status`),
  KEY `idx_custom_requests_customer` (`customer_id`),
  CONSTRAINT `fk_custom_requests_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 006 Completed Successfully
-- =============================================================================
