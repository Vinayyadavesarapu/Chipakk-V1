-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 007: THE MARSHANS Category Experience System & Media Architecture
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. CATEGORY EXPERIENCES TABLE
-- Reusable, modular category experience engine.
-- Stores presentation and interactive settings per store/experience.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `category_experiences` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2,
  `experience_code` VARCHAR(50) NOT NULL COMMENT 'e.g. normal, glow, luxury, seasonal',
  `name` VARCHAR(100) NOT NULL COMMENT 'Display name e.g. Normal, Glow Theme, Luxury Minimalist, Festive Season',
  `description` TEXT DEFAULT NULL,
  `settings` JSON DEFAULT NULL COMMENT 'Dynamic config e.g. glow_color, dark_mode_enabled, animation, intensity',
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active, inactive',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cat_exp_store_code` (`store_id`, `experience_code`),
  KEY `idx_cat_exp_store_status` (`store_id`, `status`),
  CONSTRAINT `fk_cat_exp_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Default Experiences for Store 1 (CHIPAKK) and Store 2 (THE MARSHANS)
INSERT INTO `category_experiences` (`store_id`, `experience_code`, `name`, `description`, `settings`, `status`) VALUES
  (1, 'normal', 'Standard Shop', 'Standard ecommerce category presentation for stickers & apparel', JSON_OBJECT('dark_mode_enabled', false, 'animation', 'none'), 'active'),
  (2, 'normal', 'Standard 3D Catalog', 'Clean light-theme presentation for technical 3D prints', JSON_OBJECT('dark_mode_enabled', false, 'animation', 'none'), 'active'),
  (2, 'glow', 'Glow Theme', 'Immersive dynamic dark-mode glowing aesthetic tailored for lamps & luminous models', JSON_OBJECT('glow_color', '#00ffcc', 'dark_mode_enabled', true, 'animation', 'pulse', 'intensity', 0.8), 'active'),
  (2, 'luxury', 'Luxury Theme', 'Sophisticated high-contrast presentation with metallic gold accents for premium sculptures', JSON_OBJECT('accent_color', '#d4af37', 'dark_mode_enabled', true, 'animation', 'subtle-shimmer', 'intensity', 0.5), 'active'),
  (2, 'seasonal', 'Seasonal Theme', 'Festive ambient effects for holiday promotions and seasonal collections', JSON_OBJECT('seasonal_preset', 'festive', 'dark_mode_enabled', false, 'particle_effects', true), 'active')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `settings` = VALUES(`settings`),
  `status` = VALUES(`status`);

-- -----------------------------------------------------------------------------
-- 2. CATEGORY MEDIA TABLE
-- Multi-asset management per category (hero_light, hero_dark, banner, thumbnail).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `category_media` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT NOT NULL,
  `media_type` VARCHAR(50) NOT NULL COMMENT 'e.g. hero_light, hero_dark, banner, thumbnail',
  `image_url` VARCHAR(1000) NOT NULL,
  `metadata` JSON DEFAULT NULL COMMENT 'Optional dimensions, alt_text, focal points',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cat_media_cat_type` (`category_id`, `media_type`),
  KEY `idx_cat_media_cat` (`category_id`),
  CONSTRAINT `fk_cat_media_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. UPGRADE CATEGORIES TABLE WITH EXPERIENCE LINKING
-- Links categories to category_experiences safely without breaking CHIPAKK.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'experience_id'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `categories` 
     ADD COLUMN `experience_id` BIGINT DEFAULT NULL AFTER `store_id`,
     ADD KEY `idx_categories_experience` (`experience_id`),
     ADD CONSTRAINT `fk_categories_experience` FOREIGN KEY (`experience_id`) REFERENCES `category_experiences` (`id`) ON DELETE SET NULL;',
  'SELECT "Column experience_id already exists in categories" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 4. UPGRADE PRODUCTS TABLE WITH EXPERIENCE OVERRIDE
-- Allows individual products to inherit category experience (NULL) or override (e.g. "glow").
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'experience_override'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `experience_override` VARCHAR(50) DEFAULT NULL AFTER `production_notes`;',
  'SELECT "Column experience_override already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 5. MATERIAL SYSTEM VERIFICATION & ENHANCEMENT
-- Ensure materials table has density_g_cm3 and flexible typing.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND COLUMN_NAME = 'density_g_cm3'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `materials` 
     ADD COLUMN `density_g_cm3` DECIMAL(6, 3) NOT NULL DEFAULT 1.25 COMMENT "Density in g/cm3 for volumetric weight estimation" AFTER `color_hex`;',
  'SELECT "Column density_g_cm3 already exists in materials" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 6. FINISHING SYSTEM VERIFICATION & ENHANCEMENT
-- Verify finishing_options table and ensure extra cost and lead times are supported.
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finishing_options' AND COLUMN_NAME = 'is_active'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `finishing_options` 
     ADD COLUMN `is_active` TINYINT(1) GENERATED ALWAYS AS (`active`) VIRTUAL;',
  'SELECT "Column is_active already exists in finishing_options" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 007 Completed Successfully
-- =============================================================================
