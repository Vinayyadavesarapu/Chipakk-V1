import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

async function runProductCategoryMigration() {
    console.log("CHIPAKK MIGRATION START: Products & Categories");
    
    let categoriesMigrated = 0;
    let productsMigrated = 0;
    let skippedInvalid = 0;
    let skippedExisting = 0;
    let failedRecords = 0;

    const categoriesRaw = JSON.parse(localStorage.getItem('categories') || '[]');
    const productsRaw = JSON.parse(localStorage.getItem('products') || '[]');

    // 1. Migrate Categories
    console.log(`Processing ${categoriesRaw.length} categories...`);
    for (const catName of categoriesRaw) {
        if (!catName) {
            skippedInvalid++;
            continue;
        }
        const slug = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        try {
            const catDocRef = doc(db, "categories", slug);
            const catDocSnap = await getDoc(catDocRef);
            
            if (catDocSnap.exists()) {
                console.log(`Skipped existing category: ${catName} (${slug})`);
                skippedExisting++;
                continue;
            }

            await setDoc(catDocRef, {
                name: catName,
                slug: slug,
                active: true,
                createdAt: serverTimestamp()
            });
            
            categoriesMigrated++;
            console.log(`Category migrated successfully: ${catName} -> ${slug}`);
        } catch (e) {
            failedRecords++;
            console.error(`Failed to migrate category ${catName}:`, e);
        }
    }

    // 2. Migrate Products
    console.log(`Processing ${productsRaw.length} products...`);
    for (const p of productsRaw) {
        if (!p.id || !p.title || p.price === undefined || p.price === null) {
            console.warn("Skipping invalid product structure:", p);
            skippedInvalid++;
            continue;
        }

        // Validate Price
        const parsedPrice = Number(p.price);
        if (isNaN(parsedPrice) || !isFinite(parsedPrice) || parsedPrice < 0) {
            console.error(`Skipping product "${p.title}" due to invalid price value:`, p.price);
            failedRecords++;
            continue;
        }

        // Validate compareAtPrice
        const rawComparePrice = p.compareAtPrice !== undefined && p.compareAtPrice !== null ? p.compareAtPrice : 0;
        const parsedComparePrice = Number(rawComparePrice);
        if (isNaN(parsedComparePrice) || !isFinite(parsedComparePrice) || parsedComparePrice < 0) {
            console.error(`Skipping product "${p.title}" due to invalid compareAtPrice value:`, rawComparePrice);
            failedRecords++;
            continue;
        }

        const productId = `prod_${p.id}`;
        const slugCategory = p.category ? p.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'general';

        try {
            const productDocRef = doc(db, "products", productId);
            const productDocSnap = await getDoc(productDocRef);

            if (productDocSnap.exists()) {
                console.log(`Skipped existing product: ${p.title} (${productId})`);
                skippedExisting++;
                continue;
            }

            // Explicit Conversion Rule: Rupees to Paise/Cents
            const priceInCents = Math.round(parsedPrice * 100);
            const comparePriceInCents = Math.round(parsedComparePrice * 100);

            // Write Product Document (without writing to inventory)
            await setDoc(productDocRef, {
                name: p.title,
                description: p.description || '',
                sku: p.sku || `SKU-PROD-${p.id}`,
                price: priceInCents,
                compareAtPrice: comparePriceInCents,
                images: p.img ? [p.img] : [],
                categoryId: slugCategory,
                tags: p.tags ? p.tags.split(',').map(t => t.trim()) : [],
                active: true,
                featured: p.badge === 'HOT!' || p.badge === 'LIMITED',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            productsMigrated++;
            console.log(`Product migrated successfully: ${p.title} (${productId})`);
        } catch (e) {
            failedRecords++;
            console.error(`Failed to migrate product ${p.title}:`, e);
        }
    }

    console.log("CHIPAKK MIGRATION COMPLETED", {
        categoriesMigrated,
        productsMigrated,
        skippedInvalid,
        skippedExisting,
        failedRecords
    });

    return {
        categoriesMigrated,
        productsMigrated,
        skippedInvalid,
        skippedExisting,
        failedRecords
    };
}

// Expose globally for manual execution in the console
window.runProductCategoryMigration = runProductCategoryMigration;

async function runSiteSettingsMigration() {
    console.log("CHIPAKK MIGRATION START: Site Settings");
    
    let migrated = 0;
    let skippedExisting = 0;
    let invalid = 0;
    let failed = 0;

    const rawSettings = localStorage.getItem('site_settings');
    if (!rawSettings) {
        console.log("no source data: site_settings key not found in localStorage.");
        return { migrated, skippedExisting, invalid, failed };
    }

    let settings;
    try {
        settings = JSON.parse(rawSettings);
    } catch (e) {
        console.error("Failed to parse site_settings from localStorage:", e);
        invalid++;
        return { migrated, skippedExisting, invalid, failed };
    }

    // Validation
    const shippingFee = Number(settings.shipping_fee);
    const shippingThreshold = Number(settings.free_shipping_threshold);

    if (isNaN(shippingFee) || !isFinite(shippingFee) || shippingFee < 0) {
        console.error("Invalid shipping_fee value:", settings.shipping_fee);
        invalid++;
        return { migrated, skippedExisting, invalid, failed };
    }

    if (isNaN(shippingThreshold) || !isFinite(shippingThreshold) || shippingThreshold < 0) {
        console.error("Invalid free_shipping_threshold value:", settings.free_shipping_threshold);
        invalid++;
        return { migrated, skippedExisting, invalid, failed };
    }

    try {
        const docRef = doc(db, "siteSettings", "global");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            console.log("Skipped existing site settings: /siteSettings/global already exists.");
            skippedExisting++;
            return { migrated, skippedExisting, invalid, failed };
        }

        // Convert to Paise/Cents
        const shippingFeeInCents = Math.round(shippingFee * 100);
        const shippingThresholdInCents = Math.round(shippingThreshold * 100);

        await setDoc(docRef, {
            store_name: settings.store_name !== undefined ? String(settings.store_name) : 'CHIPAKK',
            shipping_fee: shippingFeeInCents,
            free_shipping_enabled: settings.free_shipping_enabled === true,
            free_shipping_threshold: shippingThresholdInCents,
            free_shipping_calculation: settings.free_shipping_calculation !== undefined ? String(settings.free_shipping_calculation) : 'after_discounts',
            announcement_text: settings.announcement_text !== undefined ? String(settings.announcement_text) : '',
            announcement_active: settings.announcement_active === true,
            maintenance_active: settings.maintenance_active === true,
            maintenance_message: settings.maintenance_message !== undefined ? String(settings.maintenance_message) : '',
            hero_headline: settings.hero_headline !== undefined ? String(settings.hero_headline) : '',
            hero_subheadline: settings.hero_subheadline !== undefined ? String(settings.hero_subheadline) : '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        migrated++;
        console.log("Site settings migrated successfully to /siteSettings/global.");
    } catch (e) {
        failed++;
        console.error("Failed to migrate site settings:", e);
    }

    console.log("CHIPAKK MIGRATION COMPLETED: Site Settings", {
        migrated,
        skippedExisting,
        invalid,
        failed
    });

    return {
        migrated,
        skippedExisting,
        invalid,
        failed
    };
}

window.runSiteSettingsMigration = runSiteSettingsMigration;
