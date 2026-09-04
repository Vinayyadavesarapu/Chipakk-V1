# CHIPAKK MySQL Database Architecture Documentation

## Database Overview
- **Database Name**: `u781826529_chipakk`
- **Target MySQL User**: `u781826529_chipakk_admin`
- **Engine**: InnoDB (MySQL 8.0+ / MariaDB 10.5+)
- **Charset & Collation**: `utf8mb4` / `utf8mb4_unicode_ci`

---

## Architectural Rules & Security Principles

1. **Monetary Representation (Integer Paise)**:
   - All currency values (`price`, `compare_at_price`, `subtotal`, `discount_total`, `shipping_charge`, `total_price`, `min_order_value`, `max_discount_amount`, `free_shipping_threshold`, `standard_fee`) are stored as `BIGINT` in **paise** (1 INR = 100 Paise).
   - Floating-point column types (`FLOAT`, `DOUBLE`, `DECIMAL` rounding issues) are strictly avoided.

2. **Authentication Offloading**:
   - Customer and Administrator credentials and passwords are **NOT** stored in MySQL.
   - Authentication is handled exclusively by **Firebase Authentication**.
   - The `admins` and `users` tables store `firebase_uid` (`VARCHAR(128) UNIQUE`) to link relational profiles to Firebase Auth identities.

3. **Historical Order Preservation**:
   - `order_items` stores historical snapshots of product name, SKU, option string, and unit price at purchase time.
   - Future catalog edits or deletions of products or variants will **NEVER** modify or distort historical orders.

4. **Inventory Management**:
   - Inventory levels (`stock`, `reserved_stock`) are maintained per variant in the `inventory` table.
   - Initial stock is entered explicitly by administrators (no automated or assumed default stock values).

---

## Detailed Table Reference (20 Tables)

### 1. `admins`
- **Purpose**: System administrator credentials and access levels.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `uk_admins_firebase_uid` (`UNIQUE` on `firebase_uid`)
  - `idx_admins_email` (`email`)
  - `idx_admins_active` (`active`)
- **Description**: Linked to Firebase Auth via `firebase_uid`. Controls admin roles (`admin`, `super_admin`) and system access permissions.

### 2. `users`
- **Purpose**: Storefront customer accounts and contact profiles.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `uk_users_firebase_uid` (`UNIQUE` on `firebase_uid`)
  - `idx_users_email` (`email`)
  - `idx_users_created_at` (`created_at`)
- **Description**: Stores customer details (full name, phone, email) associated with Firebase Auth `firebase_uid`.

### 3. `categories`
- **Purpose**: Product category catalog structure.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `uk_categories_slug` (`UNIQUE` on `slug`)
  - `idx_categories_active` (`active`)
- **Description**: Groups products logically by category name and web URL slug.

### 4. `products`
- **Purpose**: Catalog items and main product details.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `category_id` -> `categories(id)` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- **Indexes**:
  - `uk_products_sku` (`UNIQUE` on `sku`)
  - `idx_products_category` (`category_id`)
  - `idx_products_active` (`active`)
  - `idx_products_featured` (`featured`)
  - `idx_products_created_at` (`created_at`)
- **Description**: Master catalog record storing name, base SKU, base price in paise, description, tags, active status, and featured flag.

