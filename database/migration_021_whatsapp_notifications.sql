-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 021: WhatsApp Order Notifications & Audit Ledger
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS OBJECTIVE
--   Establishes an authoritative, idempotent notification ledger for WhatsApp
--   order notifications for THE MARSHANS (Store ID 2).
--
--   Supported Meta Templates:
--   1. marshans_order_confirmation  (Triggered on verified Razorpay payment)
--   2. marshans_shipping_update      (Triggered when order actually shipped)
--   3. marshans_out_for_delivery     (Triggered when marked out for delivery)
--   4. marshans_order_delivered      (Triggered when delivery is confirmed)
--   5. marshans_customer_feedback    (Triggered ~24h after delivery)
--
-- ARCHITECTURAL RULES & SAFETY GUARANTEES
--   1. Idempotency: Unique key on (store_id, event_type, order_id, is_custom_forge)
--      guarantees duplicate confirmations or updates can never be sent.
--   2. Store Scoping: Explicit store_id ensures Store 1 (CHIPAKK) and Store 2 (THE MARSHANS)
--      remain strictly isolated. Store 1 orders never receive Store 2 templates.
--   3. Auditability: Records template name, language, delivery status, Meta message ID,
--      payload snapshots, and error reasons.
--   4. Delayed / Scheduled Notifications: Includes scheduled_at for 24h feedback requests.
--   5. Zero impact on existing tables: Purely additive table creation.
--   6. Re-run safety / Idempotency: Uses CREATE TABLE IF NOT EXISTS.
-- =============================================================================

USE `u781826529_chipakk`;

CREATE TABLE IF NOT EXISTS `whatsapp_notification_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` INT NOT NULL DEFAULT 2 COMMENT 'Store ID: strictly 2 for THE MARSHANS',
  `order_id` BIGINT NOT NULL COMMENT 'References orders(id) or custom_forge_orders(id)',
  `order_number` VARCHAR(100) NOT NULL COMMENT 'Format: MRSH-YYYY-XXXX or CF-MRSH-YYYY-XXXX',
  `is_custom_forge` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0 = Retail, 1 = Custom Forge',
  `event_type` VARCHAR(50) NOT NULL COMMENT 'order_confirmation, shipping_update, out_for_delivery, order_delivered, customer_feedback',
  `recipient_phone` VARCHAR(20) NOT NULL COMMENT 'E.164 phone number without plus (e.g. 919876543210)',
  `customer_name` VARCHAR(255) DEFAULT NULL COMMENT 'Recipient customer name',
  `template_name` VARCHAR(100) NOT NULL COMMENT 'Meta approved template name',
  `template_language` VARCHAR(20) DEFAULT 'en' COMMENT 'Template language code',
  `template_status` VARCHAR(50) DEFAULT 'APPROVED' COMMENT 'PENDING, APPROVED, REJECTED',
  `payload` JSON DEFAULT NULL COMMENT 'Snapshot of the JSON payload sent to Meta Cloud API',
  `meta_message_id` VARCHAR(100) DEFAULT NULL COMMENT 'wamid returned by Meta API on success',
  `status` VARCHAR(50) NOT NULL DEFAULT 'queued' COMMENT 'queued, sent, delivered, read, failed, skipped, gated',
  `attempts` INT NOT NULL DEFAULT 1,
  `error_message` TEXT DEFAULT NULL,
  `scheduled_at` DATETIME DEFAULT NULL COMMENT 'Scheduled timestamp for delayed events (e.g. 24h post delivery)',
  `sent_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_store_event_order` (`store_id`, `event_type`, `order_id`, `is_custom_forge`),
  KEY `idx_wnl_status_scheduled` (`status`, `scheduled_at`),
  KEY `idx_wnl_order_lookup` (`store_id`, `order_number`),
  KEY `idx_wnl_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- REVERSIBLE ROLLBACK INSTRUCTIONS (IF EVER NEEDED):
--
-- DROP TABLE IF EXISTS `whatsapp_notification_logs`;
-- =============================================================================
