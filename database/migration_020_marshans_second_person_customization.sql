-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 020: THE MARSHANS Optional Second-Person Customization for Lady Justice
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS OBJECTIVE
--   Enables customers to optionally specify a second person's name and designation
--   for eligible Lady Justice editions (1 foot and 2 feet) on THE MARSHANS (Store ID 2).
--   Example: Two partners, co-advocates, or joint honorees on the lotus plinth.
--
-- ARCHITECTURAL RULES & SAFETY GUARANTEES
--   1. Purely additive: Reuses existing `custom_forge_order_customizations` table.
--   2. Backward compatible: Both new columns are NULLable. All existing single-person
--      orders remain 100% valid with NULL second-person fields.
--   3. Field Limits:
--       * `second_customer_name`: VARCHAR(35) NULL (max 35 chars, identical to Person 1)
--       * `second_customer_designation`: VARCHAR(50) NULL (max 50 chars, identical to Person 1)
--   4. Zero pricing impact: Adding a second person incurs no additional surcharge.
--   5. Store 1 (CHIPAKK) is 100% untouched.
--   6. Re-run safety / Idempotency: Uses dynamic conditional check against
--      INFORMATION_SCHEMA.COLUMNS to ensure repeat runs never error or duplicate columns.
--
-- DO NOT EXECUTE AUTOMATICALLY. PREPARED FOR INSPECTION & REVIEW ONLY.
-- =============================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS `AddSecondPersonCustomizationColumns`$$

CREATE PROCEDURE `AddSecondPersonCustomizationColumns`()
BEGIN
  -- 1. Add `second_customer_name` if not exists
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'custom_forge_order_customizations'
      AND COLUMN_NAME = 'second_customer_name'
  ) THEN
    ALTER TABLE `custom_forge_order_customizations`
      ADD COLUMN `second_customer_name` VARCHAR(35) DEFAULT NULL
      COMMENT 'Second person nameplate name (max 35 chars, optional)'
      AFTER `customer_designation`;
  END IF;

  -- 2. Add `second_customer_designation` if not exists
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'custom_forge_order_customizations'
      AND COLUMN_NAME = 'second_customer_designation'
  ) THEN
    ALTER TABLE `custom_forge_order_customizations`
      ADD COLUMN `second_customer_designation` VARCHAR(50) DEFAULT NULL
      COMMENT 'Second person nameplate designation (max 50 chars, optional)'
      AFTER `second_customer_name`;
  END IF;
END$$

DELIMITER ;

-- Execute the idempotent procedure safely
CALL `AddSecondPersonCustomizationColumns`();

-- Clean up the temporary procedure
DROP PROCEDURE IF EXISTS `AddSecondPersonCustomizationColumns`;

-- =============================================================================
-- VERIFICATION QUERY (READ-ONLY)
-- Run to verify column definitions without altering state:
-- =============================================================================
-- SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
-- FROM INFORMATION_SCHEMA.COLUMNS
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME = 'custom_forge_order_customizations'
-- ORDER BY ORDINAL_POSITION;
