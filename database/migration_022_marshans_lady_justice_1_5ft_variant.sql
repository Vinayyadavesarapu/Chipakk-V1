-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 022: Add 1.5 FT Size Variant for Lady Justice Custom Forge
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS OBJECTIVE
--   Introduces a new 1.5 FT (18 inches / 457 mm) size edition for the Lady Justice
--   additive manufacturing sculpture on THE MARSHANS (Store ID 2).
--   Product/variant code: MRSH-CF-LJ-1.5FT
--
-- ARCHITECTURAL RULES & SAFETY GUARANTEES
--   1. Preserves existing 6-inch, 1-foot, and 2-foot variants.
--   2. Backward compatible: Reuses existing `custom_forge_product_variants` table.
--   3. Customizable: custom_mode_allowed = 1 (supports personalized legal nameplate).
--   4. Re-run safety / Idempotency: Uses NOT EXISTS guard against variant_sku.
--   5. Reversible: Rollback script provided below.
--   6. Store 1 (CHIPAKK) is 100% untouched.
-- =============================================================================

USE `u781826529_chipakk`;

SET @product_id := (
  SELECT `id`
  FROM `custom_forge_products`
  WHERE `slug` = 'lady-justice'
    AND `store_id` = 2
  LIMIT 1
);

-- Adjust display_order of 2 feet variant from 3 to 4 to accommodate 1.5 feet in natural sequence
UPDATE `custom_forge_product_variants`
SET `display_order` = 4
WHERE `product_id` = @product_id
  AND `variant_sku` = 'MRSH-CF-LJ-2FT'
  AND `display_order` = 3;

-- Insert 1.5 FT variant if it does not already exist
INSERT INTO `custom_forge_product_variants` (
  `product_id`,
  `variant_sku`,
  `size_label`,
  `height_mm`,
  `price`,
  `custom_mode_allowed`,
  `display_order`,
  `active`
)
SELECT
  @product_id,
  'MRSH-CF-LJ-1.5FT',
  '1.5 feet',
  457,
  499900,
  1,
  3,
  1
WHERE @product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `custom_forge_product_variants`
    WHERE `variant_sku` = 'MRSH-CF-LJ-1.5FT'
  );

-- =============================================================================
-- REVERSIBLE ROLLBACK INSTRUCTIONS (IF EVER NEEDED):
--
-- DELETE FROM `custom_forge_product_variants` WHERE `variant_sku` = 'MRSH-CF-LJ-1.5FT';
-- UPDATE `custom_forge_product_variants` SET `display_order` = 3 WHERE `variant_sku` = 'MRSH-CF-LJ-2FT' AND `display_order` = 4;
-- =============================================================================
