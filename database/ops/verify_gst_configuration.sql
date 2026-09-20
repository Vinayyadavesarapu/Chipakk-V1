-- =============================================================================
-- READ-ONLY verification of the GST / supplier / shipping configuration.
-- Contains ONLY SELECT statements. Safe to run in phpMyAdmin against production.
-- Nothing here changes data; remediation is done through the Admin UI (see docs/GST_AND_DEPLOYMENT.md).
-- =============================================================================

-- 1. Which tax-related keys are stored per store? Look for the placeholder GSTIN 07AAAAA0000A1Z5 and for a
--    seller_state of "Delhi" that an older migration wrote: neither is real configuration.
SELECT store_id, setting_key, setting_value
FROM store_settings
WHERE setting_key IN ('gstin','seller_state','store_state','gst_enabled','gst_pct','gst_rate','default_gst_rate',
                      'tax_pricing_mode','trade_name','invoice_prefix',
                      'custom_sticker_hsn_code','custom_sticker_gst_rate',
                      'shipping_fee','free_shipping_enabled','free_shipping_threshold','free_shipping_calculation')
ORDER BY store_id, setting_key;

-- 1b. HSN codes that are actually STORED. The application never invents an HSN: any value shown here was entered by a person
--     (Admin), never supplied by code. Empty results mean "unset", which is the correct default.
SELECT store_id, setting_key, setting_value FROM store_settings WHERE setting_key = 'custom_sticker_hsn_code';
SELECT id, name, hsn_code, gst_rate FROM categories WHERE hsn_code IS NOT NULL AND hsn_code <> '';
SELECT id, name, hsn_code, gst_rate FROM products WHERE hsn_code IS NOT NULL AND hsn_code <> '' LIMIT 50;

-- 2. Is the registered supplier entered? (expects ONE active row after configuration)
SELECT id, legal_name, gstin, state, state_code, is_active FROM legal_suppliers;
SELECT id, code, name, legal_supplier_id FROM stores;

-- 3. The shipping rule orders are actually charged with (approved: fee 50, free at gross subtotal >= 300 for Store 1)
SELECT id, store_id, name, standard_fee, free_shipping_threshold, is_enabled FROM shipping_rules ORDER BY store_id, id;

-- 4. How many active products still have no HSN anywhere (product or category)?  These orders are placed with an
--    empty HSN and cannot be invoiced until it is configured.
SELECT COUNT(*) AS active_products,
       SUM(CASE WHEN COALESCE(NULLIF(p.hsn_code,''), NULLIF(c.hsn_code,'')) IS NULL THEN 1 ELSE 0 END) AS without_hsn
FROM products p LEFT JOIN categories c ON c.id = p.category_id
WHERE p.active = 1;

-- 5. Invoice numbering state
SELECT * FROM invoice_sequences ORDER BY financial_year DESC, series_prefix;
SELECT COUNT(*) AS invoices_issued FROM invoices;
