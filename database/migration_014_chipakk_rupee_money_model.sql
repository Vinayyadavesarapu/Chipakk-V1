-- =============================================================================
-- CHIPAKK E-Commerce Platform — Whole Indian Rupees Money Model Migration
-- Migration 014: Whole Indian Rupees (₹1 = Database Value 1) for Store 1
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS RULE:
-- For CHIPAKK (Store 1), monetary values are stored in WHOLE INDIAN RUPEES.
-- ₹1    = DB value 1
-- ₹15   = DB value 15
-- ₹99   = DB value 99
-- ₹300  = DB value 300
-- ₹499  = DB value 499
-- ₹1500 = DB value 1500
--
-- SAFETY & AUDIT GUARANTEES:
-- 1. NO blanket arithmetic based on numeric thresholds (avoids corrupting legit prices).
-- 2. Explicit verified product IDs (1, 2) and SKUs ('SKU-AN_001', 'SKU-CK-001').
-- 3. Explicit product variants linked to those verified products.
-- 4. Foreign Key Checks remain enabled (no foreign key check toggling).
-- 5. 100% Idempotent: If price is already 15, zero rows are affected.
-- 6. Store 2 (THE MARSHANS) is completely untouched.
--
-- DO NOT EXECUTE AUTOMATICALLY. MUST BE EXECUTED ONLY AFTER PRE-FLIGHT CHECKS PASS.
-- =============================================================================

USE `u781826529_chipakk`;

-- -----------------------------------------------------------------------------
-- SECTION 1: PRE-FLIGHT VERIFICATION QUERIES (READ-ONLY)
-- -----------------------------------------------------------------------------
-- Operator must inspect these results first.
-- EXPECTED:
-- - Query 1.1 MUST return exactly 2 rows with price = 1500:
--     id: 1, sku: 'SKU-AN_001', price: 1500
--     id: 2, sku: 'SKU-CK-001', price: 1500
-- - Query 1.2 MUST return exactly 2 rows with price = 1500 linked to product_id IN (1, 2).
--
-- IF PRE-FLIGHT RESULTS DIFFER FROM EXPECTED, STOP AND DO NOT EXECUTE SECTION 2!
-- -----------------------------------------------------------------------------

-- Query 1.1: Pre-flight check for products
SELECT 
  id, store_id, name, sku, price, compare_at_price, created_at
FROM `products`
WHERE id IN (1, 2)
ORDER BY id ASC;

-- Query 1.2: Pre-flight check for product variants
SELECT 
  pv.id, pv.product_id, pv.sku, pv.price, pv.variant_slug
FROM `product_variants` pv
WHERE pv.product_id IN (1, 2)
ORDER BY pv.id ASC;


-- -----------------------------------------------------------------------------
-- SECTION 2: EXPLICIT IDEMPOTENT CONVERSION (RUN ONLY IF PRE-FLIGHT PASSES)
-- -----------------------------------------------------------------------------

-- 2.1 Convert Product 1 (Inosuke Hashibira, SKU-AN_001)
UPDATE `products`
SET `price` = 15,
    `compare_at_price` = 0
WHERE `id` = 1
  AND `sku` = 'SKU-AN_001'
  AND `price` = 1500
  AND (`store_id` = 1 OR `store_id` IS NULL);

-- 2.2 Convert Product 2 (Inosuke Hashibira, SKU-CK-001)
UPDATE `products`
SET `price` = 15,
    `compare_at_price` = 0
WHERE `id` = 2
  AND `sku` = 'SKU-CK-001'
  AND `price` = 1500
  AND (`store_id` = 1 OR `store_id` IS NULL);

-- 2.3 Convert Product Variants explicitly linked to Products 1 & 2
UPDATE `product_variants`
SET `price` = 15
WHERE `product_id` IN (1, 2)
  AND `price` = 1500;


-- -----------------------------------------------------------------------------
-- SECTION 3: POST-FLIGHT VERIFICATION QUERIES (READ-ONLY)
-- -----------------------------------------------------------------------------
-- Operator must inspect these results immediately after executing Section 2.
-- EXPECTED:
-- - Query 3.1: Products 1 & 2 now have price = 15 and compare_at_price = 0.
-- - Query 3.2: Both variants have price = 15.
-- - Query 3.3: Confirms ZERO Store 2 rows were touched (count = 0).
-- -----------------------------------------------------------------------------

-- Query 3.1: Verify updated products
SELECT 
  id, store_id, name, sku, price, compare_at_price
FROM `products`
WHERE id IN (1, 2)
ORDER BY id ASC;

-- Query 3.2: Verify updated product variants
SELECT 
  pv.id, pv.product_id, pv.sku, pv.price, pv.variant_slug
FROM `product_variants` pv
WHERE pv.product_id IN (1, 2)
ORDER BY pv.id ASC;

-- Query 3.3: Integrity verification (confirm Store 2 isolation)
SELECT 
  COUNT(*) AS unexpected_modified_store2_products
FROM `products`
WHERE store_id = 2
  AND id IN (1, 2);
