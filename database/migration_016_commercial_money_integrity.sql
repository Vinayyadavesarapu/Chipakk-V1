-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 016: Commercial Money Integrity, Tax Snapshots & Coupon Concurrency
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- Safety Guarantees:
-- 1. Purely Additive DDL.
-- 2. Zero destructive DROP TABLE or column drops.
-- 3. Fully idempotent with information_schema conditional checks.
-- 4. Preserves Store 1 (whole rupees) and Store 2 (integer paise) data.
-- 5. Safe defaults: all new tax fields default to 0 for historical orders.
--
-- DO NOT EXECUTE AUTOMATICALLY AGAINST PRODUCTION. LOCAL REFERENCE ONLY.
-- =============================================================================

USE `u781826529_chipakk`;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. ORDERS TABLE: TAX SNAPSHOT & SHIPPING METHOD
-- -----------------------------------------------------------------------------
SET @exist_orders_tax := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'tax_amount'
);
SET @sql_orders_tax := IF(@exist_orders_tax = 0,
  'ALTER TABLE `orders`
     ADD COLUMN `tax_amount` BIGINT NOT NULL DEFAULT 0 COMMENT "Total included GST (rupees for Store 1, paise for Store 2)" AFTER `shipping_charge`,
     ADD COLUMN `cgst_amount` BIGINT NOT NULL DEFAULT 0 COMMENT "Central GST breakdown" AFTER `tax_amount`,
     ADD COLUMN `sgst_amount` BIGINT NOT NULL DEFAULT 0 COMMENT "State GST breakdown" AFTER `cgst_amount`,
     ADD COLUMN `igst_amount` BIGINT NOT NULL DEFAULT 0 COMMENT "Integrated GST breakdown" AFTER `sgst_amount`,
     ADD COLUMN `shipping_method` VARCHAR(50) NOT NULL DEFAULT "standard" COMMENT "standard or express" AFTER `shipping_address`;',
  'SELECT "Columns tax_amount, cgst_amount, sgst_amount, igst_amount, shipping_method already exist in orders" AS msg;'
);
PREPARE stmt FROM @sql_orders_tax; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2. ORDER_ITEMS TABLE: HSN AND TAX ALLOCATION SNAPSHOT
-- -----------------------------------------------------------------------------
SET @exist_items_hsn := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'hsn_code'
);
SET @sql_items_hsn := IF(@exist_items_hsn = 0,
  'ALTER TABLE `order_items`
     ADD COLUMN `hsn_code` VARCHAR(20) DEFAULT NULL COMMENT "Authoritative HSN snapshot (e.g. 4911 / 3926)" AFTER `sku`,
     ADD COLUMN `tax_rate` DECIMAL(5,2) NOT NULL DEFAULT 18.00 COMMENT "Applicable GST percentage" AFTER `hsn_code`,
     ADD COLUMN `tax_amount` BIGINT NOT NULL DEFAULT 0 COMMENT "Allocated tax amount in store units" AFTER `tax_rate`;',
  'SELECT "Columns hsn_code, tax_rate, tax_amount already exist in order_items" AS msg;'
);
PREPARE stmt FROM @sql_items_hsn; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 3. COUPONS TABLE: PER-CUSTOMER USAGE LIMIT
-- -----------------------------------------------------------------------------
SET @exist_coupons_cust_limit := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons' AND COLUMN_NAME = 'per_customer_limit'
);
SET @sql_coupons_cust_limit := IF(@exist_coupons_cust_limit = 0,
  'ALTER TABLE `coupons`
     ADD COLUMN `per_customer_limit` INT NOT NULL DEFAULT 1 COMMENT "Max successful redemptions per authenticated customer" AFTER `usage_limit`;',
  'SELECT "Column per_customer_limit already exists in coupons" AS msg;'
);
PREPARE stmt FROM @sql_coupons_cust_limit; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 4. COUPON_USAGE TABLE: RESERVATION LIFECYCLE
-- -----------------------------------------------------------------------------
SET @exist_usage_status := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupon_usage' AND COLUMN_NAME = 'status'
);
SET @sql_usage_status := IF(@exist_usage_status = 0,
  'ALTER TABLE `coupon_usage`
     ADD COLUMN `status` ENUM(\'reserved\', \'consumed\', \'released\') NOT NULL DEFAULT \'consumed\' COMMENT "Redemption lifecycle" AFTER `discount_amount`,
     ADD COLUMN `reserved_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT "Reservation timestamp" AFTER `status`,
     ADD KEY `idx_coupon_usage_status_reserved` (`coupon_id`, `status`, `reserved_at`);',
  'SELECT "Column status already exists in coupon_usage" AS msg;'
);
PREPARE stmt FROM @sql_usage_status; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 5. STORE_SETTINGS: DEFAULT SELLER STATE AND GSTIN AUDIT KEYS
-- -----------------------------------------------------------------------------
INSERT INTO `store_settings` (`store_id`, `setting_key`, `setting_value`)
VALUES
  (1, 'seller_state', '"Delhi"'),
  (2, 'seller_state', '"Delhi"')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

-- =============================================================================
-- Migration 016 Prepared Successfully
-- =============================================================================
