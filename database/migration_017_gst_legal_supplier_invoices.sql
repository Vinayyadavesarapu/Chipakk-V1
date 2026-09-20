-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 017: GST legal supplier, per-product HSN / GST rate, order tax snapshot, invoices
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS MODEL
--   CHIPAKK is a trade name of the SAME GST-registered legal entity as THE MARSHANS. There is ONE registration.
--   The registered entity is stored ONCE in `legal_suppliers` and linked to both stores. There is no second
--   GSTIN and nothing in this file invents one.
--
-- SAFETY GUARANTEES
--   1. Purely additive DDL. No DROP, no data rewrite, no changed money units (Store 1 = whole rupees,
--      Store 2 = integer paise, exactly as before).
--   2. Idempotent: every change is guarded by INFORMATION_SCHEMA checks and can be re-run safely.
--   3. NO SEED DATA: this migration does not insert a GSTIN, legal name, address, seller state, HSN code or
--      GST rate. Those are entered by an administrator (Admin -> Settings -> Business & Tax, and per
--      product / category) or supplied by the business owner. Until they are entered, checkout refuses to
--      create GST orders and invoices cannot be issued (see docs/GST_AND_DEPLOYMENT.md).
--   4. It does not touch existing rows: orders placed before this migration keep the snapshot they have.
--
-- DO NOT EXECUTE AUTOMATICALLY AGAINST PRODUCTION. Review with the database owner first, take a backup,
-- then run it through the approved deployment process.
-- =============================================================================

