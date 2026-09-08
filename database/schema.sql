-- =============================================================================
-- CHIPAKK E-Commerce Database Schema Specification
-- Target Engine: MySQL 8.0+ / MariaDB 10.5+
-- Database: u781826529_chipakk
-- Character Set: utf8mb4
-- Collation: utf8mb4_unicode_ci
-- NOTE: All monetary amounts are stored as BIGINT in paise (e.g. ₹199.00 = 19900 paise).
-- DO NOT EXECUTE ON HOSTINGER DIRECTLY - LOCAL DEFINITION ONLY.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `u781826529_chipakk`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `u781826529_chipakk`;

-- Set SQL options for safety
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. ADMINS TABLE
-- Stores administrative personnel credentials mapping to Firebase Auth UID.
-- Password handling is offloaded to Firebase Authentication.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `admins`;
CREATE TABLE `admins` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `firebase_uid` VARCHAR(128) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'super_admin') NOT NULL DEFAULT 'admin',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admins_firebase_uid` (`firebase_uid`),
  KEY `idx_admins_email` (`email`),
  KEY `idx_admins_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. USERS (CUSTOMERS) TABLE
-- Customer profile registry linked to Firebase Auth UID.
-- Password handling is offloaded to Firebase Authentication.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `firebase_uid` VARCHAR(128) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(50) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_firebase_uid` (`firebase_uid`),
  KEY `idx_users_email` (`email`),
  KEY `idx_users_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. CATEGORIES TABLE
-- Product taxonomy groupings.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `image_url` VARCHAR(1000) DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_categories_slug` (`slug`),
  KEY `idx_categories_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration for existing database:
-- ALTER TABLE `categories` ADD COLUMN `image_url` VARCHAR(1000) DEFAULT NULL AFTER `description`;

-- -----------------------------------------------------------------------------
-- 4. PRODUCTS TABLE
-- Base catalog product entries. Prices stored in paise (INTEGER).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `price` BIGINT NOT NULL DEFAULT 0 COMMENT 'Base price in paise',
  `compare_at_price` BIGINT NOT NULL DEFAULT 0 COMMENT 'Compare at / original price in paise',
  `tags` JSON DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `featured` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_products_sku` (`sku`),
  KEY `idx_products_category` (`category_id`),
  KEY `idx_products_active` (`active`),
  KEY `idx_products_featured` (`featured`),
  KEY `idx_products_created_at` (`created_at`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. PRODUCT_IMAGES TABLE
-- Multi-image support for products. Handles external URLs and Hostinger storage paths.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `product_images`;
CREATE TABLE `product_images` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `image_url` VARCHAR(1000) NOT NULL,
  `storage_path` VARCHAR(500) DEFAULT NULL COMMENT 'Path on Hostinger file system',
  `external_url` VARCHAR(1000) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_product_images_product` (`product_id`),
  KEY `idx_product_images_sort` (`product_id`, `sort_order`),
  KEY `idx_product_images_primary` (`product_id`, `is_primary`),
  CONSTRAINT `fk_product_images_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. PRODUCT_OPTIONS TABLE
-- Option dimensions per product (e.g., Material, Size, Color).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `product_options`;
CREATE TABLE `product_options` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_options_product_name` (`product_id`, `name`),
  KEY `idx_product_options_product` (`product_id`),
  CONSTRAINT `fk_product_options_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. PRODUCT_OPTION_VALUES TABLE
-- Allowed values for a given product option (e.g., Glossy, Matte, 2 inch, 3 inch).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `product_option_values`;
CREATE TABLE `product_option_values` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `option_id` BIGINT NOT NULL,
  `value` VARCHAR(100) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_option_values_option_value` (`option_id`, `value`),
  KEY `idx_option_values_option` (`option_id`),
  CONSTRAINT `fk_option_values_option` FOREIGN KEY (`option_id`) REFERENCES `product_options` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. PRODUCT_VARIANTS TABLE
