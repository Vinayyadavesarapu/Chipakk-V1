import { db, auth, storage } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, orderBy, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { apiClient } from './api.js?v=3.5.0';

// DOM Elements
const loginSection = document.getElementById('login-section');
const adminWorkspace = document.getElementById('admin-workspace');
const loginBtn = document.getElementById('login-btn');
const emailInput = document.getElementById('admin-email');
const passwordInput = document.getElementById('admin-password');

// API Base URL
const API_BASE_URL = apiClient.getBaseUrl();

function resolveAdminImageUrl(url) {
    if (!url) return '';
    let target = url;
    if (typeof target === 'object' && target !== null) {
        target = target.image_url || target.external_url || target.url || '';
    }
    const cleanUrl = String(target).trim();
    if (!cleanUrl || cleanUrl === '[object Object]') return '';
    if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('data:') || cleanUrl.startsWith('blob:')) {
        return cleanUrl;
    }
    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api\/?$/, '') : 'https://api.chipakk.shop';
    return cleanUrl.startsWith('/') ? `${apiHost}${cleanUrl}` : `${apiHost}/${cleanUrl}`;
}

// =============================================================================
// CANONICAL STATUS MAPPING ENUMS & HELPERS
// =============================================================================

const CANONICAL_ORDER_STATUSES = [
  "New",
  "Confirmed",
  "Processing",
  "Ready to Ship",
  "Shipped",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Returned",
  "Refunded"
];

const UI_TO_BACKEND_ORDER_STATUS = {
  "New": "NEW",
  "Confirmed": "CONFIRMED",
  "Processing": "PROCESSING",
  "Ready to Ship": "READY_TO_SHIP",
  "Shipped": "SHIPPED",
  "Out for Delivery": "OUT_FOR_DELIVERY",
  "Delivered": "DELIVERED",
  "Cancelled": "CANCELLED",
  "Returned": "RETURNED",
  "Refunded": "REFUNDED"
};

const BACKEND_TO_UI_ORDER_STATUS = {
  "NEW": "New",
  "CONFIRMED": "Confirmed",
  "PROCESSING": "Processing",
  "READY_TO_SHIP": "Ready to Ship",
  "SHIPPED": "Shipped",
  "OUT_FOR_DELIVERY": "Out for Delivery",
  "DELIVERED": "Delivered",
  "CANCELLED": "Cancelled",
  "RETURNED": "Returned",
  "REFUNDED": "Refunded"
};

const PRODUCTION_STAGES = [
  "Not Started",
  "Ready to Print",
  "Printing",
  "Printed",
  "Cutting",
  "Cut",
  "Ready to Pack",
  "Packed"
];

const UI_TO_BACKEND_PROD_STATUS = {
  "Not Started": "NOT_STARTED",
  "Ready to Print": "READY_TO_PRINT",
  "Printing": "PRINTING",
  "Printed": "PRINTED",
  "Cutting": "CUTTING",
  "Cut": "CUT",
  "Ready to Pack": "READY_TO_PACK",
  "Packed": "PACKED"
};

const BACKEND_TO_UI_PROD_STATUS = {
  "NOT_STARTED": "Not Started",
  "READY_TO_PRINT": "Ready to Print",
  "PRINTING": "Printing",
  "PRINTED": "Printed",
  "CUTTING": "Cutting",
  "CUT": "Cut",
  "READY_TO_PACK": "Ready to Pack",
  "PACKED": "Packed"
};

// =============================================================================
// PRESENTATIONAL RATING TIER LOGIC
// =============================================================================

function getRatingTier(rating) {
    const r = Number(rating) || 4.7;
    if (r >= 4.9) return "LEGENDARY";
    if (r >= 4.7) return "RARE";
    if (r >= 4.4) return "EPIC";
    if (r >= 4.0) return "UNCOMMON";
    if (r >= 3.0) return "COMMON";
    return "BASIC";
}
const getRatingTierLabel = getRatingTier;

function formatRatingDisplay(rating) {
    const r = Number(rating) || (typeof siteSettings !== 'undefined' ? siteSettings.default_rating : 4.7) || 4.7;
    const tier = getRatingTier(r);
    return `<span style="color:#f59e0b; font-weight:bold;">★ ${r.toFixed(1)}</span> <span class="status-badge" style="background:#eee; color:#000; font-size:0.65rem; padding:1px 5px; border:1px solid #000;">(${tier})</span>`;
}

// =============================================================================
// SYSTEM STATE VARIABLES (POPULATED VIA HOSTINGER API)
// =============================================================================

let products = [];
let categories = [];
let orders = [];
let productionQueueItems = [];
let customers = [];
let reviews = [];
let teamMembers = [];
let activeSessions = [];
let shippingRules = [];
let events = [];
let coupons = [];
let heroGroups = [];
let promoBanners = [];
let storeSections = [];
let auditLogs = [];
let materials = [];
let editingMaterialId = null;
let chipakkMaterials = [];
let chipakkMovements = [];
let editingChipakkMaterialId = null;
let finishingOptions = [];
let editingFinishingId = null;
let productionJobs = [];
let activeProdJobStage = '';
let customRequests = [];
let activeCustomReqStatus = '';
let dashboardMetrics = null;
let monthlyStats = [];
let heroConfig = null;
let announcementBarConfig = null;
let currentChartFilter = 'all';
let siteSettings = {
    store_name: "CHIPAKK Stickers",
    business_email: "support@chipakk.shop",
    support_phone: "+91 98765 00000",
    business_address: "Cyber City, DLF Phase 2, Gurgaon, Haryana - 122002",
    gst_enabled: true,
    gst_pct: 18,
    currency_symbol: "₹ (INR)",
    order_prefix: "CHP-",
    default_rating: 4.7,
    announcement_text: "⚡ FREE SHIPPING ON ORDERS ABOVE ₹300 | CODE: START10 ⚡",
    announcement_active: true,
    announcement_rolling: true,
    store_status: "OPEN",
    maintenance_active: false,
    maintenance_msg: "CHIPAKK is currently undergoing scheduled maintenance. We will be back shortly.",
    orders_accepting: true,
    orders_paused_msg: "Orders are temporarily paused. Please check back shortly."
};

// Active Trackers & State Variables
let activeOrderTab = "All";
let activeProductionTab = "All";
let editingProductId = null;
let editingCategoryId = null;
let editingEventId = null;
let editingCouponId = null;
let editingShippingId = null;
let editingHeroSlideId = null;
let editingBannerId = null;
let activeOrderViewing = null;
let tempProdImages = [];
let tempProdOptions = [];
let tempProdVariants = [];
let selectedEvtProductIds = [];
let selectedProductionItemIds = [];

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    return escapeHtml(str);
}

// =============================================================================
// NORMALIZATION HELPERS (API PAYLOAD -> FRONTEND STATE)
// =============================================================================

function normalizeProduct(p) {
    const rawPrice = parseInt(p.price, 10) || 0;
    const priceRupees = p.price_rupees !== undefined ? p.price_rupees : rawPrice;
    const rawComp = p.compare_at_price !== null && p.compare_at_price !== undefined ? (parseInt(p.compare_at_price, 10) || 0) : null;
    const compPriceRupees = p.compare_at_price_rupees !== undefined ? p.compare_at_price_rupees : rawComp;

    const matchedCat = categories.find(c => c && (
        (p.category_id && String(c.id) === String(p.category_id)) ||
        (p.category_slug && (c.slug || '').toLowerCase() === p.category_slug.toLowerCase()) ||
        (p.category_name && (c.name || '').toLowerCase() === p.category_name.toLowerCase())
    ));

    const resolvedCategoryName = p.category_name || (matchedCat?.name) || (typeof p.category === 'string' && p.category !== 'Uncategorized' ? p.category : null) || (categories.find(c => c.id === p.category_id)?.name) || 'Uncategorized';
    const resolvedCategorySlug = p.category_slug || (matchedCat?.slug) || (categories.find(c => c.id === p.category_id)?.slug) || '';

    const explicitGalleryImages = Array.isArray(p.images)
        ? p.images.map(img => typeof img === 'string' ? img : (img.image_url || img.external_url || img.url || '')).filter(Boolean)
        : [];

    let imagesList = [...explicitGalleryImages];
    if (imagesList.length === 0) {
        if (p.lumo_light_image || p.lumo_dark_image) {
            imagesList = [p.lumo_light_image, p.lumo_dark_image].filter(Boolean);
        } else if (p.primary_image_url) {
            imagesList = [p.primary_image_url];
        }
    }

    return {
        ...p,
        id: p.id,
        admin_id: p.admin_product_id || p.sku || `CK-${p.id}`,
        title: p.name || p.title || '',
        name: p.name || p.title || '',
        sku: p.sku || '',
        description: p.description || '',
        short_description: p.short_description || '',
        variant: 'Standard 3x3"',
        price: priceRupees,
        compare_at_price: compPriceRupees,
        category: resolvedCategoryName,
        category_name: resolvedCategoryName,
        category_slug: resolvedCategorySlug,
        category_id: p.category_id || (matchedCat?.id) || null,
        stock: p.stock !== undefined ? p.stock : 0,
        rating: p.average_rating || 4.7,
        review_count: p.review_count || 0,
        rating_tier: p.rating_tier || 'RARE',
        images: imagesList.length > 0 ? imagesList : ["https://img.icons8.com/color/150/000000/sticker.png"],
        gallery_images: explicitGalleryImages,
        tags: Array.isArray(p.tags) ? p.tags : [],
        scheduled_drop_time: p.scheduled_drop_time ? new Date(p.scheduled_drop_time).toISOString().slice(0, 16) : '',
        is_active: p.active === 1 || p.active === true || p.is_active === true,
        is_best_seller: p.is_best_seller === 1 || p.is_best_seller === true,
        view_360_url: p.view_360_url || null,
        lumo_light_image: p.lumo_light_image || null,
        lumo_dark_image: p.lumo_dark_image || null,
        lumo_light_360_url: p.lumo_light_360_url || null,
        lumo_dark_360_url: p.lumo_dark_360_url || null,
        hsn_code: p.hsn_code || '',
        gst_rate: p.gst_rate === null || p.gst_rate === undefined ? '' : p.gst_rate,
        category_hsn_code: p.category_hsn_code || '',
        category_gst_rate: p.category_gst_rate === null || p.category_gst_rate === undefined ? '' : p.category_gst_rate,
        options: Array.isArray(p.options) ? p.options : [],
        variants: Array.isArray(p.variants) ? p.variants : []
    };
}

function normalizeCategory(c) {
    return {
        ...c,
        id: c.id,
        name: c.name,
        slug: c.slug || c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: c.description || '',
        image_url: c.image_url || '',
        display_order: c.display_order || c.id,
        product_count: parseInt(c.product_count, 10) || 0,
        active: c.active === 1 || c.active === true
    };
}

function normalizeOrder(o) {
    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const isStore2 = (o.store_id !== undefined && o.store_id !== null) ? (parseInt(o.store_id, 10) === 2) : (activeStoreId === 2);
    const rawTotalPrice = parseInt(o.total_price || o.total || o.total_amount, 10) || 0;
    const totalPriceRupees = o.total_price_rupees !== undefined ? o.total_price_rupees : (isStore2 ? Math.round(rawTotalPrice / 100) : rawTotalPrice);

    const rawAddress = o.shipping_address;
    let formattedAddress = '';
    if (typeof rawAddress === 'string') {
        formattedAddress = rawAddress;
    } else if (rawAddress && typeof rawAddress === 'object') {
        formattedAddress = [rawAddress.address_line1 || rawAddress.address, rawAddress.city, rawAddress.state, rawAddress.pincode || rawAddress.zip].filter(Boolean).join(', ');
    } else {
        formattedAddress = o.address || 'Address not provided';
    }

    const normalizedItems = (o.items || []).map((item, idx) => {
        const rawUnit = parseInt(item.unit_price, 10) || 0;
        const rawItemTotal = parseInt(item.total_price || item.total, 10) || 0;
        const unitRupees = item.unit_price_rupees !== undefined ? item.unit_price_rupees : (isStore2 ? Math.round(rawUnit / 100) : rawUnit);
        const itemTotalRupees = item.total_price_rupees !== undefined ? item.total_price_rupees : (isStore2 ? Math.round(rawItemTotal / 100) : rawItemTotal);
        return {
            item_id: item.id || item.item_id || `item-${o.id}-${idx + 1}`,
            order_item_id: item.id || item.order_item_id,
            admin_id: item.admin_product_id_snapshot || item.admin_id || item.sku || 'CK-001',
            title: item.product_name || item.title || 'Custom Product',
            variant: typeof item.variant_options === 'object' && item.variant_options ? Object.values(item.variant_options).join(' / ') : (item.variant || 'Standard 3x3"'),
            qty: item.quantity || item.qty || 1,
            unit_price: unitRupees,
            unit_price_rupees: unitRupees,
            total: itemTotalRupees,
            total_price_rupees: itemTotalRupees,
            img: item.img || "https://img.icons8.com/color/150/000000/sticker.png",
            production_status: BACKEND_TO_UI_PROD_STATUS[item.production_status] || item.production_status || 'Ready to Print'
        };
    });

    const statusStr = String(o.fulfillment_status || o.status || 'NEW').toUpperCase();
    const uiStatus = BACKEND_TO_UI_ORDER_STATUS[statusStr] || 'New';

    return {
        ...o,
        id: o.id,
        order_id: o.order_number || o.order_id || `CHP-${o.id}`,
        customer_name: o.customer_name || 'Anonymous Customer',
        email: o.customer_email || o.email || '',
        phone: o.customer_phone || o.phone || '',
        address: formattedAddress,
        items: normalizedItems,
        total_price: totalPriceRupees,
        total_price_rupees: totalPriceRupees,
        total_price_paise: totalPriceRupees * 100,
        payment_status: String(o.payment_status || 'paid').toLowerCase() === 'paid' ? 'Paid' : (String(o.payment_status).charAt(0).toUpperCase() + String(o.payment_status).slice(1)),
        status: uiStatus,
        raw_fulfillment_status: statusStr,
        shipping_status: (statusStr === 'SHIPPED' || statusStr === 'OUT_FOR_DELIVERY' || statusStr === 'DELIVERED') ? 'Shipped' : 'Unshipped',
        courier: o.courier || '',
        tracking_no: o.tracking_no || '',
        ship_date: o.ship_date ? new Date(o.ship_date).toISOString().slice(0, 10) : '',
        ship_notes: o.ship_notes || '',
        created_at: o.created_at || new Date().toISOString(),
        status_history: o.status_history || [{ status: uiStatus, timestamp: o.created_at || new Date().toISOString(), actor: "System" }]
    };
}

function normalizeCustomer(c) {
    const rawSpend = parseInt(c.total_spend || c.total_spent, 10) || 0;
    const spendRupees = c.total_spend_rupees !== undefined ? c.total_spend_rupees : rawSpend;
    const deliveredCount = parseInt(c.delivered_orders, 10) || 0;
    return {
        ...c,
        id: c.id,
        name: c.name || (c.email ? c.email.split('@')[0] : 'Customer'),
        email: c.email || '',
        phone: c.phone || '',
        total_orders: c.total_orders || 0,
        delivered_orders: deliveredCount,
        total_spent: spendRupees,
        total_spent_rupees: spendRupees,
        total_spent_paise: spendRupees * 100,
        status: c.loyalty_tier || calculateCustomerTier(deliveredCount),
        loyalty_tier: c.loyalty_tier || calculateCustomerTier(deliveredCount),
        last_order: c.last_order || 'N/A',
        address: c.address || ''
    };
}

// =============================================================================
// DERIVED CUSTOMER LOYALTY TIERS & STATS CALCULATOR
// =============================================================================

function calculateCustomerTier(deliveredOrdersCount) {
    const count = Number(deliveredOrdersCount) || 0;
    if (count >= 30) return "ELITE";
    if (count >= 15) return "VIP";
    if (count >= 5) return "REGULAR";
    if (count >= 1) return "CUSTOMER";
    return "NEW";
}

function updateCustomerStatsAndTiers() {
    customers.forEach(c => {
        if (!c.loyalty_tier) {
            c.loyalty_tier = calculateCustomerTier(c.delivered_orders || 0);
            c.status = c.loyalty_tier;
        }
    });
}

function copyToClipboard(text, label) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`${label} copied to clipboard!`);
        }).catch(() => {
            fallbackCopyTextToClipboard(text, label);
        });
    } else {
        fallbackCopyTextToClipboard(text, label);
    }
}

function fallbackCopyTextToClipboard(text, label) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast(`${label} copied to clipboard!`);
    } catch (err) {
        showToast(`Failed to copy ${label}`, "error");
    }
    document.body.removeChild(textArea);
}

// =============================================================================
// ASYNC API STATE LOADER
// =============================================================================

async function fetchAllAdminProducts() {
    let offset = 0;
    const limit = 500;
    let all = [];
    while (true) {
        const res = await apiClient.get('/admin/products', { limit, offset });
        const rawProds = res?.data?.products || res?.products || (Array.isArray(res?.data) ? res.data : []);
        const total = typeof res?.data?.total === 'number' ? res.data.total : (Array.isArray(rawProds) ? rawProds.length : 0);
        if (Array.isArray(rawProds)) {
            all = all.concat(rawProds);
        }
        if (!rawProds || rawProds.length === 0 || all.length >= total || rawProds.length < limit) {
            break;
        }
        offset += rawProds.length;
    }
    return all;
}

async function loadAllAdminData() {
    try {
        const [
            prodRes,
            catRes,
            ordRes,
            prodQueueRes,
            custRes,
            evtRes,
            cpnRes,
            shipRes,
            storeRes,
            revRes,
            setRes,
            auditRes,
            teamRes,
            sessionRes,
            dashRes
        ] = await Promise.allSettled([
            fetchAllAdminProducts(),
            apiClient.get('/categories'),
            apiClient.get('/admin/orders'),
            apiClient.get('/admin/production/queue'),
            apiClient.get('/admin/customers'),
            apiClient.get('/admin/events'),
            apiClient.get('/admin/coupons'),
            apiClient.get('/admin/shipping-rules'),
            apiClient.get('/admin/store-builder'),
            apiClient.get('/admin/reviews'),
            apiClient.get('/admin/settings'),
            apiClient.get('/admin/audit-logs'),
            apiClient.get('/admin/team'),
            apiClient.get('/admin/active-sessions'),
            apiClient.get('/admin/dashboard')
        ]);

        if (catRes.status === 'fulfilled' && catRes.value) {
            const rawCats = catRes.value.data?.categories || catRes.value.categories || (Array.isArray(catRes.value.data) ? catRes.value.data : []) || (Array.isArray(catRes.value) ? catRes.value : []);
            if (Array.isArray(rawCats)) categories = rawCats.map(normalizeCategory).filter(c => c && (c.name || '').toLowerCase().trim() !== 'best seller' && (c.slug || '').toLowerCase().trim() !== 'best-seller');
        }
        if (prodRes.status === 'fulfilled' && prodRes.value) {
            const rawProds = Array.isArray(prodRes.value) ? prodRes.value : (prodRes.value.data?.products || prodRes.value.products || (Array.isArray(prodRes.value.data) ? prodRes.value.data : []));
            if (Array.isArray(rawProds)) products = rawProds.map(normalizeProduct);
        }
        if (ordRes.status === 'fulfilled' && ordRes.value) {
            const rawOrds = ordRes.value.data?.orders || ordRes.value.orders || (Array.isArray(ordRes.value.data) ? ordRes.value.data : []);
            if (Array.isArray(rawOrds)) orders = rawOrds.map(normalizeOrder);
        }
        if (prodQueueRes.status === 'fulfilled' && prodQueueRes.value) {
            const rawItems = prodQueueRes.value.data?.items || prodQueueRes.value.items || (Array.isArray(prodQueueRes.value.data) ? prodQueueRes.value.data : []);
            if (Array.isArray(rawItems)) productionQueueItems = rawItems;
        }
        if (custRes.status === 'fulfilled' && custRes.value) {
            const rawCusts = custRes.value.data?.customers || custRes.value.customers || (Array.isArray(custRes.value.data) ? custRes.value.data : []);
            if (Array.isArray(rawCusts)) customers = rawCusts.map(normalizeCustomer);
        }
        if (evtRes.status === 'fulfilled' && evtRes.value) {
            const rawEvts = evtRes.value.data?.events || evtRes.value.events || (Array.isArray(evtRes.value.data) ? evtRes.value.data : []);
            if (Array.isArray(rawEvts)) {
                events = rawEvts.map(e => ({
                    ...e,
                    id: e.id,
                    event_name: e.name || e.event_name || '',
                    subtitle: e.subtitle || e.description || '',
                    discount_type: e.discount_type || 'percent',
                    discount_value: e.discount_value || 0,
                    start_time: e.start_time || e.start_date || new Date().toISOString().slice(0, 16),
                    end_time: e.end_time || e.end_date || new Date().toISOString().slice(0, 16),
                    target_product_ids: Array.isArray(e.target_product_ids) ? e.target_product_ids : (Array.isArray(e.product_ids) ? e.product_ids : []),
                    active: e.active === 1 || e.active === true
                }));
            }
        }
        if (cpnRes.status === 'fulfilled' && cpnRes.value) {
            const rawCpns = cpnRes.value.data?.coupons || cpnRes.value.coupons || (Array.isArray(cpnRes.value.data) ? cpnRes.value.data : []);
            if (Array.isArray(rawCpns)) {
                coupons = rawCpns.map(c => ({
                    ...c,
                    id: c.id,
                    code: (c.code || '').toUpperCase(),
                    discount_type: c.discount_type || 'percent',
                    discount_value: c.discount_value || 0,
                    min_spend: c.min_order_value_rupees !== undefined ? c.min_order_value_rupees : (parseInt(c.min_order_value || c.min_spend, 10) || 0),
                    active: c.active === 1 || c.active === true
                }));
            }
        }
        if (shipRes.status === 'fulfilled' && shipRes.value) {
            const rawRules = shipRes.value.data?.rules || shipRes.value.rules || shipRes.value.data?.shipping_rules || (Array.isArray(shipRes.value.data) ? shipRes.value.data : []);
            if (Array.isArray(rawRules)) {
                shippingRules = rawRules.map(s => ({
                    ...s,
                    id: s.id,
                    rule_name: s.name || s.rule_name || '',
                    min_order: s.free_shipping_threshold_rupees !== undefined ? s.free_shipping_threshold_rupees : (parseInt(s.free_shipping_threshold || s.min_order, 10) || 0),
                    max_order: 999999,
                    region: s.region || "India (All States)",
                    fee: s.standard_fee_rupees !== undefined ? s.standard_fee_rupees : (parseInt(s.standard_fee || s.fee, 10) || 0),
                    active: s.is_enabled === 1 || s.is_enabled === true || s.active === true
                }));
            }
        }
        if (storeRes.status === 'fulfilled' && storeRes.value) {
            const storeData = storeRes.value.data || storeRes.value || {};
            if (storeData.hero_config) heroConfig = storeData.hero_config;
            if (storeData.announcement_bar) announcementBarConfig = storeData.announcement_bar;
            if (Array.isArray(storeData.hero_groups)) heroGroups = storeData.hero_groups;
            else if (Array.isArray(storeData.heroGroups)) heroGroups = storeData.heroGroups;
            if (Array.isArray(storeData.promo_banners)) promoBanners = storeData.promo_banners;
            else if (Array.isArray(storeData.promoBanners)) promoBanners = storeData.promoBanners;
            if (Array.isArray(storeData.content_sections)) storeSections = storeData.content_sections;
            else if (Array.isArray(storeData.storeSections)) storeSections = storeData.storeSections;
        }
        if (dashRes && dashRes.status === 'fulfilled' && dashRes.value) {
            const dashData = dashRes.value.data || dashRes.value || {};
            if (dashData.metrics) {
                dashboardMetrics = dashData.metrics;
                if (Array.isArray(dashData.metrics.monthlyStats) && dashData.metrics.monthlyStats.length > 0) {
                    monthlyStats = dashData.metrics.monthlyStats;
                }
            }
        }
        if (revRes.status === 'fulfilled' && revRes.value) {
            const rawRevs = revRes.value.data?.reviews || revRes.value.reviews || (Array.isArray(revRes.value.data) ? revRes.value.data : []);
            if (Array.isArray(rawRevs)) {
                reviews = rawRevs.map(r => ({
                    ...r,
                    id: r.id,
                    admin_id: r.admin_product_id || `CK-${r.product_id}`,
                    product_name: r.product_name || 'Product',
                    customer_name: r.customer_name || 'Customer',
                    rating: r.rating || 5,
                    comment: r.comment || '',
                    date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                    status: String(r.status || 'pending').charAt(0).toUpperCase() + String(r.status || 'pending').slice(1).toLowerCase()
                }));
            }
        }
        if (setRes.status === 'fulfilled' && setRes.value) {
            const settingsData = setRes.value.data?.settings || setRes.value.settings || setRes.value.data;
            if (settingsData && typeof settingsData === 'object') {
                siteSettings = { ...siteSettings, ...settingsData };
            }
        }
        if (auditRes.status === 'fulfilled' && auditRes.value) {
            const rawLogs = auditRes.value.data?.auditLogs || auditRes.value.auditLogs || auditRes.value.data?.logs || (Array.isArray(auditRes.value.data) ? auditRes.value.data : []);
            if (Array.isArray(rawLogs)) {
                auditLogs = rawLogs.map(a => ({
                    timestamp: a.created_at || a.timestamp || new Date().toISOString(),
                    actor: a.actor_email || a.admin_email || a.actor_id || a.actor || 'SYSTEM',
                    action: `${a.action || ''} ${a.entity_type ? '(' + a.entity_type + ' #' + (a.entity_id || '') + ')' : ''}`.trim()
                }));
            }
        }
        if (teamRes && teamRes.status === 'fulfilled' && teamRes.value) {
            const rawTeam = teamRes.value.data?.team || teamRes.value.team || (Array.isArray(teamRes.value.data) ? teamRes.value.data : []);
            if (Array.isArray(rawTeam)) {
                teamMembers = rawTeam;
            }
        }
        if (sessionRes && sessionRes.status === 'fulfilled' && sessionRes.value) {
            const rawSessions = sessionRes.value.data?.sessions || sessionRes.value.sessions || (Array.isArray(sessionRes.value.data) ? sessionRes.value.data : []);
            if (Array.isArray(rawSessions)) {
                activeSessions = rawSessions;
            }
        }

        try {
            await Promise.allSettled([
                refreshMaterialsFromAPI(),
                refreshFinishingFromAPI(),
                refreshProductionJobsFromAPI(),
                refreshCustomRequestsFromAPI(),
                refreshChipakkMaterialsFromAPI()
            ]);
        } catch (_) {}

        updateState();
    } catch (err) {
        console.error('[loadAllAdminData Error]', err);
        showToast(`Failed to sync data with API: ${err.message}`, 'error');
    }
}

// API Refresh Handlers
async function refreshProductsFromAPI() {
    try {
        const rawProds = await fetchAllAdminProducts();
        if (Array.isArray(rawProds)) {
            products = rawProds.map(normalizeProduct);
            renderProductsTable();
            populateCategoryDropdowns();
        }
    } catch (err) {
        console.error('[refreshProductsFromAPI]', err.message);
    }
}

async function refreshCategoriesFromAPI() {
    try {
        const res = await apiClient.get('/categories');
        const raw = res?.data?.categories || res?.categories || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        if (Array.isArray(raw)) {
            categories = raw.map(normalizeCategory).filter(c => c && (c.name || '').toLowerCase().trim() !== 'best seller' && (c.slug || '').toLowerCase().trim() !== 'best-seller');
            // Re-normalize loaded products so category mappings are current
            if (Array.isArray(products) && products.length > 0) {
                products = products.map(normalizeProduct);
            }
            renderCategoriesTable();
            populateCategoryDropdowns();
            renderProductsTable();
        }
    } catch (err) {
        console.error('[refreshCategoriesFromAPI]', err.message);
    }
}

async function refreshOrdersFromAPI() {
    try {
        const res = await apiClient.get('/admin/orders');
        const rawOrds = res?.data?.orders || res?.orders || (Array.isArray(res?.data) ? res.data : []);
        if (Array.isArray(rawOrds)) {
            orders = rawOrds.map(normalizeOrder);
            renderOrderStatusTabs();
            renderOrdersTable();
            renderDashboardMetrics();
            renderSalesChart();
            if (activeOrderViewing) {
                const freshOrder = orders.find(o => String(o.id) === String(activeOrderViewing.id) || String(o.order_id) === String(activeOrderViewing.order_id));
                if (freshOrder) {
                    activeOrderViewing = freshOrder;
                    renderOrderDetailModalContent(freshOrder);
                }
            }
        }
    } catch (err) {
        console.error('[refreshOrdersFromAPI]', err.message);
    }
}

async function refreshProductionQueueFromAPI() {
    try {
        const res = await apiClient.get('/admin/production/queue');
        const rawItems = res?.data?.items || res?.items || (Array.isArray(res?.data) ? res.data : []);
        if (Array.isArray(rawItems)) {
            productionQueueItems = rawItems;
            renderProductionQueueTabs();
            renderProductionQueueTable();
        }
    } catch (err) {
        console.error('[refreshProductionQueueFromAPI]', err.message);
    }
}

async function refreshCustomersFromAPI() {
    try {
        const res = await apiClient.get('/admin/customers');
        const rawCusts = res?.data?.customers || res?.customers || (Array.isArray(res?.data) ? res.data : []);
        if (Array.isArray(rawCusts)) {
            customers = rawCusts.map(normalizeCustomer);
            renderCustomersTable();
            renderDashboardMetrics();
        }
    } catch (err) {
        console.error('[refreshCustomersFromAPI]', err.message);
    }
}

async function refreshEventsFromAPI() {
    try {
        const res = await apiClient.get('/admin/events');
        const rawEvents = res?.data?.events || res?.events || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        if (Array.isArray(rawEvents)) {
            events = rawEvents.map(e => ({
                ...e,
                id: e.id,
                event_name: e.name || e.event_name || '',
                subtitle: e.subtitle || e.description || '',
                discount_type: e.discount_type || 'percent',
                discount_value: e.discount_percent !== undefined ? e.discount_percent : (e.discount_value || 0),
                start_time: e.start_time || e.start_date || new Date().toISOString().slice(0, 16),
                end_time: e.end_time || e.end_date || new Date().toISOString().slice(0, 16),
                target_product_ids: Array.isArray(e.target_products) ? e.target_products : (Array.isArray(e.target_product_ids) ? e.target_product_ids : []),
                active: e.active === 1 || e.active === true || e.is_active === 1 || e.is_active === true
            }));
            renderEventsTable();
        }
    } catch (err) {
        console.error('[refreshEventsFromAPI]', err.message);
    }
}

async function refreshCouponsFromAPI() {
    try {
        const res = await apiClient.get('/admin/coupons');
        const rawCoupons = res?.data?.coupons || res?.coupons || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        if (Array.isArray(rawCoupons)) {
            coupons = rawCoupons.map(c => ({
                ...c,
                id: c.id,
                code: (c.code || '').toUpperCase(),
                discount_type: c.discount_type || 'percent',
                discount_value: c.discount_value || 0,
                min_spend: c.min_order_value_rupees !== undefined ? c.min_order_value_rupees : (parseInt(c.min_order_value || c.min_spend, 10) || 0),
                active: c.active === 1 || c.active === true || c.is_active === 1 || c.is_active === true
            }));
            renderCouponsTable();
        }
    } catch (err) {
        console.error('[refreshCouponsFromAPI]', err.message);
    }
}

async function refreshShippingRulesFromAPI() {
    try {
        const res = await apiClient.get('/admin/shipping-rules');
        const rawRules = res?.data?.rules || res?.rules || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        if (Array.isArray(rawRules)) {
            shippingRules = rawRules.map(s => ({
                ...s,
                id: s.id,
                rule_name: s.name || s.rule_name || '',
                min_order: s.free_shipping_threshold_rupees !== undefined ? s.free_shipping_threshold_rupees : (parseInt(s.free_shipping_threshold || s.min_order, 10) || 0),
                max_order: 999999,
                region: s.region || "India (All States)",
                fee: s.standard_fee_rupees !== undefined ? s.standard_fee_rupees : (parseInt(s.standard_fee || s.fee, 10) || 0),
                active: s.is_enabled === 1 || s.is_enabled === true || s.active === true
            }));
            renderShippingRulesTable();
            renderShippingCalculatorPreview();
        }
    } catch (err) {
        console.error('[refreshShippingRulesFromAPI]', err.message);
    }
}

async function refreshStoreBuilderFromAPI() {
    try {
        const res = await apiClient.get('/admin/store-builder');
        const data = res?.data || res || {};
        if (Array.isArray(data.heroGroups)) heroGroups = data.heroGroups;
        if (Array.isArray(data.promoBanners)) promoBanners = data.promoBanners;
        if (Array.isArray(data.storeSections)) storeSections = data.storeSections;
        renderStoreBuilder();
    } catch (err) {
        console.error('[refreshStoreBuilderFromAPI]', err.message);
    }
}

async function refreshReviewsFromAPI() {
    try {
        const res = await apiClient.get('/admin/reviews');
        const rawReviews = res?.data?.reviews || res?.reviews || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        if (Array.isArray(rawReviews)) {
            reviews = rawReviews.map(r => ({
                ...r,
                id: r.id,
                admin_id: r.admin_product_id || `CK-${r.product_id}`,
                product_name: r.product_name || 'Product',
                customer_name: r.customer_name || 'Customer',
                rating: r.rating || 5,
                comment: r.comment || '',
                date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                status: String(r.status || 'pending').charAt(0).toUpperCase() + String(r.status || 'pending').slice(1).toLowerCase()
            }));
            renderReviewsTable();
        }
    } catch (err) {
        console.error('[refreshReviewsFromAPI]', err.message);
    }
}

const STORE_TAX_CONFIG_KEYS = ['custom_sticker_hsn_code', 'custom_sticker_gst_rate', 'trade_name', 'invoice_prefix', 'default_gst_rate', 'gst_pct', 'gst_rate', 'gst_enabled'];

async function refreshSettingsFromAPI() {
    try {
        const res = await apiClient.get('/admin/settings');
        const rawSettings = res?.data?.settings || res?.settings || res?.data || (typeof res === 'object' ? res : null);
        if (rawSettings && typeof rawSettings === 'object') {
            // Per-store tax configuration must be REPLACED, never merged: a key the active store does not have (for example
            // a custom-sticker HSN saved on another store or in an earlier session) must not survive and be shown / re-saved here.
            for (const k of STORE_TAX_CONFIG_KEYS) delete siteSettings[k];
            siteSettings = { ...siteSettings, ...rawSettings };
            loadSystemSettings();
        }
    } catch (err) {
        console.error('[refreshSettingsFromAPI]', err.message);
    }
}

async function refreshMaterialsFromAPI() {
    try {
        const res = await apiClient.get('/admin/materials');
        const raw = res?.data?.materials || res?.materials || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        materials = Array.isArray(raw) ? raw : [];
        renderMaterialsTable();
        renderInventoryTable();
        populateInventoryMaterialSelect();
    } catch (err) {
        console.error('[refreshMaterialsFromAPI]', err.message);
    }
}

async function refreshFinishingFromAPI() {
    try {
        const res = await apiClient.get('/admin/finishing-options');
        const raw = res?.data?.finishing_options || res?.finishing_options || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        finishingOptions = Array.isArray(raw) ? raw : [];
        renderFinishingTable();
    } catch (err) {
        console.error('[refreshFinishingFromAPI]', err.message);
    }
}

async function refreshProductionJobsFromAPI(stageFilter = '') {
    try {
        const endpoint = stageFilter ? `/admin/production-jobs?stage=${encodeURIComponent(stageFilter)}` : '/admin/production-jobs';
        const res = await apiClient.get(endpoint);
        const raw = res?.data?.jobs || res?.jobs || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        productionJobs = Array.isArray(raw) ? raw : [];
        renderProductionJobsTable();
    } catch (err) {
        console.error('[refreshProductionJobsFromAPI]', err.message);
    }
}

async function refreshCustomRequestsFromAPI(statusFilter = '') {
    try {
        const endpoint = statusFilter ? `/admin/custom-requests?status=${encodeURIComponent(statusFilter)}` : '/admin/custom-requests';
        const res = await apiClient.get(endpoint);
        const raw = res?.data?.requests || res?.requests || (Array.isArray(res?.data) ? res.data : []) || (Array.isArray(res) ? res : []);
        customRequests = Array.isArray(raw) ? raw : [];
        renderCustomRequestsTable();
    } catch (err) {
        console.error('[refreshCustomRequestsFromAPI]', err.message);
    }
}

