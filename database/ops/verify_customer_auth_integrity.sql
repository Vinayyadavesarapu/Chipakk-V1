-- =============================================================================
-- READ-ONLY verification of customer/admin identity integrity (auth audit, 2026-09-22).
-- Contains ONLY SELECT statements. Safe to run in phpMyAdmin against production.
-- Nothing here changes data. Run each block on its own.
-- =============================================================================

-- 1. Duplicate firebase_uid in `users` / `admins`. The schema has a UNIQUE KEY on firebase_uid on both tables,
--    so this should always return 0 rows; a non-empty result means the constraint was bypassed (e.g. a raw
--    import) and needs manual investigation before anything else here is trusted.
SELECT firebase_uid, COUNT(*) AS n FROM users  GROUP BY firebase_uid HAVING COUNT(*) > 1;
SELECT firebase_uid, COUNT(*) AS n FROM admins GROUP BY firebase_uid HAVING COUNT(*) > 1;

-- 2. Duplicate customer emails. `users.email` is NOT unique (Firebase is the identity source of truth, not this
--    column), so this CAN legitimately happen -- e.g. a customer deleted and recreated their Firebase account, or
--    signed up again with a different provider. Not necessarily a bug, but worth a human look if the list is long.
SELECT LOWER(email) AS email, COUNT(*) AS n, GROUP_CONCAT(firebase_uid) AS firebase_uids
FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1;

-- 3. ADMIN / CUSTOMER EMAIL COLLISION -- the one that matters most for "customer auth must never grant admin
--    access". server/routes/customer.js resolves is_admin by matching EITHER firebase_uid OR (case-insensitive)
--    email against `admins`. If a row here exists with a users.firebase_uid that differs from the admins row's
--    firebase_uid, a CUSTOMER who happens to sign up with that same email would be misclassified as an admin the
--    moment they call /api/customer/me. Expect ZERO rows.
SELECT u.id AS user_id, u.firebase_uid AS user_uid, u.email AS user_email,
       a.id AS admin_id, a.firebase_uid AS admin_uid, a.active AS admin_active
FROM users u
JOIN admins a ON LOWER(a.email) = LOWER(u.email) AND a.active = 1
WHERE a.firebase_uid <> u.firebase_uid;

-- 4. Is the `admins` table ever empty? (server/middleware/auth.js only auto-bootstraps the first admin when this
--    is 0 AND ALLOW_ADMIN_BOOTSTRAP=true is explicitly set -- see .env.example. If this returns 0 in production
--    with that variable NOT set, every admin route currently returns 403 for everyone, including real admins.)
SELECT COUNT(*) AS admins_total, SUM(active = 1) AS admins_active FROM admins;

-- 5. Orphaned customer_addresses: user_id set but the referenced user row is gone (the FK is ON DELETE CASCADE, so
--    this should be impossible via the app; a non-empty result suggests a manual/legacy data change).
SELECT ca.id, ca.firebase_uid, ca.user_id
FROM customer_addresses ca
LEFT JOIN users u ON u.id = ca.user_id
WHERE ca.user_id IS NOT NULL AND u.id IS NULL;

-- 6. Orders whose customer_id does not resolve to a users row (customer_id is nullable / ON DELETE SET NULL, so a
--    NULL here is expected for guest-style or historical orders -- this checks for a STALE non-null id only).
SELECT o.id, o.order_number, o.customer_id
FROM orders o
LEFT JOIN users u ON u.id = o.customer_id
WHERE o.customer_id IS NOT NULL AND u.id IS NULL;

-- 7. Multi-store identity sanity check: `users` has no store_id column (by design -- Firebase identity, and
--    therefore the customer record, is intentionally SHARED between CHIPAKK and THE MARSHANS; only orders,
--    addresses and carts are store-scoped elsewhere). This just confirms that design is still true post-audit.
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('store_id', 'store');

-- 8. Customers with no orders at all under EITHER store's order table (informational only -- NOT a problem by
--    itself, just useful context when investigating "I signed in but see nothing" reports).
SELECT COUNT(*) AS customers_with_zero_orders
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id);
