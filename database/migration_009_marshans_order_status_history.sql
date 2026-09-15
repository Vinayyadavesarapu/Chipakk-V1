-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 009: Order Status History & Audit Tracking
-- Database: u781826529_chipakk
-- Engine: MySQL 8.0+ / MariaDB 10.5+
-- =============================================================================

USE `u781826529_chipakk`;

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. CREATE ORDER STATUS HISTORY TABLE
-- Tracks chronological lifecycle transitions for every order across stores.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_status_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `status` VARCHAR(50) NOT NULL COMMENT 'Canonical machine or display status at transition time',
  `changed_by` VARCHAR(255) DEFAULT 'System' COMMENT 'Admin email, customer identity, or system worker',
  `note` TEXT DEFAULT NULL COMMENT 'Optional notes, transition rationale, or tracking numbers',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_status_history_order` (`order_id`, `created_at`),
  CONSTRAINT `fk_order_status_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. BACKFILL INITIAL STATUS HISTORY RECORD FOR EXISTING ORDERS
-- Ensures every pre-existing order has at least one baseline timeline record.
-- -----------------------------------------------------------------------------
INSERT INTO `order_status_history` (`order_id`, `status`, `changed_by`, `note`, `created_at`)
SELECT 
  o.`id`, 
  COALESCE(o.`fulfillment_status`, 'NEW'), 
  'System', 
  'Initial order status migration record', 
  o.`created_at`
FROM `orders` o
WHERE NOT EXISTS (
  SELECT 1 FROM `order_status_history` osh WHERE osh.`order_id` = o.`id`
);

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- Migration 009 Completed Successfully
-- =============================================================================