function updateState() {
    updateCustomerStatsAndTiers();
    saveState();
    renderDashboardMetrics();
    renderSalesChart();
    renderProductsTable();
    renderCategoriesTable();
    renderMaterialsTable();
    renderInventoryTable();
    renderFinishingTable();
    renderProductionJobsTable();
    renderCustomRequestsTable();
    renderProductionQueueTabs();
    renderProductionQueueTable();
    renderReviewsTable();
    renderOrderStatusTabs();
    renderOrdersTable();
    renderCustomersTable();
    renderEventsTable();
    renderCouponsTable();
    renderStoreBuilder();
    renderShippingRulesTable();
    renderShippingCalculatorPreview();
    renderTeamMembersTable();
    renderActiveSessionsTable();
    renderAuditLogs();
    renderChipakkMaterialsTable();
    populateCategoryDropdowns();

    if (activeOrderViewing) {
        const freshOrder = orders.find(o => String(o.id) === String(activeOrderViewing.id) || String(o.order_id) === String(activeOrderViewing.order_id));
        if (freshOrder) {
            activeOrderViewing = freshOrder;
            renderOrderDetailModalContent(freshOrder);
        }
    }
}

function saveState() {
    // Retain UI preferences in localStorage
    localStorage.setItem('site_settings_cache', JSON.stringify(siteSettings));
}

// =============================================================================
/**
 * Get or create persistent client-side admin session ID for multi-device/session management
 */
function getOrCreateAdminSessionId() {
    try {
        let sid = localStorage.getItem('chipakk_admin_session_id');
        if (!sid) {
            sid = `sess_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
            localStorage.setItem('chipakk_admin_session_id', sid);
        }
        return sid;
    } catch (_) {
        return `sess_${Date.now()}`;
    }
}

// INACTIVITY AUTO-LOGOUT TRACKER (60 MINUTES PERSISTED)
// =============================================================================
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const INACTIVITY_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
const ACTIVITY_THROTTLE_MS = 15000; // 15 seconds throttle to avoid excessive storage writes
const STORAGE_ACTIVITY_KEY = 'chipakk_admin_last_activity';

let inactivityTimer = null;
let lastThrottledActivityAt = 0;
let isTrackerActive = false;

function recordAdminActivity(force = false) {
    const now = Date.now();
    if (force || (now - lastThrottledActivityAt >= ACTIVITY_THROTTLE_MS)) {
        lastThrottledActivityAt = now;
        try {
            localStorage.setItem(STORAGE_ACTIVITY_KEY, String(now));
        } catch (e) {}
    }
}

function handleUserActivity() {
    recordAdminActivity(false);
}

function handleApiActivity() {
    // API / background network activity is NOT genuine user interaction.
    // Intentionally no-op to prevent background API polling from extending the 60-minute inactivity timer.
}

async function checkInactivityState() {
    if (!auth || !auth.currentUser) return;
    const stored = localStorage.getItem(STORAGE_ACTIVITY_KEY);
    const lastActivity = stored ? parseInt(stored, 10) : lastThrottledActivityAt;
    const elapsed = Date.now() - (lastActivity || Date.now());

    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        console.warn(`[Inactivity Tracker] Session expired after ${Math.round(elapsed / 1000)}s of inactivity.`);
        const sessionId = getOrCreateAdminSessionId();
        stopInactivityTracker();
        localStorage.removeItem(STORAGE_ACTIVITY_KEY);
        try {
            await apiClient.post('/admin/auth/logout-event', { session_id: sessionId, reason: 'inactivity_timeout' });
        } catch (e) {}
        try {
            await signOut(auth);
        } catch (err) {
            console.error("[Inactivity Logout Error]", err);
        }
        showToast("SESSION EXPIRED (1-HOUR INACTIVITY) — PLEASE LOG IN AGAIN", "error");
        if (loginSection) loginSection.style.display = 'flex';
        if (adminWorkspace) adminWorkspace.style.display = 'none';
    }
}

function startInactivityTracker() {
    if (isTrackerActive) return;
    isTrackerActive = true;
    recordAdminActivity(true);

    const userEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    userEvents.forEach(evt => window.addEventListener(evt, handleUserActivity, { passive: true }));

    window.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkInactivityState();
    });
    window.addEventListener('focus', checkInactivityState);

    // Cross-tab synchronization
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_ACTIVITY_KEY) {
            if (!e.newValue) {
                // Logged out in another tab
                stopInactivityTracker();
                signOut(auth).catch(() => {});
                if (loginSection) loginSection.style.display = 'flex';
                if (adminWorkspace) adminWorkspace.style.display = 'none';
            } else {
                checkInactivityState();
            }
        }
    });

    if (inactivityTimer) clearInterval(inactivityTimer);
    inactivityTimer = setInterval(checkInactivityState, INACTIVITY_CHECK_INTERVAL_MS);
    console.log("[Inactivity Tracker] Started (60 min timeout with cross-tab sync)");
}

function stopInactivityTracker() {
    if (!isTrackerActive && !inactivityTimer) return;
    isTrackerActive = false;
    if (inactivityTimer) {
        clearInterval(inactivityTimer);
        inactivityTimer = null;
    }

    const userEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    userEvents.forEach(evt => window.removeEventListener(evt, handleUserActivity));

    window.removeEventListener('focus', checkInactivityState);
    console.log("[Inactivity Tracker] Stopped");
}

// Dev test helper for quick simulation of inactivity timeout
window.__simulateInactivityTimeout__ = function() {
    console.warn("[Dev Helper] Simulating 60-minute inactivity timeout...");
    localStorage.setItem(STORAGE_ACTIVITY_KEY, String(Date.now() - (INACTIVITY_TIMEOUT_MS + 5000)));
    checkInactivityState();
};

// Send beacon on tab close / reload
window.addEventListener('beforeunload', () => {
    if (auth && auth.currentUser) {
        try {
            const payload = JSON.stringify({
                uid: auth.currentUser.uid,
                email: auth.currentUser.email,
                reason: 'browser_unload'
            });
            navigator.sendBeacon('/api/admin/auth/logout-event', new Blob([payload], { type: 'application/json' }));
        } catch (e) {}
    }
});

// =============================================================================
// INITIALIZER & NAVIGATION CONTROLLER
// =============================================================================

let isDashboardInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    // Auth Listener
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Immediate check: Has more than 1 hour passed since last recorded activity?
            const stored = localStorage.getItem(STORAGE_ACTIVITY_KEY);
            if (stored) {
                const elapsed = Date.now() - parseInt(stored, 10);
                if (elapsed >= INACTIVITY_TIMEOUT_MS) {
                    console.warn("[Auth State] Session expired during offline period (>1 hour).");
                    localStorage.removeItem(STORAGE_ACTIVITY_KEY);
                    await signOut(auth);
                    showToast("SESSION EXPIRED (1-HOUR INACTIVITY) — PLEASE LOG IN AGAIN", "error");
                    if (loginSection) loginSection.style.display = 'flex';
                    if (adminWorkspace) adminWorkspace.style.display = 'none';
                    return;
                }
            }

            const sessionId = getOrCreateAdminSessionId();
            console.log("[Auth State] User signed in:", user.email, "Session ID:", sessionId);
            if (loginSection) loginSection.style.display = 'none';
            if (adminWorkspace) adminWorkspace.style.display = 'flex';
            startInactivityTracker();
            initDashboard();
            try {
                await apiClient.post('/admin/auth/login-event', { session_id: sessionId });
            } catch (_) {}
            await loadAllAdminData();
        } else {
            console.log("[Auth State] No active user.");
            stopInactivityTracker();
            localStorage.removeItem(STORAGE_ACTIVITY_KEY);
            if (loginSection) loginSection.style.display = 'block';
            if (adminWorkspace) adminWorkspace.style.display = 'none';
        }
    });

    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const email = emailInput?.value.trim();
            const password = passwordInput?.value;
            if (!email || !password) {
                showToast("Please enter both email and password!", "error");
                return;
            }
            loginBtn.disabled = true;
            loginBtn.textContent = "VERIFYING...";
            try {
                await signInWithEmailAndPassword(auth, email, password);
                recordAdminActivity(true);
                showToast("Admin authenticated successfully!");
            } catch (err) {
                console.error("[Login Error]", err);
                showToast(`Authentication failed: ${err.message}`, "error");
            } finally {
                loginBtn.disabled = false;
                loginBtn.textContent = "ENTER WORKSPACE →";
            }
        });
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                const sessionId = localStorage.getItem('chipakk_admin_session_id');
                stopInactivityTracker();
                localStorage.removeItem(STORAGE_ACTIVITY_KEY);
                localStorage.removeItem('chipakk_admin_session_id');
                await apiClient.post('/admin/auth/logout-event', { session_id: sessionId, reason: 'user_action' }).catch(() => {});
                await signOut(auth);
                showToast("Signed out of Admin Workspace.");
                if (loginSection) loginSection.style.display = 'flex';
                if (adminWorkspace) adminWorkspace.style.display = 'none';
            } catch (err) {
                console.error("[Sign Out Error]", err);
            }
        });
    }
});

function initDashboard() {
    if (!isDashboardInitialized) {
        setupNavigation();
        setupEventListeners();
        isDashboardInitialized = true;
    }
    updateState();
}

function populateCategoryDropdowns() {
    const prodCatSelect = document.getElementById('prod-category');
    const filterCatSelect = document.getElementById('prod-filter-category');
    const evtCatSelect = document.getElementById('evt-filter-cat');

    const currentProdVal = prodCatSelect?.value;
    const currentFilterVal = filterCatSelect?.value;
    const currentEvtVal = evtCatSelect?.value;

    const catOptions = categories.map(c => `<option value="${escapeHtml(c.name)}" data-id="${c.id}" data-slug="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');

    if (prodCatSelect) {
        prodCatSelect.innerHTML = catOptions;
        if (currentProdVal) {
            const matchedOpt = Array.from(prodCatSelect.options).find(o =>
                o.value.toLowerCase() === currentProdVal.toLowerCase() ||
                o.getAttribute('data-slug')?.toLowerCase() === currentProdVal.toLowerCase() ||
                o.getAttribute('data-id') === String(currentProdVal)
            );
            if (matchedOpt) prodCatSelect.value = matchedOpt.value;
        }
    }
    if (filterCatSelect) {
        filterCatSelect.innerHTML = `<option value="">All Categories</option>${catOptions}`;
        if (currentFilterVal) {
            const matchedOpt = Array.from(filterCatSelect.options).find(o =>
                o.value.toLowerCase() === currentFilterVal.toLowerCase() ||
                o.getAttribute('data-slug')?.toLowerCase() === currentFilterVal.toLowerCase() ||
                o.getAttribute('data-id') === String(currentFilterVal)
            );
            if (matchedOpt) filterCatSelect.value = matchedOpt.value;
        }
    }
    if (evtCatSelect) {
        evtCatSelect.innerHTML = `<option value="">All Categories</option>${catOptions}`;
        if (currentEvtVal) {
            const matchedOpt = Array.from(evtCatSelect.options).find(o =>
                o.value.toLowerCase() === currentEvtVal.toLowerCase() ||
                o.getAttribute('data-slug')?.toLowerCase() === currentEvtVal.toLowerCase() ||
                o.getAttribute('data-id') === String(currentEvtVal)
            );
            if (matchedOpt) evtCatSelect.value = matchedOpt.value;
        }
    }
}

function setupNavigation() {
    const navItems = document.querySelectorAll('.admin-nav-item');
    const sections = document.querySelectorAll('.tab-content, .admin-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetSecId = item.getAttribute('data-tab') || item.getAttribute('data-section');
            if (!targetSecId) return;

            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            sections.forEach(sec => {
                sec.style.display = sec.id === targetSecId ? 'block' : 'none';
            });

            // Close mobile sidebar drawer if open
            const sidebar = document.querySelector('.admin-sidebar');
            const backdrop = document.getElementById('admin-sidebar-backdrop');
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (backdrop) backdrop.style.display = 'none';
            }

            if (targetSecId === 'tab-logs' || targetSecId === 'tab-audit') {
                refreshAuditLogsFromAPI();
                refreshActiveSessionsFromAPI();
            } else if (targetSecId === 'tab-team') {
                refreshTeamFromAPI();
                refreshActiveSessionsFromAPI();
            } else if (targetSecId === 'tab-dashboard') {
                renderSalesChart();
                refreshActiveSessionsFromAPI();
            } else if (targetSecId === 'tab-homepage' || targetSecId === 'tab-store-builder') {
                renderStoreBuilder();
            } else if (targetSecId === 'tab-settings') {
                refreshAuditLogsFromAPI();
            } else if (targetSecId === 'tab-chipakk-inventory') {
                refreshChipakkMaterialsFromAPI();
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// =============================================================================
// 1. DASHBOARD & ANALYTICS WIDGETS
// =============================================================================

async function refreshDashboardFromAPI(timeframe) {
    try {
        const tf = timeframe || document.getElementById('analytics-date-filter')?.value || 'last_6_months';
        const res = await apiClient.get(`/admin/dashboard?timeframe=${encodeURIComponent(tf)}`);
        const dashData = res?.data || res || {};
        if (dashData.metrics) {
            dashboardMetrics = dashData.metrics;
            if (Array.isArray(dashData.metrics.monthlyStats)) {
                monthlyStats = dashData.metrics.monthlyStats;
            }
        }
        renderDashboardMetrics();
        renderSalesChart();
    } catch (err) {
        console.error('[refreshDashboardFromAPI]', err.message);
    }
}

function renderDashboardMetrics() {
    // Authoritative Server Metrics (Priority from dedicated DB queries)
    const hasServerMetrics = dashboardMetrics && typeof dashboardMetrics === 'object' && dashboardMetrics.totalOrders !== undefined;

    const totalOrders = hasServerMetrics ? (dashboardMetrics.totalOrders || 0) : orders.length;
    const cancelledOrders = hasServerMetrics ? (dashboardMetrics.cancelledOrders || 0) : orders.filter(o => o.status === 'Cancelled' || o.status === 'CANCELLED' || String(o.fulfillment_status).toUpperCase() === 'CANCELLED').length;

    // Strict Commercial Rule: Revenue KPI excludes unpaid, pending, cancelled, and failed orders
    const isPaidOrder = (o) => {
        const payStatus = String(o.payment_status || '').toLowerCase();
        const fulStatus = String(o.fulfillment_status || o.status || '').toUpperCase();
        return payStatus === 'paid' && fulStatus !== 'CANCELLED' && fulStatus !== 'FAILED';
    };

    const totalRevenue = hasServerMetrics ? (dashboardMetrics.totalRevenue || 0) : orders.filter(isPaidOrder).reduce((sum, o) => sum + (o.total_price || 0), 0);
    const totalProducts = hasServerMetrics ? (dashboardMetrics.totalProducts || products.length) : products.length;
    const totalCustomers = hasServerMetrics ? (dashboardMetrics.totalUsers || customers.length) : customers.length;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthOrders = orders.filter(o => {
        const d = new Date(o.created_at);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
    const monthRevenue = hasServerMetrics ? (dashboardMetrics.monthRevenue || 0) : monthOrders.filter(isPaidOrder).reduce((sum, o) => sum + (o.total_price || 0), 0);

    const todayStr = now.toISOString().slice(0, 10);
    const ordersToday = hasServerMetrics ? (dashboardMetrics.ordersToday || 0) : orders.filter(o => o.created_at && String(o.created_at).slice(0, 10) === todayStr).length;

    const awaitingConf = hasServerMetrics ? (dashboardMetrics.awaitingConfirmation || 0) : orders.filter(o => o.status === 'New' || o.status === 'NEW').length;
    const readyPrint = hasServerMetrics ? (dashboardMetrics.readyToPrint || 0) : productionQueueItems.filter(i => (i.production_status || '').toLowerCase().includes('ready') || (i.production_status || '') === 'NEW').length;
    const inProd = hasServerMetrics ? ((dashboardMetrics.printingCutting !== undefined ? dashboardMetrics.printingCutting : dashboardMetrics.inProduction) || 0) : productionQueueItems.filter(i => (i.production_status || '').toLowerCase().includes('print') || (i.production_status || '').toLowerCase().includes('cut')).length;
    const readyPack = hasServerMetrics ? (dashboardMetrics.readyToPack || 0) : productionQueueItems.filter(i => (i.production_status || '').toLowerCase().includes('pack')).length;

    const elTotalOrders = document.getElementById('stat-total-orders');
    const elCancelledOrders = document.getElementById('stat-cancelled-orders');
    const elTotalRevenue = document.getElementById('stat-total-revenue');
    const elMonthRevenue = document.getElementById('stat-month-revenue');
    const elOrdersToday = document.getElementById('stat-orders-today');
    const elAwaitingConf = document.getElementById('stat-awaiting-conf');
    const elReadyPrint = document.getElementById('stat-ready-print');
    const elInProd = document.getElementById('stat-in-production');
    const elReadyPack = document.getElementById('stat-ready-pack');

    if (elTotalOrders) elTotalOrders.textContent = totalOrders;
    if (elCancelledOrders) elCancelledOrders.textContent = cancelledOrders;
    if (elTotalRevenue) elTotalRevenue.textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
    if (elMonthRevenue) elMonthRevenue.textContent = `₹${monthRevenue.toLocaleString('en-IN')}`;
    if (elOrdersToday) elOrdersToday.textContent = ordersToday;
    if (elAwaitingConf) elAwaitingConf.textContent = awaitingConf;
    if (elReadyPrint) elReadyPrint.textContent = readyPrint;
    if (elInProd) elInProd.textContent = inProd;
    if (elReadyPack) elReadyPack.textContent = readyPack;

    renderDashboardWidgets();
}

function renderDashboardWidgets() {
    const recentOrdersBody = document.getElementById('dash-recent-orders-tbody');
    if (recentOrdersBody) {
        const recent = (dashboardMetrics && Array.isArray(dashboardMetrics.recentOrders) && dashboardMetrics.recentOrders.length > 0)
            ? dashboardMetrics.recentOrders
            : orders.slice(0, 5);
        recentOrdersBody.innerHTML = recent.map(o => `
            <tr>
                <td><strong class="admin-id-highlight">${o.order_id || o.order_number || o.id}</strong></td>
                <td>${o.customer_name || 'Customer'}</td>
                <td><strong>₹${Number(o.total_price || 0).toLocaleString('en-IN')}</strong></td>
                <td><span class="status-badge status-live">${o.payment_status || 'paid'}</span></td>
                <td><span class="status-badge status-upcoming">${o.status || 'Pending'}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="5">No recent orders found.</td></tr>';
    }

    const topProductsBody = document.getElementById('dash-top-products-tbody');
    if (topProductsBody) {
        const topProds = (dashboardMetrics && Array.isArray(dashboardMetrics.topProducts) && dashboardMetrics.topProducts.length > 0)
            ? dashboardMetrics.topProducts
            : products.slice(0, 5);
        topProductsBody.innerHTML = topProds.map(p => {
            const img = (Array.isArray(p.images) && p.images[0]) || p.image_url || 'https://img.icons8.com/color/150/000000/sticker.png';
            return `
            <tr>
                <td><img src="${img}" style="width:30px; height:30px; object-fit:cover;"></td>
                <td><strong>${p.title || p.name}</strong></td>
                <td>₹${Number(p.price || 0).toLocaleString('en-IN')}</td>
                <td>${formatRatingDisplay(p.rating || 5)}</td>
            </tr>
        `;
        }).join('') || '<tr><td colspan="4">No products found.</td></tr>';
    }
}

function initSalesComparisonChart() {
    renderSalesChart();
}

function renderSalesChart(filterMode = currentChartFilter) {
    currentChartFilter = filterMode;
    const canvas = document.getElementById('sales-comparison-canvas');
    if (!canvas) return;

    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width - 24 : 700;
    const h = 256;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (ctx.resetTransform) ctx.resetTransform();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Build or use statistical data returned from server
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    let stats = [];

    if (Array.isArray(monthlyStats) && monthlyStats.length > 0) {
        stats = monthlyStats.map(s => ({ ...s }));
    } else {
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const m = d.getMonth();
            const y = d.getFullYear();
            const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;
            stats.push({
                monthKey,
                month: monthNames[m],
                year: y,
                label: `${monthNames[m]} '${String(y).slice(-2)}`,
                revenue: 0,
                orders: 0
            });
        }
    }

    // Only overlay real orders if monthlyStats was empty (fallback)
    if ((!monthlyStats || monthlyStats.length === 0) && Array.isArray(orders) && orders.length > 0) {
        orders.forEach(o => {
            if (!o.created_at) return;
            const st = String(o.status || o.fulfillment_status || '').toLowerCase();
            const paySt = String(o.payment_status || '').toLowerCase();
            if (st === 'cancelled' || st === 'failed' || paySt !== 'paid') return;
            const d = new Date(o.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const match = stats.find(s => s.monthKey === key);
            if (match) {
                match.revenue += Math.round(Number(o.total_price || 0));
                match.orders += 1;
            }
        });
    }

    const totalRev = stats.reduce((sum, s) => sum + s.revenue, 0);
    const totalOrds = stats.reduce((sum, s) => sum + s.orders, 0);
    const aov = totalOrds > 0 ? Math.round(totalRev / totalOrds) : 0;

    // Update Summary Bar
    const summaryBar = document.getElementById('chart-summary-bar');
    if (summaryBar) {
        summaryBar.innerHTML = `
            <div>
                <small style="color: #6b7280; font-weight: 800; font-size: 0.72rem; text-transform: uppercase;">${stats.length}-Month Verified Revenue</small><br>
                <strong style="font-size: 1.25rem; color: #10b981; font-weight: 900;">${totalRev > 0 ? '₹' + totalRev.toLocaleString('en-IN') : '₹0'}</strong>
            </div>
            <div>
                <small style="color: #6b7280; font-weight: 800; font-size: 0.72rem; text-transform: uppercase;">Total Order Volume</small><br>
                <strong style="font-size: 1.25rem; color: #3b82f6; font-weight: 900;">${totalOrds} Orders</strong>
            </div>
            <div>
                <small style="color: #6b7280; font-weight: 800; font-size: 0.72rem; text-transform: uppercase;">Avg. Order Value (AOV)</small><br>
                <strong style="font-size: 1.25rem; color: #111827; font-weight: 900;">₹${aov.toLocaleString('en-IN')}</strong>
            </div>
            <div>
                <small style="color: #6b7280; font-weight: 800; font-size: 0.72rem; text-transform: uppercase;">Tracking Window</small><br>
                <strong style="font-size: 0.95rem; color: #374151; font-weight: 800;">${stats[0]?.label || ''} – ${stats[stats.length - 1]?.label || ''}</strong>
            </div>
        `;
    }

    const padLeft = 60;
    const padRight = 50;
    const padTop = 30;
    const padBottom = 40;
    const plotW = Math.max(10, w - padLeft - padRight);
    const plotH = Math.max(10, h - padTop - padBottom);

    const numMonths = stats.length;
    const colStep = plotW / numMonths;

    // Calculate dynamic axis scales
    const maxRevVal = Math.max(...stats.map(s => s.revenue), 0);
    const maxRevScale = maxRevVal > 0 ? Math.ceil(maxRevVal / 1000) * 1000 : 1000;
    const maxOrdVal = Math.max(...stats.map(s => s.orders), 0);
    const maxOrdScale = maxOrdVal > 0 ? Math.ceil(maxOrdVal / 5) * 5 : 10;

    // Draw horizontal grid lines & Y-axis labels
    const gridDivisions = 4;
    ctx.strokeStyle = '#f3f4f6';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let i = 0; i <= gridDivisions; i++) {
        const y = padTop + (plotH / gridDivisions) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(w - padRight, y);
        ctx.stroke();

        const fraction = (gridDivisions - i) / gridDivisions;

        // Left axis: Revenue (₹)
        if (filterMode === 'all' || filterMode === 'revenue') {
            const revTick = Math.round(fraction * maxRevScale);
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'right';
            const formattedRev = revTick >= 1000 ? `₹${(revTick / 1000).toFixed(1)}k` : `₹${revTick}`;
            ctx.fillText(formattedRev, padLeft - 8, y + 3);
        }

        // Right axis: Orders count
        if (filterMode === 'all' || filterMode === 'orders') {
            const ordTick = Math.round(fraction * maxOrdScale);
            ctx.fillStyle = '#3b82f6';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`${ordTick}`, w - padRight + 8, y + 3);
        }
    }

    // Draw Bars for Revenue
    if (filterMode === 'all' || filterMode === 'revenue') {
        const barWidth = Math.min(34, colStep * 0.45);
        stats.forEach((s, idx) => {
            const colCenterX = padLeft + (idx + 0.5) * colStep;
            const barH = maxRevVal > 0 ? (s.revenue / maxRevScale) * plotH : 0;
            const barX = colCenterX - (barWidth / 2);
            const barY = padTop + plotH - barH;

            if (barH > 0) {
                ctx.fillStyle = '#10b981';
                ctx.beginPath();
                const radius = Math.min(4, barH / 2);
                ctx.moveTo(barX, padTop + plotH);
                ctx.lineTo(barX, barY + radius);
                ctx.quadraticCurveTo(barX, barY, barX + radius, barY);
                ctx.lineTo(barX + barWidth - radius, barY);
                ctx.quadraticCurveTo(barX + barWidth, barY, barX + barWidth, barY + radius);
                ctx.lineTo(barX + barWidth, padTop + plotH);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = '#065f46';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`₹${s.revenue.toLocaleString('en-IN')}`, colCenterX, barY - 6);
            }
        });
    }

    // Draw Smooth Curve for Orders
    if (filterMode === 'all' || filterMode === 'orders') {
        const points = stats.map((s, idx) => {
            const x = padLeft + (idx + 0.5) * colStep;
            const y = maxOrdVal > 0 ? (padTop + plotH - (s.orders / maxOrdScale) * plotH) : (padTop + plotH);
            return { x, y, orders: s.orders };
        });

        if (points.length > 1) {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);

            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[i];
                const p1 = points[i + 1];
                const cp1x = p0.x + (p1.x - p0.x) / 2;
                const cp1y = p0.y;
                const cp2x = p0.x + (p1.x - p0.x) / 2;
                const cp2y = p1.y;
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p1.x, p1.y);
            }
            ctx.stroke();

            // Draw circular points & order counts
            points.forEach(p => {
                ctx.fillStyle = '#1d4ed8';
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                if (p.orders > 0) {
                    ctx.fillStyle = '#1e40af';
                    ctx.font = 'bold 9px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText(`${p.orders} ord`, p.x, p.y - 10);
                }
            });
        }
    }

    // Draw X-Axis Baseline & Month Labels
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + plotH);
    ctx.lineTo(w - padRight, padTop + plotH);
    ctx.stroke();

    stats.forEach((s, idx) => {
        const colCenterX = padLeft + (idx + 0.5) * colStep;
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(s.label || s.month, colCenterX, padTop + plotH + 18);
    });

    // Empty State Message (when 0 data)
    if (totalRev === 0 && totalOrds === 0) {
        ctx.fillStyle = 'rgba(250, 250, 250, 0.88)';
        ctx.fillRect(padLeft, padTop, plotW, plotH);

        ctx.fillStyle = '#111827';
        ctx.font = '900 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText("NO COMPLETED ORDERS YET", w / 2, padTop + plotH / 2 - 8);

        ctx.fillStyle = '#6b7280';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText("Dual-axis metrics will dynamically populate as verified customer orders occur.", w / 2, padTop + plotH / 2 + 12);
    }
}

// =============================================================================
// 2. PRODUCTS & DROPS CATALOG MANAGEMENT
// =============================================================================

function getProductDropStatus(product) {
    if (product.is_active === false) return { status: "Inactive", badgeClass: "status-inactive", label: "INACTIVE" };
    if (!product.scheduled_drop_time) return { status: "Live Now", badgeClass: "status-live", label: "LIVE NOW" };
    return Date.now() >= new Date(product.scheduled_drop_time).getTime()
        ? { status: "Live Now", badgeClass: "status-live", label: "LIVE NOW" }
        : { status: "Upcoming", badgeClass: "status-upcoming", label: "UPCOMING" };
}

function renderProductsTable() {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    const searchQuery = (document.getElementById('prod-search-input')?.value || '').toLowerCase().trim();
    const categoryFilter = (document.getElementById('prod-filter-category')?.value || '').trim();
    const statusFilter = (document.getElementById('prod-filter-drop-status')?.value || '').trim();

    const filtered = products.filter(p => {
        const adminId = (p.admin_id || '').toLowerCase();
        const sku = (p.sku || '').toLowerCase();
        const title = (p.title || p.name || '').toLowerCase();
        const matchesSearch = !searchQuery || adminId.includes(searchQuery) || sku.includes(searchQuery) || title.includes(searchQuery);

        let matchesCat = true;
        if (categoryFilter) {
            const filterLower = categoryFilter.toLowerCase().trim();
            const matchedFilterCat = categories.find(c =>
                c && (
                    (c.name && c.name.toLowerCase().trim() === filterLower) ||
                    (c.slug && c.slug.toLowerCase().trim() === filterLower) ||
                    (String(c.id).trim() === filterLower)
                )
            );
            const targetName = matchedFilterCat ? matchedFilterCat.name.toLowerCase().trim() : filterLower;
            const targetSlug = matchedFilterCat ? (matchedFilterCat.slug || '').toLowerCase().trim() : filterLower;
            const targetId = matchedFilterCat ? String(matchedFilterCat.id).trim() : filterLower;

            const pCatName = (p.category || p.category_name || '').toLowerCase().trim();
            const pCatSlug = (p.category_slug || '').toLowerCase().trim();
            const pCatId = String(p.category_id || '').trim();

            matchesCat = (
                pCatName === targetName ||
                pCatSlug === targetSlug ||
                pCatId === targetId ||
                pCatName === filterLower ||
                pCatSlug === filterLower ||
                pCatId === filterLower
            );
        }

        const dropInfo = getProductDropStatus(p);
        const matchesStatus = !statusFilter || dropInfo.status === statusFilter;
        return matchesSearch && matchesCat && matchesStatus;
    });

    const fallbackImg = 'https://img.icons8.com/color/150/000000/sticker.png';

    tbody.innerHTML = filtered.map(p => {
        const dropInfo = getProductDropStatus(p);
        const firstImg = (p.images && p.images[0]) || p.primary_image_url || p.lumo_light_image || p.lumo_dark_image || '';
        const resolvedImg = resolveAdminImageUrl(firstImg);
        const formattedPrice = Number(p.price || 0).toFixed(2);
        const stockDisplay = p.stock !== undefined ? p.stock : 0;
        const stockColor = stockDisplay <= 5 ? '#ef4444' : (stockDisplay <= 20 ? '#f59e0b' : '#10b981');

        return `
            <tr>
                <td>
                    <img src="${resolvedImg || fallbackImg}"
                         onerror="this.onerror=null; this.src='${fallbackImg}';"
                         alt="${escapeHtml(p.title)}"
                         style="width:45px; height:45px; object-fit:cover; border:1px solid #000; border-radius:2px; display:block;">
                </td>
                <td><span class="admin-id-highlight">${escapeHtml(p.admin_id || p.sku)}</span></td>
                <td>
                    <strong>${escapeHtml(p.title)}</strong>
                    ${p.is_best_seller ? ' <span class="status-badge" style="background:#fef08a; color:#854d0e; font-size:0.65rem; font-weight:900; border:1px solid #eab308; vertical-align:middle;">★ BEST SELLER</span>' : ''}
                    <br><small style="color:#666;">${escapeHtml(p.variant || 'Standard')}</small>
                </td>
                <td><span class="status-badge" style="background:#eee; color:#333;">${escapeHtml(p.category || 'Uncategorized')}</span></td>
                <td>
                    <strong>₹${formattedPrice}</strong>
                    <br><small style="color:${stockColor}; font-weight:bold;">Stock: ${stockDisplay}</small>
                </td>
                <td>${formatRatingDisplay(p.rating)} <small>(${p.review_count || 0})</small></td>
                <td><span class="status-badge ${dropInfo.badgeClass}">${dropInfo.label}</span></td>
                <td><small>${p.scheduled_drop_time ? new Date(p.scheduled_drop_time).toLocaleString() : 'Immediate'}</small></td>
                <td><span class="status-badge ${p.is_active ? 'status-live' : 'status-inactive'}">${p.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="retro-btn edit-prod-btn" data-id="${p.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                        ${p.is_active
                            ? `<button class="retro-btn del-prod-btn" data-id="${p.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>`
                            : `<button class="retro-btn reactivate-prod-btn" data-id="${p.id}" style="padding:2px 6px; font-size:0.75rem; background:#10b981; color:#fff;">RESTORE</button>`
                        }
                    </div>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="10" style="text-align:center; padding:20px; color:#666;">No products found.</td></tr>';

    tbody.querySelectorAll('.edit-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => editProduct(btn.getAttribute('data-id')));
    });

    tbody.querySelectorAll('.del-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => confirmDeleteProduct(btn.getAttribute('data-id')));
    });

    tbody.querySelectorAll('.reactivate-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => reactivateProduct(btn.getAttribute('data-id')));
    });
}

function updateLumoProductPreview(mode, url) {
    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
    const prevWrap = document.getElementById(`prod-lumo-${mode}-preview-wrap`);
    const prevImg = document.getElementById(`prod-lumo-${mode}-preview`);
    if (prevWrap && prevImg) {
        if (url && String(url).trim()) {
            const cleanUrl = String(url).trim();
            prevImg.src = cleanUrl.startsWith('http') ? cleanUrl : (apiHost + cleanUrl);
            prevWrap.style.display = 'block';
        } else {
            prevWrap.style.display = 'none';
            prevImg.src = '';
        }
    }
}

function updateLumoProductSectionVisibility() {
    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const catVal = document.getElementById('prod-category')?.value || '';
    const isLumo = activeStoreId === 2 && (catVal || '').trim().toUpperCase() === 'LUMO';

    const lumoSection = document.getElementById('lumo-product-assets-section');
    const generic360 = document.getElementById('prod-generic-360-container');

    if (lumoSection) {
        lumoSection.style.display = isLumo ? 'block' : 'none';
    }
    if (generic360) {
        generic360.style.display = isLumo ? 'none' : 'block';
    }

    const imgLabel = document.getElementById('prod-images-label');
    if (imgLabel) {
        if (isLumo) {
            imgLabel.innerHTML = 'Additional Gallery Images <small style="color: #64748b; font-weight: normal;">(Optional for LUMO — Dark &amp; Light images provide primary visuals)</small>';
        } else {
            imgLabel.innerHTML = 'Product Images <span style="color:red;">* (At least 1 image required)</span>';
        }
    }
}

