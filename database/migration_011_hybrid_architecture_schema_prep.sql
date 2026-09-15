-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 011: Hybrid Architecture Additive Schema Preparation (Phase 1)
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- Safety Guarantees:
-- 1. Purely Additive DDL.
-- 2. No DROP TABLE, DROP COLUMN, TRUNCATE, or RENAME.
-- 3. No data migration or deletion of existing CHIPAKK or MARSHANS records.
-- 4. Preserves 100% backward compatibility for all existing services & LUMO.
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. MARSHANS CATEGORIES TABLE
-- Dedicated category taxonomy for THE MARSHANS 3D manufacturing domain.
-- Preserves compatibility with shared category_experiences (e.g. LUMO Glow).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `marshans_categories` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `experience_id` BIGINT DEFAULT NULL COMMENT 'Reference to category_experiences (e.g. glow experience for LUMO)',
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `image_url` VARCHAR(1000) DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_marshans_categories_slug` (`slug`),
  KEY `idx_marshans_categories_store_active` (`store_id`, `active`),
  KEY `idx_marshans_categories_experience` (`experience_id`),
  CONSTRAINT `fk_marshans_categories_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_marshans_categories_experience` FOREIGN KEY (`experience_id`) REFERENCES `category_experiences` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. MARSHANS CATEGORY MEDIA TABLE
-- Category media assets (hero_light, hero_dark, banner, thumbnail) for LUMO and 3D categories.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `marshans_category_media` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT NOT NULL,
  `media_type` VARCHAR(50) NOT NULL COMMENT 'hero_light, hero_dark, banner, thumbnail',
  `image_url` VARCHAR(1000) NOT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_marshans_cat_media_type` (`category_id`, `media_type`),
  KEY `idx_marshans_cat_media_cat` (`category_id`),
  CONSTRAINT `fk_marshans_cat_media_category` FOREIGN KEY (`category_id`) REFERENCES `marshans_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. MARSHANS PRODUCTS TABLE
-- Master product catalog for THE MARSHANS 3D manufacturing & ambient luminary drops.
-- Excludes CHIPAKK sticker variants, sticker options, and sticker cutline tables.
-- Preserves paise-based BIGINT money representation, 3D print specs, and LUMO assets.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `marshans_products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `admin_product_id` VARCHAR(100) DEFAULT NULL COMMENT 'Human-readable ID e.g. MRSH-001',
  `category_id` BIGINT DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `short_description` TEXT DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `price` BIGINT NOT NULL DEFAULT 0 COMMENT 'Base price in paise (₹1.00 = 100 paise)',
  `compare_at_price` BIGINT NOT NULL DEFAULT 0 COMMENT 'Compare at / strike-through price in paise',
  `weight_grams` DECIMAL(10, 2) DEFAULT NULL,
  `dimensions_mm` JSON DEFAULT NULL COMMENT '{"x": 0, "y": 0, "z": 0}',
  `material_info` TEXT DEFAULT NULL,
  `production_notes` TEXT DEFAULT NULL,
  `experience_override` VARCHAR(50) DEFAULT NULL,
  `is_best_seller` TINYINT(1) NOT NULL DEFAULT 0,
  `view_360_url` VARCHAR(1000) DEFAULT NULL COMMENT 'Generic / fallback 360-degree interactive viewer URL',
  `lumo_light_image` VARCHAR(1000) DEFAULT NULL COMMENT 'LUMO Light Mode (daytime) primary product image URL',
  `lumo_dark_image` VARCHAR(1000) DEFAULT NULL COMMENT 'LUMO Dark Mode (nighttime/glow) primary product image URL',
  `lumo_light_360_url` VARCHAR(1000) DEFAULT NULL COMMENT 'LUMO Light Mode daytime 360-degree viewer asset URL',
  `lumo_dark_360_url` VARCHAR(1000) DEFAULT NULL COMMENT 'LUMO Dark Mode glowing 360-degree viewer asset URL',
  `tags` JSON DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `featured` TINYINT(1) NOT NULL DEFAULT 0,
  `scheduled_drop_time` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_marshans_products_sku` (`sku`),
  UNIQUE KEY `uk_marshans_products_admin_id` (`admin_product_id`),
  KEY `idx_marshans_products_store_active` (`store_id`, `active`),
  KEY `idx_marshans_products_category` (`category_id`),
  KEY `idx_marshans_products_bestseller` (`store_id`, `is_best_seller`),
  KEY `idx_marshans_products_created_at` (`created_at`),
  CONSTRAINT `fk_marshans_products_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_marshans_products_category` FOREIGN KEY (`category_id`) REFERENCES `marshans_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. MARSHANS PRODUCT IMAGES TABLE
