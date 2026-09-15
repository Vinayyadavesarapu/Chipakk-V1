-- =============================================================================
-- THE MARSHANS — HYBRID DATABASE ARCHITECTURE (OPTION C)
-- MIGRATION 012: MARSHANS STORE 2 DATA BACKFILL & DOMAIN ISOLATION
-- 
-- IMPORTANT SAFETY NOTICE:
-- DO NOT EXECUTE IN PHASE 3A.
-- THIS SCRIPT IS PREPARED AND DESIGNED FOR PHASE 3B EXECUTION ONLY.
--
-- TARGET: Backfills Store 2 categories, category media, products, images,
--         materials mappings, and finishing options into isolated marshans_* tables.
--
-- GUARANTEES:
-- 1. PURELY ADDITIVE: Inserts only into marshans_* tables.
-- 2. ZERO DESTRUCTIVE STATEMENTS: No DROP, TRUNCATE, DELETE, or RENAME.
-- 3. HISTORICAL PRESERVATION: Old categories and products rows remain intact.
-- 4. DETERMINISTIC MAPPING: Categories mapped via slug, products via SKU.
-- 5. IDEMPOTENT: Uses ON DUPLICATE KEY UPDATE and NOT EXISTS checks.
-- =============================================================================

SET NAMES utf8mb4;
SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 1;

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 1. BACKFILL MARSHANS CATEGORIES
-- Copies Store 2 categories from `categories` into `marshans_categories`.
-- Preserves experience_id -> category_experiences.id (LUMO Glow).
-- -----------------------------------------------------------------------------
INSERT INTO `marshans_categories` (
  `store_id`,
  `experience_id`,
  `name`,
  `slug`,
  `description`,
  `image_url`,
  `active`,
  `created_at`,
  `updated_at`
)
SELECT 
  2 AS `store_id`,
  c.`experience_id`,
  c.`name`,
  c.`slug`,
  c.`description`,
  c.`image_url`,
  c.`active`,
  COALESCE(c.`created_at`, CURRENT_TIMESTAMP),
  COALESCE(c.`updated_at`, CURRENT_TIMESTAMP)
FROM `categories` c
WHERE c.`store_id` = 2
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `image_url` = VALUES(`image_url`),
  `experience_id` = COALESCE(VALUES(`experience_id`), `marshans_categories`.`experience_id`),
  `active` = VALUES(`active`),
  `updated_at` = VALUES(`updated_at`);

-- -----------------------------------------------------------------------------
-- 2. BACKFILL MARSHANS CATEGORY MEDIA
-- Copies Store 2 category media (hero_light, hero_dark, etc.)
-- Links to marshans_categories.id via slug match.
-- -----------------------------------------------------------------------------
INSERT INTO `marshans_category_media` (
  `category_id`,
  `media_type`,
  `image_url`,
  `metadata`,
  `created_at`,
  `updated_at`
)
SELECT 
  mc.`id` AS `category_id`,
  cm.`media_type`,
  cm.`image_url`,
  cm.`metadata`,
  COALESCE(cm.`created_at`, CURRENT_TIMESTAMP),
  COALESCE(cm.`updated_at`, CURRENT_TIMESTAMP)
FROM `category_media` cm
JOIN `categories` c ON cm.`category_id` = c.`id`
JOIN `marshans_categories` mc ON mc.`slug` = c.`slug`
WHERE c.`store_id` = 2
ON DUPLICATE KEY UPDATE
  `image_url` = VALUES(`image_url`),
  `metadata` = VALUES(`metadata`),
  `updated_at` = VALUES(`updated_at`);

-- -----------------------------------------------------------------------------
-- 3. BACKFILL MARSHANS PRODUCTS
-- Copies Store 2 products from `products` into `marshans_products`.
-- Maps category_id to new marshans_categories.id via category slug.
-- Preserves all 3D attributes, LUMO dual assets, and paise pricing.
-- -----------------------------------------------------------------------------
INSERT INTO `marshans_products` (
  `store_id`,
  `admin_product_id`,
  `category_id`,
  `name`,
  `sku`,
  `short_description`,
  `description`,
  `price`,
  `compare_at_price`,
  `weight_grams`,
  `dimensions_mm`,
  `material_info`,
  `production_notes`,
  `experience_override`,
  `is_best_seller`,
  `view_360_url`,
  `lumo_light_image`,
  `lumo_dark_image`,
  `lumo_light_360_url`,
  `lumo_dark_360_url`,
  `tags`,
  `active`,
  `featured`,
  `scheduled_drop_time`,
  `created_at`,
  `updated_at`
)
SELECT 
  2 AS `store_id`,
  p.`admin_product_id`,
  mc.`id` AS `category_id`,
  p.`name`,
  p.`sku`,
  p.`short_description`,
  p.`description`,
  p.`price`,
  p.`compare_at_price`,
  p.`weight_grams`,
  p.`dimensions_mm`,
  p.`material_info`,
  p.`production_notes`,
  p.`experience_override`,
  p.`is_best_seller`,
  p.`view_360_url`,
  p.`lumo_light_image`,
  p.`lumo_dark_image`,
  p.`lumo_light_360_url`,
  p.`lumo_dark_360_url`,
  p.`tags`,
  p.`active`,
  p.`featured`,
  p.`scheduled_drop_time`,
  COALESCE(p.`created_at`, CURRENT_TIMESTAMP),
  COALESCE(p.`updated_at`, CURRENT_TIMESTAMP)