function openProductForm(product = null) {
    const container = document.getElementById('product-form-container');
    if (!container) return;

    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const defaultPrefix = activeStoreId === 2 ? 'MRSH' : 'CK';

    editingProductId = product ? product.id : null;
    const adminIdVal = product ? (product.admin_id || product.admin_product_id || product.sku || '') : '';
    const titleVal = product ? (product.title || product.name || '') : '';
    document.getElementById('prod-form-title').textContent = product ? `[EDIT ${activeStoreId === 2 ? '3D PRODUCT' : 'PRODUCT DROP'}: ${adminIdVal || product.id}]` : `[ADD NEW ${activeStoreId === 2 ? '3D PRODUCT' : 'PRODUCT DROP'}]`;

    document.getElementById('prod-admin-id').value = adminIdVal || `${defaultPrefix}-${String(products.length + 1).padStart(3, '0')}`;
    if (document.getElementById('prod-sku')) document.getElementById('prod-sku').value = product ? (product.sku || '') : '';
    document.getElementById('prod-title').value = titleVal;
    if (document.getElementById('prod-desc')) {
        document.getElementById('prod-desc').value = product ? (product.description || '') : '';
    }
    const priceVal = product ? (product.price !== undefined && product.price !== null ? product.price : (product.price_rupees !== undefined ? product.price_rupees : '')) : '';
    document.getElementById('prod-price').value = priceVal;
    if (document.getElementById('prod-compare-at-price')) {
        const compVal = product && product.compare_at_price !== undefined && product.compare_at_price !== null ? (product.compare_at_price_rupees !== undefined ? product.compare_at_price_rupees : product.compare_at_price) : '';
        document.getElementById('prod-compare-at-price').value = compVal;
    }
    const prodCatSelect = document.getElementById('prod-category');
    if (prodCatSelect) {
        const targetCat = (product ? (product.category || product.category_name || '') : (categories[0]?.name || '')).trim().toLowerCase();
        const targetCatId = product && product.category_id ? String(product.category_id).trim() : null;
        const targetSlug = product && product.category_slug ? String(product.category_slug).trim().toLowerCase() : null;
        const matchedOption = Array.from(prodCatSelect.options).find(o =>
            (targetCat && o.value.toLowerCase().trim() === targetCat) ||
            (targetCatId && o.getAttribute('data-id') === targetCatId) ||
            (targetSlug && o.getAttribute('data-slug')?.toLowerCase().trim() === targetSlug)
        );
        if (matchedOption) {
            prodCatSelect.value = matchedOption.value;
        } else if (prodCatSelect.options.length > 0) {
            prodCatSelect.selectedIndex = 0;
        }
    }
    const tagsArr = Array.isArray(product?.tags) ? product.tags : (typeof product?.tags === 'string' ? (product.tags.startsWith('[') ? JSON.parse(product.tags || '[]') : product.tags.split(',').map(t => t.trim())) : []);
    document.getElementById('prod-tags').value = tagsArr.filter(Boolean).join(', ');
    if (document.getElementById('prod-is-best-seller')) {
        document.getElementById('prod-is-best-seller').checked = Boolean(product && (product.is_best_seller === 1 || product.is_best_seller === true));
    }
    if (document.getElementById('prod-hsn-code')) document.getElementById('prod-hsn-code').value = product ? (product.hsn_code || '') : '';
    if (document.getElementById('prod-gst-rate')) document.getElementById('prod-gst-rate').value = product && product.gst_rate !== null && product.gst_rate !== undefined ? product.gst_rate : '';
    if (document.getElementById('prod-tax-hint')) {
        // Wording is fixed: no "fallback" / default HSN is ever suggested. A category value is shown only when one is really configured.
        const catHsn = product && product.category_hsn_code ? ` Category HSN currently: ${product.category_hsn_code}.` : '';
        document.getElementById('prod-tax-hint').textContent = `Leave blank to inherit category HSN. HSN is never guessed. An invoice cannot be issued until the order line has an HSN.${catHsn} GST rate: leave blank to inherit the category rate, then the store default.`;
    }
    const dropTimeVal = product?.scheduled_drop_time ? (typeof product.scheduled_drop_time === 'string' ? product.scheduled_drop_time.slice(0, 16) : new Date(product.scheduled_drop_time).toISOString().slice(0, 16)) : '';
    document.getElementById('prod-release-date').value = dropTimeVal;
    const isActive = product ? (product.is_active !== undefined ? product.is_active : (product.active === 1 || product.active === true)) : true;
    document.getElementById('prod-active').value = String(Boolean(isActive));

    // 3D Print Product Specifications & Mapping (THE MARSHANS)
    if (activeStoreId === 2) {
        if (document.getElementById('prod-short-desc')) document.getElementById('prod-short-desc').value = product?.short_description || '';
        if (document.getElementById('prod-weight-grams')) document.getElementById('prod-weight-grams').value = product?.weight_grams || '';
        if (document.getElementById('prod-dimensions-mm')) document.getElementById('prod-dimensions-mm').value = product?.dimensions_mm || '';
        if (document.getElementById('prod-production-notes')) document.getElementById('prod-production-notes').value = product?.production_notes || '';
        if (document.getElementById('prod-360-url')) document.getElementById('prod-360-url').value = product?.view_360_url || '';

        // LUMO Experience Assets (Light + Dark Mode)
        const lightImg = product?.lumo_light_image || '';
        const darkImg = product?.lumo_dark_image || '';
        const light360 = product?.lumo_light_360_url || '';
        const dark360 = product?.lumo_dark_360_url || '';

        if (document.getElementById('prod-lumo-light-image')) document.getElementById('prod-lumo-light-image').value = lightImg;
        if (document.getElementById('prod-lumo-dark-image')) document.getElementById('prod-lumo-dark-image').value = darkImg;
        if (document.getElementById('prod-lumo-light-360')) document.getElementById('prod-lumo-light-360').value = light360;
        if (document.getElementById('prod-lumo-dark-360')) document.getElementById('prod-lumo-dark-360').value = dark360;

        updateLumoProductPreview('light', lightImg);
        updateLumoProductPreview('dark', darkImg);

        // Populate materials checkboxes
        const matBox = document.getElementById('prod-materials-checkboxes');
        if (matBox) {
            const mappedMatIds = (product?.material_ids || (product?.materials && product.materials.map(m => m.id)) || []).map(Number);
            matBox.innerHTML = materials.length > 0 ? materials.map(m => `
                <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
                    <input type="checkbox" value="${m.id}" ${mappedMatIds.includes(Number(m.id)) ? 'checked' : ''}>
                    <span>${m.name} (${m.material_type} - ${m.color_name || 'Standard'})</span>
                </label>
            `).join('') : '<span style="color:#888; font-size:0.75rem;">No materials defined yet. Add materials in Materials tab.</span>';
        }

        // Populate finishing checkboxes
        const finishBox = document.getElementById('prod-finishing-checkboxes');
        if (finishBox) {
            const mappedFinishIds = (product?.finishing_option_ids || (product?.finishing_options && product.finishing_options.map(f => f.id)) || []).map(Number);
            finishBox.innerHTML = finishingOptions.length > 0 ? finishingOptions.map(f => `
                <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
                    <input type="checkbox" value="${f.id}" ${mappedFinishIds.includes(Number(f.id)) ? 'checked' : ''}>
                    <span>${f.name} (+₹${f.extra_price || 0})</span>
                </label>
            `).join('') : '<span style="color:#888; font-size:0.75rem;">No finishing options defined yet. Add options in Finishing tab.</span>';
        }
    } else {
        updateLumoProductPreview('light', '');
        updateLumoProductPreview('dark', '');
    }

    updateLumoProductSectionVisibility();

    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const isLumoProduct = activeStoreId === 2 && ((product?.category || product?.category_name || '').trim().toUpperCase() === 'LUMO');

    const sourceImages = isLumoProduct ? (product?.gallery_images || []) : (product?.images || []);
    if (product && Array.isArray(sourceImages) && sourceImages.length > 0) {
        tempProdImages = sourceImages.map(img => {
            if (typeof img === 'object' && img !== null) {
                return {
                    id: img.id || null,
                    url: img.image_url || img.external_url || img.url || '',
                    storage_path: img.storage_path || null,
                    is_primary: !!img.is_primary
                };
            }
            return { id: null, url: String(img || ''), is_primary: false };
        }).filter(item => Boolean(item.url));
    } else if (product && product.primary_image_url && !isLumoProduct) {
        tempProdImages = [{ id: null, url: product.primary_image_url, is_primary: true }];
    } else {
        tempProdImages = [];
    }
    renderProdImageGallery();

    // Initialize options & variants
    if (product && Array.isArray(product.options) && product.options.length > 0) {
        tempProdOptions = product.options.map(o => ({
            name: o.name || '',
            values: Array.isArray(o.values) ? o.values.map(v => typeof v === 'object' ? (v.value || v.name) : v) : []
        }));
    } else {
        tempProdOptions = [];
    }

    if (product && Array.isArray(product.variants) && product.variants.length > 0) {
        tempProdVariants = product.variants
            .filter(v => v.variant_slug !== 'default' || (tempProdOptions.length === 0))
            .map(v => ({
                id: v.id || v.variant_id || null,
                sku: v.sku || '',
                price: v.price !== undefined ? v.price : (activeStoreId === 1 ? Math.round(Number(document.getElementById('prod-price')?.value) || 0) : 0),
                stock: v.stock !== undefined ? v.stock : 100,
                active: v.active !== 0 && v.active !== false ? 1 : 0,
                option_combination: typeof v.option_combination === 'string' ? JSON.parse(v.option_combination || '{}') : (v.option_combination || {})
            }));
    } else {
        tempProdVariants = [];
    }
    renderProductOptionsBuilder();

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

function renderProdImageGallery() {
    const gallery = document.getElementById('prod-images-gallery');
    if (!gallery) return;

    const fallbackImg = 'https://img.icons8.com/color/150/000000/sticker.png';

    gallery.innerHTML = tempProdImages.map((imgItem, idx) => {
        const url = typeof imgItem === 'object' ? (imgItem.url || '') : String(imgItem || '');
        const isPrimary = idx === 0 || (typeof imgItem === 'object' && imgItem.is_primary);
        const imgId = (typeof imgItem === 'object' && imgItem.id) ? imgItem.id : '';
        const resolved = resolveAdminImageUrl(url);
        return `
        <div class="img-thumb-card">
            ${isPrimary ? '<span class="primary-tag">PRIMARY</span>' : ''}
            <img src="${resolved || fallbackImg}" onerror="this.onerror=null; this.src='${fallbackImg}';" alt="Product image">
            <div class="img-thumb-actions">
                ${!isPrimary ? `<button type="button" class="img-btn-sm set-primary-img-btn" data-idx="${idx}">PRIMARY</button>` : ''}
                <button type="button" class="img-btn-sm rem-img-btn" data-idx="${idx}" data-id="${imgId}" style="color:#ef4444;" title="Delete image">×</button>
            </div>
        </div>
        `;
    }).join('');

    gallery.querySelectorAll('.set-primary-img-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-idx'));
            const [moved] = tempProdImages.splice(idx, 1);
            if (typeof moved === 'object') moved.is_primary = true;
            tempProdImages.forEach((im, i) => {
                if (typeof im === 'object') im.is_primary = (i === 0);
            });
            tempProdImages.unshift(moved);
            renderProdImageGallery();
        });
    });

    gallery.querySelectorAll('.rem-img-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-idx'));
            const imgId = btn.getAttribute('data-id');

            const doLocalRemove = () => {
                tempProdImages.splice(idx, 1);
                if (tempProdImages.length > 0 && typeof tempProdImages[0] === 'object') {
                    tempProdImages[0].is_primary = true;
                }
                renderProdImageGallery();
            };

            if (imgId && editingProductId) {
                showConfirmModal("DELETE PRODUCT IMAGE", "Are you sure you want to permanently delete this product image?", async () => {
                    try {
                        await apiClient.deleteProductImage(editingProductId, imgId);
                        doLocalRemove();
                        showToast("Product image deleted successfully");
                        // Refresh cached product in products list if present
                        const p = products.find(prod => String(prod.id) === String(editingProductId));
                        if (p && Array.isArray(p.images)) {
                            p.images = p.images.filter(im => String(im.id) !== String(imgId));
                            p.primary_image_url = p.images.length > 0 ? (p.images[0].image_url || p.images[0].url) : null;
                            renderProductsTable();
                        }
                    } catch (err) {
                        showToast(`Failed to delete image: ${err.message}`, 'error');
                    }
                });
            } else {
                doLocalRemove();
            }
        });
    });
}

// =============================================================================
// PRODUCT OPTIONS & DYNAMIC VARIANTS BUILDER (STORE 1: CHIPAKK)
// =============================================================================

function renderProductOptionsBuilder() {
    const list = document.getElementById('prod-options-builder-list');
    const matrixSec = document.getElementById('prod-variant-matrix-section');
    if (!list) return;

    if (!tempProdOptions || tempProdOptions.length === 0) {
        list.innerHTML = '<div style="color: #666; font-size: 0.75rem; font-style: italic; padding: 4px 0;">No options configured. Single standard item. Click "+ ADD OPTION" to add options like Size, Finish, Material.</div>';
        if (matrixSec) matrixSec.style.display = 'none';
        return;
    }

    list.innerHTML = tempProdOptions.map((opt, optIdx) => `
        <div class="option-builder-card" style="border: 1px solid #000; background: #fff; padding: 8px; border-radius: 3px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <input type="text" class="retro-input opt-name-input" data-opt-idx="${optIdx}" value="${escapeAttr(opt.name || '')}" placeholder="Option Name (e.g. Size, Finish, Material)" style="font-size: 0.78rem; font-weight: bold; width: 65%; padding: 4px 6px;">
                <button type="button" class="retro-btn remove-opt-btn" data-opt-idx="${optIdx}" style="padding: 2px 6px; font-size: 0.7rem; color: #ef4444; border-color: #ef4444;">✕ REMOVE</button>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 6px;">
                ${(opt.values || []).map((val, valIdx) => `
                    <span style="display: inline-flex; align-items: center; gap: 4px; background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; border-radius: 3px; font-size: 0.72rem; padding: 2px 6px; font-weight: bold;">
                        ${escapeHtml(val)}
                        <span class="remove-val-btn" data-opt-idx="${optIdx}" data-val-idx="${valIdx}" style="cursor: pointer; color: #0369a1; font-weight: 900; margin-left: 2px;" title="Remove value">×</span>
                    </span>
                `).join('')}
            </div>
            <div style="display: flex; gap: 6px;">
                <input type="text" class="retro-input new-val-input" data-opt-idx="${optIdx}" placeholder="Add value (e.g. 2&quot;, Glossy, Pack of 3)" style="font-size: 0.72rem; padding: 3px 6px; flex: 1;">
                <button type="button" class="retro-btn add-val-btn" data-opt-idx="${optIdx}" style="padding: 3px 8px; font-size: 0.7rem; background: #f1f5f9;">+ ADD</button>
            </div>
        </div>
    `).join('');

    const hasValues = tempProdOptions.some(o => o.values && o.values.length > 0);
    if (matrixSec) {
        matrixSec.style.display = hasValues ? 'block' : 'none';
    }

    renderProductVariantsMatrix();
}

function generateVariantsFromOptions() {
    const validOpts = tempProdOptions.filter(o => o.name && o.name.trim() && Array.isArray(o.values) && o.values.length > 0);
    if (validOpts.length === 0) {
        tempProdVariants = [];
        renderProductVariantsMatrix();
        return;
    }

    // Cartesian product
    const combinations = validOpts.reduce((acc, opt) => {
        const res = [];
        acc.forEach(prev => {
            opt.values.forEach(val => {
                res.push({ ...prev, [opt.name.trim()]: String(val).trim() });
            });
        });
        return res;
    }, [{}]);

    const adminId = document.getElementById('prod-admin-id')?.value.trim() || 'CK';
    const basePrice = Number(document.getElementById('prod-price')?.value) || 0;

    syncVariantsFromUI();

    const newVariants = combinations.map((comb, idx) => {
        // Try to match existing variant with identical combination
        const matched = tempProdVariants.find(v => {
            const vc = v.option_combination || {};
            const combKeys = Object.keys(comb);
            const vcKeys = Object.keys(vc);
            if (combKeys.length !== vcKeys.length) return false;
            return combKeys.every(k => String(comb[k]).toLowerCase() === String(vc[k] || '').toLowerCase());
        });

        if (matched) {
            return {
                ...matched,
                option_combination: comb
            };
        }

        const skuSuffix = Object.values(comb).map(v => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)).join('-');
        return {
            id: null,
            sku: `${adminId}-${skuSuffix || idx + 1}`,
            price: basePrice,
            stock: 100,
            active: 1,
            option_combination: comb
        };
    });

    tempProdVariants = newVariants;
    renderProductVariantsMatrix();
}

function syncVariantsFromUI() {
    const list = document.getElementById('prod-variants-list');
    if (!list) return;
    const cards = list.querySelectorAll('.variant-matrix-card');
    cards.forEach(card => {
        const idx = Number(card.dataset.varIdx);
        if (tempProdVariants[idx]) {
            const skuInput = card.querySelector('.var-sku-input');
            const priceInput = card.querySelector('.var-price-input');
            const stockInput = card.querySelector('.var-stock-input');
            const activeInput = card.querySelector('.var-active-input');

            if (skuInput) tempProdVariants[idx].sku = skuInput.value.trim();
            if (priceInput) tempProdVariants[idx].price = Number(priceInput.value) || 0;
            if (stockInput) tempProdVariants[idx].stock = Number(stockInput.value) || 0;
            if (activeInput) tempProdVariants[idx].active = activeInput.checked ? 1 : 0;
        }
    });
}

function renderProductVariantsMatrix() {
    const list = document.getElementById('prod-variants-list');
    if (!list) return;

    if (!tempProdVariants || tempProdVariants.length === 0) {
        list.innerHTML = '<div style="color: #666; font-size: 0.75rem; font-style: italic; padding: 4px;">Click "⚡ GENERATE COMBINATIONS" above to create variant combinations.</div>';
        return;
    }

    list.innerHTML = tempProdVariants.map((v, idx) => {
        const combTags = Object.entries(v.option_combination || {}).map(([k, val]) => `
            <span style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 1px 5px; border-radius: 3px; font-size: 0.68rem; font-weight: bold;">${escapeHtml(k)}: ${escapeHtml(val)}</span>
        `).join(' ');

        return `
            <div class="variant-matrix-card" data-var-idx="${idx}" style="border: 1px solid #ccc; background: #fafafa; padding: 6px; display: grid; grid-template-columns: 2fr 1.2fr 1fr 1fr auto; gap: 8px; align-items: center; font-size: 0.75rem;">
                <div>
                    <div style="display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 3px;">${combTags}</div>
                    <input type="text" class="retro-input var-sku-input" value="${escapeAttr(v.sku || '')}" placeholder="SKU" style="font-size: 0.7rem; padding: 2px 4px;">
                </div>
                <div>
                    <label style="font-size: 0.65rem; color: #666; display: block;">Price (₹)</label>
                    <input type="number" class="retro-input var-price-input" value="${v.price !== undefined ? v.price : ''}" placeholder="₹" min="0" style="font-size: 0.72rem; padding: 2px 4px;">
                </div>
                <div>
                    <label style="font-size: 0.65rem; color: #666; display: block;">Stock</label>
                    <input type="number" class="retro-input var-stock-input" value="${v.stock !== undefined ? v.stock : 100}" placeholder="Qty" min="0" style="font-size: 0.72rem; padding: 2px 4px;">
                </div>
                <div style="text-align: center;">
                    <label style="font-size: 0.65rem; color: #666; display: block;">Active</label>
                    <input type="checkbox" class="var-active-input" ${v.active !== 0 ? 'checked' : ''} style="cursor: pointer;">
                </div>
                <div>
                    <button type="button" class="remove-var-btn" data-var-idx="${idx}" style="background: none; border: none; color: #ef4444; font-size: 0.9rem; cursor: pointer; font-weight: bold;" title="Remove this variant">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

async function editProduct(productId) {
    try {
        const res = await apiClient.get(`/admin/products/${productId}`);
        const raw = res?.data || res;
        if (raw && (raw.id || raw.admin_product_id)) {
            const freshProduct = normalizeProduct(raw);
            openProductForm(freshProduct);
            return;
        }
    } catch (err) {
        console.warn('Could not load fresh product details, using cached list:', err.message);
    }
    const p = products.find(prod => String(prod.id) === String(productId));
    if (p) openProductForm(p);
}

function confirmDeleteProduct(productId) {
    const p = products.find(prod => String(prod.id) === String(productId));
    if (!p) return;

    showConfirmModal("DELETE PRODUCT DROP", `Are you sure you want to delete product '${p.admin_id} — ${p.title}'?`, async () => {
        try {
            await apiClient.delete(`/admin/products/${productId}`);
            showToast(`Product ${p.admin_id} deactivated.`);
            await refreshProductsFromAPI();
        } catch (err) {
            showToast(`Error deleting product: ${err.message}`, 'error');
        }
    });
}

async function reactivateProduct(productId) {
    const p = products.find(prod => String(prod.id) === String(productId));
    try {
        await apiClient.post(`/admin/products/${productId}/reactivate`);
        showToast(`Product ${p ? p.admin_id : productId} reactivated.`);
        await refreshProductsFromAPI();
    } catch (err) {
        showToast(`Error reactivating product: ${err.message}`, 'error');
    }
}

async function saveProductForm() {
    const adminId = document.getElementById('prod-admin-id').value.trim();
    const title = document.getElementById('prod-title').value.trim();
    const price = Number(document.getElementById('prod-price').value);
    const category = document.getElementById('prod-category').value;

    if (!adminId || !title || isNaN(price) || !category) {
        showToast("Please complete mandatory fields (Admin ID, Product Name, Price, Category)!", "error");
        return;
    }

    const cleanImagePayload = tempProdImages.map(item => {
        if (typeof item === 'object' && item !== null) {
            return item.url;
        }
        return String(item || '');
    }).filter(Boolean);

    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    // For Store 1 (CHIPAKK), whole rupees: ₹15 = DB 15. Store 2 (THE MARSHANS) uses paise.
    const priceVal = activeStoreId === 1 ? Math.round(price) : Math.round(price * 100);
    const isLumo = activeStoreId === 2 && (category || '').trim().toUpperCase() === 'LUMO';

    if (isLumo) {
        const lumoDarkImg = document.getElementById('prod-lumo-dark-image')?.value.trim();
        const lumoLightImg = document.getElementById('prod-lumo-light-image')?.value.trim();

        if (!lumoDarkImg) {
            showToast("LUMO Dark Mode Product Image is required for LUMO products!", "error");
            return;
        }
        if (!lumoLightImg) {
            showToast("LUMO Light Mode Product Image is required for LUMO products!", "error");
            return;
        }
    } else {
        if (cleanImagePayload.length === 0 && !editingProductId) {
            showToast("Please provide at least one product image.", "error");
            return;
        }
    }

    const saveBtn = document.getElementById('save-prod-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const compareAtVal = document.getElementById('prod-compare-at-price')?.value;
    const compareAtPriceNum = (compareAtVal !== undefined && compareAtVal !== null && compareAtVal.trim() !== '') ? Number(compareAtVal) : null;
    const compareAtPriceVal = compareAtPriceNum !== null && !isNaN(compareAtPriceNum)
        ? (activeStoreId === 1 ? Math.round(compareAtPriceNum) : Math.round(compareAtPriceNum * 100))
        : null;

    const skuVal = document.getElementById('prod-sku')?.value.trim() || '';
    const descVal = document.getElementById('prod-desc')?.value.trim() || '';
    const isBestSeller = Boolean(
        document.getElementById('prod-is-best-seller')?.checked ||
        document.getElementById('prod-best-seller')?.checked
    );

    const payload = {
        name: title,
        admin_product_id: adminId,
        sku: skuVal,
        description: descVal,
        price: priceVal,
        compare_at_price: compareAtPriceVal,
        category_name: category,
        tags: document.getElementById('prod-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        images: cleanImagePayload,
        scheduled_drop_time: document.getElementById('prod-release-date').value || null,
        active: document.getElementById('prod-active').value === 'true' ? 1 : 0,
        is_best_seller: isBestSeller,
        // empty string = clear (inherit from the category / store default); the API validates 4/6/8 digits and 0-100
        hsn_code: document.getElementById('prod-hsn-code')?.value.trim() ?? '',
        gst_rate: document.getElementById('prod-gst-rate')?.value.trim() ?? ''
    };

    if (activeStoreId === 2) {
        payload.short_description = document.getElementById('prod-short-desc')?.value.trim() || null;
        payload.weight_grams = Number(document.getElementById('prod-weight-grams')?.value) || 0;
        payload.dimensions_mm = document.getElementById('prod-dimensions-mm')?.value.trim() || null;
        payload.production_notes = document.getElementById('prod-production-notes')?.value.trim() || null;

        const lumoLightImg = document.getElementById('prod-lumo-light-image')?.value.trim() || null;
        const lumoDarkImg = document.getElementById('prod-lumo-dark-image')?.value.trim() || null;
        const lumoLight360 = document.getElementById('prod-lumo-light-360')?.value.trim() || null;
        const lumoDark360 = document.getElementById('prod-lumo-dark-360')?.value.trim() || null;

        if (isLumo) {
            payload.lumo_light_image = lumoLightImg;
            payload.lumo_dark_image = lumoDarkImg;
            payload.lumo_light_360_url = lumoLight360;
            payload.lumo_dark_360_url = lumoDark360;
            payload.view_360_url = lumoLight360 || lumoDark360 || null;
        } else {
            payload.view_360_url = document.getElementById('prod-360-url')?.value.trim() || null;
            payload.lumo_light_image = null;
            payload.lumo_dark_image = null;
            payload.lumo_light_360_url = null;
            payload.lumo_dark_360_url = null;
        }

        const selMatIds = [];
        document.querySelectorAll('#prod-materials-checkboxes input[type="checkbox"]:checked').forEach(cb => {
            selMatIds.push(Number(cb.value));
        });
        payload.material_ids = selMatIds;

        const selFinishIds = [];
        document.querySelectorAll('#prod-finishing-checkboxes input[type="checkbox"]:checked').forEach(cb => {
            selFinishIds.push(Number(cb.value));
        });
        payload.finishing_option_ids = selFinishIds;
    } else {
        // Store 1 (CHIPAKK): serialize options and variants
        syncVariantsFromUI();
        const validOptions = tempProdOptions
            .filter(o => o && o.name && o.name.trim() && Array.isArray(o.values) && o.values.length > 0)
            .map(o => ({
                name: o.name.trim(),
                values: o.values.map(v => String(v).trim()).filter(Boolean)
            }));

        if (validOptions.length > 0) {
            payload.options = validOptions;
            payload.variants = (tempProdVariants || []).map(v => ({
                id: v.id || undefined,
                sku: (v.sku || '').trim(),
                price: parseInt(v.price, 10) || priceVal,
                stock: parseInt(v.stock, 10) || 0,
                active: v.active !== 0 ? 1 : 0,
                option_combination: v.option_combination || {}
            }));
        } else {
            payload.options = [];
            payload.variants = [];
        }
    }

    try {
        if (editingProductId) {
            await apiClient.put(`/admin/products/${editingProductId}`, payload);
            showToast(`Product '${adminId}' updated.`);
        } else {
            await apiClient.post('/admin/products', payload);
            showToast(`Product '${adminId}' created.`);
        }
        document.getElementById('product-form-container').style.display = 'none';
        await refreshProductsFromAPI();
    } catch (err) {
        showToast(`Error saving product: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || (activeStoreId === 2 ? "SAVE 3D PRODUCT" : "SAVE PRODUCT DROP"); }
    }
}

// =============================================================================
// 3. CATEGORIES MANAGEMENT
// =============================================================================

function renderCategoriesTable() {
    const tbody = document.getElementById('categories-tbody');
    if (!tbody) return;

    const visibleCategories = categories.filter(c => c && (c.name || '').toLowerCase().trim() !== 'best seller' && (c.slug || '').toLowerCase().trim() !== 'best-seller');

    tbody.innerHTML = visibleCategories.map(c => {
        const fallbackImg = 'https://img.icons8.com/color/150/000000/sticker.png';
        const resolvedCatImg = resolveAdminImageUrl(c.image_url);
        const imgThumb = resolvedCatImg
            ? `<img src="${resolvedCatImg}" onerror="this.onerror=null; this.src='${fallbackImg}';" alt="${escapeHtml(c.name)}" style="width:28px; height:28px; object-fit:cover; border:1px solid #000; border-radius:3px; vertical-align:middle; margin-right:6px; display:inline-block;">`
            : `<img src="${fallbackImg}" alt="" style="width:28px; height:28px; object-fit:cover; border:1px solid #ccc; border-radius:3px; vertical-align:middle; margin-right:6px; opacity:0.6; display:inline-block;">`;

        const expCode = (c.experience?.experience_code || 'normal').toLowerCase();
        let expBadge = `<span class="status-badge" style="background:#f1f5f9; color:#475569;">NORMAL</span>`;
        if (expCode === 'glow') {
            expBadge = `<span class="status-badge" style="background:#020617; color:#00ffcc; border:1px solid #00ffcc; font-weight:bold;">✨ GLOW</span>`;
        } else if (expCode === 'luxury') {
            expBadge = `<span class="status-badge" style="background:#1e1b4b; color:#fbbf24; border:1px solid #fbbf24; font-weight:bold;">👑 LUXURY</span>`;
        } else if (expCode === 'seasonal') {
            expBadge = `<span class="status-badge" style="background:#831843; color:#f472b6; border:1px solid #f472b6; font-weight:bold;">🎄 SEASONAL</span>`;
        }

        return `
            <tr>
                <td><span class="status-badge status-live">${c.display_order || c.id}</span></td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${imgThumb}
                        <div>
                            <strong>${c.name}</strong>
                            ${c.description ? `<br><small style="color:#666;">${c.description}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td><code style="background:#eee; padding:2px 6px;">${c.slug}</code></td>
                <td>${expBadge}</td>
                <td><strong style="color:#059669;">${c.product_count}</strong> <small style="color:#666;">products</small></td>
                <td><span class="status-badge ${c.active ? 'status-live' : 'status-inactive'}">${c.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="retro-btn edit-cat-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                        <button class="retro-btn del-cat-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="7">No categories found.</td></tr>';

    tbody.querySelectorAll('.edit-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = categories.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (cat) openCategoryForm(cat);
        });
    });

    tbody.querySelectorAll('.del-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCategory(btn.getAttribute('data-id')));
    });
}

function updateCategoryMediaLabels(isLumo) {
    const lightLabel = document.getElementById('cat-hero-light-label');
    const darkLabel = document.getElementById('cat-hero-dark-label');
    const lightDesc = document.getElementById('cat-hero-light-desc');
    const darkDesc = document.getElementById('cat-hero-dark-desc');
    const badge = document.getElementById('lumo-media-badge');

    if (isLumo) {
        if (lightLabel) lightLabel.innerHTML = 'LUMO LIGHT MODE IMAGE <span style="color: #e53e3e; font-weight: 900;">* REQUIRED</span>';
        if (darkLabel) darkLabel.innerHTML = 'LUMO DARK MODE IMAGE <span style="color: #e53e3e; font-weight: 900;">* REQUIRED</span>';
        if (lightDesc) lightDesc.textContent = 'Light Mode = daytime/light-theme visual';
        if (darkDesc) darkDesc.textContent = 'Dark Mode = nighttime/dark-theme glowing visual';
        if (badge) badge.style.display = 'inline-block';
    } else {
        if (lightLabel) lightLabel.textContent = 'Hero Light Image (Optional)';
        if (darkLabel) darkLabel.textContent = 'Hero Dark Image (Optional)';
        if (lightDesc) lightDesc.textContent = 'Daytime / light-theme visual';
        if (darkDesc) darkDesc.textContent = 'Nighttime / dark-theme visual';
        if (badge) badge.style.display = 'none';
    }
}

function checkCategoryLumoMode() {
    const nameVal = (document.getElementById('cat-name')?.value || '').toLowerCase().trim();
    const slugVal = (document.getElementById('cat-slug')?.value || '').toLowerCase().trim();
    const expVal = (document.getElementById('cat-experience-type')?.value || '').toLowerCase().trim();
    const isLumo = nameVal === 'lumo' || slugVal === 'lumo' || expVal === 'glow';
    updateCategoryMediaLabels(isLumo);
}

function openCategoryForm(category = null) {
    const container = document.getElementById('category-form-container');
    if (!container) return;

    editingCategoryId = category ? category.id : null;
    document.getElementById('cat-form-title').textContent = category ? `[EDIT CATEGORY: ${category.name}]` : '[ADD NEW CATEGORY]';
    document.getElementById('cat-name').value = category ? category.name : '';
    document.getElementById('cat-slug').value = category ? category.slug : '';
    document.getElementById('cat-desc').value = category ? (category.description || '') : '';
    if (document.getElementById('cat-hsn-code')) document.getElementById('cat-hsn-code').value = category ? (category.hsn_code || '') : '';
    if (document.getElementById('cat-gst-rate')) document.getElementById('cat-gst-rate').value = category && category.gst_rate !== null && category.gst_rate !== undefined ? category.gst_rate : '';

    const catImageInput = document.getElementById('cat-image');
    if (catImageInput) catImageInput.value = category?.image_url || '';

    const prevBox = document.getElementById('cat-image-preview-box');
    const prevImg = document.getElementById('cat-image-preview-img');
    const fallbackImg = 'https://img.icons8.com/color/150/000000/sticker.png';
    if (category?.image_url && prevBox && prevImg) {
        const resolved = resolveAdminImageUrl(category.image_url);
        prevImg.onerror = () => { prevImg.onerror = null; prevImg.src = fallbackImg; };
        prevImg.src = resolved || fallbackImg;
        prevBox.style.display = 'block';
    } else if (prevBox) {
        prevBox.style.display = 'none';
        if (prevImg) prevImg.src = '';
    }

    // Category Experience Selection
    const expCode = (category?.experience?.experience_code || 'normal').toLowerCase();
    const expSelect = document.getElementById('cat-experience-type');
    if (expSelect) expSelect.value = expCode;

    // Toggle Glow Settings container
    const glowBox = document.getElementById('cat-glow-settings-container');
    if (glowBox) glowBox.style.display = expCode === 'glow' ? 'block' : 'none';

    // Populate Glow Settings
    const glowSettings = category?.experience?.settings || {};
    const glowColor = glowSettings.glow_color || '#00ffcc';
    if (document.getElementById('cat-glow-color')) document.getElementById('cat-glow-color').value = glowColor;
    if (document.getElementById('cat-glow-color-picker')) document.getElementById('cat-glow-color-picker').value = glowColor;
    if (document.getElementById('cat-glow-animation')) document.getElementById('cat-glow-animation').value = glowSettings.animation || 'pulse';
    if (document.getElementById('cat-glow-intensity')) document.getElementById('cat-glow-intensity').value = glowSettings.intensity !== undefined ? glowSettings.intensity : 0.8;
    if (document.getElementById('cat-dark-mode')) document.getElementById('cat-dark-mode').checked = glowSettings.dark_mode_enabled !== false;

    // Populate Category Media (Hero Light / Hero Dark)
    const heroLight = category?.media?.hero_light || '';
    const heroDark = category?.media?.hero_dark || '';
    if (document.getElementById('cat-hero-light')) document.getElementById('cat-hero-light').value = heroLight;
    if (document.getElementById('cat-hero-dark')) document.getElementById('cat-hero-dark').value = heroDark;

    const lightPrevBox = document.getElementById('hero-light-prev-box');
    const lightPrevImg = document.getElementById('hero-light-prev-img');
    if (heroLight && lightPrevBox && lightPrevImg) {
        const resLight = resolveAdminImageUrl(heroLight);
        lightPrevImg.onerror = () => { lightPrevImg.onerror = null; lightPrevImg.src = fallbackImg; };
        lightPrevImg.src = resLight || fallbackImg;
        lightPrevBox.style.display = 'block';
    } else if (lightPrevBox) {
        lightPrevBox.style.display = 'none';
        if (lightPrevImg) lightPrevImg.src = '';
    }

    const darkPrevBox = document.getElementById('hero-dark-prev-box');
    const darkPrevImg = document.getElementById('hero-dark-prev-img');
    if (heroDark && darkPrevBox && darkPrevImg) {
        const resDark = resolveAdminImageUrl(heroDark);
        darkPrevImg.onerror = () => { darkPrevImg.onerror = null; darkPrevImg.src = fallbackImg; };
        darkPrevImg.src = resDark || fallbackImg;
        darkPrevBox.style.display = 'block';
    } else if (darkPrevBox) {
        darkPrevBox.style.display = 'none';
        if (darkPrevImg) darkPrevImg.src = '';
    }

    // Explicitly update labels and required status for LUMO vs other categories
    const isLumo = (category?.name || '').toLowerCase() === 'lumo' || (category?.slug || '').toLowerCase() === 'lumo' || expCode === 'glow';
    updateCategoryMediaLabels(isLumo);

    container.style.display = 'block';
}