-- Multi-image product gallery for THE MARSHANS 3D models and sculptures.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `marshans_product_images` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `image_url` VARCHAR(1000) NOT NULL,
  `storage_path` VARCHAR(500) DEFAULT NULL,
  `external_url` VARCHAR(1000) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_marshans_pi_product` (`product_id`),
  KEY `idx_marshans_pi_sort` (`product_id`, `sort_order`),
  KEY `idx_marshans_pi_primary` (`product_id`, `is_primary`),
  CONSTRAINT `fk_marshans_pi_product` FOREIGN KEY (`product_id`) REFERENCES `marshans_products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. MARSHANS PRODUCT MATERIALS TABLE
-- Mappings between Marshans 3D products and raw filaments/resins in `materials`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `marshans_product_materials` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `material_id` BIGINT NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `price_modifier` BIGINT NOT NULL DEFAULT 0 COMMENT 'Price adjustment in paise',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_marshans_prod_material` (`product_id`, `material_id`),
  KEY `idx_marshans_pm_product` (`product_id`),
  KEY `idx_marshans_pm_material` (`material_id`),
  CONSTRAINT `fk_marshans_pm_product` FOREIGN KEY (`product_id`) REFERENCES `marshans_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_marshans_pm_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. MARSHANS PRODUCT FINISHING OPTIONS TABLE
-- Mappings between Marshans 3D products and post-processing treatments in `finishing_options`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `marshans_product_finishing_options` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `finishing_option_id` BIGINT NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_marshans_prod_finishing` (`product_id`, `finishing_option_id`),
  KEY `idx_marshans_pfo_product` (`product_id`),
  KEY `idx_marshans_pfo_finishing` (`finishing_option_id`),
  CONSTRAINT `fk_marshans_pfo_product` FOREIGN KEY (`product_id`) REFERENCES `marshans_products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_marshans_pfo_finishing` FOREIGN KEY (`finishing_option_id`) REFERENCES `finishing_options` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. ORDER ITEMS BRIDGE COLUMN
-- Adds nullable marshans_product_id to order_items to support unified commerce ledger.
-- Preserves existing product_id untouched.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'marshans_product_id'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `order_items`
     ADD COLUMN `marshans_product_id` BIGINT DEFAULT NULL COMMENT "Foreign key to marshans_products for Store 2 line items" AFTER `product_id`,
     ADD KEY `idx_order_items_marshans_product` (`marshans_product_id`),
     ADD CONSTRAINT `fk_order_items_marshans_product` FOREIGN KEY (`marshans_product_id`) REFERENCES `marshans_products` (`id`) ON DELETE SET NULL;',
  'SELECT "Column marshans_product_id already exists in order_items" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 8. REVIEWS BRIDGE COLUMNS
-- Adds nullable store_id and marshans_product_id to reviews.
-- Preserves existing product_id untouched.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'store_id'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `reviews`
     ADD COLUMN `store_id` BIGINT DEFAULT NULL COMMENT "Store scoping ID (1 = CHIPAKK, 2 = THE MARSHANS)" AFTER `id`,
     ADD KEY `idx_reviews_store` (`store_id`),
     ADD CONSTRAINT `fk_reviews_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT;',
  'SELECT "Column store_id already exists in reviews" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'marshans_product_id'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `reviews`
     ADD COLUMN `marshans_product_id` BIGINT DEFAULT NULL COMMENT "Foreign key to marshans_products for Store 2 reviews" AFTER `product_id`,
     ADD KEY `idx_reviews_marshans_product` (`marshans_product_id`),
     ADD CONSTRAINT `fk_reviews_marshans_product` FOREIGN KEY (`marshans_product_id`) REFERENCES `marshans_products` (`id`) ON DELETE SET NULL;',
  'SELECT "Column marshans_product_id already exists in reviews" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 011 Completed Successfully
-- =============================================================================
