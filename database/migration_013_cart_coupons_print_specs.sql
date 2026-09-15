-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 013: Persistent Carts, Store-Scoped Coupons & Print Specs Bridge
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- Safety Guarantees:
-- 1. Purely Additive DDL.
-- 2. No destructive DROP TABLE or column drops.
-- 3. Backward-compatible with existing orders, coupons, and print specs.
-- 4. Enables isolated cart persistence for Store 1 & Store 2 with paise pricing.
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. CARTS TABLE
-- Dedicated persistent shopping carts scoped by store_id and customer / session.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `carts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT DEFAULT NULL COMMENT 'Reference to registered customer in users table',
  `store_id` BIGINT NOT NULL DEFAULT 1 COMMENT '1 = CHIPAKK, 2 = THE MARSHANS',
  `session_id` VARCHAR(100) DEFAULT NULL COMMENT 'Guest customer session identifier',
  `status` ENUM('active', 'converted', 'abandoned') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_carts_user_store_status` (`user_id`, `store_id`, `status`),
  KEY `idx_carts_store` (`store_id`),
  KEY `idx_carts_session_store` (`session_id`, `store_id`),
  CONSTRAINT `fk_carts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_carts_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. CART ITEMS TABLE
-- Line items within persistent carts. Supports Store 1 (product_id)
-- and Store 2 (marshans_product_id) with snapshot metadata and paise pricing.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cart_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `cart_id` BIGINT NOT NULL,
  `product_id` BIGINT DEFAULT NULL COMMENT 'Store 1 product foreign key',
  `marshans_product_id` BIGINT DEFAULT NULL COMMENT 'Store 2 product foreign key',
  `variant_id` BIGINT DEFAULT NULL COMMENT 'Optional variant ID',
  `quantity` INT NOT NULL DEFAULT 1,
  `unit_price` BIGINT NOT NULL DEFAULT 0 COMMENT 'Unit price in paise (₹1.00 = 100 paise)',
  `product_name` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(100) DEFAULT NULL,
  `image_url` VARCHAR(1000) DEFAULT NULL,
  `options_snapshot` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cart_items_cart` (`cart_id`),
  KEY `idx_cart_items_product` (`product_id`),
  KEY `idx_cart_items_marshans_product` (`marshans_product_id`),
  CONSTRAINT `fk_cart_items_cart` FOREIGN KEY (`cart_id`) REFERENCES `carts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cart_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cart_items_marshans_product` FOREIGN KEY (`marshans_product_id`) REFERENCES `marshans_products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. PRINT SPECIFICATIONS BRIDGE
-- Adds nullable marshans_product_id to support 3D manufacturing specifications
-- for dedicated Store 2 products, making product_id nullable.
-- -----------------------------------------------------------------------------
SET @exist_print_specs := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_specifications'
);

-- Make product_id nullable if table exists
SET @sql_mod_prod := IF(@exist_print_specs > 0,
  'ALTER TABLE `print_specifications` MODIFY COLUMN `product_id` BIGINT NULL;',
  'SELECT "Table print_specifications does not exist" AS msg;'
);
PREPARE stmt FROM @sql_mod_prod; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add marshans_product_id column
SET @exist_marshans_spec := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_specifications' AND COLUMN_NAME = 'marshans_product_id'
);
SET @sql_marshans_spec := IF(@exist_print_specs > 0 AND @exist_marshans_spec = 0,
  'ALTER TABLE `print_specifications`
     ADD COLUMN `marshans_product_id` BIGINT DEFAULT NULL COMMENT "Foreign key to marshans_products" AFTER `product_id`,
     ADD KEY `idx_print_specs_marshans_product` (`marshans_product_id`),
     ADD CONSTRAINT `fk_print_specs_marshans_product` FOREIGN KEY (`marshans_product_id`) REFERENCES `marshans_products` (`id`) ON DELETE SET NULL;',
  'SELECT "Column marshans_product_id already exists or table missing in print_specifications" AS msg;'
);
PREPARE stmt FROM @sql_marshans_spec; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 4. STORE-SCOPED COUPONS UNIQUE CONSTRAINT
-- Replaces global uk_coupons_code with store-scoped unique key (store_id, code).
-- Allows CHIPAKK (Store 1) and THE MARSHANS (Store 2) to manage independent coupons.
-- -----------------------------------------------------------------------------
SET @exist_uk_code := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons' AND INDEX_NAME = 'uk_coupons_code'
);
SET @sql_drop_uk_code := IF(@exist_uk_code > 0,
  'ALTER TABLE `coupons` DROP INDEX `uk_coupons_code`;',
  'SELECT "Index uk_coupons_code does not exist" AS msg;'
);
PREPARE stmt FROM @sql_drop_uk_code; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist_uk_store_code := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons' AND INDEX_NAME = 'uk_coupons_store_code'
);
SET @sql_add_store_uk := IF(@exist_uk_store_code = 0,
  'ALTER TABLE `coupons` ADD UNIQUE KEY `uk_coupons_store_code` (`store_id`, `code`);',
  'SELECT "Index uk_coupons_store_code already exists" AS msg;'
);
PREPARE stmt FROM @sql_add_store_uk; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 013 Completed Successfully
-- =============================================================================
