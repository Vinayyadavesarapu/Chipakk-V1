-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 005: Multi-Store Architecture Foundation & Store Settings
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. STORES TABLE
-- Master registry of stores operating on this unified platform.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `stores` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL COMMENT 'Unique machine code e.g. chipakk, marshans',
  `name` VARCHAR(255) NOT NULL COMMENT 'Display name e.g. CHIPAKK, THE MARSHANS',
  `domain` VARCHAR(255) NOT NULL COMMENT 'Primary domain e.g. chipakk.shop, themarshans.shop',
  `tagline` VARCHAR(255) DEFAULT NULL,
  `logo_url` VARCHAR(1000) DEFAULT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'INR',
  `business_type` ENUM('print_on_demand', 'custom_manufacturing', 'hybrid') NOT NULL DEFAULT 'print_on_demand',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stores_code` (`code`),
  UNIQUE KEY `uk_stores_domain` (`domain`),
  KEY `idx_stores_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Default Stores
INSERT INTO `stores` (`id`, `code`, `name`, `domain`, `tagline`, `business_type`, `active`)
VALUES 
  (1, 'chipakk', 'CHIPAKK', 'chipakk.shop', 'Custom Stickers & Print-on-Demand Merch', 'print_on_demand', 1),
  (2, 'marshans', 'THE MARSHANS', 'themarshans.shop', 'Precision 3D Printing & Custom Additive Manufacturing', 'custom_manufacturing', 1)
ON DUPLICATE KEY UPDATE 
  `name` = VALUES(`name`),
  `domain` = VALUES(`domain`),
  `tagline` = VALUES(`tagline`),
  `business_type` = VALUES(`business_type`);

-- -----------------------------------------------------------------------------
-- 2. STORE-SPECIFIC SETTINGS TABLE (`store_settings`)
-- Independent operational, shipping, announcement, and tax policies per store.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `store_settings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` JSON DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_store_settings_store_key` (`store_id`, `setting_key`),
  KEY `idx_store_settings_store` (`store_id`),
  CONSTRAINT `fk_store_settings_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Store 1 (CHIPAKK) Settings
INSERT INTO `store_settings` (`store_id`, `setting_key`, `setting_value`) VALUES
  (1, 'store_name', '"CHIPAKK Stickers"'),
  (1, 'store_status', '"OPEN"'),
  (1, 'order_acceptance', '"ACCEPTING ORDERS"'),
  (1, 'gst_pct', '18'),
  (1, 'gst_enabled', 'true'),
  (1, 'shipping_fee', '5000'),
  (1, 'free_shipping_enabled', 'true'),
  (1, 'free_shipping_threshold', '49900'),
  (1, 'free_shipping_calculation', '"after_discounts"'),
  (1, 'announcement_text', '"WELCOME TO CHIPAKK! GET 10% OFF ON YOUR FIRST ORDER"'),
  (1, 'announcement_active', 'true'),
  (1, 'maintenance_active', 'false'),
  (1, 'maintenance_message', '"CHIPAKK is currently undergoing scheduled maintenance."'),
  (1, 'support_email', '"support@chipakk.shop"'),
  (1, 'support_phone', '"+91 98765 00000"')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

-- Seed Store 2 (THE MARSHANS) Settings (Strictly NO free shipping, higher shipping fee, 3D printing parameters)
INSERT INTO `store_settings` (`store_id`, `setting_key`, `setting_value`) VALUES
  (2, 'store_name', '"THE MARSHANS"'),
  (2, 'store_status', '"OPEN"'),
  (2, 'order_acceptance', '"ACCEPTING ORDERS"'),
  (2, 'gst_pct', '18'),
  (2, 'gst_enabled', 'true'),
  (2, 'shipping_fee', '10000'),
  (2, 'free_shipping_enabled', 'false'),
  (2, 'free_shipping_threshold', '0'),
  (2, 'free_shipping_calculation', '"after_discounts"'),
  (2, 'announcement_text', '"PRECISION 3D PRINTING & CUSTOM ON-DEMAND MANUFACTURING"'),
  (2, 'announcement_active', 'true'),
  (2, 'maintenance_active', 'false'),
  (2, 'maintenance_message', '"THE MARSHANS workshop is currently offline for calibration."'),
  (2, 'support_email', '"support@themarshans.shop"'),
  (2, 'support_phone', '"+91 98765 00000"'),
  (2, 'material_settings', '{"default_infill": 20, "allow_custom_filaments": true, "min_wall_thickness_mm": 1.2}'),
  (2, 'production_settings', '{"auto_assign_printers": false, "qa_inspection_required": true}'),
  (2, 'quotation_settings', '{"auto_quote_multiplier": 2.5, "quote_validity_days": 14, "rush_fee_pct": 30}')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

