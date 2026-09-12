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
    gstin: "07AAAAA0000A1Z5",
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
let selectedEvtProductIds = [];
let selectedProductionItemIds = [];

// =============================================================================
// NORMALIZATION HELPERS (API PAYLOAD -> FRONTEND STATE)
// =============================================================================

function normalizeProduct(p) {
    const pricePaise = parseInt(p.price, 10) || 0;
    const priceRupees = p.price_rupees !== undefined ? p.price_rupees : Math.round(pricePaise / 100);
    const compPricePaise = parseInt(p.compare_at_price, 10) || 0;
    const compPriceRupees = Math.round(compPricePaise / 100);

    const imagesList = Array.isArray(p.images)
        ? p.images.map(img => typeof img === 'string' ? img : (img.image_url || img.url || ''))
        : (p.primary_image_url ? [p.primary_image_url] : []);

    return {
        ...p,
        id: p.id,
        admin_id: p.admin_product_id || p.sku || `CK-${p.id}`,
        title: p.name || p.title || '',
        name: p.name || p.title || '',
        sku: p.sku || '',
        variant: 'Standard 3x3"',
        price: priceRupees,
        price_paise: pricePaise,
        compare_at_price: compPriceRupees,
        compare_at_price_paise: compPricePaise,
        category: p.category_name || (categories.find(c => c.id === p.category_id)?.name) || 'Uncategorized',
        category_id: p.category_id,
        rating: p.average_rating || 4.7,
        review_count: p.review_count || 0,
        rating_tier: p.rating_tier || 'RARE',
        images: imagesList.length > 0 ? imagesList : ["https://img.icons8.com/color/150/000000/sticker.png"],
        tags: Array.isArray(p.tags) ? p.tags : [],
        scheduled_drop_time: p.scheduled_drop_time ? new Date(p.scheduled_drop_time).toISOString().slice(0, 16) : '',
        is_active: p.active === 1 || p.active === true || p.is_active === true
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
    const totalPricePaise = parseInt(o.total_price || o.total, 10) || 0;
    const totalPriceRupees = Math.round(totalPricePaise / 100);

    const rawAddress = o.shipping_address;
    let formattedAddress = '';
    if (typeof rawAddress === 'string') {
        formattedAddress = rawAddress;
    } else if (rawAddress && typeof rawAddress === 'object') {
        formattedAddress = [rawAddress.address_line1 || rawAddress.address, rawAddress.city, rawAddress.state, rawAddress.pincode || rawAddress.zip].filter(Boolean).join(', ');
    } else {
        formattedAddress = o.address || 'Address not provided';
    }

    const normalizedItems = (o.items || []).map((item, idx) => ({
        item_id: item.id || item.item_id || `item-${o.id}-${idx + 1}`,
        order_item_id: item.id || item.order_item_id,
        admin_id: item.admin_product_id_snapshot || item.admin_id || item.sku || 'CK-001',
        title: item.product_name || item.title || 'Custom Product',
        variant: typeof item.variant_options === 'object' && item.variant_options ? Object.values(item.variant_options).join(' / ') : (item.variant || 'Standard 3x3"'),
        qty: item.quantity || item.qty || 1,
        unit_price: Math.round((parseInt(item.unit_price, 10) || 0) / 100),
        total: Math.round((parseInt(item.total_price || item.total, 10) || 0) / 100),
        img: item.img || "https://img.icons8.com/color/150/000000/sticker.png",
        production_status: BACKEND_TO_UI_PROD_STATUS[item.production_status] || item.production_status || 'Ready to Print'
    }));

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
        total_price_paise: totalPricePaise,
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
    const spendPaise = parseInt(c.total_spend, 10) || 0;
    const deliveredCount = parseInt(c.delivered_orders, 10) || 0;
    return {
        ...c,
        id: c.id,
        name: c.name || (c.email ? c.email.split('@')[0] : 'Customer'),
        email: c.email || '',
        phone: c.phone || '',
        total_orders: c.total_orders || 0,
        delivered_orders: deliveredCount,
        total_spent: Math.round(spendPaise / 100),
        total_spent_paise: spendPaise,
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
            apiClient.get('/admin/products'),
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

        if (prodRes.status === 'fulfilled' && prodRes.value) {
            const rawProds = prodRes.value.data?.products || prodRes.value.products || (Array.isArray(prodRes.value.data) ? prodRes.value.data : []);
            if (Array.isArray(rawProds)) products = rawProds.map(normalizeProduct);
        }
        if (catRes.status === 'fulfilled' && catRes.value) {
            const rawCats = catRes.value.data?.categories || catRes.value.categories || (Array.isArray(catRes.value.data) ? catRes.value.data : []) || (Array.isArray(catRes.value) ? catRes.value : []);
            if (Array.isArray(rawCats)) categories = rawCats.map(normalizeCategory);
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
                    min_spend: Math.round((parseInt(c.min_order_value || c.min_spend, 10) || 0) / 100),
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
                    min_order: Math.round((parseInt(s.free_shipping_threshold || s.min_order, 10) || 0) / 100),
                    max_order: 999999,
                    region: s.region || "India (All States)",
                    fee: Math.round((parseInt(s.standard_fee || s.fee, 10) || 0) / 100),
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

        updateState();
    } catch (err) {
        console.error('[loadAllAdminData Error]', err);
        showToast(`Failed to sync data with API: ${err.message}`, 'error');
    }
}

// API Refresh Handlers
async function refreshProductsFromAPI() {
    try {
        const res = await apiClient.get('/admin/products');
        const rawProds = res?.data?.products || res?.products || (Array.isArray(res?.data) ? res.data : []);
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
            categories = raw.map(normalizeCategory);
            renderCategoriesTable();
            populateCategoryDropdowns();
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
        if (res && res.events) {
            events = res.events.map(e => ({
                ...e,
                id: e.id,
                event_name: e.name || e.event_name || '',
                subtitle: e.subtitle || e.description || '',
                discount_type: e.discount_type || 'percent',
                discount_value: e.discount_value || 0,
                start_time: e.start_time || e.start_date || new Date().toISOString().slice(0, 16),
                end_time: e.end_time || e.end_date || new Date().toISOString().slice(0, 16),
                target_product_ids: Array.isArray(e.target_product_ids) ? e.target_product_ids : [],
                active: e.active === 1 || e.active === true
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
        if (res && res.coupons) {
            coupons = res.coupons.map(c => ({
                ...c,
                id: c.id,
                code: (c.code || '').toUpperCase(),
                discount_type: c.discount_type || 'percent',
                discount_value: c.discount_value || 0,
                min_spend: Math.round((parseInt(c.min_order_value || c.min_spend, 10) || 0) / 100),
                active: c.active === 1 || c.active === true
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
        if (res && res.rules) {
            shippingRules = res.rules.map(s => ({
                ...s,
                id: s.id,
                rule_name: s.name || s.rule_name || '',
                min_order: Math.round((parseInt(s.free_shipping_threshold || s.min_order, 10) || 0) / 100),
                max_order: 999999,
                region: s.region || "India (All States)",
                fee: Math.round((parseInt(s.standard_fee || s.fee, 10) || 0) / 100),
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
        if (res) {
            if (Array.isArray(res.heroGroups)) heroGroups = res.heroGroups;
            if (Array.isArray(res.promoBanners)) promoBanners = res.promoBanners;
            if (Array.isArray(res.storeSections)) storeSections = res.storeSections;
            renderStoreBuilder();
        }
    } catch (err) {
        console.error('[refreshStoreBuilderFromAPI]', err.message);
    }
}

async function refreshReviewsFromAPI() {
    try {
        const res = await apiClient.get('/admin/reviews');
        if (res && res.reviews) {
            reviews = res.reviews.map(r => ({
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

async function refreshSettingsFromAPI() {
    try {
        const res = await apiClient.get('/admin/settings');
        if (res && res.settings) {
            siteSettings = { ...siteSettings, ...res.settings };
            loadSystemSettings();
        }
    } catch (err) {
        console.error('[refreshSettingsFromAPI]', err.message);
    }
}

function updateState() {
    updateCustomerStatsAndTiers();
    saveState();
    renderDashboardMetrics();
    renderSalesChart();
    renderProductsTable();
    renderCategoriesTable();
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

    const catOptions = categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    if (prodCatSelect) {
        prodCatSelect.innerHTML = catOptions;
        if (currentProdVal && Array.from(prodCatSelect.options).some(o => o.value === currentProdVal)) {
            prodCatSelect.value = currentProdVal;
        }
    }
    if (filterCatSelect) {
        filterCatSelect.innerHTML = `<option value="">All Categories</option>${catOptions}`;
        if (currentFilterVal !== undefined && Array.from(filterCatSelect.options).some(o => o.value === currentFilterVal)) {
            filterCatSelect.value = currentFilterVal;
        }
    }
    if (evtCatSelect) {
        evtCatSelect.innerHTML = `<option value="">All Categories</option>${catOptions}`;
        if (currentEvtVal !== undefined && Array.from(evtCatSelect.options).some(o => o.value === currentEvtVal)) {
            evtCatSelect.value = currentEvtVal;
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
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// =============================================================================
// 1. DASHBOARD & ANALYTICS WIDGETS
// =============================================================================

function renderDashboardMetrics() {
    const totalOrders = orders.length;
    const cancelledOrders = orders.filter(o => o.status === 'Cancelled' || o.status === 'CANCELLED').length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const totalProducts = products.length;
    const totalCustomers = customers.length;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthOrders = orders.filter(o => {
        const d = new Date(o.created_at);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
    const monthRevenue = monthOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);

    const todayStr = now.toISOString().slice(0, 10);
    const ordersToday = orders.filter(o => o.created_at && String(o.created_at).slice(0, 10) === todayStr).length;

    const awaitingConf = orders.filter(o => o.status === 'New' || o.status === 'NEW').length;
    const readyPrint = productionQueueItems.filter(i => (i.production_status || '').toLowerCase().includes('ready') || (i.production_status || '') === 'NEW').length;
    const inProd = productionQueueItems.filter(i => (i.production_status || '').toLowerCase().includes('print') || (i.production_status || '').toLowerCase().includes('cut')).length;
    const readyPack = productionQueueItems.filter(i => (i.production_status || '').toLowerCase().includes('pack')).length;

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
        const recent = orders.slice(0, 5);
        recentOrdersBody.innerHTML = recent.map(o => `
            <tr>
                <td><strong class="admin-id-highlight">${o.order_id}</strong></td>
                <td>${o.customer_name}</td>
                <td><strong>₹${o.total_price}</strong></td>
                <td><span class="status-badge status-live">${o.payment_status}</span></td>
                <td><span class="status-badge status-upcoming">${o.status}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="5">No recent orders found.</td></tr>';
    }

    const topProductsBody = document.getElementById('dash-top-products-tbody');
    if (topProductsBody) {
        const topProds = products.slice(0, 5);
        topProductsBody.innerHTML = topProds.map(p => `
            <tr>
                <td><img src="${(p.images && p.images[0]) || 'https://img.icons8.com/color/150/000000/sticker.png'}" style="width:30px; height:30px; object-fit:cover;"></td>
                <td><strong>${p.title}</strong></td>
                <td>₹${p.price}</td>
                <td>${formatRatingDisplay(p.rating)}</td>
            </tr>
        `).join('') || '<tr><td colspan="4">No products found.</td></tr>';
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

    // Build or use 6-month statistical data
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    let stats = [];

    if (Array.isArray(monthlyStats) && monthlyStats.length === 6) {
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

    // Overlay real orders if available
    if (Array.isArray(orders) && orders.length > 0) {
        orders.forEach(o => {
            if (!o.created_at) return;
            const st = String(o.status || '').toLowerCase();
            if (st === 'cancelled' || st === 'failed') return;
            const d = new Date(o.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const match = stats.find(s => s.monthKey === key);
            if (match) {
                if (monthlyStats.length === 0) {
                    match.revenue += Math.round(Number(o.total_price || 0));
                    match.orders += 1;
                }
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
                <small style="color: #6b7280; font-weight: 800; font-size: 0.72rem; text-transform: uppercase;">6-Month Verified Revenue</small><br>
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
    const categoryFilter = document.getElementById('prod-filter-category')?.value || '';
    const statusFilter = document.getElementById('prod-filter-drop-status')?.value || '';

    const filtered = products.filter(p => {
        const matchesSearch = !searchQuery || (p.admin_id || p.sku || '').toLowerCase().includes(searchQuery) || p.title.toLowerCase().includes(searchQuery);
        const matchesCat = !categoryFilter || p.category === categoryFilter;
        const dropStatus = getProductDropStatus(p).status;
        const matchesStatus = !statusFilter || dropStatus === statusFilter;
        return matchesSearch && matchesCat && matchesStatus;
    });

    tbody.innerHTML = filtered.map(p => {
        const dropInfo = getProductDropStatus(p);

        return `
            <tr>
                <td><img src="${(p.images && p.images[0]) || 'https://img.icons8.com/color/150/000000/sticker.png'}" style="width:45px; height:45px; object-fit:cover; border:1px solid #000;"></td>
                <td><span class="admin-id-highlight">${p.admin_id || p.sku}</span></td>
                <td><strong>${p.title}</strong><br><small style="color:#666;">${p.variant || 'Standard 3x3"'}</small></td>
                <td><span class="status-badge" style="background:#eee; color:#333;">${p.category}</span></td>
                <td><strong>₹${p.price}</strong></td>
                <td>${formatRatingDisplay(p.rating)} <small>(${p.review_count || 0})</small></td>
                <td><span class="status-badge ${dropInfo.badgeClass}">${dropInfo.label}</span></td>
                <td><small>${p.scheduled_drop_time ? new Date(p.scheduled_drop_time).toLocaleString() : 'Immediate'}</small></td>
                <td><span class="status-badge ${p.is_active ? 'status-live' : 'status-inactive'}">${p.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                <td>
                    <div style="display:flex; gap:4px;">
                        <button class="retro-btn edit-prod-btn" data-id="${p.id}" style="padding:2px 6px; font-size:0.75rem;">EDIT</button>
                        <button class="retro-btn del-prod-btn" data-id="${p.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="10">No products found.</td></tr>';

    tbody.querySelectorAll('.edit-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => editProduct(btn.getAttribute('data-id')));
    });

    tbody.querySelectorAll('.del-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => confirmDeleteProduct(btn.getAttribute('data-id')));
    });
}

function openProductForm(product = null) {
    const container = document.getElementById('product-form-container');
    if (!container) return;

    editingProductId = product ? product.id : null;
    document.getElementById('prod-form-title').textContent = product ? `[EDIT PRODUCT DROP: ${product.admin_id}]` : '[ADD NEW PRODUCT DROP]';

    document.getElementById('prod-admin-id').value = product ? product.admin_id : `CK-${String(products.length + 1).padStart(3, '0')}`;
    document.getElementById('prod-title').value = product ? product.title : '';
    document.getElementById('prod-price').value = product ? product.price : '';
    document.getElementById('prod-category').value = product ? product.category : (categories[0]?.name || '');
    document.getElementById('prod-tags').value = product ? (product.tags || []).join(', ') : '';
    document.getElementById('prod-release-date').value = product ? (product.scheduled_drop_time || '') : '';
    document.getElementById('prod-active').value = product ? String(product.is_active) : 'true';

    tempProdImages = product && product.images ? [...product.images] : ["https://img.icons8.com/color/150/000000/sticker.png"];
    renderProdImageGallery();

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });
}

function renderProdImageGallery() {
    const gallery = document.getElementById('prod-images-gallery');
    if (!gallery) return;

    gallery.innerHTML = tempProdImages.map((img, idx) => `
        <div class="img-thumb-card">
            ${idx === 0 ? '<span class="primary-tag">PRIMARY</span>' : ''}
            <img src="${img}">
            <div class="img-thumb-actions">
                ${idx !== 0 ? `<button type="button" class="img-btn-sm set-primary-img-btn" data-idx="${idx}">PRIMARY</button>` : ''}
                <button type="button" class="img-btn-sm rem-img-btn" data-idx="${idx}" style="color:#ef4444;">×</button>
            </div>
        </div>
    `).join('');

    gallery.querySelectorAll('.set-primary-img-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-idx'));
            const [moved] = tempProdImages.splice(idx, 1);
            tempProdImages.unshift(moved);
            renderProdImageGallery();
        });
    });

    gallery.querySelectorAll('.rem-img-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-idx'));
            tempProdImages.splice(idx, 1);
            renderProdImageGallery();
        });
    });
}

function editProduct(productId) {
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

async function saveProductForm() {
    const adminId = document.getElementById('prod-admin-id').value.trim();
    const title = document.getElementById('prod-title').value.trim();
    const price = Number(document.getElementById('prod-price').value);
    const category = document.getElementById('prod-category').value;

    if (!adminId || !title || isNaN(price) || !category) {
        showToast("Please complete mandatory fields (Admin ID, Product Name, Price, Category)!", "error");
        return;
    }

    if (tempProdImages.length === 0) {
        tempProdImages = ["https://img.icons8.com/color/150/000000/sticker.png"];
    }

    const saveBtn = document.getElementById('save-prod-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const priceInPaise = Math.round(price * 100);
    const payload = {
        name: title,
        admin_product_id: adminId,
        sku: `SKU-${adminId}`,
        price: priceInPaise,
        category_name: category,
        tags: document.getElementById('prod-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        images: [...tempProdImages],
        scheduled_drop_time: document.getElementById('prod-release-date').value || null,
        active: document.getElementById('prod-active').value === 'true' ? 1 : 0
    };

    try {
        if (editingProductId) {
            await apiClient.put(`/admin/products/${editingProductId}`, payload);
            showToast(`Print-on-demand product '${adminId}' updated.`);
        } else {
            await apiClient.post('/admin/products', payload);
            showToast(`Print-on-demand product '${adminId}' created.`);
        }
        document.getElementById('product-form-container').style.display = 'none';
        await refreshProductsFromAPI();
    } catch (err) {
        showToast(`Error saving product: ${err.message}`, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || "SAVE STICKER DROP"; }
    }
}

// =============================================================================
// 3. CATEGORIES MANAGEMENT
// =============================================================================

function renderCategoriesTable() {
    const tbody = document.getElementById('categories-tbody');
    if (!tbody) return;

    tbody.innerHTML = categories.map(c => {
        const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
        const imgThumb = c.image_url ? `<img src="${c.image_url.startsWith('http') ? c.image_url : (apiHost + c.image_url)}" style="width:28px; height:28px; object-fit:cover; border:1px solid #000; border-radius:3px; vertical-align:middle; margin-right:6px;">` : '';
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
    }).join('') || '<tr><td colspan="6">No categories found.</td></tr>';

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

function openCategoryForm(category = null) {
    const container = document.getElementById('category-form-container');
    if (!container) return;

    editingCategoryId = category ? category.id : null;
    document.getElementById('cat-form-title').textContent = category ? `[EDIT CATEGORY: ${category.name}]` : '[ADD NEW CATEGORY]';
    document.getElementById('cat-name').value = category ? category.name : '';
    document.getElementById('cat-slug').value = category ? category.slug : '';
    document.getElementById('cat-desc').value = category ? (category.description || '') : '';

    const catImageInput = document.getElementById('cat-image');
    if (catImageInput) catImageInput.value = category?.image_url || '';

    const prevBox = document.getElementById('cat-image-preview-box');
    const prevImg = document.getElementById('cat-image-preview-img');
    if (category?.image_url && prevBox && prevImg) {
        const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
        prevImg.src = category.image_url.startsWith('http') ? category.image_url : (apiHost + category.image_url);
        prevBox.style.display = 'block';
    } else if (prevBox) {
        prevBox.style.display = 'none';
    }

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

    const saveBtn = document.getElementById('save-cat-btn');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "SAVING..."; }

    const payload = { name, slug, description: desc, image_url: imageUrl, active: 1 };

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
            showToast(`Error deleting category: ${err.message}`, 'error');
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
                        unit_price: it.unit_price_rupees || Math.round((parseInt(it.unit_price, 10) || 0) / 100),
                        total_price: it.total_price_rupees || Math.round((parseInt(it.total_price, 10) || 0) / 100),
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
    
    document.getElementById('ord-detail-total').innerHTML = `
        ₹${o.total_price}
        <div style="font-size:0.75rem; color:#555; font-weight:normal; margin-top:3px;">
            Subtotal: ₹${subtotal} | Shipping: ₹${shipping} | Discount: -₹${discount}${couponInfo}
        </div>
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

    const history = order.status_history || [{ status: order.status, timestamp: order.created_at, actor: "System" }];
    container.innerHTML = history.map(h => `
        <div class="timeline-item">
            <span class="timeline-dot"></span>
            <strong>${h.status}</strong> — <small>${new Date(h.timestamp).toLocaleString()} (${h.actor || 'System'})</small>
        </div>
    `).join('');
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
                    <button class="retro-btn toggle-evt-btn" data-id="${e.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
                    <button class="retro-btn del-evt-btn" data-id="${e.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="8">No sales events scheduled.</td></tr>';

    tbody.querySelectorAll('.toggle-evt-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const evt = events.find(item => String(item.id) === btn.getAttribute('data-id'));
            if (evt) {
                try {
                    await apiClient.put(`/admin/events/${evt.id}`, { ...evt, active: !evt.active ? 1 : 0 });
                    showToast(`Event promotion ${evt.event_name} updated.`);
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
    document.getElementById('evt-form-title').textContent = evt ? `[EDIT EVENT PROMOTION: ${evt.event_name}]` : '[SCHEDULE EVENT PROMOTION]';
    document.getElementById('evt-name').value = evt ? evt.event_name : '';
    document.getElementById('evt-title').value = evt ? (evt.subtitle || '') : '';
    document.getElementById('evt-discount-type').value = evt ? evt.discount_type : 'percent';
    document.getElementById('evt-discount-value').value = evt ? evt.discount_value : 20;
    document.getElementById('evt-start').value = evt ? evt.start_time : new Date().toISOString().slice(0, 16);
    document.getElementById('evt-end').value = evt ? evt.end_time : new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 16);
    document.getElementById('evt-active').value = evt ? String(evt.active) : 'true';
    document.getElementById('evt-storefront-hero').value = evt ? String(evt.hero_banner || false) : 'true';

    selectedEvtProductIds = evt && evt.target_product_ids ? [...evt.target_product_ids] : products.map(p => p.admin_id || p.sku);
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
        start_time: document.getElementById('evt-start').value,
        end_time: document.getElementById('evt-end').value,
        active: document.getElementById('evt-active').value === 'true' ? 1 : 0,
        hero_banner: document.getElementById('evt-storefront-hero').value === 'true' ? 1 : 0,
        target_product_ids: [...selectedEvtProductIds]
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
                    <button class="retro-btn toggle-cpn-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
                    <button class="retro-btn del-cpn-btn" data-id="${c.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6">No coupons created.</td></tr>';

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
    document.getElementById('cpn-min').value = cpn ? cpn.min_spend : 200;
    document.getElementById('cpn-active').value = cpn ? String(cpn.active) : 'true';

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

    const minSpendPaise = Math.round((Number(document.getElementById('cpn-min').value) || 0) * 100);
    const payload = {
        code,
        discount_type: document.getElementById('cpn-type').value,
        discount_value: value,
        min_order_value: minSpendPaise,
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
                    <button class="retro-btn toggle-ship-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem;">TOGGLE</button>
                    <button class="retro-btn del-ship-btn" data-id="${r.id}" style="padding:2px 6px; font-size:0.75rem; background:#ef4444; color:#fff;">DEL</button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6">No shipping rules configured.</td></tr>';

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

    const payload = {
        name,
        standard_fee: Math.round(fee * 100),
        free_shipping_threshold: Math.round(minVal * 100),
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
// 10. VISUAL STORE BUILDER MANAGEMENT
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
    if (document.getElementById('set-gstin')) document.getElementById('set-gstin').value = siteSettings.gstin || '';
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
            const res = await apiClient.get('/admin/dashboard');
            if (res && res.data && res.data.metrics) {
                dashboardMetrics = res.data.metrics;
                if (Array.isArray(res.data.metrics.monthlyStats)) {
                    monthlyStats = res.data.metrics.monthlyStats;
                }
            }
            renderSalesChart();
            showToast("Sales comparison chart synchronized with real database.");
        } catch (err) {
            renderSalesChart();
            showToast(`Refreshed chart: ${err.message}`, 'info');
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

    document.getElementById('apply-analytics-filter-btn')?.addEventListener('click', () => {
        updateState();
        showToast("Analytics timeframe filter applied.");
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

    document.getElementById('add-image-url-btn')?.addEventListener('click', () => {
        const urlInput = document.getElementById('prod-image-url');
        if (urlInput && urlInput.value.trim()) {
            tempProdImages.push(urlInput.value.trim());
            urlInput.value = '';
            renderProdImageGallery();
        }
    });

    document.getElementById('prod-image-file-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                tempProdImages.push(evt.target.result);
                renderProdImageGallery();
            };
            reader.readAsDataURL(file);
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
        siteSettings.announcement_text = document.getElementById('set-announcement').value;
        siteSettings.announcement_active = document.getElementById('set-announcement-active').value === 'true';
        siteSettings.announcement_rolling = document.getElementById('set-announcement-rolling').value === 'true';
        try {
            await apiClient.put('/admin/settings', siteSettings);
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
        const gstVal = Number(document.getElementById('set-gst-rate').value) || 18;

        const payload = {
            store_name: document.getElementById('set-store-name').value.trim(),
            business_email: email,
            support_email: email,
            support_phone: document.getElementById('set-support-phone').value.trim(),
            gstin: document.getElementById('set-gstin').value.trim(),
            gst_pct: gstVal,
            gst_rate: gstVal,
            currency_symbol: document.getElementById('set-currency').value.trim(),
            order_prefix: document.getElementById('set-order-prefix').value.trim(),
            default_rating: Number(document.getElementById('set-default-rating').value) || 4.7
        };

        try {
            await apiClient.put('/admin/settings', payload);
            showToast("Business & Tax settings saved successfully.");
            await refreshSettingsFromAPI();
        } catch (err) {
            showToast(`Error saving business settings: ${err.message}`, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = originalText || "SAVE BUSINESS & TAX SETTINGS"; }
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

    // Category Image Live Preview and Upload Listener
    document.getElementById('cat-image')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const prevBox = document.getElementById('cat-image-preview-box');
        const prevImg = document.getElementById('cat-image-preview-img');
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
                if (prevBox && prevImg) {
                    const apiHost = apiClient.baseUrl ? apiClient.baseUrl.replace(/\/api$/, '') : 'https://api.chipakk.shop';
                    prevImg.src = uploadedUrl.startsWith('http') ? uploadedUrl : (apiHost + uploadedUrl);
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