-- Specific sellable SKUs representing option combinations (e.g., material_glossy__size_2inch).
-- Prices stored in paise (INTEGER).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `product_variants`;
CREATE TABLE `product_variants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `variant_slug` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(100) NOT NULL,
  `price` BIGINT NOT NULL COMMENT 'Variant price in paise',
  `option_combination` JSON NOT NULL COMMENT 'Normalized JSON key-value map of selected options',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_variants_sku` (`sku`),
  UNIQUE KEY `uk_product_variants_slug` (`product_id`, `variant_slug`),
  KEY `idx_product_variants_product` (`product_id`),
  KEY `idx_product_variants_active` (`active`),
  CONSTRAINT `fk_product_variants_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. INVENTORY TABLE
-- Physical & reserved stock per product variant. Stock entered by Admin (no default stock assumptions).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `inventory`;
CREATE TABLE `inventory` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `variant_id` BIGINT NOT NULL,
  `stock` INT NOT NULL COMMENT 'Available physical stock entered by admin',
  `reserved_stock` INT NOT NULL DEFAULT 0 COMMENT 'Stock reserved during active customer checkouts',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inventory_variant` (`variant_id`),
  KEY `idx_inventory_stock` (`stock`),
  CONSTRAINT `fk_inventory_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. ORDERS TABLE
-- Customer order master header records. All money fields stored in paise (INTEGER).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_number` VARCHAR(64) NOT NULL,
  `customer_id` BIGINT DEFAULT NULL,
  `customer_email` VARCHAR(255) NOT NULL,
  `customer_name` VARCHAR(255) NOT NULL,
  `shipping_address` JSON NOT NULL,
  `payment_method` VARCHAR(50) NOT NULL DEFAULT 'COD',
  `payment_status` ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  `fulfillment_status` ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
  `subtotal` BIGINT NOT NULL DEFAULT 0 COMMENT 'Subtotal in paise',
  `discount_total` BIGINT NOT NULL DEFAULT 0 COMMENT 'Total discounts applied in paise',
  `shipping_charge` BIGINT NOT NULL DEFAULT 0 COMMENT 'Shipping fee in paise',
  `total_price` BIGINT NOT NULL DEFAULT 0 COMMENT 'Final grand total in paise',
  `coupon_code` VARCHAR(50) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orders_order_number` (`order_number`),
  KEY `idx_orders_customer` (`customer_id`),
  KEY `idx_orders_payment_status` (`payment_status`),
  KEY `idx_orders_fulfillment_status` (`fulfillment_status`),
  KEY `idx_orders_created_at` (`created_at`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. ORDER_ITEMS TABLE
-- Order line items preserving historical product, SKU, option, and price snapshots.
-- Future modifications to catalog products/variants WILL NOT alter old orders.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `product_id` BIGINT DEFAULT NULL,
  `variant_id` BIGINT DEFAULT NULL,
  `product_name` VARCHAR(255) NOT NULL COMMENT 'Historical product name snapshot',
  `sku` VARCHAR(100) NOT NULL COMMENT 'Historical SKU snapshot',
  `variant_options` VARCHAR(255) DEFAULT NULL COMMENT 'Historical option text snapshot (e.g. Material: Glossy, Size: 2 inch)',
  `unit_price` BIGINT NOT NULL COMMENT 'Historical unit price snapshot in paise',
  `quantity` INT NOT NULL DEFAULT 1,
  `total_price` BIGINT NOT NULL COMMENT 'Historical total price (unit_price * quantity) in paise',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order` (`order_id`),
  KEY `idx_order_items_product` (`product_id`),
  KEY `idx_order_items_variant` (`variant_id`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_order_items_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 12. COUPONS TABLE
-- Coupon definitions for promotional discounts. Money fields in paise (INTEGER).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `coupons`;
CREATE TABLE `coupons` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `discount_type` ENUM('percent', 'fixed') NOT NULL,
  `discount_value` BIGINT NOT NULL COMMENT 'Percentage integer (e.g. 10) or fixed amount in paise',
  `min_order_value` BIGINT NOT NULL DEFAULT 0 COMMENT 'Minimum order subtotal in paise',
  `max_discount_amount` BIGINT DEFAULT NULL COMMENT 'Maximum discount ceiling in paise (for percentage discounts)',
  `start_date` DATETIME DEFAULT NULL,
  `end_date` DATETIME DEFAULT NULL,
  `usage_limit` INT DEFAULT NULL COMMENT 'Max global usage count (NULL = unlimited)',
  `usage_count` INT NOT NULL DEFAULT 0 COMMENT 'Times redeemed',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_coupons_code` (`code`),
  KEY `idx_coupons_active` (`active`),
  KEY `idx_coupons_dates` (`start_date`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 13. COUPON_USAGE TABLE
-- Audit log of individual coupon redemptions tied to orders and users.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `coupon_usage`;
CREATE TABLE `coupon_usage` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `coupon_id` BIGINT NOT NULL,
  `order_id` BIGINT NOT NULL,
  `customer_id` BIGINT DEFAULT NULL,
  `discount_amount` BIGINT NOT NULL COMMENT 'Actual discount applied in paise',
  `used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_coupon_usage_coupon` (`coupon_id`),
  KEY `idx_coupon_usage_order` (`order_id`),
  KEY `idx_coupon_usage_customer` (`customer_id`),
  CONSTRAINT `fk_coupon_usage_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_coupon_usage_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_coupon_usage_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 14. BANNERS TABLE
-- Promotional banner carousel assets for customer-facing applications.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `banners`;
CREATE TABLE `banners` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) DEFAULT NULL,
  `image_url` VARCHAR(1000) NOT NULL,
  `storage_path` VARCHAR(500) DEFAULT NULL COMMENT 'Path on Hostinger file system',
  `target_url` VARCHAR(1000) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_banners_active_order` (`active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 15. REVIEWS TABLE