async function saveCategoryForm() {
    const name = document.getElementById('cat-name').value.trim();
    const slug = document.getElementById('cat-slug').value.trim() || name.toLowerCase().replace(/\s+/g, '-');
    const desc = document.getElementById('cat-desc').value.trim();
    const imageUrl = document.getElementById('cat-image')?.value.trim() || null;

    if (!name) {
        showToast("Category name is required!", "error");
        return;
    }

    let finalImageUrl = imageUrl;
    if (editingCategoryId && !finalImageUrl) {
        const existingCat = categories.find(c => String(c.id) === String(editingCategoryId));
        if (existingCat && existingCat.image_url) {
            finalImageUrl = existingCat.image_url;
        }
    }

    const experienceCode = document.getElementById('cat-experience-type')?.value || 'normal';
    let experienceSettings = null;
    if (experienceCode === 'glow') {
        experienceSettings = {
            glow_color: document.getElementById('cat-glow-color')?.value.trim() || '#00ffcc',
            animation: document.getElementById('cat-glow-animation')?.value || 'pulse',
            intensity: parseFloat(document.getElementById('cat-glow-intensity')?.value) || 0.8,
            dark_mode_enabled: document.getElementById('cat-dark-mode')?.checked ?? true
        };
    }

    const heroLight = document.getElementById('cat-hero-light')?.value.trim() || null;
    const heroDark = document.getElementById('cat-hero-dark')?.value.trim() || null;

    const isLumo = name.toLowerCase() === 'lumo' || slug.toLowerCase() === 'lumo' || experienceCode === 'glow';
    if (isLumo && (!heroLight || !heroDark)) {
        showToast("LUMO category requires both Light Mode (Daytime) and Dark Mode (Night) images!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-cat-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const payload = {
        name,
        slug,
        description: desc,
        image_url: finalImageUrl,
        active: 1,
        experience_code: experienceCode,
        experience_settings: experienceSettings,
        hsn_code: document.getElementById('cat-hsn-code')?.value.trim() ?? '',
        gst_rate: document.getElementById('cat-gst-rate')?.value.trim() ?? '',
        hero_light: heroLight,
        hero_dark: heroDark,
        media: {
            hero_light: heroLight,
            hero_dark: heroDark
        }
    };

    try {
        if (editingCategoryId) {
            await apiClient.put(`/admin/categories/${editingCategoryId}`, payload);
            showToast(`Category '${name}' updated.`);
        } else {
            await apiClient.post('/admin/categories', payload);
            showToast(`Category '${name}' created.`);
        }
        document.getElementById('category-form-container').style.display = 'none';
        await refreshCategoriesFromAPI();
        await refreshAuditLogsFromAPI();
    } catch (err) {
        showToast(`Error saving category: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || "SAVE CATEGORY"; }
    }
}

async function deleteCategory(categoryId) {
    const cat = categories.find(c => String(c.id) === String(categoryId));
    if (!cat) return;

    showConfirmModal("DELETE CATEGORY", `Delete category '${cat.name}'?`, async () => {
        try {
            await apiClient.delete(`/admin/categories/${categoryId}`);
            showToast(`Category '${cat.name}' deleted.`);
            await refreshCategoriesFromAPI();
        } catch (err) {
            const isConflict = err.status === 409 || err.statusCode === 409 || (err.message && (err.message.includes('active product') || err.message.includes('reassign')));
            if (isConflict) {
                const otherCats = categories.filter(c => String(c.id) !== String(categoryId));
                if (otherCats.length === 0) {
                    showToast(`Cannot delete category: ${err.message}`, 'error');
                    return;
                }
                const catList = otherCats.map(c => `[ID ${c.id}] ${c.name}`).join('\n');
                const targetId = prompt(
                    `Category '${cat.name}' contains active products.\n\nTo proceed, enter the ID of a category to reassign them to:\n\n${catList}`
                );
                if (targetId && targetId.trim()) {
                    try {
                        await apiClient.delete(`/admin/categories/${categoryId}?reassign_to_category_id=${encodeURIComponent(targetId.trim())}`);
                        showToast(`Products reassigned and category '${cat.name}' deleted.`);
                        await refreshCategoriesFromAPI();
                        await refreshProductsFromAPI();
                    } catch (reassignErr) {
                        showToast(`Error during reassignment: ${reassignErr.message}`, 'error');
                    }
                }
            } else {
                showToast(`Error deleting category: ${err.message}`, 'error');
            }
        }
    });
}

// =============================================================================
// 4. PRINT-ON-DEMAND PRODUCTION QUEUE
// =============================================================================

function renderProductionQueueTabs() {
    const container = document.getElementById('production-status-tabs');
    if (!container) return;

    const tabs = ["All", ...PRODUCTION_STAGES];
    container.innerHTML = tabs.map(tab => {
        let count = 0;
        if (tab === "All") {
            count = productionQueueItems.length;
        } else {
            count = productionQueueItems.filter(i => {
                const uiStatus = BACKEND_TO_UI_PROD_STATUS[i.production_status] || i.production_status;
                return uiStatus === tab;
            }).length;
        }

        const isSelected = activeProductionTab === tab;
        return `
            <button class="retro-btn order-tab-btn ${isSelected ? 'active' : ''} prod-queue-tab-btn" data-tab="${tab}">
                ${tab.toUpperCase()} (${count})
            </button>
        `;
    }).join('');

    container.querySelectorAll('.prod-queue-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeProductionTab = btn.getAttribute('data-tab');
            renderProductionQueueTabs();
            renderProductionQueueTable();
        });
    });
}

function derivePrintAndCutBadges(stage) {
    let printBadge = '<span class="status-badge status-upcoming">PENDING</span>';
    let cutBadge = '<span class="status-badge status-inactive">WAITING</span>';

    if (stage === 'Printing') {
        printBadge = '<span class="status-badge" style="background:#2563eb; color:#fff;">PRINTING</span>';
        cutBadge = '<span class="status-badge status-inactive">WAITING</span>';
    } else if (stage === 'Printed') {
        printBadge = '<span class="status-badge status-live">PRINTED</span>';
        cutBadge = '<span class="status-badge status-upcoming">READY</span>';
    } else if (stage === 'Cutting') {
        printBadge = '<span class="status-badge status-live">PRINTED</span>';
        cutBadge = '<span class="status-badge" style="background:#7c3aed; color:#fff;">CUTTING</span>';
    } else if (['Cut', 'Ready to Pack', 'Packed'].includes(stage)) {
        printBadge = '<span class="status-badge status-live">PRINTED</span>';
        cutBadge = '<span class="status-badge status-live">CUT</span>';
    }
    return { printBadge, cutBadge };
}

function renderProductionQueueTable() {
    const tbody = document.getElementById('production-tbody');
    if (!tbody) return;

    const searchQuery = (document.getElementById('prod-queue-search')?.value || '').toLowerCase().trim();

    const filtered = productionQueueItems.filter(row => {
        const stage = BACKEND_TO_UI_PROD_STATUS[row.production_status] || row.production_status || 'Ready to Print';
        const matchesTab = activeProductionTab === "All" || stage === activeProductionTab;
        const matchesSearch = !searchQuery ||
            (row.admin_id || '').toLowerCase().includes(searchQuery) ||
            (row.admin_product_id_snapshot || '').toLowerCase().includes(searchQuery) ||
            (row.order_id || '').toLowerCase().includes(searchQuery) ||
            (row.order_number || '').toLowerCase().includes(searchQuery) ||
            (row.product_name || '').toLowerCase().includes(searchQuery) ||
            (row.customer_name || '').toLowerCase().includes(searchQuery);
        return matchesTab && matchesSearch;
    });

    tbody.innerHTML = filtered.map(row => {
        const itemKey = row.order_item_id || row.id;
        const stage = BACKEND_TO_UI_PROD_STATUS[row.production_status] || row.production_status || 'Ready to Print';
        const isChecked = selectedProductionItemIds.includes(String(itemKey));
        const { printBadge, cutBadge } = derivePrintAndCutBadges(stage);

        let variantText = '';
        if (row.variant_options) {
            if (typeof row.variant_options === 'object') {
                variantText = Object.entries(row.variant_options).map(([k, v]) => `${k}: ${v}`).join(', ');
            } else {
                variantText = String(row.variant_options);
            }
        }

        return `
            <tr>
                <td><input type="checkbox" class="prod-queue-item-chk" data-id="${itemKey}" ${isChecked ? 'checked' : ''}></td>
                <td><strong class="admin-id-highlight">${row.order_number || row.order_id}</strong></td>
                <td><strong>${row.customer_name || 'Customer'}</strong>${row.customer_phone ? `<br><small style="color:#666;">${row.customer_phone}</small>` : ''}</td>
                <td><span class="admin-id-highlight">${row.admin_product_id_snapshot || row.admin_id || row.sku || 'CK-001'}</span></td>
                <td><strong>${row.product_name}</strong>${variantText ? `<br><small style="color:#666;">${variantText}</small>` : ''}</td>
                <td><strong>x${row.quantity}</strong></td>
                <td>${printBadge}</td>
                <td>${cutBadge}</td>
                <td>
                    <select class="retro-input prod-stage-select" data-id="${itemKey}" style="padding:2px 4px; font-size:0.75rem;">
                        ${PRODUCTION_STAGES.map(st => `<option value="${st}" ${st === stage ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                </td>
                <td><span class="status-badge status-live">${row.fulfillment_status || 'CONFIRMED'}</span></td>
                <td><small>${row.created_at ? new Date(row.created_at).toLocaleDateString() : '-'}</small></td>
                <td>
                    <button class="retro-btn adv-prod-stage-btn" data-id="${itemKey}" style="padding:2px 6px; font-size:0.75rem; background:#2563eb; color:#fff;">ADVANCE →</button>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="12">No POD production items found.</td></tr>';

    tbody.querySelectorAll('.prod-queue-item-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            const id = chk.getAttribute('data-id');
            if (chk.checked) {
                if (!selectedProductionItemIds.includes(id)) selectedProductionItemIds.push(id);
            } else {
                selectedProductionItemIds = selectedProductionItemIds.filter(item => item !== id);
            }
        });
    });

    tbody.querySelectorAll('.prod-stage-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const itemId = sel.getAttribute('data-id');
            const newUIStage = e.target.value;
            const machineStatus = UI_TO_BACKEND_PROD_STATUS[newUIStage] || newUIStage.toUpperCase();
            try {
                await apiClient.put(`/admin/production/queue/items/${itemId}/status`, { status: machineStatus });
                showToast(`Production stage updated to ${newUIStage}`);
                await refreshProductionQueueFromAPI();
            } catch (err) {
                showToast(`Error updating stage: ${err.message}`, 'error');
            }
        });
    });

    tbody.querySelectorAll('.adv-prod-stage-btn').forEach(btn => {
        btn.addEventListener('click', () => advanceProductionItemStage(btn.getAttribute('data-id')));
    });
}

async function advanceProductionItemStage(itemId) {
    let targetItem = null;
    productionQueueItems.forEach(i => {
        if (String(i.order_item_id) === String(itemId) || String(i.id) === String(itemId)) {
            targetItem = i;
        }
    });

    if (!targetItem) return;

    const currentStage = BACKEND_TO_UI_PROD_STATUS[targetItem.production_status] || targetItem.production_status || 'Ready to Print';
    const currentIdx = PRODUCTION_STAGES.indexOf(currentStage);
    const nextIdx = Math.min(PRODUCTION_STAGES.length - 1, currentIdx < 1 ? 1 + 1 : currentIdx + 1);
    const nextStageUI = PRODUCTION_STAGES[nextIdx];
    const machineStatus = UI_TO_BACKEND_PROD_STATUS[nextStageUI] || nextStageUI.toUpperCase();

    try {
        await apiClient.put(`/admin/production/queue/items/${targetItem.order_item_id || itemId}/status`, { status: machineStatus });
        showToast(`Production updated to ${nextStageUI}.`);
        await Promise.all([refreshProductionQueueFromAPI(), refreshOrdersFromAPI()]);
    } catch (err) {
        showToast(`Error updating production status: ${err.message}`, 'error');
    }
}

async function applyBatchProductionStatus(newUIStatus) {
    if (selectedProductionItemIds.length === 0) {
        showToast("Select at least one production item first!", "error");
        return;
    }

    const machineStatus = UI_TO_BACKEND_PROD_STATUS[newUIStatus] || newUIStatus.toUpperCase();
    let updatedCount = 0;

    for (const itemId of selectedProductionItemIds) {
        try {
            await apiClient.put(`/admin/production/queue/items/${itemId}/status`, { status: machineStatus });
            updatedCount++;
        } catch (err) {
            console.error(`[Batch Production Error] Item ${itemId}:`, err.message);
        }
    }

    selectedProductionItemIds = [];
    showToast(`Updated ${updatedCount} production items to ${newUIStatus}.`);
    await Promise.all([refreshProductionQueueFromAPI(), refreshOrdersFromAPI()]);
}

// =============================================================================
// 5. ORDERS & FULFILLMENT MANAGEMENT
// =============================================================================

function renderOrderStatusTabs() {
    const container = document.getElementById('order-status-tabs');
    if (!container) return;

    const tabs = ["All", ...CANONICAL_ORDER_STATUSES];
    container.innerHTML = tabs.map(tab => {
        let count = 0;
        if (tab === "All") {
            count = orders.length;
        } else {
            count = orders.filter(o => o.status === tab).length;
        }

        return `
            <button class="retro-btn order-tab-btn ${activeOrderTab === tab ? 'active' : ''}" data-tab="${tab}" style="padding:4px 10px; font-size:0.75rem;">
                ${tab.toUpperCase()} (${count})
            </button>
        `;
    }).join('');

    container.querySelectorAll('.order-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeOrderTab = btn.getAttribute('data-tab');
            renderOrderStatusTabs();
            renderOrdersTable();
        });
    });
}

function renderOrdersTable() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;

    const searchQuery = (document.getElementById('order-search-input')?.value || '').toLowerCase().trim();

    const filtered = orders.filter(o => {
        const matchesTab = activeOrderTab === "All" || o.status === activeOrderTab;
        const matchesSearch = !searchQuery ||
            o.order_id.toLowerCase().includes(searchQuery) ||
            o.customer_name.toLowerCase().includes(searchQuery) ||
            (o.email || '').toLowerCase().includes(searchQuery) ||
            (o.phone || '').toLowerCase().includes(searchQuery);
        return matchesTab && matchesSearch;
    });

    tbody.innerHTML = filtered.map(o => `
        <tr>
            <td><strong class="admin-id-highlight">${o.order_id}</strong></td>
            <td><a href="#" class="view-cust-link" data-id="${o.order_id}" style="color:#000; font-weight:bold; text-decoration:underline;">${o.customer_name}</a></td>
            <td><strong>₹${o.total_price}</strong></td>
            <td><span class="status-badge ${o.payment_status === 'Paid' ? 'status-live' : 'status-upcoming'}">${o.payment_status}</span></td>
            <td><span class="status-badge status-upcoming">${o.status}</span></td>
            <td><span class="status-badge ${o.shipping_status === 'Shipped' ? 'status-shipped' : 'status-inactive'}">${o.shipping_status}</span></td>
            <td><small>${new Date(o.created_at).toLocaleString()}</small></td>
            <td>
                <button class="retro-btn view-order-btn" data-id="${o.order_id}" style="padding:2px 8px; font-size:0.75rem;">VIEW DETAILS →</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8">No orders found.</td></tr>';

    tbody.querySelectorAll('.view-order-btn').forEach(btn => {
        btn.addEventListener('click', () => openOrderDetailModal(btn.getAttribute('data-id')));
    });

    tbody.querySelectorAll('.view-cust-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const orderId = link.getAttribute('data-id');
            const o = orders.find(ord => ord.order_id === orderId);
            if (o) openCustomerModal(o);
        });
    });
}

async function openOrderDetailModal(orderId) {
    let o = orders.find(ord => ord.order_id === orderId || String(ord.id) === String(orderId));
    activeOrderViewing = o || { id: orderId, order_id: orderId, items: [] };

    const modal = document.getElementById('order-detail-modal');
    if (!modal) return;

    if (o) renderOrderDetailModalContent(o);
    modal.style.display = 'flex';

    // Fetch fresh database order details including line items, images, tracking & breakdown
    try {
        const fetchId = o ? o.id : orderId;
        const res = await apiClient.get(`/admin/orders/${fetchId}`);
        const freshOrder = res?.data || res;
        if (freshOrder && (freshOrder.id || freshOrder.order_number)) {
            const normalized = normalizeOrder(freshOrder);
            if (Array.isArray(freshOrder.items)) {
                normalized.items = freshOrder.items.map(it => {
                    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                    let itemImg = it.img || it.product_image || 'https://img.icons8.com/color/150/000000/sticker.png';
                    if (itemImg && !itemImg.startsWith('http') && !itemImg.startsWith('//')) {
                        itemImg = apiHost + itemImg;
                    }
                    let variantStr = 'Standard';
                    if (it.variant_options) {
                        if (typeof it.variant_options === 'object') {
                            variantStr = Object.entries(it.variant_options).map(([k, v]) => `${k}: ${v}`).join(', ');
                        } else {
                            variantStr = String(it.variant_options);
                        }
                    }
                    return {
                        ...it,
                        item_id: it.id,
                        order_item_id: it.id,
                        admin_id: it.admin_product_id_snapshot || it.sku || 'CK-001',
                        title: it.product_name,
                        variant: variantStr,
                        qty: it.quantity,
                        unit_price: (apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1) === 2 ? Math.round((parseInt(it.unit_price, 10) || 0) / 100) : (parseInt(it.unit_price, 10) || 0),
                        total_price: (apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1) === 2 ? Math.round((parseInt(it.total_price, 10) || 0) / 100) : (parseInt(it.total_price, 10) || 0),
                        production_status: BACKEND_TO_UI_PROD_STATUS[it.production_status] || it.production_status || 'Ready to Print',
                        img: itemImg,
                        custom_designs: it.custom_designs || []
                    };
                });
            }
            activeOrderViewing = normalized;
            renderOrderDetailModalContent(normalized);
        }
    } catch (err) {
        console.warn('[Fetch Fresh Order Error]', err.message);
    }
}

function renderOrderDetailModalContent(o) {
    document.getElementById('ord-detail-title').textContent = `[ORDER DETAILS: ${o.order_id}]`;
    document.getElementById('ord-detail-date').textContent = `Placed on: ${new Date(o.created_at).toLocaleString()}`;
    document.getElementById('ord-detail-cust-name').textContent = o.customer_name;
    document.getElementById('ord-detail-cust-email').textContent = o.email;
    document.getElementById('ord-detail-cust-phone').textContent = o.phone;
    document.getElementById('ord-detail-cust-address').textContent = o.address;

    // Detailed price breakdown
    const subtotal = o.subtotal_rupees !== undefined ? o.subtotal_rupees : o.total_price;
    const shipping = o.shipping_charge_rupees !== undefined ? o.shipping_charge_rupees : 0;
    const discount = o.discount_total_rupees !== undefined ? o.discount_total_rupees : 0;
    const couponInfo = o.coupon_code ? ` [Coupon: ${o.coupon_code}]` : '';

    // Inclusive GST breakdown
    const tax = o.tax_amount_rupees !== undefined ? o.tax_amount_rupees : (o.tax_amount ? Math.round(o.tax_amount / 100) : 0);
    const cgst = o.cgst_amount_rupees !== undefined ? o.cgst_amount_rupees : (o.cgst_amount ? Math.round(o.cgst_amount / 100) : 0);
    const sgst = o.sgst_amount_rupees !== undefined ? o.sgst_amount_rupees : (o.sgst_amount ? Math.round(o.sgst_amount / 100) : 0);
    const igst = o.igst_amount_rupees !== undefined ? o.igst_amount_rupees : (o.igst_amount ? Math.round(o.igst_amount / 100) : 0);
    const shipMethod = o.shipping_method ? ` (${o.shipping_method})` : '';
    const taxText = igst > 0 ? `IGST: ₹${igst}` : `CGST: ₹${cgst} + SGST: ₹${sgst}`;

    document.getElementById('ord-detail-total').innerHTML = `
        ₹${o.total_price}
        <div style="font-size:0.75rem; color:#555; font-weight:normal; margin-top:3px;">
            Subtotal: ₹${subtotal} | Shipping: ₹${shipping}${shipMethod} | Discount: -₹${discount}${couponInfo}
        </div>
        ${tax > 0 ? `
        <div style="font-size:0.75rem; color:#047857; font-weight:600; margin-top:3px;">
            Included 18% GST: ₹${tax} (${taxText})
        </div>` : ''}
    `;

    const payBadge = document.getElementById('ord-detail-pay-status');
    payBadge.textContent = o.payment_status;
    payBadge.className = `status-badge ${o.payment_status === 'Paid' ? 'status-live' : 'status-upcoming'}`;

    renderOrderTimeline(o);

    const viewCustBtn = document.getElementById('ord-view-cust-btn');
    const viewCustLink = document.getElementById('ord-detail-cust-name-link');
    const viewCustAction = (e) => {
        if (e) e.preventDefault();
        document.getElementById('order-detail-modal').style.display = 'none';
        openCustomerModal(o);
    };
    if (viewCustBtn) viewCustBtn.onclick = viewCustAction;
    if (viewCustLink) viewCustLink.onclick = viewCustAction;

    const statusSelect = document.getElementById('ord-detail-status-select');
    statusSelect.innerHTML = CANONICAL_ORDER_STATUSES.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('');

    const itemsTbody = document.getElementById('ord-detail-items-tbody');
    itemsTbody.innerHTML = (o.items || []).map((item, idx) => {
        const prodStage = item.production_status || 'Ready to Print';
        const hasArtwork = item.custom_designs && item.custom_designs.length > 0;
        return `
            <tr>
                <td><img src="${item.img || 'https://img.icons8.com/color/150/000000/sticker.png'}" style="width:40px; height:40px; object-fit:cover; border:1px solid #000;"></td>
                <td><span class="admin-id-highlight">${item.admin_id || 'CK-001'}</span></td>
                <td>
                    <strong>${item.title}</strong>
                    <br><small style="color:#666;">${item.variant || 'Standard 3x3"'}</small>
                    ${hasArtwork ? `<div style="margin-top:2px;"><span class="status-badge" style="background:#7c3aed; color:#fff; font-size:0.65rem;">🎨 CUSTOM ARTWORK (${item.custom_designs.length})</span></div>` : ''}
                </td>
                <td><strong>x${item.qty}</strong></td>
                <td>₹${item.unit_price}</td>
                <td>
                    <select class="retro-input item-prod-select" data-itemid="${item.item_id || item.order_item_id}" style="padding:2px 4px; font-size:0.75rem;">
                        ${PRODUCTION_STAGES.map(st => `<option value="${st}" ${st === prodStage ? 'selected' : ''}>${st}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <button class="retro-btn adv-item-btn" data-itemid="${item.item_id || item.order_item_id}" style="padding:2px 6px; font-size:0.7rem; background:#2563eb; color:#fff;">NEXT STAGE</button>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="7">No items recorded for this order.</td></tr>';

    itemsTbody.querySelectorAll('.item-prod-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const itemId = sel.getAttribute('data-itemid');
            const newUIStage = e.target.value;
            const machineStatus = UI_TO_BACKEND_PROD_STATUS[newUIStage] || newUIStage.toUpperCase();
            try {
                await apiClient.put(`/admin/production/queue/items/${itemId}/status`, { status: machineStatus });
                showToast(`Production stage updated to ${newUIStage}`);
                await Promise.all([refreshProductionQueueFromAPI(), refreshOrdersFromAPI()]);
            } catch (err) {
                showToast(`Error updating stage: ${err.message}`, 'error');
            }
        });
    });

    itemsTbody.querySelectorAll('.adv-item-btn').forEach(btn => {
        btn.addEventListener('click', () => advanceProductionItemStage(btn.getAttribute('data-itemid')));
    });

    document.getElementById('ord-ship-courier').value = o.courier || '';
    document.getElementById('ord-ship-tracking-no').value = o.tracking_no || '';
    document.getElementById('ord-ship-date').value = o.ship_date || '';
    document.getElementById('ord-ship-notes').value = o.ship_notes || '';

    const extTrackBtn = document.getElementById('track-shipment-external-btn');
    if (o.tracking_no) {
        extTrackBtn.style.display = 'inline-block';
        extTrackBtn.href = `https://www.google.com/search?q=${encodeURIComponent((o.courier || '') + ' tracking ' + o.tracking_no)}`;
    } else {
        extTrackBtn.style.display = 'none';
    }
}

function renderOrderTimeline(order) {
    const container = document.getElementById('ord-timeline-container');
    if (!container) return;

    const history = (order.status_history && order.status_history.length > 0)
        ? order.status_history
        : [{ status: order.status || 'ORDER PLACED', timestamp: order.created_at, actor: "System", note: "Order placed" }];

    container.innerHTML = history.map(h => {
        const timeStr = h.timestamp || h.created_at ? new Date(h.timestamp || h.created_at).toLocaleString() : 'Just now';
        const actorStr = h.actor || h.changed_by || 'System';
        return `
            <div class="timeline-item">
                <span class="timeline-dot"></span>
                <strong>${h.status}</strong> — <small>${timeStr} (${actorStr})</small>
                ${h.note ? `<div style="font-size:0.75rem; color:#666; margin-top:2px;">${h.note}</div>` : ''}
            </div>
        `;
    }).join('');
}

// =============================================================================
// 6. CUSTOMERS & LOYALTY DATABASE MANAGEMENT
// =============================================================================

function renderCustomersTable() {
    const tbody = document.getElementById('customers-tbody');
    if (!tbody) return;

    const searchQuery = (document.getElementById('cust-search-input')?.value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('cust-filter-status')?.value || '';

    const filtered = customers.filter(c => {
        const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery) || c.email.toLowerCase().includes(searchQuery) || (c.phone || '').includes(searchQuery);
        const matchesStatus = !statusFilter || c.status === statusFilter || c.loyalty_tier === statusFilter;
        return matchesSearch && matchesStatus;
    });

    tbody.innerHTML = filtered.map(c => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.email}</td>
            <td><small>${c.phone || '-'}</small></td>
            <td><span class="status-badge" style="background:#eee; color:#000;">${c.delivered_orders || c.total_orders || 0} Delivered</span></td>
            <td><strong>₹${c.total_spent || 0}</strong></td>
            <td><span class="status-badge ${c.status === 'ELITE' ? 'status-live' : (c.status === 'VIP' ? 'status-shipped' : 'status-upcoming')}">${c.status || 'NEW'}</span></td>
            <td>
                <button class="retro-btn view-cust-btn" data-id="${c.id}" style="padding:2px 8px; font-size:0.75rem;">VIEW PROFILE →</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="7">No customers found.</td></tr>';

    tbody.querySelectorAll('.view-cust-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cust = customers.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (cust) openCustomerModal(cust);
        });
    });
}

function openCustomerModal(custOrOrder) {
    const modal = document.getElementById('customer-detail-modal');
    if (!modal) return;

    let cust = null;
    if (custOrOrder.id && customers.some(c => String(c.id) === String(custOrOrder.id))) {
        cust = customers.find(c => String(c.id) === String(custOrOrder.id));
    } else {
        cust = customers.find(c => (c.email && c.email.toLowerCase() === (custOrOrder.email || '').toLowerCase()) || c.name.toLowerCase() === (custOrOrder.customer_name || '').toLowerCase());
    }

    if (!cust) {
        cust = {
            id: Date.now(),
            name: custOrOrder.customer_name || custOrOrder.name || "Customer",
            email: custOrOrder.email || "No email",
            phone: custOrOrder.phone || "No phone",
            address: custOrOrder.address || "No address provided",
            total_orders: 1,
            delivered_orders: custOrOrder.status === 'Delivered' ? 1 : 0,
            total_spent: custOrOrder.total_price || 0,
            status: calculateCustomerTier(custOrOrder.status === 'Delivered' ? 1 : 0)
        };
    }

    document.getElementById('cust-modal-name').textContent = `[CUSTOMER PROFILE: ${cust.name}]`;

    const custOrders = orders.filter(o => o.email.toLowerCase() === cust.email.toLowerCase() || o.customer_name.toLowerCase() === cust.name.toLowerCase());
    const deliveredCount = custOrders.filter(o => o.status === 'Delivered').length;
    const tier = calculateCustomerTier(deliveredCount);

    const content = document.getElementById('cust-modal-content');
    content.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:15px; font-size:0.85rem;">
            <div>
                <p style="margin:4px 0;"><strong>EMAIL:</strong> ${cust.email}</p>
                <p style="margin:4px 0;"><strong>PHONE:</strong> ${cust.phone || '-'}</p>
                <p style="margin:4px 0;"><strong>DELIVERED SPEND:</strong> <strong style="color:#059669;">₹${cust.total_spent || 0}</strong></p>
            </div>
            <div>
                <p style="margin:4px 0;"><strong>DELIVERED ORDERS:</strong> ${deliveredCount}</p>
                <p style="margin:4px 0;"><strong>LOYALTY TIER:</strong> <span class="status-badge status-live">${tier}</span></p>
                <p style="margin:4px 0;"><strong>ADDRESS:</strong> ${cust.address || '-'}</p>
            </div>
        </div>

        <h4 style="font-weight:900; margin-bottom:8px; border-bottom:1.5px solid #000; padding-bottom:4px;">PURCHASE HISTORY (${custOrders.length})</h4>
        <div style="max-height:220px; overflow-y:auto;">
            <table class="retro-table" style="font-size:0.8rem;">
                <thead>
                    <tr>
                        <th>ORDER ID</th>
                        <th>TOTAL</th>
                        <th>PAYMENT</th>
                        <th>FULFILLMENT</th>
                        <th>DATE</th>
                    </tr>
                </thead>
                <tbody>
                    ${custOrders.map(o => `
                        <tr>
                            <td><strong class="admin-id-highlight">${o.order_id}</strong></td>
                            <td>₹${o.total_price}</td>
                            <td><span class="status-badge status-live">${o.payment_status}</span></td>
                            <td><span class="status-badge status-upcoming">${o.status}</span></td>
                            <td><small>${new Date(o.created_at).toLocaleDateString()}</small></td>
                        </tr>
                    `).join('') || '<tr><td colspan="5">No orders found for this customer profile.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;

    modal.style.display = 'flex';
}

// =============================================================================
// 7. PROMOTIONAL EVENTS & SALES DROPS MANAGEMENT
// =============================================================================

function renderEventsTable() {
    const tbody = document.getElementById('events-tbody');
    if (!tbody) return;

    tbody.innerHTML = events.map(e => `
        <tr>
            <td><strong>${e.event_name}</strong><br><small style="color:#666;">${e.subtitle || ''}</small></td>
            <td><strong style="color:#7c3aed;">${e.discount_value}${e.discount_type === 'percent' ? '%' : '₹'} OFF</strong></td>
            <td><small>${new Date(e.start_time).toLocaleString()}</small></td>
            <td><small>${new Date(e.end_time).toLocaleString()}</small></td>
            <td><span class="status-badge" style="background:#eee; color:#000;">${(e.target_product_ids || []).length} products</span></td>
            <td><span class="status-badge ${e.active ? 'status-live' : 'status-inactive'}">${e.active ? 'ON' : 'OFF'}</span></td>
            <td><span class="status-badge ${e.active ? 'status-live' : 'status-ended'}">${e.active ? 'RUNNING' : 'INACTIVE'}</span></td>
            <td>
                <div style="display:flex; gap:4px;">
                    <button class="retro-btn edit-evt-btn" data-id="${e.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                    <button class="retro-btn toggle-evt-btn" data-id="${e.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
                    <button class="retro-btn del-evt-btn" data-id="${e.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8">No sales events scheduled.</td></tr>';

    tbody.querySelectorAll('.edit-evt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const evt = events.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (evt) openEventForm(evt);
        });
    });

    tbody.querySelectorAll('.toggle-evt-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const evt = events.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (evt) {
                try {
                    await apiClient.put(`/admin/events/${evt.id}`, { ...evt, active: !evt.active ? 1 : 0 });
                    showToast(`Event promotion ${evt.event_name || evt.name} updated.`);
                    await refreshEventsFromAPI();
                } catch (err) {
                    showToast(`Error toggling event: ${err.message}`, 'error');
                }
            }
        });
    });

    tbody.querySelectorAll('.del-evt-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteEvent(btn.getAttribute('data-id')));
    });
}

function openEventForm(evt = null) {
    const container = document.getElementById('event-form-container');
    if (!container) return;

    editingEventId = evt ? evt.id : null;
    const evtName = evt ? (evt.event_name || evt.name || '') : '';
    document.getElementById('evt-form-title').textContent = evt ? `[EDIT EVENT PROMOTION: ${evtName}]` : '[SCHEDULE EVENT PROMOTION]';
    document.getElementById('evt-name').value = evtName;
    document.getElementById('evt-title').value = evt ? (evt.subtitle || evt.description || '') : '';
    document.getElementById('evt-discount-type').value = evt ? evt.discount_type : 'percent';
    document.getElementById('evt-discount-value').value = evt ? (evt.discount_value !== undefined ? evt.discount_value : (evt.discount_percent || 20)) : 20;
    document.getElementById('evt-start').value = evt ? (evt.start_time || evt.start_date || new Date().toISOString().slice(0, 16)) : new Date().toISOString().slice(0, 16);
    document.getElementById('evt-end').value = evt ? (evt.end_time || evt.end_date || new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16)) : new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16);
    document.getElementById('evt-active').value = evt ? String(evt.active !== undefined ? (evt.active === 1 || evt.active === true) : true) : 'true';
    document.getElementById('evt-storefront-hero').value = evt ? String(evt.hero_banner || false) : 'true';

    const targetProds = evt && (evt.target_product_ids || evt.product_ids || evt.target_products);
    selectedEvtProductIds = targetProds ? [...targetProds] : products.map(p => p.admin_id || p.sku);
    renderEvtProductChecklist();

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

function renderEvtProductChecklist() {
    const checklist = document.getElementById('evt-product-checklist');
    const chipsContainer = document.getElementById('evt-selected-chips');
    const selectedCountSpan = document.getElementById('evt-selected-count');
    if (!checklist || !chipsContainer) return;

    const catFilter = document.getElementById('evt-filter-cat')?.value || '';
    const searchVal = (document.getElementById('evt-filter-search')?.value || '').toLowerCase().trim();

    const filteredProds = products.filter(p => {
        const matchesCat = !catFilter || p.category === catFilter;
        const matchesSearch = !searchVal || (p.admin_id || p.sku || '').toLowerCase().includes(searchVal) || p.title.toLowerCase().includes(searchVal);
        return matchesCat && matchesSearch;
    });

    checklist.innerHTML = filteredProds.map(p => {
        const pId = p.admin_id || p.sku;
        const isChecked = selectedEvtProductIds.includes(pId);
        return `
            <div class="product-select-item">
                <label style="display:flex; align-items:center; gap:8px; width:100%; cursor:pointer; font-size:0.8rem;">
                    <input type="checkbox" class="evt-prod-chk" data-id="${pId}" ${isChecked ? 'checked' : ''}>
                    <span class="admin-id-highlight">${pId}</span>
                    <strong>${p.title}</strong>
                    <span style="margin-left:auto; color:#059669; font-weight:bold;">₹${p.price}</span>
                </label>
            </div>
        `;
    }).join('');

    checklist.querySelectorAll('.evt-prod-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            const pId = chk.getAttribute('data-id');
            if (chk.checked) {
                if (!selectedEvtProductIds.includes(pId)) selectedEvtProductIds.push(pId);
            } else {
                selectedEvtProductIds = selectedEvtProductIds.filter(id => id !== pId);
            }
            renderEvtProductChecklist();
        });
    });

    if (selectedCountSpan) selectedCountSpan.textContent = selectedEvtProductIds.length;

    chipsContainer.innerHTML = selectedEvtProductIds.map(id => `
        <span class="chip-item">
            ${id} <span class="chip-remove-btn" data-id="${id}">×</span>
        </span>
    `).join('');

    chipsContainer.querySelectorAll('.chip-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idToRemove = btn.getAttribute('data-id');
            selectedEvtProductIds = selectedEvtProductIds.filter(id => id !== idToRemove);
            renderEvtProductChecklist();
        });
    });
}

async function saveEventForm() {
    const name = document.getElementById('evt-name').value.trim();
    const value = Number(document.getElementById('evt-discount-value').value);

    if (!name || isNaN(value)) {
        showToast("Please fill in event name and discount value!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-event-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SCHEDULING..."; }

    const payload = {
        name,
        subtitle: document.getElementById('evt-title').value.trim(),
        discount_type: document.getElementById('evt-discount-type').value,
        discount_value: value,
        discount_percent: value,
        start_time: document.getElementById('evt-start').value,
        end_time: document.getElementById('evt-end').value,
        active: document.getElementById('evt-active').value === 'true' ? 1 : 0,
        hero_banner: document.getElementById('evt-storefront-hero').value === 'true' ? 1 : 0,
        target_product_ids: [...selectedEvtProductIds],
        target_products: [...selectedEvtProductIds]
    };

    try {
        if (editingEventId) {
            await apiClient.put(`/admin/events/${editingEventId}`, payload);
            showToast(`Event promotion '${name}' updated.`);
        } else {
            await apiClient.post('/admin/events', payload);
            showToast(`Event promotion '${name}' scheduled.`);
        }
        document.getElementById('event-form-container').style.display = 'none';
        await refreshEventsFromAPI();
    } catch (err) {
        showToast(`Error saving event: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || "SCHEDULE PROMOTION DROP"; }
    }
}

async function deleteEvent(eventId) {
    const evt = events.find(e => String(e.id) === String(eventId));
    if (!evt) return;

    showConfirmModal("DELETE EVENT", `Delete sale event '${evt.event_name}'?`, async () => {
        try {
            await apiClient.delete(`/admin/events/${eventId}`);
            showToast(`Event deleted.`);
            await refreshEventsFromAPI();
        } catch (err) {
            showToast(`Error deleting event: ${err.message}`, 'error');
        }
    });
}

// =============================================================================
// 8. COUPONS ENGINE MANAGEMENT
// =============================================================================

