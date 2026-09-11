-- =============================================================================
-- CHIPAKK Database Migration 004: Orders Customer Phone Column
-- Safe, non-destructive schema alignment
-- =============================================================================

USE `u781826529_chipakk`;

-- Add customer_phone column to orders table if missing
SET @exist := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'customer_phone'
);

SET @sql := IF(@exist = 0, 'ALTER TABLE `orders` ADD COLUMN `customer_phone` VARCHAR(50) DEFAULT NULL AFTER `customer_name`', 'SELECT "Column customer_phone already exists in orders" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
