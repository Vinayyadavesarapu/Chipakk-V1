-- =============================================================================
-- CHIPAKK & THE MARSHANS Unified Multi-Store Platform
-- Migration 019: THE MARSHANS Dedicated Custom Forge Ordering System
-- Engine: MySQL 8.0+ / MariaDB 10.5+
--
-- BUSINESS MODEL
--   Implements dedicated Custom Forge 3D additive manufacturing ordering system
--   for THE MARSHANS (Store ID 2).
--   - Starting Product: Lady Justice
--   - Size Variants:
--       * 6 inches: ₹1,600 (160,000 paise) — Custom Mode UNAVAILABLE
--       * 1 foot:   ₹3,500 (350,000 paise) — Custom Mode OPTIONAL
--       * 2 feet:   ₹5,600 (560,000 paise) — Custom Mode OPTIONAL
--   - Custom Mode (No extra charge):
--       * Name: required, max 35 characters
--       * Designation: required, max 50 characters (literal "NIL" accepted)
--       * Nameplate Material: required, 'Plastic' or 'MDF'
--   - Order Number Format: CF-MRSH-YYYY-XXXX (collision-safe generation)
--   - Guest Checkout: Strictly prohibited. Mandatory authenticated customer.
--
-- ARCHITECTURAL SEPARATION & SAFETY GUARANTEES
--   1. Zero modification to existing retail tables: `orders`, `order_items`,
--      `payments`, `products`, `marshans_products`.
--   2. Purely additive DDL: Creates 7 dedicated `custom_forge_*` tables.
--   3. Reuses authenticated customer identities in `users` (via customer_id FK)
--      without coupling Custom Forge orders to retail orders.
--   4. Preserves Store 2 integer paise monetary representation (₹1 = 100 paise).
--   5. Store 1 (CHIPAKK) is 100% untouched.
--   6. Engine-level Store 2 Isolation: Enforced via `CHECK (store_id = 2)`.
--   7. Idempotent & Non-Destructive Seeds: Uses `INSERT IGNORE` to guarantee that
--      repeat migration execution NEVER overwrites administrator-managed prices,
--      descriptions, or active flags.
--   8. Natural Foreign Key Order: All tables are created in strict dependency
--      order without disabling `FOREIGN_KEY_CHECKS`.
--   9. Runner Compatibility: No hardcoded `USE <database>` statement, ensuring
--      seamless execution across local, CI, staging, and production environments.
--
-- DO NOT EXECUTE AUTOMATICALLY. PREPARED FOR INSPECTION & REVIEW ONLY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `custom_forge_products`
-- Master catalog items for THE MARSHANS Custom Forge line.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2 COMMENT 'Store ID: strictly 2 for THE MARSHANS',
  `slug` VARCHAR(100) NOT NULL COMMENT 'URL identifier e.g. lady-justice',
  `name` VARCHAR(255) NOT NULL COMMENT 'Display title e.g. Lady Justice',
  `tagline` VARCHAR(255) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `base_model_sku` VARCHAR(100) NOT NULL COMMENT 'Base model SKU e.g. MRSH-CF-LJ',
  `hero_image_url` VARCHAR(1000) DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = visible in Custom Forge studio, 0 = inactive',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_custom_forge_prod_slug` (`slug`),
  UNIQUE KEY `uk_custom_forge_prod_sku` (`base_model_sku`),
  KEY `idx_custom_forge_prod_store_active` (`store_id`, `active`),
  CONSTRAINT `fk_custom_forge_prod_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_custom_forge_prod_store` CHECK (`store_id` = 2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. `custom_forge_product_variants`
-- Physical size options, authoritative pricing (in paise), and custom mode rules.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_product_variants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `variant_sku` VARCHAR(100) NOT NULL COMMENT 'e.g. MRSH-CF-LJ-6IN, MRSH-CF-LJ-1FT, MRSH-CF-LJ-2FT',
  `size_label` VARCHAR(50) NOT NULL COMMENT 'e.g. 6 inches, 1 foot, 2 feet',
  `height_mm` INT NOT NULL COMMENT 'Approximate physical height in mm: 152 for 6in, 305 for 1ft, 610 for 2ft',
  `price` BIGINT NOT NULL COMMENT 'Price in integer paise: 199900 for ₹1,999, 369900 for ₹3,699, 599900 for ₹5,999',
  `custom_mode_allowed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0 for 6 inches; 1 for 1 foot and 2 feet',
  `display_order` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_custom_forge_var_sku` (`variant_sku`),
  KEY `idx_custom_forge_var_prod` (`product_id`),
  KEY `idx_custom_forge_var_active` (`active`),
  CONSTRAINT `fk_custom_forge_var_prod` FOREIGN KEY (`product_id`) REFERENCES `custom_forge_products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. `custom_forge_orders`
-- Header records for Custom Forge orders. Strictly segregated from retail orders.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL DEFAULT 2 COMMENT 'Store ID: strictly 2 for THE MARSHANS',
  `order_number` VARCHAR(64) NOT NULL COMMENT 'Format: CF-MRSH-YYYY-XXXX',
  `customer_id` BIGINT NOT NULL COMMENT 'References users(id) - guest checkout is prohibited',
  `customer_email` VARCHAR(255) NOT NULL COMMENT 'Snapshot of customer email at purchase',
  `customer_name` VARCHAR(255) NOT NULL COMMENT 'Snapshot of customer name at purchase',
  `customer_phone` VARCHAR(50) NOT NULL COMMENT 'Snapshot of customer phone at purchase',
  `shipping_address` JSON NOT NULL COMMENT 'Snapshot: { name, phone, address, city, state, pincode, country }',
  `shipping_charge` BIGINT NOT NULL DEFAULT 0 COMMENT 'Shipping fee in integer paise (calculated via Marshans shipping rules)',
  `subtotal` BIGINT NOT NULL COMMENT 'Merchandise subtotal in integer paise (inclusive of applicable GST)',
  `tax_amount` BIGINT NOT NULL DEFAULT 0 COMMENT 'Total included GST in integer paise (tax_pricing_mode: inclusive)',
  `cgst_amount` BIGINT NOT NULL DEFAULT 0 COMMENT 'Central GST breakdown in paise (intra-state sales)',
  `sgst_amount` BIGINT NOT NULL DEFAULT 0 COMMENT 'State GST breakdown in paise (intra-state sales)',
  `igst_amount` BIGINT NOT NULL DEFAULT 0 COMMENT 'Integrated GST breakdown in paise (inter-state sales)',
  `total_price` BIGINT NOT NULL COMMENT 'Grand total in integer paise: subtotal + shipping_charge',
  `payment_method` VARCHAR(50) NOT NULL DEFAULT 'ONLINE' COMMENT 'Payment mode e.g. ONLINE, RAZORPAY',
  `payment_status` ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending' COMMENT 'Marked paid only upon gateway verification',
  `production_status` ENUM(
    'order_placed',
    '3d_printing',
    'post_processing',
    'nameplate_fabrication',
    'quality_check',
    'ready_to_ship',
    'shipped',
    'delivered',
    'cancelled'
  ) NOT NULL DEFAULT 'order_placed',
  `customer_notes` TEXT DEFAULT NULL,
  `admin_notes` TEXT DEFAULT NULL,
  `gateway_order_id` VARCHAR(100) DEFAULT NULL COMMENT 'Razorpay order ID populated upon payment initialization',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cf_orders_number` (`order_number`),
  KEY `idx_cf_orders_store_status` (`store_id`, `production_status`),
  KEY `idx_cf_orders_customer` (`customer_id`),
  KEY `idx_cf_orders_payment_status` (`payment_status`),
  KEY `idx_cf_orders_gateway_order` (`gateway_order_id`),
  KEY `idx_cf_orders_created_at` (`created_at`),
  CONSTRAINT `fk_cf_orders_store` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_cf_orders_store` CHECK (`store_id` = 2),
  CONSTRAINT `fk_cf_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. `custom_forge_order_items`
-- Order line items preserving historical variant, size, and price snapshots.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `product_id` BIGINT DEFAULT NULL COMMENT 'References custom_forge_products(id)',
  `variant_id` BIGINT DEFAULT NULL COMMENT 'References custom_forge_product_variants(id)',
  `product_name_snapshot` VARCHAR(255) NOT NULL COMMENT 'e.g. Lady Justice',
  `variant_sku_snapshot` VARCHAR(100) NOT NULL COMMENT 'e.g. MRSH-CF-LJ-1FT',
  `size_label_snapshot` VARCHAR(50) NOT NULL COMMENT 'e.g. 1 foot',
  `height_mm_snapshot` INT NOT NULL COMMENT 'e.g. 305',
  `unit_price` BIGINT NOT NULL COMMENT 'Authoritative unit price snapshot in integer paise (inclusive of GST)',
  `quantity` INT NOT NULL DEFAULT 1,
  `total_price` BIGINT NOT NULL COMMENT 'unit_price * quantity in integer paise',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cf_order_items_order` (`order_id`),
  KEY `idx_cf_order_items_product` (`product_id`),
  KEY `idx_cf_order_items_variant` (`variant_id`),
  CONSTRAINT `fk_cf_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `custom_forge_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cf_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `custom_forge_products` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cf_order_items_variant` FOREIGN KEY (`variant_id`) REFERENCES `custom_forge_product_variants` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. `custom_forge_order_customizations`
-- Dedicated customization details for Custom Mode selections.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_order_customizations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_item_id` BIGINT NOT NULL,
  `custom_mode_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 if Custom Mode enabled, 0 otherwise',
  `customer_name` VARCHAR(35) DEFAULT NULL COMMENT 'Nameplate name (max 35 chars)',
  `customer_designation` VARCHAR(50) DEFAULT NULL COMMENT 'Nameplate designation (max 50 chars; literal NIL accepted)',
  `nameplate_material` ENUM('Plastic', 'MDF') DEFAULT NULL COMMENT 'Required if custom_mode_enabled = 1',
  `verification_status` ENUM('pending', 'approved', 'flagged') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cf_customizations_item` (`order_item_id`),
  KEY `idx_cf_customizations_material` (`nameplate_material`),
  CONSTRAINT `fk_cf_customizations_item` FOREIGN KEY (`order_item_id`) REFERENCES `custom_forge_order_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. `custom_forge_order_status_history`
-- Chronological status and production workflow audit trail.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_order_status_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `previous_status` VARCHAR(50) DEFAULT NULL COMMENT 'Previous status machine value',
  `new_status` VARCHAR(50) NOT NULL COMMENT 'New status machine value',
  `changed_by` VARCHAR(100) NOT NULL DEFAULT 'System' COMMENT 'Admin email/name, Customer, or System',
  `note` TEXT DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cf_history_order` (`order_id`),
  KEY `idx_cf_history_created` (`created_at`),
  CONSTRAINT `fk_cf_history_order` FOREIGN KEY (`order_id`) REFERENCES `custom_forge_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. `custom_forge_payments`
-- Dedicated payment attempts and reconciliation ledger for Custom Forge.
-- Completely segregated from retail `payments` table.
-- Record is created only when a valid gateway_order_id exists.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_forge_payments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL COMMENT 'References custom_forge_orders(id)',
  `provider` VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  `gateway_order_id` VARCHAR(100) NOT NULL COMMENT 'Mandatory Razorpay order ID (e.g. order_xxx)',
  `gateway_payment_id` VARCHAR(100) DEFAULT NULL COMMENT 'Razorpay payment ID (e.g. pay_xxx), populated upon capture',
  `gateway_signature` VARCHAR(255) DEFAULT NULL COMMENT 'HMAC-SHA256 signature verified by server',
  `amount` BIGINT NOT NULL COMMENT 'Payment amount in integer paise',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'INR',
  `status` ENUM('created', 'authorized', 'captured', 'failed', 'refunded') NOT NULL DEFAULT 'created',
  `method` VARCHAR(50) DEFAULT NULL,
  `error_code` VARCHAR(100) DEFAULT NULL,
  `error_description` TEXT DEFAULT NULL,
  `raw_event_reference` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cf_payments_gateway_payment` (`gateway_payment_id`),
  KEY `idx_cf_payments_order` (`order_id`),
  KEY `idx_cf_payments_gateway_order` (`gateway_order_id`),
  KEY `idx_cf_payments_status` (`status`),
  CONSTRAINT `fk_cf_payments_order` FOREIGN KEY (`order_id`) REFERENCES `custom_forge_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. SEED DATA: LADY JUSTICE PRODUCT & 3 SIZE VARIANTS
-- Idempotent initialization: Uses INSERT IGNORE to ensure that re-running this
-- migration will NEVER overwrite administrator-managed descriptions, active flags,
-- or customized variant pricing.
-- -----------------------------------------------------------------------------

-- 8.1 Seed Lady Justice Master Product (Safe against overwrite)
INSERT IGNORE INTO `custom_forge_products` (
  `store_id`, `slug`, `name`, `tagline`, `description`, `base_model_sku`, `active`
) VALUES (
  2,
  'lady-justice',
  'Lady Justice',
  'Symbol of Impartial Justice — Precision Crafted',
  'Exquisite additive manufacturing sculpture of Lady Justice, featuring precision balance scales and optional personalized legal nameplate.',
  'MRSH-CF-LJ',
  1
);

-- 8.2 Seed the 3 Lady Justice Size Variants (Safe against overwrite)
-- Count rows matching either identifier to detect partial or multi-row conflicts
SET @either_match_count := (
  SELECT COUNT(DISTINCT `id`)
  FROM `custom_forge_products`
  WHERE `slug` = 'lady-justice' OR `base_model_sku` = 'MRSH-CF-LJ'
);

-- Count rows matching BOTH identifiers on the same record
SET @both_match_count := (
  SELECT COUNT(DISTINCT `id`)
  FROM `custom_forge_products`
  WHERE `slug` = 'lady-justice' AND `base_model_sku` = 'MRSH-CF-LJ'
);

-- Select product ID ONLY when exactly one row matches BOTH criteria
-- and NO other conflicting rows match either identifier (@either_match_count = 1)
SET @product_id := (
  SELECT `id`
  FROM `custom_forge_products`
  WHERE `slug` = 'lady-justice'
    AND `base_model_sku` = 'MRSH-CF-LJ'
    AND @both_match_count = 1
    AND @either_match_count = 1
  LIMIT 1
);

-- Seed variants only when a valid unambiguous product ID is resolved (prevents NULL product_id insertions)
INSERT IGNORE INTO `custom_forge_product_variants` (
  `product_id`, `variant_sku`, `size_label`, `height_mm`, `price`, `custom_mode_allowed`, `display_order`, `active`
)
SELECT @product_id, v.variant_sku, v.size_label, v.height_mm, v.price, v.custom_mode_allowed, v.display_order, v.active
FROM (
  -- 6 inches: ₹1,999 (199,900 paise), Custom Mode UNAVAILABLE
  SELECT 'MRSH-CF-LJ-6IN' AS variant_sku, '6 inches' AS size_label, 152 AS height_mm, 199900 AS price, 0 AS custom_mode_allowed, 1 AS display_order, 1 AS active
  UNION ALL
  -- 1 foot: ₹3,699 (369,900 paise), Custom Mode OPTIONAL
  SELECT 'MRSH-CF-LJ-1FT', '1 foot', 305, 369900, 1, 2, 1
  UNION ALL
  -- 2 feet: ₹5,999 (599,900 paise), Custom Mode OPTIONAL
  SELECT 'MRSH-CF-LJ-2FT', '2 feet', 610, 599900, 1, 3, 1
) AS v
WHERE @product_id IS NOT NULL;

-- =============================================================================
-- Migration 019 Prepared Successfully (NOT executed against live database)
-- =============================================================================