-- -----------------------------------------------------------------------------
-- 3. PARTITION EXISTING TABLES BY STORE_ID
-- Non-destructive: DEFAULT 1 backfills all existing CHIPAKK records safely.
-- -----------------------------------------------------------------------------

-- 3.1 CATEGORIES
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `categories` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_categories_store_active` (`store_id`, `active`),
     ADD CONSTRAINT `fk_categories_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in categories" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.2 PRODUCTS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `products` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_products_store_active` (`store_id`, `active`),
     ADD CONSTRAINT `fk_products_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.3 ORDERS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `orders` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_orders_store_created` (`store_id`, `created_at`),
     ADD CONSTRAINT `fk_orders_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in orders" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.4 COUPONS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `coupons` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_coupons_store_active` (`store_id`, `active`),
     ADD CONSTRAINT `fk_coupons_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in coupons" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.5 BANNERS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'banners' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `banners` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_banners_store_active` (`store_id`, `active`, `sort_order`),
     ADD CONSTRAINT `fk_banners_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in banners" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.6 EVENTS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `events` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_events_store_active` (`store_id`, `active`),
     ADD CONSTRAINT `fk_events_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in events" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.7 CAMPAIGNS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `campaigns` 
     ADD COLUMN `store_id` BIGINT NOT NULL DEFAULT 1 AFTER `id`,
     ADD KEY `idx_campaigns_store_active` (`store_id`, `active`),
     ADD CONSTRAINT `fk_campaigns_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in campaigns" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.8 SHIPPING_RULES
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_rules' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `shipping_rules` 
     ADD COLUMN `store_id` BIGINT DEFAULT NULL AFTER `id`,
     ADD KEY `idx_shipping_rules_store` (`store_id`);',
  'SELECT "Column store_id already exists in shipping_rules" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.9 AUDIT_LOGS
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0, 
  'ALTER TABLE `audit_logs` 
     ADD COLUMN `store_id` BIGINT DEFAULT NULL AFTER `actor_id`,
     ADD KEY `idx_audit_logs_store` (`store_id`);',
  'SELECT "Column store_id already exists in audit_logs" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 4. MARSHANS 3D PRINTING & MANUFACTURING TABLES
-- -----------------------------------------------------------------------------

-- 4.1 MATERIALS
CREATE TABLE IF NOT EXISTS `materials` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `name` VARCHAR(255) NOT NULL COMMENT 'e.g., eSUN PLA+ Black, Siraya Tech Fast Navy Grey',
  `category` ENUM('filament', 'resin', 'powder', 'packaging', 'consumable') NOT NULL DEFAULT 'filament',
  `material_type` VARCHAR(50) NOT NULL COMMENT 'PLA, PETG, ABS, TPU, Standard Resin, Tough Resin',
  `color_name` VARCHAR(100) NOT NULL,
  `color_hex` VARCHAR(10) DEFAULT '#000000',
  `density_g_cm3` DECIMAL(6, 3) NOT NULL DEFAULT 1.240 COMMENT 'Density for weight & volume calculations',
  `cost_per_gram` BIGINT NOT NULL DEFAULT 0 COMMENT 'Cost per gram in paise',
  `spool_weight_grams` INT NOT NULL DEFAULT 1000 COMMENT 'Total spool capacity in grams',
  `stock_weight_grams` INT NOT NULL DEFAULT 0 COMMENT 'Current available stock in grams',
  `safety_stock_grams` INT NOT NULL DEFAULT 200 COMMENT 'Low inventory threshold',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_materials_store_category` (`store_id`, `category`),
  KEY `idx_materials_active` (`active`),
  CONSTRAINT `fk_materials_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.2 PRINT_SPECIFICATIONS