-- Product customer ratings and reviews with moderation status.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `reviews`;
CREATE TABLE `reviews` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `customer_id` BIGINT DEFAULT NULL,
  `customer_name` VARCHAR(255) NOT NULL,
  `rating` TINYINT NOT NULL CHECK (`rating` >= 1 AND `rating` <= 5),
  `comment` TEXT DEFAULT NULL,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reviews_product` (`product_id`),
  KEY `idx_reviews_customer` (`customer_id`),
  KEY `idx_reviews_status` (`status`),
  CONSTRAINT `fk_reviews_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_reviews_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 16. SITE_SETTINGS TABLE
-- Global key-value store for site parameters (store name, maintenance mode, splashes).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `site_settings`;
CREATE TABLE `site_settings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` JSON DEFAULT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 17. SHIPPING_RULES TABLE
-- Shipping fees and free-shipping thresholds in paise (INTEGER).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `shipping_rules`;
CREATE TABLE `shipping_rules` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL DEFAULT 'Standard Shipping',
  `free_shipping_threshold` BIGINT NOT NULL DEFAULT 0 COMMENT 'Free shipping threshold in paise',
  `standard_fee` BIGINT NOT NULL DEFAULT 0 COMMENT 'Standard delivery fee in paise',
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `regional_overrides` JSON DEFAULT NULL COMMENT 'JSON list of state/pincode rate overrides',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_shipping_rules_enabled` (`is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 18. CAMPAIGNS TABLE
-- Marketing campaign graphics and landing parameters.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `campaigns`;
CREATE TABLE `campaigns` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `banner_url` VARCHAR(1000) DEFAULT NULL,
  `storage_path` VARCHAR(500) DEFAULT NULL COMMENT 'Path on Hostinger file system',
  `target_url` VARCHAR(1000) DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_campaigns_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 19. EVENTS TABLE
-- Time-bound promotional drops and flash sales targeting products or categories.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `events`;
CREATE TABLE `events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `event_type` VARCHAR(50) NOT NULL DEFAULT 'drop' COMMENT 'Event type e.g., drop, flash_sale',
  `start_time` DATETIME NOT NULL,
  `end_time` DATETIME NOT NULL,
  `discount_percent` INT NOT NULL DEFAULT 0,
  `target_products` JSON DEFAULT NULL COMMENT 'JSON array of product IDs',
  `target_categories` JSON DEFAULT NULL COMMENT 'JSON array of category IDs',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_events_active_times` (`active`, `start_time`, `end_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 20. AUDIT_LOGS TABLE
-- Administrative activity tracking and security audit log.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actor_id` VARCHAR(128) NOT NULL COMMENT 'Firebase UID of admin or system string',
  `actor_email` VARCHAR(255) DEFAULT NULL,
  `action` VARCHAR(255) NOT NULL COMMENT 'Action performed e.g., product.create, order.update_status',
  `entity_type` VARCHAR(100) DEFAULT NULL COMMENT 'Target entity type e.g., products, orders',
  `entity_id` VARCHAR(100) DEFAULT NULL COMMENT 'Target entity primary key or code',
  `details` JSON DEFAULT NULL COMMENT 'Contextual delta metadata',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_actor` (`actor_id`),
  KEY `idx_audit_logs_action` (`action`),
  KEY `idx_audit_logs_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-enable Foreign Key Checks
SET FOREIGN_KEY_CHECKS = 1;