function renderCouponsTable() {
    const tbody = document.getElementById('coupons-tbody');
    if (!tbody) return;

    tbody.innerHTML = coupons.map(c => `
        <tr>
            <td><strong style="font-family:monospace; font-size:0.95rem; background:#fef08a; padding:2px 6px; border:1px solid #000;">${c.code}</strong></td>
            <td>${c.discount_type === 'percent' ? 'Percentage (%)' : 'Fixed Amount (₹)'}</td>
            <td><strong style="color:#059669;">${c.discount_value}${c.discount_type === 'percent' ? '%' : '₹'} OFF</strong></td>
            <td>₹${c.min_spend || 0}</td>
            <td><span class="status-badge ${c.active ? 'status-live' : 'status-inactive'}">${c.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
            <td>
                <div style="display:flex; gap:4px;">
                    <button class="retro-btn edit-cpn-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                    <button class="retro-btn toggle-cpn-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
                    <button class="retro-btn del-cpn-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6">No coupons created.</td></tr>';

    tbody.querySelectorAll('.edit-cpn-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cpn = coupons.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (cpn) openCouponForm(cpn);
        });
    });

    tbody.querySelectorAll('.toggle-cpn-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cpn = coupons.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (cpn) {
                try {
                    await apiClient.put(`/admin/coupons/${cpn.id}`, { active: !cpn.active ? 1 : 0 });
                    showToast(`Coupon code ${cpn.code} set to ${!cpn.active ? 'Active' : 'Inactive'}`);
                    await refreshCouponsFromAPI();
                } catch (err) {
                    showToast(`Error toggling coupon: ${err.message}`, 'error');
                }
            }
        });
    });

    tbody.querySelectorAll('.del-cpn-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteCoupon(btn.getAttribute('data-id')));
    });
}

function openCouponForm(cpn = null) {
    const container = document.getElementById('coupon-form-container');
    if (!container) return;

    editingCouponId = cpn ? cpn.id : null;
    const titleEl = document.getElementById('cpn-form-title');
    if (titleEl) {
        titleEl.textContent = cpn ? `[EDIT COUPON CODE: ${cpn.code}]` : '[CREATE NEW COUPON CODE]';
    }
    document.getElementById('cpn-code').value = cpn ? cpn.code : '';
    document.getElementById('cpn-type').value = cpn ? cpn.discount_type : 'percent';
    document.getElementById('cpn-amount').value = cpn ? cpn.discount_value : 10;
    const minSpend = cpn ? (cpn.min_spend !== undefined ? cpn.min_spend : (cpn.min_order_value_rupees !== undefined ? cpn.min_order_value_rupees : (cpn.min_order_value !== undefined ? cpn.min_order_value : 200))) : 200;
    document.getElementById('cpn-min').value = minSpend;
    document.getElementById('cpn-active').value = cpn ? String(cpn.active !== undefined ? (cpn.active === 1 || cpn.active === true) : true) : 'true';
    const custLimitEl = document.getElementById('cpn-per-customer-limit');
    if (custLimitEl) {
        custLimitEl.value = cpn ? (cpn.per_customer_limit || 1) : 1;
    }

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

async function saveCouponForm() {
    const code = document.getElementById('cpn-code').value.trim().toUpperCase();
    const value = Number(document.getElementById('cpn-amount').value);

    if (!code || isNaN(value)) {
        showToast("Coupon code and discount value are required!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-coupon-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const minSpendInput = Number(document.getElementById('cpn-min').value) || 0;
    const minOrderVal = activeStoreId === 1 ? Math.round(minSpendInput) : Math.round(minSpendInput * 100);
    const custLimitEl = document.getElementById('cpn-per-customer-limit');
    const perCustomerLimit = custLimitEl ? (parseInt(custLimitEl.value, 10) || 1) : 1;
    const payload = {
        code,
        discount_type: document.getElementById('cpn-type').value,
        discount_value: value,
        min_order_value: minOrderVal,
        per_customer_limit: perCustomerLimit,
        active: document.getElementById('cpn-active').value === 'true' ? 1 : 0
    };

    try {
        if (editingCouponId) {
            await apiClient.put(`/admin/coupons/${editingCouponId}`, payload);
            showToast(`Coupon code '${code}' updated.`);
        } else {
            await apiClient.post('/admin/coupons', payload);
            showToast(`Coupon code '${code}' created.`);
        }
        document.getElementById('coupon-form-container').style.display = 'none';
        await refreshCouponsFromAPI();
    } catch (err) {
        showToast(`Error saving coupon: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || "CREATE PROMO CODE"; }
    }
}

async function deleteCoupon(couponId) {
    const cpn = coupons.find(c => String(c.id) === String(couponId));
    if (!cpn) return;

    showConfirmModal("DELETE COUPON", `Delete coupon code '${cpn.code}'?`, async () => {
        try {
            await apiClient.delete(`/admin/coupons/${couponId}`);
            showToast(`Coupon deleted.`);
            await refreshCouponsFromAPI();
        } catch (err) {
            showToast(`Error deleting coupon: ${err.message}`, 'error');
        }
    });
}

// =============================================================================
// 9. SHIPPING RULES ENGINE
// =============================================================================

function renderShippingRulesTable() {
    const tbody = document.getElementById('shipping-tbody');
    if (!tbody) return;

    tbody.innerHTML = shippingRules.map(r => `
        <tr>
            <td><strong>${r.rule_name}</strong></td>
            <td>₹${r.min_order} - ${r.max_order > 900000 ? 'No Limit' : '₹' + r.max_order}</td>
            <td><span class="status-badge" style="background:#eee; color:#000;">${r.region}</span></td>
            <td><strong style="color:${r.fee === 0 ? '#059669' : '#000'};">${r.fee === 0 ? 'FREE' : '₹' + r.fee}</strong></td>
            <td><span class="status-badge ${r.active ? 'status-live' : 'status-inactive'}">${r.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
            <td>
                <div style="display:flex; gap:4px;">
                    <button class="retro-btn edit-ship-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                    <button class="retro-btn toggle-ship-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
                    <button class="retro-btn del-ship-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6">No shipping rules configured.</td></tr>';

    tbody.querySelectorAll('.edit-ship-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rule = shippingRules.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (rule) openShippingRuleForm(rule);
        });
    });

    tbody.querySelectorAll('.toggle-ship-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const rule = shippingRules.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (rule) {
                try {
                    await apiClient.put(`/admin/shipping-rules/${rule.id}`, { is_enabled: !rule.active ? 1 : 0 });
                    showToast(`Shipping rule ${rule.rule_name} toggled.`);
                    await refreshShippingRulesFromAPI();
                } catch (err) {
                    showToast(`Error toggling shipping rule: ${err.message}`, 'error');
                }
            }
        });
    });

    tbody.querySelectorAll('.del-ship-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteShippingRule(btn.getAttribute('data-id')));
    });
}

function openShippingRuleForm(rule = null) {
    const container = document.getElementById('shipping-form-container');
    if (!container) return;

    editingShippingId = rule ? rule.id : null;
    const titleEl = document.getElementById('ship-form-title');
    if (titleEl) {
        titleEl.textContent = rule ? `[EDIT SHIPPING RULE: ${rule.rule_name}]` : '[ADD SHIPPING RULE]';
    }
    const nameEl = document.getElementById('ship-name');
    const feeEl = document.getElementById('ship-fee');
    const minEl = document.getElementById('ship-min');
    const regionEl = document.getElementById('ship-region');
    const activeEl = document.getElementById('ship-active');

    if (nameEl) nameEl.value = rule ? rule.rule_name : '';
    if (feeEl) feeEl.value = rule ? rule.fee : 50;
    if (minEl) minEl.value = rule ? rule.min_order : 0;
    if (regionEl) regionEl.value = rule ? rule.region : 'India (All States)';
    if (activeEl) activeEl.value = rule ? String(rule.active) : 'true';

    container.style.display = 'block';
}

async function saveShippingRuleForm() {
    const nameEl = document.getElementById('ship-name');
    const feeEl = document.getElementById('ship-fee');
    const minEl = document.getElementById('ship-min');

    const name = nameEl ? nameEl.value.trim() : '';
    const fee = Number(feeEl ? feeEl.value : 0);
    const minVal = Number(minEl ? minEl.value : 0) || 0;

    if (!name || isNaN(fee)) {
        showToast("Please enter rule name and shipping fee!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-ship-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const payload = {
        name,
        standard_fee: activeStoreId === 1 ? Math.round(fee) : Math.round(fee * 100),
        free_shipping_threshold: activeStoreId === 1 ? Math.round(minVal) : Math.round(minVal * 100),
        is_enabled: document.getElementById('ship-active').value === 'true' ? 1 : 0,
        regional_overrides: { region: document.getElementById('ship-region').value }
    };

    try {
        if (editingShippingId) {
            await apiClient.put(`/admin/shipping-rules/${editingShippingId}`, payload);
            showToast(`Shipping rule '${name}' updated.`);
        } else {
            await apiClient.post('/admin/shipping-rules', payload);
            showToast(`Shipping rule '${name}' created.`);
        }
        document.getElementById('shipping-form-container').style.display = 'none';
        await refreshShippingRulesFromAPI();
    } catch (err) {
        showToast(`Error saving shipping rule: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || "SAVE SHIPPING RULE"; }
    }
}

async function deleteShippingRule(ruleId) {
    const rule = shippingRules.find(r => String(r.id) === String(ruleId));
    if (!rule) return;

    showConfirmModal("DELETE SHIPPING RULE", `Delete shipping rule '${rule.rule_name}'?`, async () => {
        try {
            await apiClient.delete(`/admin/shipping-rules/${ruleId}`);
            showToast(`Shipping rule deleted.`);
            await refreshShippingRulesFromAPI();
        } catch (err) {
            showToast(`Error deleting shipping rule: ${err.message}`, 'error');
        }
    });
}

function renderShippingCalculatorPreview() {
    const previewDiv = document.getElementById('calc-result');
    if (!previewDiv) return;

    const cartVal = Number(document.getElementById('calc-order-val')?.value || 250);
    const region = document.getElementById('calc-region')?.value || 'India (All States)';

    let matchedFee = 50;
    let applicableRuleName = "Standard Shipping";

    const activeRules = shippingRules.filter(r => r.active);

    const freeRule = activeRules.find(r => r.fee === 0 && cartVal >= r.min_order);
    if (freeRule) {
        matchedFee = 0;
        applicableRuleName = freeRule.rule_name;
    } else {
        const flatRule = activeRules.find(r => r.fee > 0 && cartVal >= r.min_order && cartVal <= r.max_order);
        if (flatRule) {
            matchedFee = flatRule.fee;
            applicableRuleName = flatRule.rule_name;
        }
    }

    previewDiv.innerHTML = `
        <div style="font-size:0.85rem;">
            <p style="margin:4px 0;"><strong>CALCULATED FEE:</strong> <strong style="color:${matchedFee === 0 ? '#059669' : '#000'}; font-size:1.1rem;">${matchedFee === 0 ? 'FREE' : '₹' + matchedFee}</strong></p>
            <p style="margin:4px 0;"><strong>APPLIED RULE:</strong> ${applicableRuleName}</p>
            <p style="margin:4px 0; color:#666;"><small>Subtotal: ₹${cartVal} | Region: ${region}</small></p>
        </div>
    `;
}

// =============================================================================
// 10. THE MARSHANS: MATERIALS, INVENTORY, FINISHING, PRODUCTION, CUSTOM REQUESTS
// =============================================================================

// --- MATERIALS ---
function renderMaterialsTable() {
    const tbody = document.getElementById('materials-tbody');
    if (!tbody) return;

    const query = (document.getElementById('material-search-input')?.value || '').toLowerCase().trim();
    const filterType = document.getElementById('material-filter-type')?.value || '';

    // Populate type dropdown if needed
    const typeSelect = document.getElementById('material-filter-type');
    if (typeSelect && materials.length > 0) {
        const uniqueTypes = [...new Set(materials.map(m => m.material_type).filter(Boolean))];
        const currentVal = typeSelect.value;
        typeSelect.innerHTML = '<option value="">All Material Types</option>' + uniqueTypes.map(t => `<option value="${t}">${t}</option>`).join('');
        typeSelect.value = currentVal;
    }

    const filtered = materials.filter(m => {
        const matchQ = !query || (m.name || '').toLowerCase().includes(query) || (m.material_type || '').toLowerCase().includes(query) || (m.color_name || '').toLowerCase().includes(query);
        const matchT = !filterType || m.material_type === filterType;
        return matchQ && matchT;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:15px; color:#666;">No materials found. Click "+ ADD MATERIAL" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(m => {
        const stockQty = Number(m.stock_quantity) || 0;
        const minThreshold = Number(m.min_stock_threshold) || 0;
        const isLow = stockQty <= minThreshold;
        const colorBadge = m.color_hex ? `<span style="display:inline-block; width:12px; height:12px; border:1px solid #000; background:${m.color_hex}; vertical-align:middle; margin-right:4px;"></span>` : '';
        const costVal = (Number(m.cost_per_unit) || 0).toFixed(2);

        return `
            <tr>
                <td><strong>${m.name}</strong></td>
                <td><span class="status-badge" style="background:#7c3aed; color:#fff;">${m.material_type}</span></td>
                <td>${colorBadge} ${m.color_name || 'Standard'}</td>
                <td><code style="background:#eee; padding:2px 6px;">${m.unit || 'grams'}</code></td>
                <td>₹${costVal}</td>
                <td><span style="font-weight:bold; color:${isLow ? '#dc2626' : '#059669'};">${stockQty.toLocaleString()} ${m.unit || 'g'}</span></td>
                <td><span class="status-badge ${isLow ? 'status-inactive' : 'status-live'}">${isLow ? 'LOW STOCK' : 'IN STOCK'}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="retro-btn edit-mat-btn" data-id="${m.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                        <button class="retro-btn del-mat-btn" data-id="${m.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.edit-mat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = materials.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (m) openMaterialForm(m);
        });
    });

    tbody.querySelectorAll('.del-mat-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteMaterial(btn.getAttribute('data-id')));
    });
}

function openMaterialForm(material = null) {
    const container = document.getElementById('material-form-container');
    if (!container) return;

    editingMaterialId = material ? material.id : null;
    const titleEl = document.getElementById('mat-form-title');
    if (titleEl) titleEl.textContent = material ? `[EDIT MATERIAL: ${material.name}]` : '[ADD NEW MATERIAL]';

    document.getElementById('mat-edit-id').value = material ? material.id : '';
    document.getElementById('mat-name').value = material ? material.name : '';
    document.getElementById('mat-type').value = material ? material.material_type : 'PLA';
    document.getElementById('mat-color-name').value = material ? material.color_name : '';
    document.getElementById('mat-color-hex').value = material ? (material.color_hex || '#000000') : '#000000';
    document.getElementById('mat-color-picker').value = material ? (material.color_hex || '#000000') : '#000000';
    document.getElementById('mat-stock-quantity').value = material ? material.stock_quantity : 1000;
    document.getElementById('mat-unit').value = material ? (material.unit || 'grams') : 'grams';
    document.getElementById('mat-cost-per-unit').value = material ? material.cost_per_unit : 2.5;
    document.getElementById('mat-density').value = material ? (material.density_g_cm3 || 1.24) : 1.24;
    document.getElementById('mat-min-threshold').value = material ? (material.min_stock_threshold || 500) : 500;
    document.getElementById('mat-active').value = material ? String(material.is_active !== 0 && material.is_active !== false) : 'true';

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

async function saveMaterialForm() {
    const name = document.getElementById('mat-name')?.value.trim();
    const type = document.getElementById('mat-type')?.value.trim();
    const colorName = document.getElementById('mat-color-name')?.value.trim();
    const colorHex = document.getElementById('mat-color-hex')?.value.trim();
    const stockQty = Number(document.getElementById('mat-stock-quantity')?.value) || 0;
    const unit = document.getElementById('mat-unit')?.value || 'grams';
    const costPerUnit = Number(document.getElementById('mat-cost-per-unit')?.value) || 0;
    const density = Number(document.getElementById('mat-density')?.value) || 1.24;
    const minThreshold = Number(document.getElementById('mat-min-threshold')?.value) || 0;
    const isActive = document.getElementById('mat-active')?.value === 'true' ? 1 : 0;

    if (!name || !type) {
        showToast("Material name and category/type are required!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-material-btn');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const payload = {
        name,
        material_type: type,
        color_name: colorName,
        color_hex: colorHex,
        stock_quantity: stockQty,
        unit,
        cost_per_unit: costPerUnit,
        density_g_cm3: density,
        min_stock_threshold: minThreshold,
        is_active: isActive
    };

    try {
        if (editingMaterialId) {
            await apiClient.put(`/admin/materials/${editingMaterialId}`, payload);
            showToast(`Material '${name}' updated.`);
        } else {
            await apiClient.post('/admin/materials', payload);
            showToast(`Material '${name}' created.`);
        }
        document.getElementById('material-form-container').style.display = 'none';
        await refreshMaterialsFromAPI();
    } catch (err) {
        showToast(`Error saving material: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText || "SAVE MATERIAL"; }
    }
}

async function deleteMaterial(materialId) {
    const m = materials.find(item => String(item.id) === String(materialId));
    if (!m) return;

    showConfirmModal("DELETE MATERIAL", `Delete material '${m.name}'?`, async () => {
        try {
            await apiClient.delete(`/admin/materials/${materialId}`);
            showToast(`Material '${m.name}' deleted.`);
            await refreshMaterialsFromAPI();
        } catch (err) {
            showToast(`Error deleting material: ${err.message}`, 'error');
        }
    });
}

// --- INVENTORY & STOCK CONTROL ---
function renderInventoryTable() {
    const tbody = document.getElementById('inventory-tbody');
    if (!tbody) return;

    if (materials.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:15px; color:#666;">No inventory items recorded. Materials added in the Materials tab will appear here.</td></tr>';
        return;
    }

    tbody.innerHTML = materials.map(m => {
        const stockQty = Number(m.stock_quantity) || 0;
        const minThreshold = Number(m.min_stock_threshold) || 0;
        const isLow = stockQty <= minThreshold;
        const colorBadge = m.color_hex ? `<span style="display:inline-block; width:12px; height:12px; border:1px solid #000; background:${m.color_hex}; vertical-align:middle; margin-right:4px;"></span>` : '';
        const costVal = (Number(m.cost_per_unit) || 0).toFixed(2);

        return `
            <tr>
                <td><code>MAT-${String(m.id).padStart(3, '0')}</code></td>
                <td><strong>${m.name}</strong></td>
                <td><span class="status-badge" style="background:#7c3aed; color:#fff;">${m.material_type}</span></td>
                <td>${colorBadge} ${m.color_name || 'Standard'}</td>
                <td><strong style="font-size:1rem; color:${isLow ? '#dc2626' : '#059669'};">${stockQty.toLocaleString()} ${m.unit || 'g'}</strong></td>
                <td>${minThreshold.toLocaleString()} ${m.unit || 'g'}</td>
                <td>₹${costVal} / ${m.unit || 'unit'}</td>
                <td><span class="status-badge ${isLow ? 'status-inactive' : 'status-live'}">${isLow ? 'CRITICAL LOW' : 'HEALTHY'}</span></td>
                <td>
                    <button class="retro-btn quick-adjust-btn" data-id="${m.id}" style="padding:2px 8px; font-size:0.75rem; background:#0ea5e9; color:#fff;">ADJUST STOCK</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.quick-adjust-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const matId = btn.getAttribute('data-id');
            const selectEl = document.getElementById('inv-material-select');
            if (selectEl) selectEl.value = matId;
            const formContainer = document.getElementById('inventory-form-container');
            if (formContainer) {
                formContainer.style.display = 'block';
                formContainer.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

function populateInventoryMaterialSelect() {
    const select = document.getElementById('inv-material-select');
    if (!select) return;

    select.innerHTML = materials.map(m => `
        <option value="${m.id}">${m.name} (${m.material_type} - ${m.color_name || 'Standard'}) [Current: ${m.stock_quantity} ${m.unit || 'g'}]</option>
    `).join('') || '<option value="">No materials available</option>';

    select.addEventListener('change', () => {
        const m = materials.find(item => String(item.id) === select.value);
        const unitLabel = document.getElementById('inv-unit-label');
        if (unitLabel && m) unitLabel.textContent = m.unit || 'grams / ml';
    });
}

async function saveInventoryAdjust() {
    const select = document.getElementById('inv-material-select');
    const materialId = select ? select.value : null;
    const adjustType = document.getElementById('inv-adjust-type')?.value;
    const amount = Number(document.getElementById('inv-adjust-amount')?.value);
    const reason = document.getElementById('inv-adjust-reason')?.value.trim() || 'Manual Admin Stock Adjustment';

    if (!materialId) {
        showToast("Please select a material to adjust!", "error");
        return;
    }
    if (isNaN(amount) || amount < 0) {
        showToast("Please enter a valid non-negative adjustment amount!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-inventory-adjust-btn');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "RECORDING..."; }

    try {
        await apiClient.patch(`/admin/materials/${materialId}/stock`, {
            adjustment_type: adjustType,
            amount,
            reason
        });
        showToast("Stock adjustment successfully recorded in inventory.");
        document.getElementById('inventory-form-container').style.display = 'none';
        document.getElementById('inv-adjust-amount').value = '';
        document.getElementById('inv-adjust-reason').value = '';
        await refreshMaterialsFromAPI();
    } catch (err) {
        showToast(`Error recording adjustment: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText || "CONFIRM ADJUSTMENT"; }
    }
}

// --- FINISHING OPTIONS ---
function renderFinishingTable() {
    const tbody = document.getElementById('finishing-tbody');
    if (!tbody) return;

    if (finishingOptions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:15px; color:#666;">No finishing options configured. Click "+ ADD FINISHING OPTION" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = finishingOptions.map(f => {
        const extraPrice = Number(f.extra_price) || 0;
        const leadDays = Number(f.lead_time_days) || 0;
        const isActive = f.is_active !== 0 && f.is_active !== false;

        return `
            <tr>
                <td><strong>${f.name}</strong></td>
                <td><small style="color:#555;">${f.description || 'Standard post-processing'}</small></td>
                <td><strong style="color:${extraPrice > 0 ? '#059669' : '#555'};">${extraPrice > 0 ? '+₹' + extraPrice : 'FREE / INCLUDED'}</strong></td>
                <td>${leadDays > 0 ? `+${leadDays} days` : 'Same day'}</td>
                <td><span class="status-badge ${isActive ? 'status-live' : 'status-inactive'}">${isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="retro-btn edit-finish-btn" data-id="${f.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                        <button class="retro-btn del-finish-btn" data-id="${f.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.edit-finish-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const f = finishingOptions.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (f) openFinishingForm(f);
        });
    });

    tbody.querySelectorAll('.del-finish-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteFinishingOption(btn.getAttribute('data-id')));
    });
}

function openFinishingForm(opt = null) {
    const container = document.getElementById('finishing-form-container');
    if (!container) return;

    editingFinishingId = opt ? opt.id : null;
    const titleEl = document.getElementById('finish-form-title');
    if (titleEl) titleEl.textContent = opt ? `[EDIT FINISHING OPTION: ${opt.name}]` : '[ADD FINISHING OPTION]';

    document.getElementById('finish-edit-id').value = opt ? opt.id : '';
    document.getElementById('finish-name').value = opt ? opt.name : '';
    document.getElementById('finish-extra-price').value = opt ? opt.extra_price : 0;
    document.getElementById('finish-description').value = opt ? (opt.description || '') : '';
    document.getElementById('finish-lead-time').value = opt ? (opt.lead_time_days || 0) : 2;
    document.getElementById('finish-active').value = opt ? String(opt.is_active !== 0 && opt.is_active !== false) : 'true';

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

async function saveFinishingForm() {
    const name = document.getElementById('finish-name')?.value.trim();
    const extraPrice = Number(document.getElementById('finish-extra-price')?.value) || 0;
    const description = document.getElementById('finish-description')?.value.trim();
    const leadTimeDays = Number(document.getElementById('finish-lead-time')?.value) || 0;
    const isActive = document.getElementById('finish-active')?.value === 'true' ? 1 : 0;

    if (!name) {
        showToast("Finishing option name is required!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-finishing-btn');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const payload = {
        name,
        extra_price: extraPrice,
        description,
        lead_time_days: leadTimeDays,
        is_active: isActive
    };

    try {
        if (editingFinishingId) {
            await apiClient.put(`/admin/finishing-options/${editingFinishingId}`, payload);
            showToast(`Finishing option '${name}' updated.`);
        } else {
            await apiClient.post('/admin/finishing-options', payload);
            showToast(`Finishing option '${name}' created.`);
        }
        document.getElementById('finishing-form-container').style.display = 'none';
        await refreshFinishingFromAPI();
    } catch (err) {
        showToast(`Error saving finishing option: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText || "SAVE FINISHING OPTION"; }
    }
}

async function deleteFinishingOption(id) {
    const f = finishingOptions.find(item => String(item.id) === String(id));
    if (!f) return;

    showConfirmModal("DELETE FINISHING OPTION", `Delete finishing option '${f.name}'?`, async () => {
        try {
            await apiClient.delete(`/admin/finishing-options/${id}`);
            showToast(`Finishing option '${f.name}' deleted.`);
            await refreshFinishingFromAPI();
        } catch (err) {
            showToast(`Error deleting finishing option: ${err.message}`, 'error');
        }
    });
}

// --- 3D PRODUCTION JOBS (7-STAGE WORKFLOW) ---
function renderProductionJobsTable() {
    const tbody = document.getElementById('production-jobs-tbody');
    if (!tbody) return;

    if (productionJobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:15px; color:#666;">No 3D production jobs in queue. When customer orders with 3D parts are placed, jobs will appear here automatically.</td></tr>';
        return;
    }

    tbody.innerHTML = productionJobs.map(job => {
        const stageColors = {
            'Order Received': '#6b7280',
            'Preparing': '#3b82f6',
            'Printing': '#059669',
            'Finishing': '#8b5cf6',
            'Quality Check': '#f59e0b',
            'Ready': '#10b981',
            'Completed': '#111827',
            'Failed': '#ef4444',
            'Cancelled': '#991b1b'
        };
        const color = stageColors[job.stage] || '#000';
        const updatedDate = job.updated_at ? new Date(job.updated_at).toLocaleDateString('en-IN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';

        return `
            <tr>
                <td><strong>#3DJ-${job.id}</strong></td>
                <td><code>#${job.order_number || job.order_id || 'N/A'}</code></td>
                <td><strong>${job.item_name || '3D Printed Part'}</strong></td>
                <td><span class="status-badge" style="background:#7c3aed; color:#fff;">${job.material_name || 'PLA'}</span></td>
                <td>${job.finishing_name || 'Raw Print'}</td>
                <td>${job.assigned_printer ? `🖨️ ${job.assigned_printer}` : '<em style="color:#888;">Unassigned</em>'}</td>
                <td><span class="status-badge" style="background:${color}; color:#fff;">${job.stage}</span></td>
                <td><small style="color:#666;">${updatedDate}</small></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        ${job.stage !== 'Completed' && job.stage !== 'Failed' && job.stage !== 'Cancelled' ? `<button class="retro-btn advance-job-btn" data-id="${job.id}" style="padding:2px 6px; font-size:0.75rem; background:#059669; color:#fff;">NEXT ⏩</button>` : ''}
                        <button class="retro-btn update-job-btn" data-id="${job.id}" style="padding:2px 6px; font-size:0.75rem;">UPDATE</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.advance-job-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const jobId = btn.getAttribute('data-id');
            try {
                const res = await apiClient.post(`/admin/production-jobs/${jobId}/advance`);
                showToast(`Job #3DJ-${jobId} advanced to stage: ${res.data?.stage || 'Next Stage'}`);
                await refreshProductionJobsFromAPI(activeProdJobStage);
            } catch (err) {
                showToast(`Failed to advance job: ${err.message}`, 'error');
            }
        });
    });

    tbody.querySelectorAll('.update-job-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const jobId = btn.getAttribute('data-id');
            openProductionJobModal(jobId);
        });
    });
}

function openProductionJobModal(jobId) {
    const job = productionJobs.find(j => String(j.id) === String(jobId));
    if (!job) return;

    const modal = document.getElementById('production-job-modal');
    if (!modal) return;

    document.getElementById('job-modal-id').value = job.id;
    document.getElementById('job-modal-title').textContent = `[UPDATE 3D JOB #3DJ-${job.id}: ${job.item_name || ''}]`;
    document.getElementById('job-modal-stage').value = job.stage || 'Order Received';
    document.getElementById('job-modal-machine').value = job.assigned_printer || '';
    document.getElementById('job-modal-time').value = job.print_time_minutes || '';
    document.getElementById('job-modal-weight').value = job.weight_grams || '';
    document.getElementById('job-modal-notes').value = job.notes || '';

    modal.style.display = 'block';
    modal.scrollIntoView({ behavior: 'smooth' });
}

async function saveProductionJobModal() {
    const jobId = document.getElementById('job-modal-id')?.value;
    const stage = document.getElementById('job-modal-stage')?.value;
    const machine = document.getElementById('job-modal-machine')?.value.trim();
    const timeMins = Number(document.getElementById('job-modal-time')?.value) || null;
    const weightGrams = Number(document.getElementById('job-modal-weight')?.value) || null;
    const notes = document.getElementById('job-modal-notes')?.value.trim();

    if (!jobId || !stage) return;

    const saveBtn = document.getElementById('save-job-modal-btn');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "UPDATING..."; }

    try {
        await apiClient.put(`/admin/production-jobs/${jobId}/stage`, {
            stage,
            assigned_printer: machine,
            print_time_minutes: timeMins,
            weight_grams: weightGrams,
            notes
        });
        showToast(`Job #3DJ-${jobId} updated to ${stage}.`);
        document.getElementById('production-job-modal').style.display = 'none';
        await refreshProductionJobsFromAPI(activeProdJobStage);
    } catch (err) {
        showToast(`Error updating job: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText || "UPDATE JOB"; }
    }
}

// --- CUSTOM 3D REQUESTS (5-STAGE WORKFLOW) ---
function renderCustomRequestsTable() {
    const tbody = document.getElementById('custom-requests-tbody');
    if (!tbody) return;

    if (customRequests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:15px; color:#666;">No custom 3D printing requests in queue.</td></tr>';
        return;
    }

    tbody.innerHTML = customRequests.map(req => {
        const statusColors = {
            'Pending Review': '#f59e0b',
            'In Review': '#3b82f6',
            'Quoted': '#8b5cf6',
            'Approved': '#059669',
            'Order Created': '#111827',
            'Rejected': '#ef4444'
        };
        const badgeColor = statusColors[req.status] || '#555';
        const fileLink = req.model_file_url ? `<a href="${req.model_file_url}" target="_blank" style="color:#2563eb; text-decoration:underline;"><code>${req.model_file_name || 'Download Model'}</code></a>` : (req.model_file_name || 'N/A');
        const quoteText = req.quoted_price ? `<strong>₹${(Number(req.quoted_price) / 100).toFixed(0)}</strong>` : '<em style="color:#888;">Pending</em>';
        const createdDate = req.created_at ? new Date(req.created_at).toISOString().slice(0, 10) : '-';

        return `
            <tr>
                <td><strong>#CR-${req.id}</strong></td>
                <td>${req.customer_name || 'Customer'}<br><small style="color:#666;">${req.customer_email || ''}</small></td>
                <td>${fileLink}</td>
                <td>${req.requested_material || 'PLA'} / ${req.requested_finishing || 'Raw'}</td>
                <td>${req.dimensions_mm || '-'}<br><small style="color:#666;">${req.volume_cm3 ? req.volume_cm3 + ' cm³' : ''}</small></td>
                <td>${quoteText}</td>
                <td><span class="status-badge" style="background:${badgeColor}; color:#fff;">${req.status}</span></td>
                <td><small style="color:#666;">${createdDate}</small></td>
                <td>
                    <button class="retro-btn retro-btn-primary review-req-btn" data-id="${req.id}" style="padding:2px 8px; font-size:0.75rem;">REVIEW & QUOTE</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.review-req-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const reqId = btn.getAttribute('data-id');
            openCustomRequestModal(reqId);
        });
    });
}

function openCustomRequestModal(reqId) {
    const req = customRequests.find(r => String(r.id) === String(reqId));
    if (!req) return;

    const modal = document.getElementById('custom-request-modal');
    if (!modal) return;

    document.getElementById('quote-modal-id').value = req.id;
    document.getElementById('quote-modal-title').textContent = `[CUSTOM REQUEST #CR-${req.id}: ${req.customer_name || 'Customer'}]`;

    const infoBox = document.getElementById('quote-modal-info');
    if (infoBox) {
        infoBox.innerHTML = `
            <div><strong>Customer:</strong> ${req.customer_name || ''} (${req.customer_email || ''} | ${req.customer_phone || 'N/A'})</div>
            <div><strong>Requested Specs:</strong> Material: <b>${req.requested_material || 'Any'}</b> | Color: <b>${req.requested_color || 'Standard'}</b> | Infill: <b>${req.infill_pct ? req.infill_pct + '%' : 'Default'}</b> | Finishing: <b>${req.requested_finishing || 'Raw'}</b></div>
            <div><strong>File:</strong> <code>${req.model_file_name || 'No file'}</code> ${req.model_file_url ? `[<a href="${req.model_file_url}" target="_blank">Download Asset</a>]` : ''}</div>
            ${req.notes ? `<div><strong>Customer Notes:</strong> <em>"${req.notes}"</em></div>` : ''}
            <div><strong>Current Workflow Stage:</strong> <span class="status-badge status-live">${req.status}</span></div>
        `;
    }

    document.getElementById('quote-price').value = req.quoted_price ? Math.round(Number(req.quoted_price) / 100) : '';
    document.getElementById('quote-time-hours').value = req.print_time_hours || '';
    document.getElementById('quote-weight').value = req.material_weight_grams || '';
    document.getElementById('quote-lead-days').value = req.lead_time_days || 3;
    document.getElementById('quote-admin-notes').value = req.admin_notes || '';

    modal.style.display = 'block';
    modal.scrollIntoView({ behavior: 'smooth' });
}

async function submitCustomQuotation() {
    const reqId = document.getElementById('quote-modal-id')?.value;
    const priceRupees = Number(document.getElementById('quote-price')?.value);
    const printTimeHours = Number(document.getElementById('quote-time-hours')?.value) || null;
    const materialWeight = Number(document.getElementById('quote-weight')?.value) || null;
    const leadTimeDays = Number(document.getElementById('quote-lead-days')?.value) || 3;
    const adminNotes = document.getElementById('quote-admin-notes')?.value.trim();

    if (!reqId || !priceRupees || priceRupees <= 0) {
        showToast("Please enter a valid quoted price in ₹!", "error");
        return;
    }

    const saveBtn = document.getElementById('submit-quote-btn');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SENDING..."; }

    try {
        await apiClient.put(`/admin/custom-requests/${reqId}/quote`, {
            quoted_price: priceRupees * 100, // paise
            print_time_hours: printTimeHours,
            material_weight_grams: materialWeight,
            lead_time_days: leadTimeDays,
            admin_notes: adminNotes
        });
        showToast(`Quotation of ₹${priceRupees} sent for Request #CR-${reqId}.`);
        document.getElementById('custom-request-modal').style.display = 'none';
        await refreshCustomRequestsFromAPI(activeCustomReqStatus);
    } catch (err) {
        showToast(`Error saving quotation: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText || "SUBMIT QUOTATION"; }
    }
}

async function convertCustomRequestToOrder() {
    const reqId = document.getElementById('quote-modal-id')?.value;
    if (!reqId) return;

    showConfirmModal("CONVERT TO LIVE ORDER", `Convert Custom Request #CR-${reqId} into an official paid production order?`, async () => {
        try {
            const res = await apiClient.post(`/admin/custom-requests/${reqId}/convert-to-order`);
            showToast(`Custom request converted to Order #${res.data?.order_number || res.data?.order_id || 'OK'}!`);
            document.getElementById('custom-request-modal').style.display = 'none';
            await refreshCustomRequestsFromAPI(activeCustomReqStatus);
            await refreshProductionJobsFromAPI();
            await refreshOrdersFromAPI();
        } catch (err) {
            showToast(`Conversion failed: ${err.message}`, 'error');
        }
    });
}

async function rejectCustomRequest() {
    const reqId = document.getElementById('quote-modal-id')?.value;
    if (!reqId) return;

    showConfirmModal("REJECT REQUEST", `Reject Custom Request #CR-${reqId}?`, async () => {
        try {
            await apiClient.patch(`/admin/custom-requests/${reqId}/status`, { status: 'Rejected' });
            showToast(`Request #CR-${reqId} rejected.`);
            document.getElementById('custom-request-modal').style.display = 'none';
            await refreshCustomRequestsFromAPI(activeCustomReqStatus);
        } catch (err) {
            showToast(`Error rejecting request: ${err.message}`, 'error');
        }
    });
}

// =============================================================================
// 10B. CHIPAKK: PRODUCTION-MATERIAL INVENTORY & STOCK MOVEMENTS (STORE 1 ONLY)
// =============================================================================

async function refreshChipakkMaterialsFromAPI() {
    try {
        const res = await apiClient.get('/admin/production-inventory/materials');
        const raw = res?.data || (Array.isArray(res) ? res : []);
        chipakkMaterials = Array.isArray(raw) ? raw : [];
        renderChipakkMaterialsTable();
        updateChipakkInventoryKPIs();
        populateChipakkMaterialSelects();
    } catch (err) {
        console.warn('[refreshChipakkMaterialsFromAPI]', err.message);
    }
}

