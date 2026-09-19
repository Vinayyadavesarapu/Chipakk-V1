-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 015: Clarify Currency Column Comments for CHIPAKK Whole Rupees
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- PURPOSE:
-- Updates database column metadata comments on `products` and `product_variants`
-- to accurately document CHIPAKK's canonical Whole Indian Rupees money model
-- (₹1 = 1, ₹15 = 15, ₹1500 = 1500) while preserving Store 2 paise documentation.
--
-- STRICT SAFETY GUARANTEES:
-- 1. PURELY METADATA: Modifies only column comments.
-- 2. ZERO DATA MODIFICATION: Numeric types (BIGINT) and existing row values unchanged.
-- 3. NO DESTRUCTIVE DDL: No table or column drops.
-- 4. 100% IDEMPOTENT.
--
-- DO NOT EXECUTE AUTOMATICALLY AGAINST PRODUCTION.
-- =============================================================================

USE `u781826529_chipakk`;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Update `products.price` comment
ALTER TABLE `products`
  MODIFY COLUMN `price` BIGINT NOT NULL DEFAULT 0
  COMMENT 'Store 1 (CHIPAKK): Whole Indian Rupees (₹15 = 15). Store 2 (THE MARSHANS): Paise (₹15 = 1500)';

-- 2. Update `products.compare_at_price` comment
ALTER TABLE `products`
  MODIFY COLUMN `compare_at_price` BIGINT NOT NULL DEFAULT 0
  COMMENT 'Store 1 (CHIPAKK): Whole Indian Rupees (₹15 = 15). Store 2 (THE MARSHANS): Paise (₹15 = 1500)';

-- 3. Update `product_variants.price` comment
ALTER TABLE `product_variants`
  MODIFY COLUMN `price` BIGINT NOT NULL
  COMMENT 'Store 1 (CHIPAKK): Whole Indian Rupees (₹15 = 15). Store 2 (THE MARSHANS): Paise (₹15 = 1500)';

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

-- =============================================================================
-- Migration 015 Prepared Successfully (Metadata / Comments Only)
-- =============================================================================
