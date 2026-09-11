-- =============================================================================
-- Migration 002: Add gateway_order_id to orders and create payments table
-- Phase 7: Real Payment Gateway Integration (Razorpay)
-- =============================================================================

-- 1. Add gateway_order_id to orders table if not already present
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'orders' 
  AND COLUMN_NAME = 'gateway_order_id';

SET @stmt = IF(@col_exists = 0, 
  'ALTER TABLE `orders` ADD COLUMN `gateway_order_id` VARCHAR(100) DEFAULT NULL COMMENT ''Razorpay or gateway payment order ID'' AFTER `coupon_code`, ADD KEY `idx_orders_gateway_order_id` (`gateway_order_id`);',
  'SELECT ''Column gateway_order_id already exists in orders'';'
);
PREPARE add_col_stmt FROM @stmt;
EXECUTE add_col_stmt;
DEALLOCATE PREPARE add_col_stmt;

-- 2. Create payments table for payment attempts, reconciliation, and webhook idempotency
CREATE TABLE IF NOT EXISTS `payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `provider` VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  `gateway_order_id` VARCHAR(100) NOT NULL,
  `gateway_payment_id` VARCHAR(100) DEFAULT NULL,
  `gateway_signature` VARCHAR(255) DEFAULT NULL,
  `amount` BIGINT NOT NULL COMMENT 'Payment attempt amount in paise',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'INR',
  `status` ENUM('created', 'authorized', 'captured', 'failed', 'refunded') NOT NULL DEFAULT 'created',
  `method` VARCHAR(50) DEFAULT NULL COMMENT 'upi, card, netbanking, wallet, etc.',
  `error_code` VARCHAR(100) DEFAULT NULL,
  `error_description` TEXT DEFAULT NULL,
  `raw_event_reference` VARCHAR(100) DEFAULT NULL COMMENT 'Webhook event ID for idempotency deduplication',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payments_gateway_payment` (`gateway_payment_id`),
  KEY `idx_payments_order` (`order_id`),
  KEY `idx_payments_gateway_order` (`gateway_order_id`),
  KEY `idx_payments_status` (`status`),
  KEY `idx_payments_event_ref` (`raw_event_reference`),
  CONSTRAINT `fk_payments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