function updateChipakkInventoryKPIs() {
    const totalCountEl = document.getElementById('stat-chipakk-mat-count');
    const lowCountEl = document.getElementById('stat-chipakk-mat-low');
    const valueEl = document.getElementById('stat-chipakk-mat-value');
    const banner = document.getElementById('chipakk-mat-alert-banner');
    const bannerText = document.getElementById('chipakk-mat-alert-text');

    if (!totalCountEl) return;

    const totalCount = chipakkMaterials.length;
    const lowStockItems = chipakkMaterials.filter(m => m.is_low_stock && m.is_active);
    const lowCount = lowStockItems.length;

    let totalValuePaise = 0;
    chipakkMaterials.forEach(m => {
        if (m.is_active) {
            totalValuePaise += (Number(m.stock) || 0) * (Number(m.cost) || 0);
        }
    });

    totalCountEl.textContent = totalCount;
    lowCountEl.textContent = lowCount;
    if (valueEl) valueEl.textContent = '₹' + Math.round(totalValuePaise / 100).toLocaleString('en-IN');

    if (lowCount > 0 && banner && bannerText) {
        banner.style.display = 'block';
        bannerText.textContent = `${lowCount} material(s) at or below safety reorder threshold: ${lowStockItems.map(m => `${m.name} (${m.stock} ${m.unit})`).join(', ')}`;
    } else if (banner) {
        banner.style.display = 'none';
    }
}

function populateChipakkMaterialSelects() {
    // 1. Types filter
    const typeSelect = document.getElementById('chipakk-mat-type-filter');
    if (typeSelect) {
        const currentVal = typeSelect.value;
        const types = [...new Set(chipakkMaterials.map(m => m.type).filter(Boolean))];
        typeSelect.innerHTML = '<option value="">All Material Types</option>' + types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        typeSelect.value = currentVal;
    }

    // 2. Movement material dropdown
    const movSelect = document.getElementById('chipakk-mov-material');
    if (movSelect) {
        const cur = movSelect.value;
        movSelect.innerHTML = '<option value="">-- Choose Material --</option>' + chipakkMaterials.filter(m => m.is_active).map(m => {
            return `<option value="${m.id}" data-unit="${escapeHtml(m.unit)}" data-stock="${m.stock}" data-safety="${m.safety_stock}" data-cost="${(m.cost / 100).toFixed(2)}">${escapeHtml(m.name)} (${escapeHtml(m.sku || 'No SKU')}) - ${m.stock} ${escapeHtml(m.unit)}</option>`;
        }).join('');
        if (cur) movSelect.value = cur;
    }

    // 3. History filter dropdown
    const histSelect = document.getElementById('chipakk-hist-mat-filter');
    if (histSelect) {
        const cur = histSelect.value;
        histSelect.innerHTML = '<option value="">All Materials</option>' + chipakkMaterials.map(m => {
            return `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.sku || 'No SKU')})</option>`;
        }).join('');
        if (cur) histSelect.value = cur;
    }
}

function renderChipakkMaterialsTable() {
    const tbody = document.getElementById('chipakk-materials-tbody');
    if (!tbody) return;

    const query = (document.getElementById('chipakk-mat-search')?.value || '').toLowerCase().trim();
    const filterType = document.getElementById('chipakk-mat-type-filter')?.value || '';
    const lowOnly = document.getElementById('chipakk-mat-low-filter')?.checked || false;

    const filtered = chipakkMaterials.filter(m => {
        const matchQ = !query ||
            (m.name || '').toLowerCase().includes(query) ||
            (m.sku || '').toLowerCase().includes(query) ||
            (m.type || '').toLowerCase().includes(query) ||
            (m.supplier || '').toLowerCase().includes(query);
        const matchT = !filterType || m.type === filterType;
        const matchL = !lowOnly || m.is_low_stock;
        return matchQ && matchT && matchL;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 25px; color: #666;">No production materials match your filters. Click "+ ADD MATERIAL" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(m => {
        const isLow = m.is_low_stock;
        const isAct = m.is_active;
        const costDisp = m.cost_rupees || (m.cost ? (m.cost / 100).toFixed(2) : '0.00');

        return `
            <tr style="${!isAct ? 'opacity: 0.6; background: #fafafa;' : ''}">
                <td><code style="font-weight: 700; background: #f3f4f6; padding: 2px 6px; border: 1px solid #ddd;">${escapeHtml(m.sku || '—')}</code></td>
                <td>
                    <strong>${escapeHtml(m.name)}</strong>
                </td>
                <td><span class="status-badge" style="background: #3b82f6; color: #fff;">${escapeHtml(m.type)}</span></td>
                <td>${escapeHtml(m.color || '—')}</td>
                <td>
                    <span style="font-weight: 900; font-size: 1rem; color: ${isLow ? '#dc2626' : '#059669'};">
                        ${Number(m.stock).toLocaleString()} ${escapeHtml(m.unit)}
                    </span>
                    ${isLow ? '<span class="status-badge status-inactive" style="margin-left: 4px; font-size: 0.68rem;">LOW</span>' : ''}
                </td>
                <td>${Number(m.safety_stock).toLocaleString()} ${escapeHtml(m.unit)}</td>
                <td>${Number(m.reorder_quantity).toLocaleString()} ${escapeHtml(m.unit)}</td>
                <td>₹${costDisp}</td>
                <td>${escapeHtml(m.supplier || '—')}</td>
                <td>
                    <span class="status-badge ${isAct ? 'status-live' : 'status-inactive'}">
                        ${isAct ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap;">
                        <button class="retro-btn chipakk-record-mov-btn" data-id="${m.id}" title="Record Stock Movement" style="padding: 2px 8px; font-size: 0.72rem; background: #f59e0b; color: #000; font-weight: bold;">⚡ MOVE</button>
                        <button class="retro-btn chipakk-edit-mat-btn" data-id="${m.id}" title="Edit Material" style="padding: 2px 8px; font-size: 0.72rem;">✏️ EDIT</button>
                        <button class="retro-btn chipakk-toggle-mat-btn" data-id="${m.id}" data-active="${isAct ? '1' : '0'}" title="${isAct ? 'Deactivate' : 'Activate'}" style="padding: 2px 6px; font-size: 0.72rem; background: ${isAct ? '#fee2e2' : '#dcfce7'}; color: ${isAct ? '#991b1b' : '#166534'};">
                            ${isAct ? 'DEACT' : 'ACT'}
                        </button>
                        <button class="retro-btn chipakk-view-hist-btn" data-id="${m.id}" title="View Movement History" style="padding: 2px 6px; font-size: 0.72rem;">📜</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Wire up row buttons
    tbody.querySelectorAll('.chipakk-record-mov-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = chipakkMaterials.find(x => String(x.id) === btn.getAttribute('data-id'));
            openChipakkMovementModal(m);
        });
    });

    tbody.querySelectorAll('.chipakk-edit-mat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = chipakkMaterials.find(x => String(x.id) === btn.getAttribute('data-id'));
            openChipakkMaterialModal(m);
        });
    });

    tbody.querySelectorAll('.chipakk-toggle-mat-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const currentActive = btn.getAttribute('data-active') === '1';
            const m = chipakkMaterials.find(x => String(x.id) === String(id));
            const confirmMsg = currentActive
                ? `Deactivate material "${m?.name || id}"? It will not appear in production stock forms.`
                : `Reactivate material "${m?.name || id}"?`;
            if (!confirm(confirmMsg)) return;

            try {
                if (currentActive) {
                    await apiClient.delete(`/admin/production-inventory/materials/${id}`);
                } else {
                    await apiClient.put(`/admin/production-inventory/materials/${id}`, { active: true });
                }
                showToast(`Material status updated successfully`);
                await refreshChipakkMaterialsFromAPI();
            } catch (err) {
                showToast(`Failed to update material: ${err.message}`, 'error');
            }
        });
    });

    tbody.querySelectorAll('.chipakk-view-hist-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            openChipakkHistoryModal(id);
        });
    });
}

function openChipakkMaterialModal(material = null) {
    const modal = document.getElementById('modal-chipakk-material');
    const title = document.getElementById('chipakk-mat-modal-title');
    const idInput = document.getElementById('chipakk-mat-id');
    const nameInput = document.getElementById('chipakk-mat-name');
    const skuInput = document.getElementById('chipakk-mat-sku');
    const typeInput = document.getElementById('chipakk-mat-type');
    const colorInput = document.getElementById('chipakk-mat-color');
    const unitSelect = document.getElementById('chipakk-mat-unit');
    const stockInput = document.getElementById('chipakk-mat-stock');
    const stockWrap = document.getElementById('chipakk-mat-initial-stock-wrap');
    const costInput = document.getElementById('chipakk-mat-cost');
    const safetyInput = document.getElementById('chipakk-mat-safety-stock');
    const reorderInput = document.getElementById('chipakk-mat-reorder-qty');
    const supplierInput = document.getElementById('chipakk-mat-supplier');
    const activeCheck = document.getElementById('chipakk-mat-active');

    if (!modal) return;

    if (material) {
        title.textContent = `[EDIT PRODUCTION MATERIAL: ${material.sku || material.name}]`;
        idInput.value = material.id;
        nameInput.value = material.name || '';
        skuInput.value = material.sku || '';
        typeInput.value = material.type || 'Vinyl';
        colorInput.value = material.color || '';
        unitSelect.value = material.unit || 'meters';
        if (stockWrap) stockWrap.style.display = 'none';
        costInput.value = material.cost ? (Number(material.cost) / 100).toFixed(2) : '0.00';
        safetyInput.value = material.safety_stock || 0;
        reorderInput.value = material.reorder_quantity || 0;
        supplierInput.value = material.supplier || '';
        activeCheck.checked = material.is_active;
    } else {
        title.textContent = '[ADD NEW PRODUCTION MATERIAL]';
        idInput.value = '';
        nameInput.value = '';
        skuInput.value = '';
        typeInput.value = 'Vinyl';
        colorInput.value = '';
        unitSelect.value = 'meters';
        if (stockWrap) stockWrap.style.display = 'block';
        if (stockInput) stockInput.value = '0.00';
        costInput.value = '0.00';
        safetyInput.value = '50';
        reorderInput.value = '100';
        supplierInput.value = '';
        activeCheck.checked = true;
    }

    modal.style.display = 'flex';
}

function closeChipakkMaterialModal() {
    const modal = document.getElementById('modal-chipakk-material');
    if (modal) modal.style.display = 'none';
}

async function saveChipakkMaterial(e) {
    if (e && e.preventDefault) e.preventDefault();
    const id = document.getElementById('chipakk-mat-id')?.value;
    const name = document.getElementById('chipakk-mat-name')?.value.trim();
    const sku = document.getElementById('chipakk-mat-sku')?.value.trim();
    const type = document.getElementById('chipakk-mat-type')?.value.trim();
    const color = document.getElementById('chipakk-mat-color')?.value.trim();
    const unit = document.getElementById('chipakk-mat-unit')?.value;
    const costRupees = parseFloat(document.getElementById('chipakk-mat-cost')?.value || '0');
    const safetyStock = parseFloat(document.getElementById('chipakk-mat-safety-stock')?.value || '0');
    const reorderQuantity = parseFloat(document.getElementById('chipakk-mat-reorder-qty')?.value || '0');
    const supplier = document.getElementById('chipakk-mat-supplier')?.value.trim();
    const active = document.getElementById('chipakk-mat-active')?.checked;

    if (!name || !type || !unit) {
        showToast('Name, type, and unit are required fields', 'error');
        return;
    }

    const payload = {
        name,
        sku: sku || undefined,
        type,
        color: color || null,
        unit,
        cost: Math.round(costRupees * 100),
        safety_stock: safetyStock,
        reorder_quantity: reorderQuantity,
        supplier: supplier || null,
        active: active ? 1 : 0
    };

    const saveBtn = document.getElementById('btn-save-chipakk-mat');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'SAVING...'; }

    try {
        if (id) {
            await apiClient.put(`/admin/production-inventory/materials/${id}`, payload);
            showToast(`Material "${name}" updated successfully`);
        } else {
            const initialStock = parseFloat(document.getElementById('chipakk-mat-stock')?.value || '0');
            payload.stock = initialStock;
            await apiClient.post('/admin/production-inventory/materials', payload);
            showToast(`Material "${name}" created successfully`);
        }
        closeChipakkMaterialModal();
        await refreshChipakkMaterialsFromAPI();
    } catch (err) {
        showToast(`Failed to save material: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'SAVE MATERIAL'; }
    }
}

function openChipakkMovementModal(material = null) {
    const modal = document.getElementById('modal-chipakk-movement');
    const matSelect = document.getElementById('chipakk-mov-material');
    const typeSelect = document.getElementById('chipakk-mov-type');
    const dirWrap = document.getElementById('chipakk-mov-direction-wrap');
    const qtyInput = document.getElementById('chipakk-mov-qty');
    const costInput = document.getElementById('chipakk-mov-cost');
    const refInput = document.getElementById('chipakk-mov-ref');
    const notesInput = document.getElementById('chipakk-mov-notes');
    const infoBox = document.getElementById('chipakk-mov-current-info');
    const curStockEl = document.getElementById('chipakk-mov-cur-stock');
    const curSafetyEl = document.getElementById('chipakk-mov-cur-safety');
    const unitLabel = document.getElementById('chipakk-mov-unit-label');

    if (!modal) return;

    populateChipakkMaterialSelects();

    if (material) {
        matSelect.value = material.id;
        if (infoBox) {
            infoBox.style.display = 'block';
            if (curStockEl) curStockEl.textContent = `${material.stock} ${material.unit}`;
            if (curSafetyEl) curSafetyEl.textContent = `${material.safety_stock} ${material.unit}`;
        }
        if (unitLabel) unitLabel.textContent = `(${material.unit})`;
        if (costInput && material.cost) costInput.value = (material.cost / 100).toFixed(2);
    } else {
        matSelect.value = '';
        if (infoBox) infoBox.style.display = 'none';
        if (unitLabel) unitLabel.textContent = '';
        if (costInput) costInput.value = '';
    }

    typeSelect.value = 'PURCHASE';
    if (dirWrap) dirWrap.style.display = 'none';
    qtyInput.value = '';
    refInput.value = '';
    notesInput.value = '';

    modal.style.display = 'flex';
}

function closeChipakkMovementModal() {
    const modal = document.getElementById('modal-chipakk-movement');
    if (modal) modal.style.display = 'none';
}

async function saveChipakkMovement(e) {
    if (e && e.preventDefault) e.preventDefault();
    const materialId = document.getElementById('chipakk-mov-material')?.value;
    const type = document.getElementById('chipakk-mov-type')?.value;
    const direction = document.getElementById('chipakk-mov-direction')?.value || 'add';
    const quantity = parseFloat(document.getElementById('chipakk-mov-qty')?.value || '0');
    const costRupees = parseFloat(document.getElementById('chipakk-mov-cost')?.value || '0');
    const referenceId = document.getElementById('chipakk-mov-ref')?.value.trim();
    const notes = document.getElementById('chipakk-mov-notes')?.value.trim();

    if (!materialId) {
        showToast('Please select a material', 'error');
        return;
    }
    if (!quantity || isNaN(quantity) || quantity <= 0) {
        showToast('Quantity must be greater than 0', 'error');
        return;
    }

    const payload = {
        materialId: parseInt(materialId, 10),
        type,
        quantity,
        direction: type === 'ADJUSTMENT' ? direction : undefined,
        costPerUnit: costRupees > 0 ? Math.round(costRupees * 100) : undefined,
        referenceId: referenceId || undefined,
        notes: notes || undefined
    };

    const saveBtn = document.getElementById('btn-save-chipakk-mov');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'RECORDING...'; }

    try {
        const res = await apiClient.post('/admin/production-inventory/movements', payload);
        const resultingStock = res?.data?.movement?.resulting_stock ?? res?.data?.material?.stock;
        showToast(`Stock updated! New balance: ${resultingStock}`);
        closeChipakkMovementModal();
        await refreshChipakkMaterialsFromAPI();
    } catch (err) {
        showToast(`Stock movement failed: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'RECORD MOVEMENT'; }
    }
}

async function openChipakkHistoryModal(materialId = null) {
    const modal = document.getElementById('modal-chipakk-movement-history');
    if (!modal) return;

    populateChipakkMaterialSelects();

    const matFilter = document.getElementById('chipakk-hist-mat-filter');
    if (matFilter) {
        matFilter.value = materialId ? String(materialId) : '';
    }

    modal.style.display = 'flex';
    await refreshChipakkMovements();
}

function closeChipakkHistoryModal() {
    const modal = document.getElementById('modal-chipakk-movement-history');
    if (modal) modal.style.display = 'none';
}

async function refreshChipakkMovements() {
    const tbody = document.getElementById('chipakk-history-tbody');
    if (!tbody) return;

    const materialId = document.getElementById('chipakk-hist-mat-filter')?.value || '';
    const type = document.getElementById('chipakk-hist-type-filter')?.value || '';

    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #666;">Loading movement history...</td></tr>';

    try {
        const queryParams = { limit: 100 };
        if (materialId) queryParams.materialId = materialId;
        if (type) queryParams.type = type;

        const res = await apiClient.get('/admin/production-inventory/movements', queryParams);
        const data = res?.data || res;
        const movements = data?.movements || [];

        const countEl = document.getElementById('stat-chipakk-movements-count');
        if (countEl && data?.total !== undefined) {
            countEl.textContent = data.total;
        }

        if (movements.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 25px; color: #666;">No stock movements recorded yet.</td></tr>';
            return;
        }

        const typeColors = {
            PURCHASE: '#059669',
            CONSUMPTION: '#2563eb',
            WASTE: '#dc2626',
            ADJUSTMENT: '#d97706',
            RETURN: '#7c3aed'
        };

        tbody.innerHTML = movements.map(mv => {
            const isAddition = mv.type === 'PURCHASE' || mv.type === 'RETURN' || (mv.resulting_stock > mv.previous_stock);
            const deltaSign = isAddition ? '+' : '-';
            const deltaColor = isAddition ? '#059669' : '#dc2626';
            const dt = mv.created_at ? new Date(mv.created_at).toLocaleString() : '—';

            return `
                <tr>
                    <td style="font-size: 0.8rem; white-space: nowrap;">${dt}</td>
                    <td>
                        <strong>${escapeHtml(mv.material_name || 'Material #' + mv.material_id)}</strong>
                        ${mv.material_sku ? `<br><small style="color: #666;">${escapeHtml(mv.material_sku)}</small>` : ''}
                    </td>
                    <td>
                        <span class="status-badge" style="background: ${typeColors[mv.type] || '#666'}; color: #fff;">
                            ${escapeHtml(mv.type)}
                        </span>
                    </td>
                    <td>
                        <span style="font-weight: 700; color: ${deltaColor};">
                            ${deltaSign}${Number(mv.quantity).toLocaleString()} ${escapeHtml(mv.material_unit || '')}
                        </span>
                    </td>
                    <td style="font-size: 0.82rem;">
                        ${Number(mv.previous_stock).toLocaleString()} ➔ <strong>${Number(mv.resulting_stock).toLocaleString()}</strong>
                    </td>
                    <td><code style="font-size: 0.78rem;">${escapeHtml(mv.reference_id || '—')}</code></td>
                    <td style="font-size: 0.8rem; color: #555;">${escapeHtml(mv.created_by || 'admin')}</td>
                    <td style="font-size: 0.8rem; max-width: 200px; word-break: break-word;">${escapeHtml(mv.notes || '—')}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: #dc2626;">Failed to load history: ${escapeHtml(err.message)}</td></tr>`;
    }
}

// =============================================================================
// 11. VISUAL STORE BUILDER MANAGEMENT (LEGACY)
// =============================================================================

function renderStoreBuilder() {
    // 1. Populate Announcement Bar controls
    if (announcementBarConfig) {
        const textInput = document.getElementById('announcement-text-input');
        const activeSelect = document.getElementById('announcement-active-toggle');
        const speedSelect = document.getElementById('announcement-speed-select');
        const prevText = document.getElementById('announcement-preview-text');
        if (textInput && announcementBarConfig.text !== undefined) textInput.value = announcementBarConfig.text;
        if (activeSelect && announcementBarConfig.enabled !== undefined) activeSelect.value = String(announcementBarConfig.enabled);
        if (speedSelect && announcementBarConfig.marquee_speed) speedSelect.value = announcementBarConfig.marquee_speed;
        if (prevText && announcementBarConfig.text) prevText.textContent = announcementBarConfig.text;
    }

    // 2. Populate Hero Mode & Fixed Banner controls
    const activeHeroMode = heroConfig?.mode || 'fixed';
    if (typeof window.__chipakk_toggle_hero_mode === 'function') {
        window.__chipakk_toggle_hero_mode(activeHeroMode);
    }

    if (heroConfig?.fixed_banner) {
        const fb = heroConfig.fixed_banner;
        const eyebrowEnable = document.getElementById('hero-opt-eyebrow-enable');
        const eyebrowText = document.getElementById('hero-opt-eyebrow-text');
        const titleEnable = document.getElementById('hero-opt-title-enable');
        const titleText = document.getElementById('hero-opt-title-text');
        const descEnable = document.getElementById('hero-opt-desc-enable');
        const descText = document.getElementById('hero-opt-desc-text');
        const btn1Enable = document.getElementById('hero-opt-btn1-enable');
        const btn1Text = document.getElementById('hero-opt-btn1-text');
        const btn1Url = document.getElementById('hero-opt-btn1-url');
        const btn2Enable = document.getElementById('hero-opt-btn2-enable');
        const btn2Text = document.getElementById('hero-opt-btn2-text');
        const btn2Url = document.getElementById('hero-opt-btn2-url');
        const imgUrl = document.getElementById('hero-fixed-image-url');
        const prevImg = document.getElementById('hero-fixed-preview-img');
        const noImg = document.getElementById('hero-fixed-no-img');

        if (eyebrowEnable && fb.show_eyebrow !== undefined) eyebrowEnable.checked = Boolean(fb.show_eyebrow);
        if (eyebrowText && fb.eyebrow !== undefined) eyebrowText.value = fb.eyebrow;
        if (titleEnable && fb.show_title !== undefined) titleEnable.checked = Boolean(fb.show_title);
        if (titleText && fb.title !== undefined) titleText.value = fb.title;
        if (descEnable && fb.show_description !== undefined) descEnable.checked = Boolean(fb.show_description);
        if (descText && fb.description !== undefined) descText.value = fb.description;
        if (btn1Enable && fb.show_primary_btn !== undefined) btn1Enable.checked = Boolean(fb.show_primary_btn);
        if (btn1Text && fb.primary_btn_text !== undefined) btn1Text.value = fb.primary_btn_text;
        if (btn1Url && fb.primary_btn_url !== undefined) btn1Url.value = fb.primary_btn_url;
        if (btn2Enable && fb.show_secondary_btn !== undefined) btn2Enable.checked = Boolean(fb.show_secondary_btn);
        if (btn2Text && fb.secondary_btn_text !== undefined) btn2Text.value = fb.secondary_btn_text;
        if (btn2Url && fb.secondary_btn_url !== undefined) btn2Url.value = fb.secondary_btn_url;
        if (imgUrl && fb.image_url !== undefined) {
            imgUrl.value = fb.image_url;
            if (prevImg) {
                prevImg.src = fb.image_url;
                prevImg.style.display = fb.image_url ? 'block' : 'none';
            }
            if (noImg) {
                noImg.style.display = fb.image_url ? 'none' : 'block';
            }
        }
    }

    if (typeof window.__chipakk_update_hero_live_preview === 'function') {
        window.__chipakk_update_hero_live_preview();
    }

    renderHeroGroupsList();
    renderPromoBannersList();
    renderStoreSectionsList();
}

function renderHeroGroupsList() {
    const container = document.getElementById('hero-slides-container');
    if (!container) return;

    container.innerHTML = heroGroups.map(group => `
        <div class="retro-panel" style="background:#fff; margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid #000; padding-bottom:8px; margin-bottom:10px;">
                <h4 style="margin:0; font-weight:900;">${group.group_name}</h4>
                <div style="display:flex; gap:6px;">
                    <span class="status-badge ${group.active ? 'status-live' : 'status-inactive'}">${group.active ? 'ACTIVE HERO' : 'INACTIVE'}</span>
                    <button class="retro-btn toggle-hero-group-btn" data-id="${group.id}" style="padding:2px 6px; font-size:0.75rem;">ACTIVATE</button>
                </div>
            </div>
            <div class="slides-list" style="display:flex; flex-direction:column; gap:8px;">
                ${(group.slides || []).map(slide => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#f9f9f9; padding:8px; border:1px solid #ddd;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <img src="${slide.image_url}" style="width:40px; height:40px; object-fit:cover; border:1px solid #000;">
                            <div>
                                <strong>${slide.title}</strong><br>
                                <small style="color:#666;">${slide.subtitle || ''}</small>
                            </div>
                        </div>
                        <span class="status-badge status-live">${slide.cta_text || 'CTA'}</span>
                    </div>
                `).join('') || '<small>No slides in this hero group.</small>'}
            </div>
        </div>
    `).join('') || '<p>No hero groups created.</p>';

    container.querySelectorAll('.toggle-hero-group-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const gId = Number(btn.getAttribute('data-id'));
            heroGroups.forEach(g => g.active = (g.id === gId));
            renderHeroGroupsList();
            try {
                await apiClient.put('/admin/store-builder', { hero_groups: heroGroups, promo_banners: promoBanners, sections: storeSections });
                showToast("Active hero banner group updated.");
            } catch (err) {
                showToast(`Error updating store builder: ${err.message}`, 'error');
            }
        });
    });
}

function openHeroSlideForm(groupId) {
    const container = document.getElementById('hero-slide-form-container');
    if (!container) return;
    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

function saveHeroSlideForm() {
    const title = document.getElementById('hero-slide-title')?.value.trim();
    const subtitle = document.getElementById('hero-slide-sub')?.value.trim();
    const imgUrl = document.getElementById('hero-slide-img')?.value.trim();
    const ctaText = document.getElementById('hero-slide-cta')?.value.trim();
    const ctaLink = document.getElementById('hero-slide-link')?.value.trim();

    if (!title) {
        showToast("Hero slide title is required!", "error");
        return;
    }

    const activeGroup = heroGroups.find(g => g.active) || heroGroups[0];
    if (activeGroup) {
        activeGroup.slides = activeGroup.slides || [];
        activeGroup.slides.push({
            id: `slide-${Date.now()}`,
            title,
            subtitle,
            image_url: imgUrl || "https://img.icons8.com/color/300/000000/sticker.png",
            cta_text: ctaText || "SHOP NOW",
            cta_link: ctaLink || "#catalog",
            active: true,
            order: activeGroup.slides.length + 1
        });
    }

    document.getElementById('hero-slide-form-container').style.display = 'none';
    saveStoreBuilder();
}

function renderPromoBannersList() {
    const container = document.getElementById('promo-banners-container');
    if (!container) return;

    container.innerHTML = promoBanners.map(b => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:10px; border:2px solid #000; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:12px;">
                <img src="${b.image_url}" style="width:50px; height:50px; object-fit:cover; border:1px solid #000;">
                <div>
                    <strong style="font-size:0.9rem;">${b.headline}</strong><br>
                    <small style="color:#666;">${b.subtitle} | Placement: ${b.placement}</small>
                </div>
            </div>
            <span class="status-badge ${b.active ? 'status-live' : 'status-inactive'}">${b.active ? 'LIVE' : 'OFF'}</span>
        </div>
    `).join('') || '<p>No promotional banners configured.</p>';
}

function savePromoBannerForm() {
    const headline = document.getElementById('banner-title')?.value.trim();
    const subtitle = document.getElementById('banner-sub')?.value.trim();
    const imgUrl = document.getElementById('banner-img')?.value.trim();

    if (!headline) {
        showToast("Banner headline is required!", "error");
        return;
    }

    promoBanners.push({
        id: Date.now(),
        headline,
        subtitle: subtitle || '',
        image_url: imgUrl || "https://img.icons8.com/color/150/000000/discount.png",
        cta_text: "SHOP NOW",
        cta_link: "#catalog",
        placement: "Homepage Top",
        active: true
    });

    document.getElementById('banner-form-container').style.display = 'none';
    saveStoreBuilder();
}

function renderStoreSectionsList() {
    const container = document.getElementById('store-blocks-container');
    if (!container) return;

    container.innerHTML = storeSections.map((sec, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:10px; border:2px solid #000; margin-bottom:8px;">
            <div>
                <strong>#${sec.order || idx + 1} — ${sec.name}</strong>
            </div>
            <span class="status-badge ${sec.active ? 'status-live' : 'status-inactive'}">${sec.active ? 'ENABLED' : 'DISABLED'}</span>
        </div>
    `).join('');
}

async function saveStoreBuilder() {
    try {
        await apiClient.put('/admin/store-builder', {
            hero_groups: heroGroups,
            promo_banners: promoBanners,
            sections: storeSections
        });
        showToast("Store Builder layout published successfully.");
        await refreshStoreBuilderFromAPI();
    } catch (err) {
        showToast(`Error publishing Store Builder layout: ${err.message}`, 'error');
    }
}

// =============================================================================
// 11. REVIEWS & COMMUNITY MODERATION
// =============================================================================

function renderReviewsTable() {
    const tbody = document.getElementById('reviews-tbody');
    if (!tbody) return;

    tbody.innerHTML = reviews.map(r => `
        <tr>
            <td><span class="admin-id-highlight">${r.admin_id}</span></td>
            <td><strong>${r.product_name}</strong></td>
            <td>${r.customer_name}</td>
            <td>${formatRatingDisplay(r.rating)}</td>
            <td><small>"${r.comment}"</small></td>
            <td><small>${r.date}</small></td>
            <td><span class="status-badge ${r.status === 'Approved' ? 'status-live' : (r.status === 'Rejected' ? 'status-inactive' : 'status-upcoming')}">${r.status.toUpperCase()}</span></td>
            <td>
                <div style="display:flex; gap:4px;">
                    ${r.status !== 'Approved' ? `<button class="retro-btn approve-rev-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem; background:#059669; color:#fff;">APPROVE</button>` : ''}
                    ${r.status !== 'Rejected' ? `<button class="retro-btn reject-rev-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">REJECT</button>` : ''}
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8">No customer reviews to display.</td></tr>';

    tbody.querySelectorAll('.approve-rev-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const revId = btn.getAttribute('data-id');
            try {
                await apiClient.put(`/admin/reviews/${revId}`, { status: 'approved' });
                showToast(`Review Approved! Product rating recalculated.`);
                await refreshReviewsFromAPI();
            } catch (err) {
                showToast(`Error approving review: ${err.message}`, 'error');
            }
        });
    });

    tbody.querySelectorAll('.reject-rev-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const revId = btn.getAttribute('data-id');
            try {
                await apiClient.put(`/admin/reviews/${revId}`, { status: 'rejected' });
                showToast(`Review Hidden.`);
                await refreshReviewsFromAPI();
            } catch (err) {
                showToast(`Error rejecting review: ${err.message}`, 'error');
            }
        });
    });
}

// =============================================================================
// 12. TEAM MEMBERS MANAGEMENT
// =============================================================================

function renderTeamMembersTable() {
    const tbody = document.getElementById('team-tbody');
    if (!tbody) return;

    tbody.innerHTML = teamMembers.map(m => `
        <tr>
            <td><strong>${m.name || m.email.split('@')[0]}</strong></td>
            <td>${m.email}</td>
            <td><span class="status-badge" style="background:#7c3aed; color:#fff;">${m.role}</span></td>
            <td><small>${(m.permissions || ['Catalog', 'Orders', 'Production']).join(', ')}</small></td>
            <td><span class="status-badge ${m.active ? 'status-live' : 'status-inactive'}">${m.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
            <td>
                <button class="retro-btn toggle-team-btn" data-id="${m.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6">No team members found in database.</td></tr>';

    tbody.querySelectorAll('.toggle-team-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const m = teamMembers.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (!m) return;
            const newActive = !m.active;
            try {
                await apiClient.put(`/admin/team/${m.id}/status`, { active: newActive });
                m.active = newActive;
                renderTeamMembersTable();
                showToast(`Team member ${m.email} set to ${newActive ? 'Active' : 'Inactive'}`);
                await refreshAuditLogsFromAPI();
            } catch (err) {
                showToast(`Error updating team member: ${err.message}`, 'error');
            }
        });
    });
}

async function refreshTeamFromAPI() {
    try {
        const res = await apiClient.get('/admin/team');
        const rawTeam = res?.data?.team || res?.team || (Array.isArray(res?.data) ? res.data : []);
        if (Array.isArray(rawTeam)) {
            teamMembers = rawTeam;
            renderTeamMembersTable();
        }
    } catch (err) {
        console.warn('[refreshTeamFromAPI error]', err.message);
    }
}

async function saveTeamMemberForm() {
    const email = document.getElementById('team-email')?.value.trim();
    const role = document.getElementById('team-role')?.value;

    if (!email) {
        showToast("Valid email address is required!", "error");
        return;
    }

    const saveBtn = document.getElementById('save-team-btn');
    const origText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'SAVING...'; }

    try {
        await apiClient.post('/admin/team', { email, role });
        showToast(`Team member '${email}' added to database.`);
        document.getElementById('team-form-container').style.display = 'none';
        await refreshTeamFromAPI();
        await refreshAuditLogsFromAPI();
    } catch (err) {
        showToast(`Error adding team member: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = origText || 'SAVE MEMBER'; }
    }
}

// =============================================================================
// ACTIVE SESSIONS & LIVE LOGIN MANAGEMENT
// =============================================================================

function renderActiveSessionsTable() {
    const tbody = document.getElementById('active-sessions-tbody');
    const badge = document.getElementById('active-sessions-count-badge');
    const pills = document.getElementById('audit-active-sessions-pills');

    if (badge) {
        badge.textContent = `${activeSessions.length} ACTIVE`;
        badge.className = `status-badge ${activeSessions.length > 0 ? 'status-live' : 'status-inactive'}`;
    }

    if (pills) {
        if (activeSessions.length === 0) {
            pills.innerHTML = '<span style="color:#888;">No active sessions currently online</span>';
        } else {
            pills.innerHTML = activeSessions.map(s => `
                <span class="status-badge status-live" style="margin-right: 6px; font-size: 0.75rem;">
                    🟢 ${s.name || s.email} (${s.role || 'ADMIN'})
                </span>
            `).join('');
        }
    }

    if (!tbody) return;

    if (activeSessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #888; padding: 18px;">No active sessions found in database. All administrators are currently logged out or expired.</td></tr>';
        return;
    }

    tbody.innerHTML = activeSessions.map(s => {
        const isSelf = s.is_current || (auth?.currentUser && auth.currentUser.uid === s.firebase_uid);
        const loginStr = s.login_time ? new Date(s.login_time).toLocaleString() : 'N/A';
        const lastActStr = s.last_activity ? new Date(s.last_activity).toLocaleTimeString() : 'N/A';
        const expiresStr = s.expires_at ? new Date(s.expires_at).toLocaleTimeString() : '1 hour inactivity';

        return `
            <tr style="${isSelf ? 'background: #f0fdf4;' : ''}">
                <td>
                    <strong>${s.name || s.email.split('@')[0]}</strong>
                    ${isSelf ? '<span class="status-badge" style="background:#000; color:#fff; font-size:0.65rem; margin-left:6px;">YOU (CURRENT)</span>' : ''}
                </td>
                <td>${s.email}</td>
                <td><span class="status-badge" style="background:#7c3aed; color:#fff;">${s.role || 'ADMIN'}</span></td>
                <td><small>${loginStr}</small></td>
                <td><small style="font-weight:bold; color:#2563eb;">${lastActStr}</small></td>
                <td><span class="status-badge status-live">ACTIVE</span></td>
                <td><small style="color:#d97706;">${expiresStr}</small></td>
                <td>
                    <button class="retro-btn terminate-session-btn" data-id="${s.id}" data-email="${s.email}" style="padding:2px 8px; font-size:0.75rem; background:#ef4444; color:#fff; border-color:#000;">
                        ${isSelf ? 'LOGOUT' : 'FORCE LOGOUT'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.terminate-session-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const sid = btn.getAttribute('data-id');
            const email = btn.getAttribute('data-email');
            const isSelf = btn.textContent.includes('LOGOUT') && !btn.textContent.includes('FORCE');

            showConfirmModal(
                'TERMINATE ADMIN SESSION',
                `Are you sure you want to terminate session #${sid} for ${email}?`,
                async () => {
                    try {
                        await apiClient.post(`/admin/active-sessions/${sid}/terminate`);
                        showToast(`Session #${sid} terminated.`);
                        await refreshActiveSessionsFromAPI();
                        await refreshAuditLogsFromAPI();
                        if (isSelf) {
                            signOut(auth);
                        }
                    } catch (err) {
                        showToast(`Failed to terminate session: ${err.message}`, 'error');
                    }
                }
            );
        });
    });
}

