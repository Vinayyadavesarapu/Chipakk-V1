-- =============================================================================
-- READ-ONLY: every uploaded-file path the database references (the complete list of files that must exist on disk).
-- SELECT statements only. Safe to run in phpMyAdmin against production. Run each statement on its own: a table that
-- does not exist in your database only fails that one statement.
--
-- The public API lists ACTIVE catalogue rows only. This list is authoritative: it also covers inactive rows, category
-- media, LUMO images, banners, hero images and PRIVATE custom artwork, for BOTH stores (CHIPAKK = products/categories,
-- THE MARSHANS = marshans_*). Export any result to CSV to get the exact file names to restore (strip the "/uploads/").
--
-- Nothing here changes data, and the database paths must stay exactly as they are.
-- =============================================================================

-- 1. Counts per source (compare with the number of files you restore)
SELECT 'product_images (CHIPAKK)'          AS source, COUNT(*) AS rows_, COUNT(DISTINCT image_url) AS distinct_paths FROM product_images WHERE image_url LIKE '/uploads/%';
SELECT 'marshans_product_images (MARSHANS)' AS source, COUNT(*) AS rows_, COUNT(DISTINCT image_url) AS distinct_paths FROM marshans_product_images WHERE image_url LIKE '/uploads/%';
SELECT 'categories (CHIPAKK)'              AS source, COUNT(*) AS rows_, COUNT(DISTINCT image_url) AS distinct_paths FROM categories WHERE image_url LIKE '/uploads/%';
SELECT 'marshans_categories (MARSHANS)'    AS source, COUNT(*) AS rows_, COUNT(DISTINCT image_url) AS distinct_paths FROM marshans_categories WHERE image_url LIKE '/uploads/%';

-- 2. CHIPAKK product images (products -> product_images)
SELECT DISTINCT pi.image_url AS path, 'CHIPAKK product' AS used_by, pi.product_id AS id FROM product_images pi WHERE pi.image_url LIKE '/uploads/%' ORDER BY pi.image_url;

-- 3. THE MARSHANS product images (marshans_products -> marshans_product_images)
SELECT DISTINCT mi.image_url AS path, 'MARSHANS product' AS used_by, mi.product_id AS id FROM marshans_product_images mi WHERE mi.image_url LIKE '/uploads/%' ORDER BY mi.image_url;

-- 4. Category images (both stores)
SELECT DISTINCT image_url AS path, 'CHIPAKK category' AS used_by, id FROM categories WHERE image_url LIKE '/uploads/%';
SELECT DISTINCT image_url AS path, 'MARSHANS category' AS used_by, id FROM marshans_categories WHERE image_url LIKE '/uploads/%';

-- 5. Category media (hero light/dark, banner, thumbnail) for both stores
SELECT DISTINCT image_url AS path, CONCAT('CHIPAKK category media: ', media_type) AS used_by, category_id AS id FROM category_media WHERE image_url LIKE '/uploads/%';
SELECT DISTINCT image_url AS path, CONCAT('MARSHANS category media: ', media_type) AS used_by, category_id AS id FROM marshans_category_media WHERE image_url LIKE '/uploads/%';

-- 6. LUMO (glow) product images
SELECT DISTINCT lumo_light_image AS path, 'CHIPAKK lumo light' AS used_by, id FROM products WHERE lumo_light_image LIKE '/uploads/%';
SELECT DISTINCT lumo_dark_image  AS path, 'CHIPAKK lumo dark'  AS used_by, id FROM products WHERE lumo_dark_image  LIKE '/uploads/%';
SELECT DISTINCT lumo_light_image AS path, 'MARSHANS lumo light' AS used_by, id FROM marshans_products WHERE lumo_light_image LIKE '/uploads/%';
SELECT DISTINCT lumo_dark_image  AS path, 'MARSHANS lumo dark'  AS used_by, id FROM marshans_products WHERE lumo_dark_image  LIKE '/uploads/%';

-- 7. Banners and campaigns
SELECT DISTINCT image_url AS path, 'banner' AS used_by, id FROM banners WHERE image_url LIKE '/uploads/%';
SELECT DISTINCT banner_url AS path, 'campaign' AS used_by, id FROM campaigns WHERE banner_url LIKE '/uploads/%';

-- 8. Hero banners / slides and other settings stored as JSON text
SELECT store_id, setting_key, setting_value FROM store_settings WHERE setting_value LIKE '%/uploads/%';

-- 9. PRIVATE custom-sticker artwork (customer files; restore them, but they are never served publicly)
SELECT DISTINCT image_url AS path, 'custom artwork (private)' AS used_by, order_item_id AS id FROM order_item_custom_designs WHERE image_url LIKE '/uploads/%';

-- 10. Anything in a cart that still points at an upload (informational)
SELECT DISTINCT image_url AS path, 'cart item' AS used_by, id FROM cart_items WHERE image_url LIKE '/uploads/%' LIMIT 200;