FROM `products` p
LEFT JOIN `categories` c ON p.`category_id` = c.`id`
LEFT JOIN `marshans_categories` mc ON mc.`slug` = c.`slug`
WHERE p.`store_id` = 2
ON DUPLICATE KEY UPDATE
  `admin_product_id` = VALUES(`admin_product_id`),
  `category_id` = VALUES(`category_id`),
  `name` = VALUES(`name`),
  `short_description` = VALUES(`short_description`),
  `description` = VALUES(`description`),
  `price` = VALUES(`price`),
  `compare_at_price` = VALUES(`compare_at_price`),
  `weight_grams` = VALUES(`weight_grams`),
  `dimensions_mm` = VALUES(`dimensions_mm`),
  `material_info` = VALUES(`material_info`),
  `production_notes` = VALUES(`production_notes`),
  `experience_override` = VALUES(`experience_override`),
  `is_best_seller` = VALUES(`is_best_seller`),
  `view_360_url` = VALUES(`view_360_url`),
  `lumo_light_image` = VALUES(`lumo_light_image`),
  `lumo_dark_image` = VALUES(`lumo_dark_image`),
  `lumo_light_360_url` = VALUES(`lumo_light_360_url`),
  `lumo_dark_360_url` = VALUES(`lumo_dark_360_url`),
  `tags` = VALUES(`tags`),
  `active` = VALUES(`active`),
  `featured` = VALUES(`featured`),
  `scheduled_drop_time` = VALUES(`scheduled_drop_time`),
  `updated_at` = VALUES(`updated_at`);

-- -----------------------------------------------------------------------------
-- 4. BACKFILL MARSHANS PRODUCT IMAGES
-- Copies gallery images for Store 2 products into `marshans_product_images`.
-- Maps product_id to new marshans_products.id via SKU match.
-- -----------------------------------------------------------------------------
INSERT INTO `marshans_product_images` (
  `product_id`,
  `image_url`,
  `storage_path`,
  `external_url`,
  `sort_order`,
  `is_primary`,
  `created_at`,
  `updated_at`
)
SELECT 
  mp.`id` AS `product_id`,
  pi.`image_url`,
  pi.`storage_path`,
  pi.`external_url`,
  pi.`sort_order`,
  pi.`is_primary`,
  COALESCE(pi.`created_at`, CURRENT_TIMESTAMP),
  COALESCE(pi.`updated_at`, CURRENT_TIMESTAMP)
FROM `product_images` pi
JOIN `products` p ON pi.`product_id` = p.`id`
JOIN `marshans_products` mp ON mp.`sku` = p.`sku`
WHERE p.`store_id` = 2
  AND NOT EXISTS (
    SELECT 1 FROM `marshans_product_images` mpi 
    WHERE mpi.`product_id` = mp.`id` AND mpi.`image_url` = pi.`image_url`
  );

-- -----------------------------------------------------------------------------
-- 5. BACKFILL MARSHANS PRODUCT MATERIALS
-- Copies material relationships for Store 2 products into `marshans_product_materials`.
-- References existing shared materials.id; maps product_id via SKU match.
-- -----------------------------------------------------------------------------
INSERT INTO `marshans_product_materials` (
  `product_id`,
  `material_id`,
  `is_default`,
  `price_modifier`,
  `created_at`
)
SELECT 
  mp.`id` AS `product_id`,
  pm.`material_id`,
  pm.`is_default`,
  pm.`price_modifier`,
  COALESCE(pm.`created_at`, CURRENT_TIMESTAMP)
FROM `product_materials` pm
JOIN `products` p ON pm.`product_id` = p.`id`
JOIN `marshans_products` mp ON mp.`sku` = p.`sku`
WHERE p.`store_id` = 2
ON DUPLICATE KEY UPDATE
  `is_default` = VALUES(`is_default`),
  `price_modifier` = VALUES(`price_modifier`);

-- -----------------------------------------------------------------------------
-- 6. BACKFILL MARSHANS PRODUCT FINISHING OPTIONS
-- Copies finishing option relationships into `marshans_product_finishing_options`.
-- References existing shared finishing_options.id; maps product_id via SKU match.
-- -----------------------------------------------------------------------------
INSERT INTO `marshans_product_finishing_options` (
  `product_id`,
  `finishing_option_id`,
  `is_default`,
  `created_at`
)
SELECT 
  mp.`id` AS `product_id`,
  pfo.`finishing_option_id`,
  pfo.`is_default`,
  COALESCE(pfo.`created_at`, CURRENT_TIMESTAMP)
FROM `product_finishing_options` pfo
JOIN `products` p ON pfo.`product_id` = p.`id`
JOIN `marshans_products` mp ON mp.`sku` = p.`sku`
WHERE p.`store_id` = 2
ON DUPLICATE KEY UPDATE
  `is_default` = VALUES(`is_default`);

COMMIT;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

-- =============================================================================
-- Migration 012 Data Backfill Script Ready for Phase 3B Execution
-- =============================================================================