CREATE TABLE IF NOT EXISTS `print_specifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `variant_id` BIGINT DEFAULT NULL,
  `technology` ENUM('FDM', 'SLA', 'SLS') NOT NULL DEFAULT 'FDM',
  `recommended_material_type` VARCHAR(50) NOT NULL DEFAULT 'PLA',
  `infill_percentage` INT NOT NULL DEFAULT 20 COMMENT 'Default infill percentage',
  `layer_height_mm` DECIMAL(4, 2) NOT NULL DEFAULT 0.20 COMMENT 'e.g. 0.20mm, 0.12mm, 0.05mm',
  `supports_required` TINYINT(1) NOT NULL DEFAULT 0,
  `print_time_minutes` INT NOT NULL DEFAULT 0 COMMENT 'Estimated manufacturing duration per unit',
  `material_weight_grams` INT NOT NULL DEFAULT 0 COMMENT 'Material consumed per unit in grams',
  `dimensions_mm` JSON NOT NULL COMMENT '{"x": 120, "y": 80, "z": 150}',
  `volume_cm3` DECIMAL(10, 3) DEFAULT NULL,
  `model_file_url` VARCHAR(1000) DEFAULT NULL COMMENT 'Path to CAD/STL/3MF reference',
  `storage_path` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_print_specs_product` (`product_id`),
  KEY `idx_print_specs_variant` (`variant_id`),
  CONSTRAINT `fk_print_specs_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_print_specs_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.3 CUSTOM_3D_REQUESTS
CREATE TABLE IF NOT EXISTS `custom_3d_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `request_number` VARCHAR(64) NOT NULL COMMENT 'e.g., MR-2026-0001',
  `customer_id` BIGINT DEFAULT NULL,
  `guest_name` VARCHAR(255) NOT NULL,
  `guest_email` VARCHAR(255) NOT NULL,
  `guest_phone` VARCHAR(50) NOT NULL,
  `file_url` VARCHAR(1000) NOT NULL,
  `storage_path` VARCHAR(500) NOT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `file_format` VARCHAR(20) NOT NULL COMMENT 'STL, OBJ, 3MF, STEP',
  `file_size_bytes` BIGINT NOT NULL DEFAULT 0,
  `dimensions_mm` JSON DEFAULT NULL COMMENT 'Calculated bounding box {"x": 0, "y": 0, "z": 0}',
  `volume_cm3` DECIMAL(10, 3) DEFAULT NULL,
  `preferred_technology` ENUM('FDM', 'SLA', 'ANY') NOT NULL DEFAULT 'FDM',
  `preferred_material` VARCHAR(50) DEFAULT NULL,
  `preferred_color` VARCHAR(50) DEFAULT NULL,
  `infill_percentage` INT DEFAULT 20,
  `quantity` INT NOT NULL DEFAULT 1,
  `customer_notes` TEXT DEFAULT NULL,
  `status` ENUM('submitted', 'analyzing', 'quoted', 'approved', 'rejected', 'ordered') NOT NULL DEFAULT 'submitted',
  `quote_amount` BIGINT DEFAULT NULL COMMENT 'Quoted price in paise',
  `quote_shipping_fee` BIGINT DEFAULT NULL COMMENT 'Quoted delivery in paise',
  `quote_valid_until` DATETIME DEFAULT NULL,
  `admin_notes` TEXT DEFAULT NULL,
  `converted_order_id` BIGINT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_custom_3d_requests_num` (`request_number`),
  KEY `idx_custom_3d_requests_customer` (`customer_id`),
  KEY `idx_custom_3d_requests_status` (`status`),
  KEY `idx_custom_3d_requests_created` (`created_at`),
  CONSTRAINT `fk_custom_3d_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_custom_3d_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_custom_3d_order` FOREIGN KEY (`converted_order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.4 PRODUCTION_JOBS
CREATE TABLE IF NOT EXISTS `production_jobs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `job_number` VARCHAR(64) NOT NULL COMMENT 'e.g. JOB-3D-1001',
  `order_id` BIGINT DEFAULT NULL,
  `order_item_id` BIGINT DEFAULT NULL,
  `custom_request_id` BIGINT DEFAULT NULL,
  `printer_id` VARCHAR(100) DEFAULT NULL COMMENT 'Identifier e.g. BAMBU-X1C-01, ELEGOO-SAT-02',
  `material_id` BIGINT DEFAULT NULL,
  `estimated_minutes` INT NOT NULL DEFAULT 0,
  `actual_minutes` INT DEFAULT NULL,
  `material_grams_used` INT DEFAULT NULL,
  `stage` ENUM('PENDING', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK', 'READY_TO_SHIP') NOT NULL DEFAULT 'PENDING',
  `stage_notes` TEXT DEFAULT NULL,
  `qa_passed` TINYINT(1) DEFAULT NULL,
  `qa_inspector_id` VARCHAR(128) DEFAULT NULL,
  `started_at` DATETIME DEFAULT NULL,
  `completed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_production_jobs_num` (`job_number`),
  KEY `idx_prod_jobs_order` (`order_id`),
  KEY `idx_prod_jobs_order_item` (`order_item_id`),
  KEY `idx_prod_jobs_stage` (`stage`),
  KEY `idx_prod_jobs_printer` (`printer_id`),
  CONSTRAINT `fk_prod_jobs_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_prod_jobs_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_prod_jobs_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 005 Ready for Execution
-- =============================================================================
