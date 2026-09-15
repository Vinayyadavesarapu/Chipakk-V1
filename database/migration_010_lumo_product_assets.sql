-- =============================================================================
-- THE MARSHANS — Migration 010: LUMO Product Experience Assets
-- Target Database: u781826529_chipakk
-- Adds dedicated Light & Dark Mode product images and 360-degree view URLs
-- for LUMO ambient luminary products (store_id = 2).
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. ADD LUMO LIGHT MODE PRODUCT IMAGE
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'lumo_light_image'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `lumo_light_image` VARCHAR(1000) DEFAULT NULL COMMENT "LUMO Light Mode (daytime) primary product image URL" AFTER `view_360_url`;',
  'SELECT "Column lumo_light_image already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2. ADD LUMO DARK MODE PRODUCT IMAGE
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'lumo_dark_image'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `lumo_dark_image` VARCHAR(1000) DEFAULT NULL COMMENT "LUMO Dark Mode (nighttime/glowing) primary product image URL" AFTER `lumo_light_image`;',
  'SELECT "Column lumo_dark_image already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 3. ADD LUMO LIGHT MODE 360° VIEW ASSET URL
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'lumo_light_360_url'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `lumo_light_360_url` VARCHAR(1000) DEFAULT NULL COMMENT "LUMO Light Mode interactive 360 view URL" AFTER `lumo_dark_image`;',
  'SELECT "Column lumo_light_360_url already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 4. ADD LUMO DARK MODE 360° VIEW ASSET URL
-- -----------------------------------------------------------------------------
SET @exist := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'lumo_dark_360_url'
);
SET @sql := IF(@exist = 0,
  'ALTER TABLE `products` 
     ADD COLUMN `lumo_dark_360_url` VARCHAR(1000) DEFAULT NULL COMMENT "LUMO Dark Mode interactive 360 view URL" AFTER `lumo_light_360_url`;',
  'SELECT "Column lumo_dark_360_url already exists in products" AS msg;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 010 Completed Successfully
-- =============================================================================