USE `u781826529_chipakk`;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. LEGAL SUPPLIERS  (the single registered entity behind both storefronts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `legal_suppliers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `legal_name` VARCHAR(255) NOT NULL COMMENT 'Registered legal name exactly as on the GST registration',
  `gstin` CHAR(15) NOT NULL COMMENT 'The one GSTIN of the registered entity',
  `address` TEXT NOT NULL COMMENT 'Registered principal place of business, as printed on invoices',
  `state` VARCHAR(100) NOT NULL COMMENT 'State / UT name (derived from the GSTIN state code)',
  `state_code` CHAR(2) NOT NULL COMMENT 'GST state code = first two characters of the GSTIN',
  `pincode` VARCHAR(10) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_legal_suppliers_gstin` (`gstin`),
  KEY `idx_legal_suppliers_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- stores.legal_supplier_id : both stores point at the same row (nullable; when NULL and exactly one active
-- supplier exists, that supplier is used).
SET @has_stores := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores');
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stores' AND COLUMN_NAME = 'legal_supplier_id');
SET @sql := IF(@has_stores = 1 AND @has_col = 0,
  'ALTER TABLE `stores` ADD COLUMN `legal_supplier_id` BIGINT DEFAULT NULL COMMENT "Registered legal entity that supplies this store" AFTER `business_type`',
  'SELECT "stores.legal_supplier_id: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 2. HSN + GST RATE CONFIGURATION  (product > category > store default rate)
--    Nullable on purpose: an unset HSN is NEVER guessed. Rate NULL = use the store's default GST rate.
-- -----------------------------------------------------------------------------
SET @t := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products');
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'hsn_code');
SET @sql := IF(@t = 1 AND @c = 0,
  'ALTER TABLE `products` ADD COLUMN `hsn_code` VARCHAR(8) DEFAULT NULL COMMENT "HSN (4, 6 or 8 digits); NULL = inherit from category, never guessed", ADD COLUMN `gst_rate` DECIMAL(5,2) DEFAULT NULL COMMENT "GST %; NULL = inherit category / store default"',
  'SELECT "products.hsn_code/gst_rate: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories');
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'hsn_code');
SET @sql := IF(@t = 1 AND @c = 0,
  'ALTER TABLE `categories` ADD COLUMN `hsn_code` VARCHAR(8) DEFAULT NULL COMMENT "Default HSN for products in this category", ADD COLUMN `gst_rate` DECIMAL(5,2) DEFAULT NULL COMMENT "Default GST % for products in this category"',
  'SELECT "categories.hsn_code/gst_rate: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marshans_products');
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marshans_products' AND COLUMN_NAME = 'hsn_code');
SET @sql := IF(@t = 1 AND @c = 0,
  'ALTER TABLE `marshans_products` ADD COLUMN `hsn_code` VARCHAR(8) DEFAULT NULL COMMENT "HSN (4, 6 or 8 digits); NULL = inherit from category, never guessed", ADD COLUMN `gst_rate` DECIMAL(5,2) DEFAULT NULL COMMENT "GST %; NULL = inherit category / store default"',
  'SELECT "marshans_products.hsn_code/gst_rate: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marshans_categories');
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marshans_categories' AND COLUMN_NAME = 'hsn_code');
SET @sql := IF(@t = 1 AND @c = 0,
  'ALTER TABLE `marshans_categories` ADD COLUMN `hsn_code` VARCHAR(8) DEFAULT NULL COMMENT "Default HSN for products in this category", ADD COLUMN `gst_rate` DECIMAL(5,2) DEFAULT NULL COMMENT "Default GST % for products in this category"',
  'SELECT "marshans_categories.hsn_code/gst_rate: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 3. ORDERS: SUPPLIER / PLACE-OF-SUPPLY / SHIPPING-TAX SNAPSHOT  (money columns follow the store's unit)
-- -----------------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'supplier_gstin');
SET @sql := IF(@c = 0,
  'ALTER TABLE `orders`
     ADD COLUMN `supplier_legal_name` VARCHAR(255) DEFAULT NULL COMMENT "Snapshot: registered legal supplier name at purchase",
     ADD COLUMN `supplier_trade_name` VARCHAR(255) DEFAULT NULL COMMENT "Snapshot: CHIPAKK / THE MARSHANS",
     ADD COLUMN `supplier_gstin` CHAR(15) DEFAULT NULL COMMENT "Snapshot: supplier GSTIN at purchase",
     ADD COLUMN `supplier_address` TEXT DEFAULT NULL COMMENT "Snapshot: supplier address at purchase",
     ADD COLUMN `supplier_state` VARCHAR(100) DEFAULT NULL,
     ADD COLUMN `supplier_state_code` CHAR(2) DEFAULT NULL,
     ADD COLUMN `place_of_supply` VARCHAR(100) DEFAULT NULL COMMENT "Delivery state name",
     ADD COLUMN `place_of_supply_code` CHAR(2) DEFAULT NULL COMMENT "Delivery state GST code",
     ADD COLUMN `tax_supply_type` VARCHAR(12) DEFAULT NULL COMMENT "INTRA (CGST+SGST) | INTER (IGST) | NONE (GST disabled)",
     ADD COLUMN `tax_pricing_mode` VARCHAR(12) DEFAULT NULL COMMENT "inclusive (prices already contain GST)",
     ADD COLUMN `recipient_gstin` CHAR(15) DEFAULT NULL COMMENT "Buyer GSTIN when the customer supplied one (B2B)",
     ADD COLUMN `shipping_taxable_value` BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN `shipping_tax_rate` DECIMAL(5,2) NOT NULL DEFAULT 0,
     ADD COLUMN `shipping_tax_amount` BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN `shipping_cgst_amount` BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN `shipping_sgst_amount` BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN `shipping_igst_amount` BIGINT NOT NULL DEFAULT 0',
  'SELECT "orders supplier/tax snapshot columns: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 4. ORDER ITEMS: per-line taxable value, tax split and allocated discount (hsn_code / tax_rate / tax_amount
--    already exist from migration 016)
-- -----------------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'taxable_value');
SET @sql := IF(@c = 0,
  'ALTER TABLE `order_items`
     ADD COLUMN `discount_allocated` BIGINT NOT NULL DEFAULT 0 COMMENT "Share of the order discount allocated to this line",
     ADD COLUMN `taxable_value` BIGINT NOT NULL DEFAULT 0 COMMENT "Line value net of discount and of the GST it contains",
     ADD COLUMN `cgst_amount` BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN `sgst_amount` BIGINT NOT NULL DEFAULT 0,
     ADD COLUMN `igst_amount` BIGINT NOT NULL DEFAULT 0',
  'SELECT "order_items tax split columns: nothing to do" AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- -----------------------------------------------------------------------------
-- 5. INVOICE NUMBERING  (sequential, gap-free, unique per series and financial year)
--    Number format: <PREFIX>/<YY-YY>/<6-digit sequence>, e.g. CHP/25-26/000001  (16 characters, GST Rule 46 limit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `invoice_sequences` (
  `series_prefix` VARCHAR(5) NOT NULL COMMENT 'e.g. CHP, MRS (configurable per store, max 3 chars to stay within 16)',
  `financial_year` CHAR(7) NOT NULL COMMENT 'e.g. 2025-26 (1 April - 31 March, India)',
  `last_number` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`series_prefix`, `financial_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `invoice_number` VARCHAR(16) NOT NULL,
  `series_prefix` VARCHAR(5) NOT NULL,
  `financial_year` CHAR(7) NOT NULL,
  `sequence_no` INT NOT NULL,
  `invoice_date` DATETIME NOT NULL,
  `order_id` BIGINT NOT NULL,
  `store_id` BIGINT NOT NULL,
  `status` ENUM('ISSUED', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
  `money_unit` ENUM('rupees', 'paise') NOT NULL COMMENT 'Unit of every amount on the invoice / its order',
  `supplier_legal_name` VARCHAR(255) NOT NULL,
  `supplier_trade_name` VARCHAR(255) NOT NULL,
  `supplier_gstin` CHAR(15) NOT NULL,
  `supplier_address` TEXT NOT NULL,
  `supplier_state` VARCHAR(100) NOT NULL,
  `supplier_state_code` CHAR(2) NOT NULL,
  `recipient_name` VARCHAR(255) NOT NULL,
  `recipient_address` TEXT NOT NULL,
  `recipient_gstin` CHAR(15) DEFAULT NULL,
  `place_of_supply` VARCHAR(100) NOT NULL,
  `place_of_supply_code` CHAR(2) NOT NULL,
  `supply_type` VARCHAR(12) NOT NULL,
  `taxable_value` BIGINT NOT NULL,
  `discount_total` BIGINT NOT NULL DEFAULT 0,
  `shipping_charge` BIGINT NOT NULL DEFAULT 0,
  `cgst_amount` BIGINT NOT NULL DEFAULT 0,
  `sgst_amount` BIGINT NOT NULL DEFAULT 0,
  `igst_amount` BIGINT NOT NULL DEFAULT 0,
  `total_value` BIGINT NOT NULL,
  `issued_by` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invoices_number` (`invoice_number`),
  UNIQUE KEY `uk_invoices_series_seq` (`series_prefix`, `financial_year`, `sequence_no`),
  UNIQUE KEY `uk_invoices_order` (`order_id`),
  KEY `idx_invoices_store_date` (`store_id`, `invoice_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

-- =============================================================================
-- Migration 017 prepared. NOTHING was seeded. Next steps (docs/GST_AND_DEPLOYMENT.md):
--   1. Enter the registered supplier in Admin -> Settings -> Business & Tax (GSTIN, legal name, address).
--   2. Set the HSN (and, if different from the store default, the GST rate) on each category / product.
--   3. Confirm store settings: trade name, default GST rate, invoice prefix.
-- =============================================================================
