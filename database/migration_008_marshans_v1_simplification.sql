-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 008: THE MARSHANS Final V1 Admin Simplification
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. ADD BEST SELLER BOOLEAN FLAG TO PRODUCTS TABLE
-- This product-level flag is used exclusively for customer storefront showcase.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_best_seller'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `is_best_seller` TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Homepage Best Seller highlight flag" AFTER `featured`,
     ADD KEY `idx_products_store_bestseller` (`store_id`, `is_best_seller`);',
  'SELECT "Column is_best_seller already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2. ADD OPTIONAL 360-DEGREE PRODUCT VIEW URL TO PRODUCTS TABLE
-- Optional external or hosted asset link for interactive 360 viewer.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'view_360_url'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `view_360_url` VARCHAR(1000) DEFAULT NULL COMMENT "Optional interactive 360-degree view asset URL" AFTER `material_info`;',
  'SELECT "Column view_360_url already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 3. SEED INITIAL 6 DATABASE-DRIVEN CATEGORIES FOR THE MARSHANS (store_id = 2)
-- Categories: Utility Co., Fandom, Darshanam, LUMO, Mini Tales, Custom.
-- Note: LUMO is automatically linked to the "glow" experience.
-- -----------------------------------------------------------------------------
SET @lumo_exp_id := (
  SELECT `id` FROM `category_experiences` 
  WHERE `experience_code` = 'glow' AND (`store_id` = 2 OR `store_id` = 1) 
  ORDER BY `id` DESC LIMIT 1
);

INSERT INTO `categories` (`store_id`, `name`, `slug`, `description`, `experience_id`, `active`) VALUES
  (2, 'Utility Co.', 'utility-co', 'Precision engineering tools, organizers, brackets, and functional everyday 3D prints', NULL, 1),
  (2, 'Fandom', 'fandom', 'High-detail collectible sculptures, game props, pop-culture statues, and miniatures', NULL, 1),
  (2, 'Darshanam', 'darshanam', 'Spiritual, devotional, and cultural architecture sculptures crafted with heritage precision', NULL, 1),
  (2, 'LUMO', 'lumo', 'Luminous ambient lamps and radiant light sculptures featuring dual daytime/nighttime aesthetics', @lumo_exp_id, 1),
  (2, 'Mini Tales', 'mini-tales', 'Pocket-sized figurines, miniature tabletop dioramas, and micro-scale art pieces', NULL, 1),
  (2, 'Custom', 'custom', 'Bespoke additive manufacturing for on-demand customer CAD models and prototypes', NULL, 1)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `experience_id` = COALESCE(VALUES(`experience_id`), `experience_id`),
  `active` = 1;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 008 Completed Successfully
-- =============================================================================