async function refreshActiveSessionsFromAPI() {
    try {
        const res = await apiClient.get('/admin/active-sessions');
        const rawSessions = res?.data?.sessions || res?.sessions || (Array.isArray(res?.data) ? res.data : []);
        if (Array.isArray(rawSessions)) {
            activeSessions = rawSessions;
            renderActiveSessionsTable();
        }
    } catch (err) {
        console.warn('[refreshActiveSessionsFromAPI error]', err.message);
    }
}

// =============================================================================
// 13. AUDIT LOGS RETRIEVAL
// =============================================================================

function renderAuditLogs() {
    const container = document.getElementById('audit-logs-container');
    if (!container) return;

    container.innerHTML = auditLogs.map(l => {
        const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString() : 'N/A';
        let actionBadge = '';
        const act = String(l.action || '').toLowerCase();
        if (act.includes('admin.login')) {
            actionBadge = '<span class="status-badge status-live" style="font-size:0.68rem; margin-right:4px;">LOGIN</span>';
        } else if (act.includes('admin.logout')) {
            actionBadge = '<span class="status-badge" style="background:#6b7280; color:#fff; font-size:0.68rem; margin-right:4px;">LOGOUT</span>';
        } else if (act.includes('session_expired')) {
            actionBadge = '<span class="status-badge" style="background:#f59e0b; color:#000; font-size:0.68rem; margin-right:4px;">SESSION EXPIRED</span>';
        } else if (act.includes('session_terminated')) {
            actionBadge = '<span class="status-badge status-inactive" style="font-size:0.68rem; margin-right:4px;">TERMINATED</span>';
        }

        return `
            <div style="font-family:monospace; font-size:0.82rem; border-bottom:1px solid #eee; padding:6px 0; display:flex; align-items:center; flex-wrap:wrap; gap:6px;">
                <span style="color:#666; font-size:0.75rem;">[${dateStr}]</span>
                ${actionBadge}
                <strong style="color:#2563eb;">${l.actor}:</strong>
                <span>${l.action}</span>
            </div>
        `;
    }).join('') || '<div style="font-family:monospace; font-size:0.8rem; color:#888;">No system audit logs recorded.</div>';
}

async function refreshAuditLogsFromAPI() {
    try {
        const res = await apiClient.get('/admin/audit-logs');
        const rawLogs = res?.data?.auditLogs || res?.auditLogs || res?.data?.logs || (Array.isArray(res?.data) ? res.data : []);
        if (Array.isArray(rawLogs)) {
            auditLogs = rawLogs.map(a => ({
                timestamp: a.created_at || a.timestamp || new Date().toISOString(),
                actor: a.actor_email || a.admin_email || a.actor_id || a.actor || 'SYSTEM',
                action: `${a.action || ''} ${a.entity_type ? '(' + a.entity_type + ' #' + (a.entity_id || '') + ')' : ''}`.trim()
            }));
            renderAuditLogs();
        }
    } catch (err) {
        console.warn('[refreshAuditLogs Error]', err.message);
    }
}

function writeAuditLog(actor, action) {
    auditLogs.unshift({ timestamp: new Date().toISOString(), actor, action });
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('admin-toast');
    const toastText = document.getElementById('admin-toast-text');
    if (!toast || !toastText) return;

    let text = message;
    if (message instanceof Error) {
        text = message.message;
    } else if (typeof message === 'object' && message !== null) {
        text = message.message || message.error || JSON.stringify(message);
    }
    toastText.textContent = String(text || 'Action completed');
    toast.style.borderLeft = type === 'error' ? '6px solid var(--error-color)' : '6px solid var(--success-color)';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

function showConfirmModal(title, msg, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;

    document.getElementById('confirm-modal-title').textContent = `[${title}]`;
    document.getElementById('confirm-modal-msg').textContent = msg;
    modal.style.display = 'flex';

    const yesBtn = document.getElementById('confirm-modal-yes-btn');
    const noBtn = document.getElementById('confirm-modal-no-btn');

    const cleanUp = () => {
        modal.style.display = 'none';
        yesBtn.replaceWith(yesBtn.cloneNode(true));
        noBtn.replaceWith(noBtn.cloneNode(true));
    };

    document.getElementById('confirm-modal-yes-btn').onclick = () => { cleanUp(); onConfirm(); };
    document.getElementById('confirm-modal-no-btn').onclick = () => { cleanUp(); };
}

// =============================================================================
// GLOBAL SEARCH & EVENT LISTENERS
// =============================================================================

function handleGlobalSearch(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return;

    const matchingOrders = orders.filter(o => o.order_id.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q) || (o.tracking_no || '').toLowerCase().includes(q));
    const matchingCusts = customers.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));

    showToast(`Search for '${q}' returned ${matchingOrders.length} orders, ${matchingCusts.length} customers.`);
}

function loadSystemSettings() {
    if (document.getElementById('set-store-name')) document.getElementById('set-store-name').value = siteSettings.store_name || '';
    if (document.getElementById('set-support-email')) document.getElementById('set-support-email').value = siteSettings.business_email || siteSettings.support_email || '';
    if (document.getElementById('set-support-phone')) document.getElementById('set-support-phone').value = siteSettings.support_phone || '';
    if (document.getElementById('set-trade-name')) document.getElementById('set-trade-name').value = siteSettings.trade_name || '';
    if (document.getElementById('set-gst-enabled')) document.getElementById('set-gst-enabled').value = String(siteSettings.gst_enabled !== false);
    if (document.getElementById('set-invoice-prefix')) document.getElementById('set-invoice-prefix').value = siteSettings.invoice_prefix || '';
    if (document.getElementById('set-custom-hsn')) document.getElementById('set-custom-hsn').value = siteSettings.custom_sticker_hsn_code || '';
    if (document.getElementById('set-custom-gst-rate')) document.getElementById('set-custom-gst-rate').value = siteSettings.custom_sticker_gst_rate === undefined || siteSettings.custom_sticker_gst_rate === null ? '' : siteSettings.custom_sticker_gst_rate;
    loadLegalSupplierPanel();
    if (document.getElementById('set-gst-rate')) document.getElementById('set-gst-rate').value = siteSettings.gst_pct !== undefined ? siteSettings.gst_pct : (siteSettings.gst_rate || 18);
    if (document.getElementById('set-currency')) document.getElementById('set-currency').value = siteSettings.currency_symbol || '₹ (INR)';
    if (document.getElementById('set-order-prefix')) document.getElementById('set-order-prefix').value = siteSettings.order_prefix || 'CHP-';
    if (document.getElementById('set-default-rating')) document.getElementById('set-default-rating').value = siteSettings.default_rating || 4.7;

    if (document.getElementById('set-store-status')) document.getElementById('set-store-status').value = siteSettings.store_status || 'OPEN';
    if (document.getElementById('set-maintenance-active')) document.getElementById('set-maintenance-active').value = String(siteSettings.maintenance_active === true || siteSettings.maintenance_active === 'true');
    if (document.getElementById('set-maintenance-msg')) document.getElementById('set-maintenance-msg').value = siteSettings.maintenance_message || siteSettings.maintenance_msg || '';

    const maintImgInput = document.getElementById('set-maintenance-image');
    const maintPrevBox = document.getElementById('set-maintenance-image-preview-box');
    const maintPrevImg = document.getElementById('set-maintenance-image-preview-img');
    const maintImgVal = siteSettings.maintenance_image || '';
    if (maintImgInput) maintImgInput.value = maintImgVal;
    if (maintPrevBox && maintPrevImg) {
        if (maintImgVal) {
            const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
            maintPrevImg.src = maintImgVal.startsWith('http') ? maintImgVal : (apiHost + maintImgVal);
            maintPrevBox.style.display = 'block';
        } else {
            maintPrevBox.style.display = 'none';
        }
    }

    if (document.getElementById('set-orders-accepting')) {
        const accepting = siteSettings.orders_accepting !== undefined
            ? (siteSettings.orders_accepting === true || siteSettings.orders_accepting === 'true')
            : (siteSettings.order_acceptance !== 'PAUSED');
        document.getElementById('set-orders-accepting').value = String(accepting);
    }
    if (document.getElementById('set-orders-paused-msg')) document.getElementById('set-orders-paused-msg').value = siteSettings.orders_paused_msg || '';

    // Store-Specific Shipping Policies
    const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    const isMarshans = activeStoreId === 2;

    const shippingFeeInput = document.getElementById('set-shipping-fee');
    if (shippingFeeInput) {
        shippingFeeInput.value = siteSettings.shipping_fee !== undefined
            ? (activeStoreId === 1 ? Math.round(Number(siteSettings.shipping_fee)) : Math.round(Number(siteSettings.shipping_fee) / 100))
            : (isMarshans ? 100 : 50);
    }

    const freeShippingSelect = document.getElementById('set-free-shipping-enabled');
    const freeShippingThresholdField = document.getElementById('set-free-shipping-threshold-field');
    const freeShippingThresholdInput = document.getElementById('set-free-shipping-threshold');
    const freeShippingNote = document.getElementById('set-free-shipping-note');

    if (freeShippingSelect) {
        if (isMarshans) {
            freeShippingSelect.value = 'false';
            freeShippingSelect.disabled = true;
            if (freeShippingThresholdField) freeShippingThresholdField.style.display = 'none';
            if (freeShippingNote) freeShippingNote.style.display = 'block';
        } else {
            freeShippingSelect.disabled = false;
            freeShippingSelect.value = String(siteSettings.free_shipping_enabled !== undefined ? siteSettings.free_shipping_enabled : true);
            if (freeShippingThresholdField) freeShippingThresholdField.style.display = 'block';
            if (freeShippingNote) freeShippingNote.style.display = 'none';
            if (freeShippingThresholdInput) {
                freeShippingThresholdInput.value = siteSettings.free_shipping_threshold !== undefined
                    ? (activeStoreId === 1 ? Math.round(Number(siteSettings.free_shipping_threshold)) : Math.round(Number(siteSettings.free_shipping_threshold) / 100))
                    : 300;
            }
        }
    }

    // Announcement Ticker
    if (document.getElementById('set-announcement')) {
        document.getElementById('set-announcement').value = siteSettings.announcement_text || '';
    }
    if (document.getElementById('set-announcement-active')) {
        document.getElementById('set-announcement-active').value = String(siteSettings.announcement_active === true || siteSettings.announcement_active === 'true');
    }

    // 3D Manufacturing Controls (THE MARSHANS)
    const panel3D = document.getElementById('panel-3d-settings');
    if (panel3D) {
        panel3D.style.display = isMarshans ? 'flex' : 'none';
        if (isMarshans) {
            const matSettings = siteSettings.material_settings || {};
            const prodSettings = siteSettings.production_settings || {};
            const quoteSettings = siteSettings.quotation_settings || {};

            if (document.getElementById('set-3d-default-infill')) {
                document.getElementById('set-3d-default-infill').value = matSettings.default_infill || 20;
            }
            if (document.getElementById('set-3d-auto-assign')) {
                document.getElementById('set-3d-auto-assign').value = String(prodSettings.auto_assign_printers === true);
            }
            if (document.getElementById('set-3d-quote-multiplier')) {
                document.getElementById('set-3d-quote-multiplier').value = quoteSettings.auto_quote_multiplier || 2.5;
            }
            if (document.getElementById('set-3d-quote-validity')) {
                document.getElementById('set-3d-quote-validity').value = quoteSettings.quote_validity_days || 14;
            }
        }
    }
}