### 5. `product_images`
- **Purpose**: Multiple image management per product.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `product_id` -> `products(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- **Indexes**:
  - `idx_product_images_product` (`product_id`)
  - `idx_product_images_sort` (`product_id`, `sort_order`)
  - `idx_product_images_primary` (`product_id`, `is_primary`)
- **Description**: Supports multiple image assets per product, primary thumbnail selection, sort ordering, external URLs, and Hostinger file storage paths (`storage_path`).

### 6. `product_options`
- **Purpose**: Option dimensions for configurable products (e.g., Material, Size, Color).
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `product_id` -> `products(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- **Indexes**:
  - `uk_product_options_product_name` (`UNIQUE` on `product_id`, `name`)
  - `idx_product_options_product` (`product_id`)
- **Description**: Defines option attribute groups belonging to a product.

### 7. `product_option_values`
- **Purpose**: Specific choices within a product option (e.g., Material -> Glossy, Matte; Size -> 2 inch, 3 inch).
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `option_id` -> `product_options(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- **Indexes**:
  - `uk_option_values_option_value` (`UNIQUE` on `option_id`, `value`)
  - `idx_option_values_option` (`option_id`)
- **Description**: Allowed discrete values per product option definition.

### 8. `product_variants`
- **Purpose**: Sellable SKU combinations generated from product option selections.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `product_id` -> `products(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- **Indexes**:
  - `uk_product_variants_sku` (`UNIQUE` on `sku`)
  - `uk_product_variants_slug` (`UNIQUE` on `product_id`, `variant_slug`)
  - `idx_product_variants_product` (`product_id`)
  - `idx_product_variants_active` (`active`)
- **Description**: Holds price in paise, SKU, active toggle, and normalized JSON mapping of option selections (e.g. `material_glossy__size_2inch`).

### 9. `inventory`
- **Purpose**: Stock tracking per product variant.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `variant_id` -> `product_variants(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
- **Indexes**:
  - `uk_inventory_variant` (`UNIQUE` on `variant_id`)
  - `idx_inventory_stock` (`stock`)
- **Description**: Manages physical `stock` entered by admin and `reserved_stock` allocated during checkout.

### 10. `orders`
- **Purpose**: Master customer order records.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `customer_id` -> `users(id)` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- **Indexes**:
  - `uk_orders_order_number` (`UNIQUE` on `order_number`)
  - `idx_orders_customer` (`customer_id`)
  - `idx_orders_payment_status` (`payment_status`)
  - `idx_orders_fulfillment_status` (`fulfillment_status`)
  - `idx_orders_created_at` (`created_at`)
- **Description**: Header record for purchases containing customer info, JSON shipping address, totals in paise, payment/fulfillment status, and applied coupon code.

### 11. `order_items`
- **Purpose**: Line items within an order.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `order_id` -> `orders(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
  - `product_id` -> `products(id)` (`ON DELETE SET NULL ON UPDATE CASCADE`)
  - `variant_id` -> `product_variants(id)` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- **Indexes**:
  - `idx_order_items_order` (`order_id`)
  - `idx_order_items_product` (`product_id`)
  - `idx_order_items_variant` (`variant_id`)
- **Description**: Immutable order line items capturing snapshot values (`product_name`, `sku`, `variant_options`, `unit_price`, `total_price`) at time of purchase.

### 12. `coupons`
- **Purpose**: Promotional discount codes.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `uk_coupons_code` (`UNIQUE` on `code`)
  - `idx_coupons_active` (`active`)
  - `idx_coupons_dates` (`start_date`, `end_date`)
- **Description**: Defines percentage or fixed amount discounts (in paise), minimum spend requirements, max discount caps, date validity windows, and usage counts.

### 13. `coupon_usage`
- **Purpose**: Redemption log for coupons used in orders.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `coupon_id` -> `coupons(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
  - `order_id` -> `orders(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
  - `customer_id` -> `users(id)` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- **Indexes**:
  - `idx_coupon_usage_coupon` (`coupon_id`)
  - `idx_coupon_usage_order` (`order_id`)
  - `idx_coupon_usage_customer` (`customer_id`)
- **Description**: Records every discount redemption per customer and order.

### 14. `banners`
- **Purpose**: Homepage hero and section promotional banners.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `idx_banners_active_order` (`active`, `sort_order`)
- **Description**: Manages banner images, target URLs, sort order, and Hostinger file storage paths.

### 15. `reviews`
- **Purpose**: Customer product ratings and reviews.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**:
  - `product_id` -> `products(id)` (`ON DELETE CASCADE ON UPDATE CASCADE`)
  - `customer_id` -> `users(id)` (`ON DELETE SET NULL ON UPDATE CASCADE`)
- **Indexes**:
  - `idx_reviews_product` (`product_id`)
  - `idx_reviews_customer` (`customer_id`)
  - `idx_reviews_status` (`status`)
- **Description**: Product reviews with 1-5 rating checks and moderation status (`pending`, `approved`, `rejected`).

### 16. `site_settings`
- **Purpose**: Global key-value store for site-wide configuration.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `uk_site_settings_key` (`UNIQUE` on `setting_key`)
- **Description**: Stores JSON configuration settings such as store details, maintenance mode status, and announcements.

### 17. `shipping_rules`
- **Purpose**: Dynamic delivery fee calculations and free-shipping thresholds.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `idx_shipping_rules_enabled` (`is_enabled`)
- **Description**: Configures global free shipping threshold (paise), standard fee (paise), and regional overrides (JSON).

### 18. `campaigns`
- **Purpose**: Promotional marketing campaign landing pages.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `idx_campaigns_active` (`active`)
- **Description**: Marketing landing banners and campaign target configurations.

### 19. `events`
- **Purpose**: Time-bound drops and flash sale event scheduling.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `idx_events_active_times` (`active`, `start_time`, `end_time`)
- **Description**: Schedules promotional drops, target product/category JSON arrays, and flash discount percentages.

### 20. `audit_logs`
- **Purpose**: Administrative activity and security audit logging.
- **Primary Key**: `id` (`BIGINT AUTO_INCREMENT`)
- **Foreign Keys**: None
- **Indexes**:
  - `idx_audit_logs_actor` (`actor_id`)
  - `idx_audit_logs_action` (`action`)
  - `idx_audit_logs_created_at` (`created_at`)
- **Description**: Tracks admin actions (`actor_id`, `action`, `entity_type`, `entity_id`, JSON `details`) for security auditing.

---

## Entity Relationship Overview

```
[categories] 1 ───< N [products] 1 ───< N [product_images]
                          │
                          ├───< N [product_options] 1 ───< N [product_option_values]
                          │
                          ├───< N [product_variants] 1 ─── 1 [inventory]
                          │             │
                          ├───< N [reviews]
                          │             │
                          └──────┬──────┘
                                 │ (historical snapshot)
                                 ▼
[users] 1 ───< N [orders] 1 ───< N [order_items]
   │                │
   └───< N          └───< N [coupon_usage] >─── 1 [coupons]
```