function setupEventListeners() {
    // Sales Chart Toggle Pills & Sync
    document.querySelectorAll('.chart-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-mode') || 'all';
            document.querySelectorAll('.chart-toggle-btn').forEach(b => {
                b.classList.remove('is-active');
                b.style.background = 'transparent';
                b.style.color = '#000';
            });
            btn.classList.add('is-active');
            btn.style.background = '#000';
            btn.style.color = '#fff';
            renderSalesChart(mode);
        });
    });

    document.getElementById('refresh-chart-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('refresh-chart-btn');
        if (btn) btn.textContent = 'SYNCING...';
        try {
            const filterVal = document.getElementById('analytics-date-filter')?.value || 'last_6_months';
            await refreshDashboardFromAPI(filterVal);
            showToast("Sales comparison chart synchronized with real database.");
        } catch (err) {
            showToast(`Refreshed chart error: ${err.message}`, 'error');
        } finally {
            if (btn) btn.textContent = '↻ SYNC';
        }
    });

    window.addEventListener('resize', () => {
        renderSalesChart();
    });

    // Mobile Sidebar Drawer Toggle & Backdrop
    const mobileMenuBtn = document.getElementById('admin-mobile-toggle');
    const sidebarEl = document.querySelector('.admin-sidebar');
    const backdropEl = document.getElementById('admin-sidebar-backdrop');
    const closeSidebarBtn = document.getElementById('close-admin-sidebar-btn');

    if (mobileMenuBtn && sidebarEl) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebarEl.classList.toggle('open');
            if (backdropEl) {
                backdropEl.style.display = sidebarEl.classList.contains('open') ? 'block' : 'none';
            }
        });
    }

    if (backdropEl && sidebarEl) {
        backdropEl.addEventListener('click', () => {
            sidebarEl.classList.remove('open');
            backdropEl.style.display = 'none';
        });
    }

    if (closeSidebarBtn && sidebarEl) {
        closeSidebarBtn.addEventListener('click', () => {
            sidebarEl.classList.remove('open');
            if (backdropEl) backdropEl.style.display = 'none';
        });
    }

    // Store Builder Hero Mode Switcher
    window.__chipakk_toggle_hero_mode = function(mode) {
        const fixedBtn = document.getElementById('hero-toggle-fixed');
        const carouselBtn = document.getElementById('hero-toggle-carousel');
        const fixedPanel = document.getElementById('hero-fixed-panel');
        const carouselPanel = document.getElementById('hero-carousel-panel');
        const fixedBadge = document.getElementById('hero-fixed-status-badge');
        const carouselBadge = document.getElementById('hero-carousel-status-badge');

        if (mode === 'fixed') {
            if (fixedBtn) {
                fixedBtn.classList.add('is-active');
                fixedBtn.style.background = '#000';
                fixedBtn.style.color = '#fff';
                fixedBtn.textContent = '[✓] FIXED BANNER';
            }
            if (carouselBtn) {
                carouselBtn.classList.remove('is-active');
                carouselBtn.style.background = 'transparent';
                carouselBtn.style.color = '#000';
                carouselBtn.textContent = '[ ] CAROUSEL SLIDER';
            }
            if (fixedPanel) fixedPanel.style.display = 'block';
            if (carouselPanel) carouselPanel.style.display = 'none';
            if (fixedBadge) {
                fixedBadge.textContent = 'ACTIVE MODE';
                fixedBadge.className = 'status-badge status-live';
            }
            if (carouselBadge) {
                carouselBadge.textContent = 'INACTIVE MODE';
                carouselBadge.className = 'status-badge status-inactive';
            }
        } else {
            if (carouselBtn) {
                carouselBtn.classList.add('is-active');
                carouselBtn.style.background = '#000';
                carouselBtn.style.color = '#fff';
                carouselBtn.textContent = '[✓] CAROUSEL SLIDER';
            }
            if (fixedBtn) {
                fixedBtn.classList.remove('is-active');
                fixedBtn.style.background = 'transparent';
                fixedBtn.style.color = '#000';
                fixedBtn.textContent = '[ ] FIXED BANNER';
            }
            if (fixedPanel) fixedPanel.style.display = 'none';
            if (carouselPanel) carouselPanel.style.display = 'block';
            if (fixedBadge) {
                fixedBadge.textContent = 'INACTIVE MODE';
                fixedBadge.className = 'status-badge status-inactive';
            }
            if (carouselBadge) {
                carouselBadge.textContent = 'ACTIVE MODE';
                carouselBadge.className = 'status-badge status-live';
            }
        }
        if (typeof window.__chipakk_update_hero_live_preview === 'function') {
            window.__chipakk_update_hero_live_preview();
        }
    };

    document.getElementById('hero-toggle-fixed')?.addEventListener('click', async () => {
        window.__chipakk_toggle_hero_mode('fixed');
        try {
            await apiClient.put('/admin/store-builder', { hero_mode: 'fixed' });
            showToast("Store Hero set to FIXED BANNER mode.");
        } catch (err) {
            console.warn('[Hero Mode Error]', err.message);
        }
    });

    document.getElementById('hero-toggle-carousel')?.addEventListener('click', async () => {
        window.__chipakk_toggle_hero_mode('carousel');
        try {
            await apiClient.put('/admin/store-builder', { hero_mode: 'carousel' });
            showToast("Store Hero set to CAROUSEL SLIDER mode.");
        } catch (err) {
            console.warn('[Hero Mode Error]', err.message);
        }
    });

    // Fixed Hero Live Preview & Input Handlers
    window.__chipakk_update_hero_live_preview = function() {
        const eyebrowEnable = document.getElementById('hero-opt-eyebrow-enable')?.checked ?? true;
        const eyebrowText = document.getElementById('hero-opt-eyebrow-text')?.value || '';
        const titleEnable = document.getElementById('hero-opt-title-enable')?.checked ?? true;
        const titleText = document.getElementById('hero-opt-title-text')?.value || '';
        const descEnable = document.getElementById('hero-opt-desc-enable')?.checked ?? true;
        const descText = document.getElementById('hero-opt-desc-text')?.value || '';
        const btn1Enable = document.getElementById('hero-opt-btn1-enable')?.checked ?? true;
        const btn1Text = document.getElementById('hero-opt-btn1-text')?.value || 'Shop Now →';
        const btn1Url = document.getElementById('hero-opt-btn1-url')?.value || 'shop.html';
        const btn2Enable = document.getElementById('hero-opt-btn2-enable')?.checked ?? true;
        const btn2Text = document.getElementById('hero-opt-btn2-text')?.value || 'Custom Stickers';
        const btn2Url = document.getElementById('hero-opt-btn2-url')?.value || 'custom-stickers.html';
        const imgUrl = document.getElementById('hero-fixed-image-url')?.value.trim() || '/uploads/hero-banner-1.png';

        const prevEyebrow = document.getElementById('preview-hero-eyebrow');
        if (prevEyebrow) {
            prevEyebrow.style.display = eyebrowEnable ? 'inline-block' : 'none';
            prevEyebrow.textContent = eyebrowText;
        }
        const prevTitle = document.getElementById('preview-hero-title');
        if (prevTitle) {
            prevTitle.style.display = titleEnable ? 'block' : 'none';
            prevTitle.textContent = titleText;
        }
        const prevDesc = document.getElementById('preview-hero-desc');
        if (prevDesc) {
            prevDesc.style.display = descEnable ? 'block' : 'none';
            prevDesc.textContent = descText;
        }
        const prevBtn1 = document.getElementById('preview-hero-btn1');
        if (prevBtn1) {
            prevBtn1.style.display = btn1Enable ? 'inline-block' : 'none';
            prevBtn1.textContent = btn1Text;
            prevBtn1.href = btn1Url;
        }
        const prevBtn2 = document.getElementById('preview-hero-btn2');
        if (prevBtn2) {
            prevBtn2.style.display = btn2Enable ? 'inline-block' : 'none';
            prevBtn2.textContent = btn2Text;
            prevBtn2.href = btn2Url;
        }
        const prevImg = document.getElementById('preview-hero-img');
        if (prevImg) {
            prevImg.src = imgUrl;
        }
    };

    [
        'hero-opt-eyebrow-enable', 'hero-opt-eyebrow-text',
        'hero-opt-title-enable', 'hero-opt-title-text',
        'hero-opt-desc-enable', 'hero-opt-desc-text',
        'hero-opt-btn1-enable', 'hero-opt-btn1-text', 'hero-opt-btn1-url',
        'hero-opt-btn2-enable', 'hero-opt-btn2-text', 'hero-opt-btn2-url'
    ].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('input', window.__chipakk_update_hero_live_preview);
        el?.addEventListener('change', window.__chipakk_update_hero_live_preview);
    });

    // Fixed Hero Image Upload
    document.getElementById('hero-fixed-upload-btn')?.addEventListener('click', () => {
        document.getElementById('hero-fixed-image-file')?.click();
    });

    document.getElementById('hero-fixed-image-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const statusEl = document.getElementById('hero-fixed-upload-status');
        if (statusEl) statusEl.textContent = 'Uploading...';

        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await apiClient.upload('/admin/upload', fd);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const urlInput = document.getElementById('hero-fixed-image-url');
                const prevImg = document.getElementById('hero-fixed-preview-img');
                const noImg = document.getElementById('hero-fixed-no-img');
                if (urlInput) urlInput.value = uploadedUrl;
                if (prevImg) {
                    prevImg.src = uploadedUrl;
                    prevImg.style.display = 'block';
                }
                if (noImg) noImg.style.display = 'none';
                window.__chipakk_update_hero_live_preview();
                if (statusEl) statusEl.textContent = '✓ Uploaded';
                showToast("Hero banner image uploaded successfully.");
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = 'Upload failed';
            showToast(`Upload failed: ${err.message}`, 'error');
        }
    });

    document.getElementById('hero-fixed-image-url')?.addEventListener('input', (e) => {
        const url = e.target.value.trim();
        const prevImg = document.getElementById('hero-fixed-preview-img');
        const noImg = document.getElementById('hero-fixed-no-img');
        if (url) {
            if (prevImg) { prevImg.src = url; prevImg.style.display = 'block'; }
            if (noImg) noImg.style.display = 'none';
        } else {
            if (prevImg) prevImg.style.display = 'none';
            if (noImg) noImg.style.display = 'block';
        }
        window.__chipakk_update_hero_live_preview();
    });

    // Save Fixed Hero Button
    document.getElementById('save-hero-fixed-btn')?.addEventListener('click', async () => {
        const fixedBanner = {
            image_url: document.getElementById('hero-fixed-image-url')?.value.trim() || '',
            show_eyebrow: document.getElementById('hero-opt-eyebrow-enable')?.checked ?? true,
            eyebrow: document.getElementById('hero-opt-eyebrow-text')?.value.trim() || '',
            show_title: document.getElementById('hero-opt-title-enable')?.checked ?? true,
            title: document.getElementById('hero-opt-title-text')?.value.trim() || '',
            show_description: document.getElementById('hero-opt-desc-enable')?.checked ?? true,
            description: document.getElementById('hero-opt-desc-text')?.value.trim() || '',
            show_primary_btn: document.getElementById('hero-opt-btn1-enable')?.checked ?? true,
            primary_btn_text: document.getElementById('hero-opt-btn1-text')?.value.trim() || '',
            primary_btn_url: document.getElementById('hero-opt-btn1-url')?.value.trim() || '',
            show_secondary_btn: document.getElementById('hero-opt-btn2-enable')?.checked ?? true,
            secondary_btn_text: document.getElementById('hero-opt-btn2-text')?.value.trim() || '',
            secondary_btn_url: document.getElementById('hero-opt-btn2-url')?.value.trim() || ''
        };

        const btn = document.getElementById('save-hero-fixed-btn');
        const origText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'SAVING...'; }
        try {
            await apiClient.put('/admin/store-builder', {
                hero_mode: 'fixed',
                hero_config: {
                    mode: 'fixed',
                    fixed_banner: fixedBanner
                }
            });
            showToast("Fixed Hero Banner saved and published!");
        } catch (err) {
            showToast(`Error saving hero banner: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = origText || '💾 SAVE FIXED HERO BANNER'; }
        }
    });

    // Carousel Slide Image Upload
    document.getElementById('hero-slide-upload-btn')?.addEventListener('click', () => {
        document.getElementById('hero-slide-file-input')?.click();
    });

    document.getElementById('hero-slide-file-input')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const statusEl = document.getElementById('hero-slide-upload-status');
        if (statusEl) statusEl.textContent = 'Uploading...';

        const fd = new FormData();
        fd.append('file', file);
        try {
            const res = await apiClient.upload('/admin/upload', fd);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const urlInput = document.getElementById('hero-slide-img');
                const prevImg = document.getElementById('hero-slide-preview-img');
                if (urlInput) urlInput.value = uploadedUrl;
                if (prevImg) prevImg.src = uploadedUrl;
                if (statusEl) statusEl.textContent = '✓ Uploaded';
                showToast("Slide image uploaded successfully.");
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = 'Upload failed';
            showToast(`Upload failed: ${err.message}`, 'error');
        }
    });

    document.getElementById('hero-slide-img')?.addEventListener('input', (e) => {
        const prevImg = document.getElementById('hero-slide-preview-img');
        if (prevImg) prevImg.src = e.target.value.trim();
    });

    // Announcement Ticker Live Preview & Save
    document.getElementById('announcement-text-input')?.addEventListener('input', (e) => {
        const prevText = document.getElementById('announcement-preview-text');
        if (prevText) prevText.textContent = e.target.value;
    });

    document.getElementById('save-announcement-btn')?.addEventListener('click', async () => {
        const text = document.getElementById('announcement-text-input')?.value.trim() || '';
        const enabled = document.getElementById('announcement-active-toggle')?.value === 'true';
        const marqueeSpeed = document.getElementById('announcement-speed-select')?.value || 'normal';

        const btn = document.getElementById('save-announcement-btn');
        const origText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'SAVING...'; }
        try {
            await apiClient.put('/admin/store-builder', {
                announcement_bar: {
                    enabled,
                    text,
                    mode: 'MARQUEE',
                    marquee_speed: marqueeSpeed
                }
            });
            showToast("Announcement ticker saved and published!");
        } catch (err) {
            showToast(`Error saving announcement ticker: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = origText || 'SAVE ANNOUNCEMENT TICKER'; }
        }
    });

    document.getElementById('apply-analytics-filter-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('apply-analytics-filter-btn');
        const origText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'APPLYING...'; }
        try {
            const filterVal = document.getElementById('analytics-date-filter')?.value || 'last_6_months';
            await refreshDashboardFromAPI(filterVal);
            showToast(`Analytics timeframe filter (${filterVal.replace(/_/g, ' ')}) applied.`);
        } catch (err) {
            showToast(`Failed to apply analytics filter: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = origText || 'APPLY'; }
        }
    });
    document.getElementById('apply-chart-filter-btn')?.addEventListener('click', () => {
        renderSalesChart();
        showToast("Chart range updated.");
    });

    document.getElementById('global-admin-search')?.addEventListener('input', (e) => handleGlobalSearch(e.target.value));
    document.getElementById('prod-search-input')?.addEventListener('input', renderProductsTable);
    document.getElementById('prod-filter-category')?.addEventListener('change', renderProductsTable);
    document.getElementById('prod-filter-drop-status')?.addEventListener('change', renderProductsTable);
    document.getElementById('prod-reset-filter-btn')?.addEventListener('click', () => {
        document.getElementById('prod-search-input').value = '';
        document.getElementById('prod-filter-category').value = '';
        document.getElementById('prod-filter-drop-status').value = '';
        renderProductsTable();
    });

    document.getElementById('prod-queue-search')?.addEventListener('input', renderProductionQueueTable);

    document.getElementById('prod-queue-chk-header')?.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const allChks = document.querySelectorAll('.prod-queue-item-chk');
        selectedProductionItemIds = [];
        allChks.forEach(chk => {
            chk.checked = checked;
            if (checked) selectedProductionItemIds.push(chk.getAttribute('data-id'));
        });
    });

    document.getElementById('prod-queue-select-all-btn')?.addEventListener('click', () => {
        const allChks = document.querySelectorAll('.prod-queue-item-chk');
        selectedProductionItemIds = [];
        allChks.forEach(chk => {
            chk.checked = true;
            selectedProductionItemIds.push(chk.getAttribute('data-id'));
        });
        showToast(`Selected all ${selectedProductionItemIds.length} visible items.`);
    });

    document.getElementById('prod-queue-batch-apply-btn')?.addEventListener('click', () => {
        const targetStatus = document.getElementById('prod-queue-batch-status').value;
        applyBatchProductionStatus(targetStatus);
    });

    document.getElementById('order-search-input')?.addEventListener('input', renderOrdersTable);
    document.getElementById('order-reset-search-btn')?.addEventListener('click', () => {
        document.getElementById('order-search-input').value = '';
        renderOrdersTable();
    });

    document.getElementById('cust-search-input')?.addEventListener('input', renderCustomersTable);
    document.getElementById('cust-filter-status')?.addEventListener('change', renderCustomersTable);

    document.getElementById('evt-filter-cat')?.addEventListener('change', renderEvtProductChecklist);
    document.getElementById('evt-filter-search')?.addEventListener('input', renderEvtProductChecklist);
    document.getElementById('evt-select-all-btn')?.addEventListener('click', () => {
        selectedEvtProductIds = products.map(p => p.admin_id || p.sku);
        renderEvtProductChecklist();
    });
    document.getElementById('evt-deselect-all-btn')?.addEventListener('click', () => {
        selectedEvtProductIds = [];
        renderEvtProductChecklist();
    });

    document.getElementById('new-prod-btn')?.addEventListener('click', () => openProductForm());
    document.getElementById('cancel-prod-btn')?.addEventListener('click', () => {
        document.getElementById('product-form-container').style.display = 'none';
    });
    document.getElementById('save-prod-btn')?.addEventListener('click', saveProductForm);

    // Product Options & Variants events
    document.getElementById('add-option-group-btn')?.addEventListener('click', () => {
        tempProdOptions.push({ name: '', values: [] });
        renderProductOptionsBuilder();
    });

    document.getElementById('generate-variants-btn')?.addEventListener('click', () => {
        generateVariantsFromOptions();
    });

    const optSec = document.getElementById('prod-dynamic-options-section');
    if (optSec) {
        optSec.addEventListener('click', (e) => {
            const remOptBtn = e.target.closest('.remove-opt-btn');
            if (remOptBtn) {
                const optIdx = Number(remOptBtn.dataset.optIdx);
                tempProdOptions.splice(optIdx, 1);
                renderProductOptionsBuilder();
                return;
            }

            const addValBtn = e.target.closest('.add-val-btn');
            if (addValBtn) {
                const optIdx = Number(addValBtn.dataset.optIdx);
                const card = addValBtn.closest('.option-builder-card');
                const valInput = card?.querySelector('.new-val-input');
                if (valInput && valInput.value.trim()) {
                    const newVal = valInput.value.trim();
                    if (!tempProdOptions[optIdx].values.includes(newVal)) {
                        tempProdOptions[optIdx].values.push(newVal);
                        renderProductOptionsBuilder();
                    }
                }
                return;
            }

            const remValBtn = e.target.closest('.remove-val-btn');
            if (remValBtn) {
                const optIdx = Number(remValBtn.dataset.optIdx);
                const valIdx = Number(remValBtn.dataset.valIdx);
                if (tempProdOptions[optIdx] && tempProdOptions[optIdx].values) {
                    tempProdOptions[optIdx].values.splice(valIdx, 1);
                    renderProductOptionsBuilder();
                }
                return;
            }

            const remVarBtn = e.target.closest('.remove-var-btn');
            if (remVarBtn) {
                const varIdx = Number(remVarBtn.dataset.varIdx);
                syncVariantsFromUI();
                tempProdVariants.splice(varIdx, 1);
                renderProductVariantsMatrix();
                return;
            }
        });

        optSec.addEventListener('change', (e) => {
            if (e.target.classList.contains('opt-name-input')) {
                const optIdx = Number(e.target.dataset.optIdx);
                if (tempProdOptions[optIdx]) {
                    tempProdOptions[optIdx].name = e.target.value.trim();
                }
            } else if (e.target.closest('#prod-variants-list')) {
                syncVariantsFromUI();
            }
        });

        optSec.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.classList.contains('new-val-input')) {
                e.preventDefault();
                const optIdx = Number(e.target.dataset.optIdx);
                const newVal = e.target.value.trim();
                if (newVal && tempProdOptions[optIdx]) {
                    if (!tempProdOptions[optIdx].values.includes(newVal)) {
                        tempProdOptions[optIdx].values.push(newVal);
                        renderProductOptionsBuilder();
                    }
                }
            }
        });
    }

    document.getElementById('add-image-url-btn')?.addEventListener('click', () => {
        const urlInput = document.getElementById('prod-image-url');
        if (urlInput && urlInput.value.trim()) {
            let inputUrl = urlInput.value.trim();
            if (inputUrl.includes('drive.google.com')) {
                const fileIdMatch = inputUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || inputUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
                if (fileIdMatch && fileIdMatch[1]) {
                    inputUrl = `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
                }
            }
            tempProdImages.push({ id: null, url: inputUrl, is_primary: tempProdImages.length === 0 });
            urlInput.value = '';
            renderProdImageGallery();
        }
    });

    document.getElementById('prod-image-file-input')?.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        showToast('Uploading product image...');
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                tempProdImages.push({ id: null, url: uploadedUrl, is_primary: tempProdImages.length === 0 });
                renderProdImageGallery();
                showToast('Product image uploaded successfully');
            } else {
                showToast('Upload returned empty file path', 'error');
            }
        } catch (err) {
            showToast(`Image upload failed: ${err.message}`, 'error');
        } finally {
            e.target.value = '';
        }
    });

    // LUMO Product Form Dynamic Listeners
    document.getElementById('prod-category')?.addEventListener('change', updateLumoProductSectionVisibility);

    document.getElementById('prod-lumo-light-image')?.addEventListener('input', (e) => {
        updateLumoProductPreview('light', e.target.value);
    });

    document.getElementById('prod-lumo-dark-image')?.addEventListener('input', (e) => {
        updateLumoProductPreview('dark', e.target.value);
    });

    document.getElementById('prod-lumo-light-upload-btn')?.addEventListener('click', () => {
        document.getElementById('prod-lumo-light-file')?.click();
    });

    document.getElementById('prod-lumo-light-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uploadBtn = document.getElementById('prod-lumo-light-upload-btn');
        const origText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '...'; }
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const input = document.getElementById('prod-lumo-light-image');
                if (input) input.value = uploadedUrl;
                updateLumoProductPreview('light', uploadedUrl);
                showToast('LUMO light mode image uploaded successfully');
            }
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText || 'UPLOAD'; }
            e.target.value = '';
        }
    });

    document.getElementById('prod-lumo-dark-upload-btn')?.addEventListener('click', () => {
        document.getElementById('prod-lumo-dark-file')?.click();
    });

    document.getElementById('prod-lumo-dark-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uploadBtn = document.getElementById('prod-lumo-dark-upload-btn');
        const origText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '...'; }
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const input = document.getElementById('prod-lumo-dark-image');
                if (input) input.value = uploadedUrl;
                updateLumoProductPreview('dark', uploadedUrl);
                showToast('LUMO dark mode image uploaded successfully');
            }
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText || 'UPLOAD'; }
            e.target.value = '';
        }
    });

    document.getElementById('new-cat-btn')?.addEventListener('click', () => openCategoryForm());
    document.getElementById('cancel-cat-btn')?.addEventListener('click', () => {
        document.getElementById('category-form-container').style.display = 'none';
    });
    document.getElementById('save-cat-btn')?.addEventListener('click', saveCategoryForm);

    document.getElementById('new-event-btn')?.addEventListener('click', () => openEventForm());
    document.getElementById('cancel-event-btn')?.addEventListener('click', () => {
        document.getElementById('event-form-container').style.display = 'none';
    });
    document.getElementById('save-event-btn')?.addEventListener('click', saveEventForm);

    document.getElementById('new-coupon-btn')?.addEventListener('click', () => openCouponForm());
    document.getElementById('cancel-coupon-btn')?.addEventListener('click', () => {
        document.getElementById('coupon-form-container').style.display = 'none';
    });
    document.getElementById('save-coupon-btn')?.addEventListener('click', saveCouponForm);

    document.getElementById('new-team-btn')?.addEventListener('click', () => {
        document.getElementById('team-form-container').style.display = 'block';
    });
    document.getElementById('cancel-team-btn')?.addEventListener('click', () => {
        document.getElementById('team-form-container').style.display = 'none';
    });
    document.getElementById('save-team-btn')?.addEventListener('click', saveTeamMemberForm);

    document.getElementById('new-shipping-btn')?.addEventListener('click', () => openShippingRuleForm());
    document.getElementById('cancel-ship-btn')?.addEventListener('click', () => {
        document.getElementById('shipping-form-container').style.display = 'none';
    });
    document.getElementById('save-ship-btn')?.addEventListener('click', saveShippingRuleForm);
    document.getElementById('calc-order-val')?.addEventListener('input', renderShippingCalculatorPreview);
    document.getElementById('calc-region')?.addEventListener('input', renderShippingCalculatorPreview);

    document.getElementById('new-hero-slide-btn')?.addEventListener('click', () => {
        const activeGroup = heroGroups.find(g => g.active) || heroGroups[0];
        if (activeGroup) openHeroSlideForm(activeGroup.id);
    });
    document.getElementById('save-hero-slide-btn')?.addEventListener('click', saveHeroSlideForm);
    document.getElementById('cancel-hero-slide-btn')?.addEventListener('click', () => {
        document.getElementById('hero-slide-form-container').style.display = 'none';
    });

    document.getElementById('new-banner-btn')?.addEventListener('click', () => {
        document.getElementById('banner-form-container').style.display = 'block';
    });
    document.getElementById('save-banner-btn')?.addEventListener('click', savePromoBannerForm);
    document.getElementById('cancel-banner-btn')?.addEventListener('click', () => {
        document.getElementById('banner-form-container').style.display = 'none';
    });

    document.getElementById('close-order-detail-btn')?.addEventListener('click', () => {
        document.getElementById('order-detail-modal').style.display = 'none';
        activeOrderViewing = null;
    });
    document.getElementById('close-cust-detail-btn')?.addEventListener('click', () => {
        document.getElementById('customer-detail-modal').style.display = 'none';
    });

    document.getElementById('ord-detail-status-select')?.addEventListener('change', async (e) => {
        if (!activeOrderViewing) return;
        const newUIStatus = e.target.value;
        const machineStatus = UI_TO_BACKEND_ORDER_STATUS[newUIStatus] || newUIStatus.toUpperCase();
        try {
            await apiClient.put(`/admin/orders/${activeOrderViewing.id}/status`, { status: machineStatus });
            showToast(`Order status updated to ${newUIStatus}`);
            await refreshOrdersFromAPI();
        } catch (err) {
            showToast(`Error updating order status: ${err.message}`, 'error');
        }
    });

    document.getElementById('save-ord-shipment-btn')?.addEventListener('click', async () => {
        if (!activeOrderViewing) return;
        const courier = document.getElementById('ord-ship-courier').value.trim();
        const trackingNo = document.getElementById('ord-ship-tracking-no').value.trim();
        const shipDate = document.getElementById('ord-ship-date').value;
        const notes = document.getElementById('ord-ship-notes').value;

        const saveBtn = document.getElementById('save-ord-shipment-btn');
        const originalText = saveBtn ? saveBtn.textContent : '';
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

        try {
            await apiClient.put(`/admin/orders/${activeOrderViewing.id}/shipping`, {
                courier,
                tracking_no: trackingNo,
                ship_date: shipDate,
                ship_notes: notes
            });
            showToast(`Courier details saved for Order ${activeOrderViewing.order_id}`);
            await refreshOrdersFromAPI();
        } catch (err) {
            showToast(`Error saving shipment details: ${err.message}`, 'error');
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || "SAVE COURIER & SHIPMENT DETAILS"; }
        }
    });

    document.getElementById('save-announcement-btn')?.addEventListener('click', async () => {
        const payload = {
            announcement_text: document.getElementById('set-announcement')?.value || '',
            announcement_active: document.getElementById('set-announcement-active')?.value === 'true',
            announcement_rolling: document.getElementById('set-announcement-rolling')?.value === 'true'
        };
        try {
            await apiClient.put('/admin/settings', payload);
            showToast("Announcement ticker saved successfully.");
            await refreshSettingsFromAPI();
        } catch (err) {
            showToast(`Error saving announcement: ${err.message}`, 'error');
        }
    });

    document.getElementById('save-business-settings-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('save-business-settings-btn');
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = "SAVING..."; }

        const email = document.getElementById('set-support-email').value.trim();
        const gstRaw = document.getElementById('set-gst-rate')?.value || '0';
        const gstVal = gstRaw === '' || isNaN(Number(gstRaw)) ? 0 : Number(gstRaw);

        const payload = {
            store_name: document.getElementById('set-store-name').value.trim(),
            business_email: email,
            support_email: email,
            support_phone: document.getElementById('set-support-phone').value.trim(),
            // the supplier identity (GSTIN, legal name, address) is saved separately: it is ONE record for both stores
            trade_name: document.getElementById('set-trade-name')?.value.trim() || undefined,
            gst_enabled: false,
            gst_pct: gstVal,
            gst_rate: gstVal,
            default_gst_rate: gstVal,
            invoice_prefix: (document.getElementById('set-invoice-prefix')?.value.trim() || '').toUpperCase() || undefined,
            custom_sticker_hsn_code: document.getElementById('set-custom-hsn')?.value.trim() || '',
            custom_sticker_gst_rate: document.getElementById('set-custom-gst-rate')?.value.trim() || '',
            currency_symbol: document.getElementById('set-currency').value.trim(),
            order_prefix: document.getElementById('set-order-prefix').value.trim(),
            default_rating: Number(document.getElementById('set-default-rating').value) || 4.7
        };

        try {
            await apiClient.put('/admin/settings', payload);
            showToast("Business settings saved successfully.");
            await refreshSettingsFromAPI();
        } catch (err) {
            showToast(`Error saving business settings: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText || "SAVE BUSINESS SETTINGS"; }
        }
    });

    document.getElementById('save-store-ops-settings-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('save-store-ops-settings-btn');
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = "APPLYING..."; }

        const isAccepting = document.getElementById('set-orders-accepting').value === 'true';
        const maintenanceMsg = document.getElementById('set-maintenance-msg').value.trim();
        const maintenanceImage = document.getElementById('set-maintenance-image')?.value.trim() || '';

        const payload = {
            store_status: document.getElementById('set-store-status').value,
            maintenance_active: document.getElementById('set-maintenance-active').value === 'true',
            maintenance_msg: maintenanceMsg,
            maintenance_message: maintenanceMsg,
            maintenance_image: maintenanceImage,
            orders_accepting: isAccepting,
            order_acceptance: isAccepting ? 'ACCEPTING ORDERS' : 'PAUSED',
            orders_paused_msg: document.getElementById('set-orders-paused-msg').value.trim()
        };

        try {
            await apiClient.put('/admin/settings', payload);
            showToast("Store Operations & Maintenance settings applied.");
            await refreshSettingsFromAPI();
        } catch (err) {
            showToast(`Error applying store operations settings: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText || "APPLY STORE OPERATIONS SETTINGS"; }
        }
    });

    // Save Store-Specific Shipping Policies
    document.getElementById('save-shipping-settings-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('save-shipping-settings-btn');
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = "SAVING..."; }

        const activeStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
        const isMarshans = activeStoreId === 2;

        const feeRupees = Math.max(Number(document.getElementById('set-shipping-fee')?.value) || 0, 0);
        const freeEnabled = isMarshans ? false : (document.getElementById('set-free-shipping-enabled')?.value === 'true');
        const thresholdRupees = Math.max(Number(document.getElementById('set-free-shipping-threshold')?.value) || 0, 0);

        const payload = {
            shipping_fee: activeStoreId === 1 ? feeRupees : (feeRupees * 100),
            free_shipping_enabled: freeEnabled,
            free_shipping_threshold: freeEnabled ? (activeStoreId === 1 ? thresholdRupees : (thresholdRupees * 100)) : 0
        };

        try {
            await apiClient.put('/admin/settings', payload);
            showToast(`${isMarshans ? 'THE MARSHANS' : 'CHIPAKK'} shipping policies saved successfully.`);
            await refreshSettingsFromAPI();
        } catch (err) {
            showToast(`Error saving shipping settings: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText || "SAVE STORE SHIPPING SETTINGS"; }
        }
    });

    // Save THE MARSHANS 3D Manufacturing & Quotation Policies
    document.getElementById('save-3d-settings-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('save-3d-settings-btn');
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = "SAVING..."; }

        const payload = {
            material_settings: {
                default_infill: Number(document.getElementById('set-3d-default-infill')?.value) || 20,
                allow_custom_filaments: true,
                min_wall_thickness_mm: 1.2
            },
            production_settings: {
                auto_assign_printers: document.getElementById('set-3d-auto-assign')?.value === 'true',
                qa_inspection_required: true
            },
            quotation_settings: {
                auto_quote_multiplier: Number(document.getElementById('set-3d-quote-multiplier')?.value) || 2.5,
                quote_validity_days: Number(document.getElementById('set-3d-quote-validity')?.value) || 14,
                rush_fee_pct: 30
            }
        };

        try {
            await apiClient.put('/admin/settings', payload);
            showToast("THE MARSHANS 3D manufacturing policies saved successfully.");
            await refreshSettingsFromAPI();
        } catch (err) {
            showToast(`Error saving 3D settings: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText || "SAVE 3D MANUFACTURING POLICIES"; }
        }
    });

    // =========================================================================
    // MULTI-STORE CONTEXT SWITCHER HANDLERS
    // =========================================================================

    function updateStoreSwitcherUI(storeId) {
        const btnChipakk = document.getElementById('switch-store-chipakk');
        const btnMarshans = document.getElementById('switch-store-marshans');
        const badge = document.getElementById('active-store-badge');
        const domain = document.getElementById('active-store-domain');
        const shipStoreLabel = document.getElementById('shipping-store-label');

        // Dynamic element labels & headings
        const navProdLabel = document.getElementById('nav-products-label');
        const prodTabHeading = document.getElementById('products-tab-heading');
        const prodTabSubheading = document.getElementById('products-tab-subheading');
        const newProdBtn = document.getElementById('new-prod-btn');
        const prodFormBadge = document.getElementById('prod-form-header-badge');
        const prodFormTitle = document.getElementById('prod-form-title');
        const saveProdBtn = document.getElementById('save-prod-btn');

        if (storeId === 2) {
            // --- THE MARSHANS MODE ---
            if (btnChipakk) {
                btnChipakk.style.background = '#fff';
                btnChipakk.style.color = '#000';
            }
            if (btnMarshans) {
                btnMarshans.style.background = '#ff0055';
                btnMarshans.style.color = '#fff';
            }
            if (badge) {
                badge.textContent = 'THE MARSHANS ACTIVE';
                badge.style.background = '#0ea5e9';
            }
            if (domain) domain.textContent = 'themarshans.shop';
            if (shipStoreLabel) shipStoreLabel.textContent = 'THE MARSHANS (themarshans.shop)';

            // Update product labels to 3D Products
            if (navProdLabel) navProdLabel.textContent = '🏷️ 3D Products';
            if (prodTabHeading) prodTabHeading.textContent = '3D Products Catalog';
            if (prodTabSubheading) prodTabSubheading.textContent = 'Manage 3D printed models, filament specifications, pricing, and manufacturing assets';
            if (newProdBtn) newProdBtn.textContent = '+ CREATE NEW 3D PRODUCT';
            if (prodFormBadge) prodFormBadge.textContent = '⚙️ 3D PRINT PRODUCT CONFIGURATION';
            if (prodFormTitle) prodFormTitle.textContent = '[ADD NEW 3D PRODUCT]';
            if (saveProdBtn) saveProdBtn.textContent = 'SAVE 3D PRODUCT';

            // Scoped navigation labels for Marshans V1
            const navReviewsLabel = document.getElementById('nav-reviews-label');
            if (navReviewsLabel) navReviewsLabel.textContent = '⭐ Ratings';
            const navShippingLabel = document.getElementById('nav-shipping-label');
            if (navShippingLabel) navShippingLabel.textContent = '🚚 Shipping Rules';

            // Hide CHIPAKK-only modules (POD Queue, Events, Audit Logs, Team, Settings)
            document.querySelectorAll('.store-module-chipakk').forEach(el => {
                el.style.display = 'none';
            });

            // Hide future Marshans modules (Inventory, Finishing Options, Custom Requests, Production Jobs)
            document.querySelectorAll('.store-module-marshans-future').forEach(el => {
                el.style.display = 'none';
            });

            // Show THE MARSHANS active V1 modules (Materials)
            document.querySelectorAll('.store-module-marshans').forEach(el => {
                if (el.classList.contains('tab-content')) {
                    const activeNav = document.querySelector('.admin-nav-item.active');
                    const activeTabId = activeNav ? (activeNav.getAttribute('data-tab') || activeNav.getAttribute('data-section')) : null;
                    el.style.display = (el.id === activeTabId) ? 'block' : 'none';
                } else if (el.tagName === 'LI') {
                    el.style.display = 'list-item';
                } else {
                    el.style.display = '';
                }
            });

            // If user was viewing a tab that is now hidden, auto-switch to tab-dashboard
            const currentTabSec = document.querySelector('.tab-content:not([style*="display: none"])');
            if (currentTabSec && (currentTabSec.classList.contains('store-module-chipakk') || currentTabSec.classList.contains('store-module-marshans-future'))) {
                const navDashboard = document.querySelector('.admin-nav-item[data-tab="tab-dashboard"]');
                if (navDashboard) navDashboard.click();
            }

        } else {
            // --- CHIPAKK MODE ---
            if (btnChipakk) {
                btnChipakk.style.background = '#ff0055';
                btnChipakk.style.color = '#fff';
            }
            if (btnMarshans) {
                btnMarshans.style.background = '#fff';
                btnMarshans.style.color = '#000';
            }
            if (badge) {
                badge.textContent = 'CHIPAKK ACTIVE';
                badge.style.background = '#ff0055';
            }
            if (domain) domain.textContent = 'chipakk.shop';
            if (shipStoreLabel) shipStoreLabel.textContent = 'CHIPAKK (chipakk.shop)';

            // Restore product labels to Sticker Drops
            if (navProdLabel) navProdLabel.textContent = '🏷️ Products & Drops';
            if (prodTabHeading) prodTabHeading.textContent = 'Product & Drop Catalog';
            if (prodTabSubheading) prodTabSubheading.textContent = 'Manage print-on-demand sticker designs, pricing, images, and release schedules';
            if (newProdBtn) newProdBtn.textContent = '+ CREATE NEW STICKER DROP';
            if (prodFormBadge) prodFormBadge.textContent = '🖨️ PRINT-ON-DEMAND PRODUCT CONFIGURATION';
            if (prodFormTitle) prodFormTitle.textContent = '[ADD NEW PRODUCT DROP]';
            if (saveProdBtn) saveProdBtn.textContent = 'SAVE PRODUCT DROP';

            // Restore standard labels for CHIPAKK
            const navReviewsLabel = document.getElementById('nav-reviews-label');
            if (navReviewsLabel) navReviewsLabel.textContent = '⭐ Reviews';
            const navShippingLabel = document.getElementById('nav-shipping-label');
            if (navShippingLabel) navShippingLabel.textContent = '🚚 Shipping Management';

            // Show CHIPAKK modules
            document.querySelectorAll('.store-module-chipakk').forEach(el => {
                if (el.classList.contains('tab-content')) {
                    const activeNav = document.querySelector('.admin-nav-item.active');
                    const activeTabId = activeNav ? (activeNav.getAttribute('data-tab') || activeNav.getAttribute('data-section')) : null;
                    el.style.display = (el.id === activeTabId) ? 'block' : 'none';
                } else if (el.tagName === 'LI') {
                    el.style.display = 'list-item';
                } else {
                    el.style.display = '';
                }
            });

            // Hide MARSHANS modules
            document.querySelectorAll('.store-module-marshans').forEach(el => {
                el.style.display = 'none';
            });
            document.querySelectorAll('.store-module-marshans-future').forEach(el => {
                el.style.display = 'none';
            });

            // If user was viewing a MARSHANS-only tab, auto-switch to tab-dashboard
            const currentTabSec = document.querySelector('.tab-content:not([style*="display: none"])');
            if (currentTabSec && (currentTabSec.classList.contains('store-module-marshans') || currentTabSec.classList.contains('store-module-marshans-future'))) {
                const navDashboard = document.querySelector('.admin-nav-item[data-tab="tab-dashboard"]');
                if (navDashboard) navDashboard.click();
            }
        }
        updateLumoProductSectionVisibility();
    }

    async function switchActiveStore(targetStoreId) {
        const numericId = parseInt(targetStoreId, 10) === 2 ? 2 : 1;
        apiClient.setActiveStoreId(numericId);
        updateStoreSwitcherUI(numericId);

        // Close every open edit form / detail modal and clear its editing-id BEFORE loading the new store's data.
        // Without this, a form opened against the OLD store (e.g. editing product #42 on CHIPAKK) stayed open and
        // populated with the old store's values across the switch; clicking Save then sent a PUT for the old
        // store's id under the newly-active store's X-Store-ID header -- a cross-store write. Same risk for the
        // order-detail modal's Update Status / Save Courier Details actions. This resets ALL of them defensively,
        // not just the two confirmed during audit, since any open form + a store switch is the same risk class.
        ['product-form-container', 'category-form-container', 'coupon-form-container', 'shipping-form-container',
         'event-form-container', 'material-form-container', 'finishing-form-container', 'inventory-form-container',
         'hero-slide-form-container', 'banner-form-container', 'team-form-container'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        editingProductId = null;
        editingCategoryId = null;
        editingEventId = null;
        editingCouponId = null;
        editingShippingId = null;
        editingMaterialId = null;
        editingFinishingId = null;
        editingHeroSlideId = null;
        editingBannerId = null;
        const orderDetailModal = document.getElementById('order-detail-modal');
        if (orderDetailModal) orderDetailModal.style.display = 'none';
        activeOrderViewing = null;
        const custDetailModal = document.getElementById('customer-detail-modal');
        if (custDetailModal) custDetailModal.style.display = 'none';

        showToast(`Switched active store context to ${numericId === 2 ? 'THE MARSHANS (3D Printing)' : 'CHIPAKK (Stickers & Merch)'}`);

        // Reset product search and filters to prevent cross-store filter carryover
        const prodSearch = document.getElementById('prod-search-input');
        if (prodSearch) prodSearch.value = '';
        const prodCat = document.getElementById('prod-filter-category');
        if (prodCat) prodCat.value = '';
        const prodDrop = document.getElementById('prod-filter-drop-status');
        if (prodDrop) prodDrop.value = '';

        // Clear in-memory data to prevent stale UI flash
        products = [];
        categories = [];
        renderProductsTable();
        populateCategoryDropdowns();

        // Re-load settings and data for the newly active store
        await refreshSettingsFromAPI();

        try {
            // First refresh categories so products normalize with active store categories
            await refreshCategoriesFromAPI();

            await Promise.allSettled([
                refreshDashboardFromAPI(),
                refreshOrdersFromAPI(),
                refreshProductsFromAPI(),
                numericId === 1 ? refreshChipakkMaterialsFromAPI() : refreshMaterialsFromAPI(),
                numericId === 2 ? refreshFinishingFromAPI() : Promise.resolve(),
                refreshReviewsFromAPI(),
                refreshShippingRulesFromAPI(),
                refreshStoreBuilderFromAPI(),
                refreshEventsFromAPI(),
                refreshCouponsFromAPI()
            ]);
        } catch (_) {}
    }

    document.getElementById('switch-store-chipakk')?.addEventListener('click', () => switchActiveStore(1));
    document.getElementById('switch-store-marshans')?.addEventListener('click', () => switchActiveStore(2));

    // Initialize switcher UI on startup
    const initialStoreId = apiClient.getActiveStoreId ? apiClient.getActiveStoreId() : 1;
    updateStoreSwitcherUI(initialStoreId);

    // Category Image Live Preview and Upload Listener
    document.getElementById('cat-image')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const prevBox = document.getElementById('cat-image-preview-box');
        const prevImg = document.getElementById('cat-image-preview-img');
        const fallbackImg = 'https://img.icons8.com/color/150/000000/sticker.png';
        if (prevBox && prevImg) {
            if (val) {
                const res = resolveAdminImageUrl(val);
                prevImg.onerror = () => { prevImg.onerror = null; prevImg.src = fallbackImg; };
                prevImg.src = res || fallbackImg;
                prevBox.style.display = 'block';
            } else {
                prevBox.style.display = 'none';
                prevImg.src = '';
            }
        }
    });

    document.getElementById('upload-cat-img-btn')?.addEventListener('click', () => {
        document.getElementById('cat-image-file')?.click();
    });

    document.getElementById('cat-image-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uploadBtn = document.getElementById('upload-cat-img-btn');
        const origText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '...'; }
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const catInput = document.getElementById('cat-image');
                if (catInput) catInput.value = uploadedUrl;
                const prevBox = document.getElementById('cat-image-preview-box');
                const prevImg = document.getElementById('cat-image-preview-img');
                const fallbackImg = 'https://img.icons8.com/color/150/000000/sticker.png';
                if (prevBox && prevImg) {
                    const resolved = resolveAdminImageUrl(uploadedUrl);
                    prevImg.onerror = () => { prevImg.onerror = null; prevImg.src = fallbackImg; };
                    prevImg.src = resolved || fallbackImg;
                    prevBox.style.display = 'block';
                }
                showToast('Category image uploaded successfully');
            }
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText || 'UPLOAD'; }
            e.target.value = '';
        }
    });

    // Category Experience Switcher Listener
    document.getElementById('cat-experience-type')?.addEventListener('change', (e) => {
        const val = (e.target.value || '').toLowerCase();
        const glowBox = document.getElementById('cat-glow-settings-container');
        if (glowBox) {
            glowBox.style.display = val === 'glow' ? 'block' : 'none';
        }
        checkCategoryLumoMode();
    });
    document.getElementById('cat-name')?.addEventListener('input', checkCategoryLumoMode);
    document.getElementById('cat-slug')?.addEventListener('input', checkCategoryLumoMode);

    // Glow Color Picker <-> Text Sync
    document.getElementById('cat-glow-color-picker')?.addEventListener('input', (e) => {
        const textInput = document.getElementById('cat-glow-color');
        if (textInput) textInput.value = e.target.value;
    });
    document.getElementById('cat-glow-color')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            const picker = document.getElementById('cat-glow-color-picker');
            if (picker) picker.value = val;
        }
    });

    // Hero Light Image Upload & Preview Listener
    document.getElementById('cat-hero-light')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const prevBox = document.getElementById('hero-light-prev-box');
        const prevImg = document.getElementById('hero-light-prev-img');
        if (prevBox && prevImg) {
            if (val) {
                const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                prevImg.src = val.startsWith('http') ? val : (apiHost + val);
                prevBox.style.display = 'block';
            } else {
                prevBox.style.display = 'none';
            }
        }
    });
    document.getElementById('upload-hero-light-btn')?.addEventListener('click', () => {
        document.getElementById('cat-hero-light-file')?.click();
    });
    document.getElementById('cat-hero-light-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uploadBtn = document.getElementById('upload-hero-light-btn');
        const origText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '...'; }
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const input = document.getElementById('cat-hero-light');
                if (input) input.value = uploadedUrl;
                const prevBox = document.getElementById('hero-light-prev-box');
                const prevImg = document.getElementById('hero-light-prev-img');
                if (prevBox && prevImg) {
                    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                    prevImg.src = uploadedUrl.startsWith('http') ? uploadedUrl : (apiHost + uploadedUrl);
                    prevBox.style.display = 'block';
                }
                showToast('Hero light image uploaded');
            }
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText || 'UPLOAD'; }
            e.target.value = '';
        }
    });

    // Hero Dark Image Upload & Preview Listener
    document.getElementById('cat-hero-dark')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const prevBox = document.getElementById('hero-dark-prev-box');
        const prevImg = document.getElementById('hero-dark-prev-img');
        if (prevBox && prevImg) {
            if (val) {
                const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                prevImg.src = val.startsWith('http') ? val : (apiHost + val);
                prevBox.style.display = 'block';
            } else {
                prevBox.style.display = 'none';
            }
        }
    });
    document.getElementById('upload-hero-dark-btn')?.addEventListener('click', () => {
        document.getElementById('cat-hero-dark-file')?.click();
    });
    document.getElementById('cat-hero-dark-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uploadBtn = document.getElementById('upload-hero-dark-btn');
        const origText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '...'; }
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const input = document.getElementById('cat-hero-dark');
                if (input) input.value = uploadedUrl;
                const prevBox = document.getElementById('hero-dark-prev-box');
                const prevImg = document.getElementById('hero-dark-prev-img');
                if (prevBox && prevImg) {
                    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                    prevImg.src = uploadedUrl.startsWith('http') ? uploadedUrl : (apiHost + uploadedUrl);
                    prevBox.style.display = 'block';
                }
                showToast('Hero dark image uploaded');
            }
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText || 'UPLOAD'; }
            e.target.value = '';
        }
    });

    // Maintenance Image Live Preview and Upload Listener
    document.getElementById('set-maintenance-image')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const prevBox = document.getElementById('set-maintenance-image-preview-box');
        const prevImg = document.getElementById('set-maintenance-image-preview-img');
        if (prevBox && prevImg) {
            if (val) {
                const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                prevImg.src = val.startsWith('http') ? val : (apiHost + val);
                prevBox.style.display = 'block';
            } else {
                prevBox.style.display = 'none';
            }
        }
    });

    document.getElementById('upload-maintenance-img-btn')?.addEventListener('click', () => {
        document.getElementById('set-maintenance-image-file')?.click();
    });

    document.getElementById('set-maintenance-image-file')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uploadBtn = document.getElementById('upload-maintenance-img-btn');
        const origText = uploadBtn ? uploadBtn.textContent : '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '...'; }
        try {
            const formData = new FormData();
            formData.append('image', file);
            const res = await apiClient.upload('/admin/upload', formData);
            const uploadedUrl = res?.data?.url || res?.url;
            if (uploadedUrl) {
                const maintInput = document.getElementById('set-maintenance-image');
                if (maintInput) maintInput.value = uploadedUrl;
                const prevBox = document.getElementById('set-maintenance-image-preview-box');
                const prevImg = document.getElementById('set-maintenance-image-preview-img');
                if (prevBox && prevImg) {
                    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                    prevImg.src = uploadedUrl.startsWith('http') ? uploadedUrl : (apiHost + uploadedUrl);
                    prevBox.style.display = 'block';
                }
                showToast('Maintenance image uploaded successfully');
            }
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, 'error');
        } finally {
            if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText || 'UPLOAD'; }
            e.target.value = '';
        }
    });

    // Auto-refresh audit logs on mutating API actions (POST, PUT, DELETE) only
    let auditDebounce = null;
    window.addEventListener('admin-api-activity', (e) => {
        const method = (e.detail?.method || 'GET').toUpperCase();
        const endpoint = e.detail?.endpoint || '';

        // Ignore read-only GET queries and audit-log fetches to break infinite feedback loops
        if (method === 'GET' || endpoint.includes('audit-logs')) {
            return;
        }

        clearTimeout(auditDebounce);
        auditDebounce = setTimeout(() => {
            refreshAuditLogsFromAPI();
        }, 1200);
    });

    // Refresh controls for active sessions, team members, and audit logs
    document.getElementById('refresh-sessions-btn')?.addEventListener('click', async () => {
        showToast('Refreshing active sessions...');
        await refreshActiveSessionsFromAPI();
    });

    document.getElementById('refresh-team-btn')?.addEventListener('click', async () => {
        showToast('Refreshing team members...');
        await refreshTeamFromAPI();
    });

    document.getElementById('refresh-audit-logs-btn')?.addEventListener('click', async () => {
        showToast('Refreshing audit logs...');
        await refreshAuditLogsFromAPI();
    });

    document.getElementById('audit-goto-sessions-btn')?.addEventListener('click', () => {
        const teamTabLink = document.querySelector('.admin-nav-item[data-tab="tab-team"]');
        if (teamTabLink) teamTabLink.click();
    });

    // --- MARSHANS MODULES EVENT LISTENERS ---
    document.getElementById('new-material-btn')?.addEventListener('click', () => openMaterialForm());
    document.getElementById('save-material-btn')?.addEventListener('click', saveMaterialForm);
    document.getElementById('cancel-material-btn')?.addEventListener('click', () => {
        const c = document.getElementById('material-form-container');
        if (c) c.style.display = 'none';
    });
    document.getElementById('material-search-input')?.addEventListener('input', renderMaterialsTable);
    document.getElementById('material-filter-type')?.addEventListener('change', renderMaterialsTable);
    document.getElementById('mat-color-picker')?.addEventListener('input', (e) => {
        const hex = document.getElementById('mat-color-hex');
        if (hex) hex.value = e.target.value;
    });
    document.getElementById('mat-color-hex')?.addEventListener('input', (e) => {
        const picker = document.getElementById('mat-color-picker');
        if (picker && /^#[0-9A-F]{6}$/i.test(e.target.value)) picker.value = e.target.value;
    });

    document.getElementById('new-inventory-adjust-btn')?.addEventListener('click', () => {
        const c = document.getElementById('inventory-form-container');
        if (c) {
            c.style.display = 'block';
            c.scrollIntoView({ behavior: 'smooth' });
        }
    });
    document.getElementById('save-inventory-adjust-btn')?.addEventListener('click', saveInventoryAdjust);
    document.getElementById('cancel-inventory-adjust-btn')?.addEventListener('click', () => {
        const c = document.getElementById('inventory-form-container');
        if (c) c.style.display = 'none';
    });

    document.getElementById('new-finishing-btn')?.addEventListener('click', () => openFinishingForm());
    document.getElementById('save-finishing-btn')?.addEventListener('click', saveFinishingForm);
    document.getElementById('cancel-finishing-btn')?.addEventListener('click', () => {
        const c = document.getElementById('finishing-form-container');
        if (c) c.style.display = 'none';
    });

    document.querySelectorAll('#prod-jobs-filter-tabs .order-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#prod-jobs-filter-tabs .order-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeProdJobStage = btn.getAttribute('data-job-stage') || '';
            refreshProductionJobsFromAPI(activeProdJobStage);
        });
    });
    document.getElementById('save-job-modal-btn')?.addEventListener('click', saveProductionJobModal);
    document.getElementById('close-job-modal-btn')?.addEventListener('click', () => {
        const m = document.getElementById('production-job-modal');
        if (m) m.style.display = 'none';
    });

    document.querySelectorAll('#custom-req-filter-tabs .order-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#custom-req-filter-tabs .order-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCustomReqStatus = btn.getAttribute('data-req-status') || '';
            refreshCustomRequestsFromAPI(activeCustomReqStatus);
        });
    });
    document.getElementById('submit-quote-btn')?.addEventListener('click', submitCustomQuotation);
    document.getElementById('convert-order-btn')?.addEventListener('click', convertCustomRequestToOrder);
    document.getElementById('reject-quote-btn')?.addEventListener('click', rejectCustomRequest);
    document.getElementById('close-quote-modal-btn')?.addEventListener('click', () => {
        const m = document.getElementById('custom-request-modal');
        if (m) m.style.display = 'none';
    });

    // --- CHIPAKK PRODUCTION INVENTORY EVENT LISTENERS ---
    document.getElementById('btn-chipakk-add-material')?.addEventListener('click', () => openChipakkMaterialModal());
    document.getElementById('btn-chipakk-record-movement')?.addEventListener('click', () => openChipakkMovementModal());
    document.getElementById('btn-chipakk-history')?.addEventListener('click', () => openChipakkHistoryModal());
    document.getElementById('btn-refresh-chipakk-mat')?.addEventListener('click', refreshChipakkMaterialsFromAPI);
    document.getElementById('chipakk-mat-search')?.addEventListener('input', renderChipakkMaterialsTable);
    document.getElementById('chipakk-mat-type-filter')?.addEventListener('change', renderChipakkMaterialsTable);
    document.getElementById('chipakk-mat-low-filter')?.addEventListener('change', renderChipakkMaterialsTable);
    document.getElementById('btn-reorder-filter')?.addEventListener('click', () => {
        const chk = document.getElementById('chipakk-mat-low-filter');
        if (chk) { chk.checked = true; renderChipakkMaterialsTable(); }
    });

    document.getElementById('close-chipakk-mat-modal-btn')?.addEventListener('click', closeChipakkMaterialModal);
    document.getElementById('btn-cancel-chipakk-mat')?.addEventListener('click', closeChipakkMaterialModal);
    document.getElementById('form-chipakk-material')?.addEventListener('submit', saveChipakkMaterial);

    document.getElementById('close-chipakk-mov-modal-btn')?.addEventListener('click', closeChipakkMovementModal);
    document.getElementById('btn-cancel-chipakk-mov')?.addEventListener('click', closeChipakkMovementModal);
    document.getElementById('form-chipakk-movement')?.addEventListener('submit', saveChipakkMovement);

    document.getElementById('chipakk-mov-material')?.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        const mat = chipakkMaterials.find(x => String(x.id) === String(selectedId));
        const infoBox = document.getElementById('chipakk-mov-current-info');
        const curStockEl = document.getElementById('chipakk-mov-cur-stock');
        const curSafetyEl = document.getElementById('chipakk-mov-cur-safety');
        const unitLabel = document.getElementById('chipakk-mov-unit-label');
        const costInput = document.getElementById('chipakk-mov-cost');

        if (mat) {
            if (infoBox) infoBox.style.display = 'block';
            if (curStockEl) curStockEl.textContent = `${mat.stock} ${mat.unit}`;
            if (curSafetyEl) curSafetyEl.textContent = `${mat.safety_stock} ${mat.unit}`;
            if (unitLabel) unitLabel.textContent = `(${mat.unit})`;
            if (costInput && mat.cost) costInput.value = (mat.cost / 100).toFixed(2);
        } else {
            if (infoBox) infoBox.style.display = 'none';
            if (unitLabel) unitLabel.textContent = '';
        }
    });

    document.getElementById('chipakk-mov-type')?.addEventListener('change', (e) => {
        const dirWrap = document.getElementById('chipakk-mov-direction-wrap');
        const costWrap = document.getElementById('chipakk-mov-cost-wrap');
        if (dirWrap) dirWrap.style.display = e.target.value === 'ADJUSTMENT' ? 'block' : 'none';
        if (costWrap) costWrap.style.display = e.target.value === 'PURCHASE' ? 'block' : 'none';
    });

    document.getElementById('close-chipakk-hist-modal-btn')?.addEventListener('click', closeChipakkHistoryModal);
    document.getElementById('btn-refresh-chipakk-hist')?.addEventListener('click', refreshChipakkMovements);
    document.getElementById('chipakk-hist-mat-filter')?.addEventListener('change', refreshChipakkMovements);
    document.getElementById('chipakk-hist-type-filter')?.addEventListener('change', refreshChipakkMovements);

    // Single Guarded Periodic Polling (every 30s) for live sessions, team members, and audit logs
    if (!window.__adminPollingInterval) {
        window.__adminPollingInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                refreshActiveSessionsFromAPI();
                refreshAuditLogsFromAPI();
                refreshTeamFromAPI();
            }
        }, 30000);
    }
}

// Global Export Routine Helpers
window.updateState = updateState;
window.saveState = saveState;
window.showToast = showToast;


/* =========================================================
   LEGAL SUPPLIER (shared by CHIPAKK and THE MARSHANS) + GST READINESS
   ========================================================= */
async function loadLegalSupplierPanel() {
    const box = document.getElementById('supplier-readiness');
    if (!box) return;
    try {
        const [supRes, taxRes] = await Promise.all([apiClient.get('/admin/legal-supplier'), apiClient.get('/admin/tax-profile')]);
        const sup = (supRes && (supRes.data || supRes)).supplier || null;
        const readiness = ((taxRes && (taxRes.data || taxRes)).readiness) || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('set-supplier-name', sup && sup.legal_name);
        set('set-supplier-gstin', sup && sup.gstin);
        set('set-supplier-address', sup && sup.address);
        set('set-supplier-state', sup && sup.state ? `${sup.state} (${sup.state_code})` : '');
        set('set-supplier-pin', sup && sup.pincode);
        const miss = (list) => (list && list.length ? list.join(', ') : 'nothing');
        const okCheckout = readiness.checkout_ready, okInvoice = readiness.invoice_ready;
        box.style.borderColor = okCheckout ? (okInvoice ? '#15803d' : '#b45309') : '#b91c1c';
        box.style.background = okCheckout ? (okInvoice ? '#f0fdf4' : '#fffbeb') : '#fef2f2';
        box.textContent = `Checkout: ${okCheckout ? 'READY' : 'BLOCKED (missing: ' + miss(readiness.missing_for_checkout) + ')'}  |  Invoices: ${okInvoice ? 'READY' : 'NOT READY (missing: ' + miss(readiness.missing_for_invoice) + ')'}`;
    } catch (err) {
        box.textContent = 'Could not load the tax configuration: ' + err.message;
    }
}

document.getElementById('set-supplier-gstin')?.addEventListener('input', (e) => {
    const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    e.target.value = v;
    const hint = document.getElementById('set-supplier-gstin-hint');
    if (hint && v.length >= 2) hint.textContent = `State code ${v.slice(0, 2)} is read from the GSTIN; the full number is verified when you save.`;
});

document.getElementById('save-supplier-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-supplier-btn');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'SAVING...'; }
    try {
        await apiClient.put('/admin/legal-supplier', {
            legal_name: document.getElementById('set-supplier-name').value.trim(),
            gstin: document.getElementById('set-supplier-gstin').value.trim(),
            address: document.getElementById('set-supplier-address').value.trim(),
            pincode: document.getElementById('set-supplier-pin').value.trim()
        });
        showToast('Legal supplier saved. It now applies to both CHIPAKK and THE MARSHANS.');
        await loadLegalSupplierPanel();
    } catch (err) {
        showToast(`Could not save the legal supplier: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = original || 'SAVE LEGAL SUPPLIER'; }
    }
});
