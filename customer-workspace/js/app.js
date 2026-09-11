/* =========================================================
   CHIPAKK — Customer Storefront
   Core Shared Engine — js/app.js
   
   BACKEND-FIRST ARCHITECTURE:
   - Centralized data store (CHIPAKK_DATA) structured to match
     future Admin API responses (GET /api/products, /api/categories,
     /api/events, /api/settings, /api/store-builder).
   - LocalStorage-persisted Cart and Wishlist across separate HTML pages.
   - Global header, mobile drawer, search dialog, cart drawer,
     and circular video loading screen.
   ========================================================= */

(function () {
  "use strict";

  /* =========================================================
     1. CENTRALIZED DATA CONTRACTS (Swap for API calls later)
     ========================================================= */

  const CHIPAKK_DATA = {
    // Store Settings (mirrors GET /api/settings)
    settings: {
      storeName: "CHIPAKK",
      storeOpen: true,
      freeShippingThreshold: 0,
      currencySymbol: "₹",
      announcementActive: false,
      announcementText: ""
    },

    // SHARED PLATFORM ARCHITECTURE (THE MARSHANS ↔ CHIPAKK)
    sharedPlatform: {
      parentCompany: "THE MARSHANS",
      storefronts: [
        { id: "themarshans", name: "THE MARSHANS", url: "https://themarshans.shop", isCurrent: false },
        { id: "chipakk", name: "CHIPAKK", url: "index.html", isCurrent: true }
      ],
      unifiedAuthArchitecture: {
        strategy: "SINGLE_USER_IDENTITY_POOL",
        firebaseAuthShared: true,
        sharedAccountTable: true,
        note: "Single unified customer account shared between THE MARSHANS and CHIPAKK. No duplicate accounts or secondary auth."
      }
    },

    // Hero Section Data (mirrors GET /api/store-builder / hero)
    hero: {
      enabled: true,
      eyebrow: "New designs every week",
      titleLine1: "STICK",
      titleLine2: "YOUR",
      titleLine3: "WORLD.",
      accentLine: 3, // "WORLD." in electric blue!
      description: "Premium stickers for a bolder, brighter, more you. Waterproof, scratch-resistant vinyl made for laptops, phones, bottles, and every surface that deserves personality.",
      primaryButtonText: "Shop Now →",
      primaryButtonLink: "shop.html",
      secondaryButtonText: "Custom Stickers",
      secondaryButtonLink: "custom-stickers.html",
      image: "assets/images/logo.png",
      imageAlt: "CHIPAKK Sticker Collage Artwork",
      badge: "ORIGINAL ART",
      stats: [
        { value: "500+", label: "Original designs" },
        { value: "50k+", label: "Stickers shipped" },
        { value: "4.8★", label: "Average rating" }
      ]
    },

    // Categories (populated dynamically from GET /api/categories)
    categories: [],

    // Products (populated dynamically from GET /api/products)
    products: [],

    // Events / Drops (populated dynamically from GET /api/events?status=live)
    events: []
  };

  /* =========================================================
     2. API CLIENT & ASYNC REPOSITORY LAYER
     ========================================================= */

  function resolveApiBaseUrl() {
    if (typeof window !== 'undefined') {
      if (window.API_BASE_URL) return window.API_BASE_URL;
      try {
        const stored = localStorage.getItem('chipakk_api_base_url');
        if (stored) return stored;
      } catch (_) {}

      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocal) {
        const currentPort = window.location.port;
        if (currentPort === '3000') {
          return `${window.location.origin}/api`;
        }
        return 'http://localhost:3000/api';
      }
    }
    return 'https://api.chipakk.shop/api';
  }

  const API_BASE = resolveApiBaseUrl();

  // In-memory session cache to avoid duplicate API requests during a single page visit
  const apiCache = new Map();

  async function fetchApi(endpoint, options = {}) {
    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const cacheKey = `${options.method || "GET"}:${url}`;

    if (!options.refresh && options.method !== "POST" && options.method !== "PUT" && apiCache.has(cacheKey)) {
      return apiCache.get(cacheKey);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          ...(options.headers || {})
        },
        signal: controller.signal,
        ...options
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      const payload = json && typeof json === "object" && "data" in json ? json.data : json;
      apiCache.set(cacheKey, payload);
      return payload;
    } catch (err) {
      console.warn(`[CHIPAKK API] Failed to fetch ${endpoint}:`, err.message);
      throw err;
    }
  }

  /**
   * Authenticated API request helper
   * Obtains current Firebase ID token at request time (never cached in localStorage)
   */
  async function fetchAuthenticated(endpoint, options = {}) {
    const user = window.CHIPAKK?.auth?.getCurrentUser ? window.CHIPAKK.auth.getCurrentUser() : null;
    let authHeaders = {};

    if (user && typeof user.getIdToken === "function") {
      try {
        const idToken = await user.getIdToken();
        if (idToken) {
          authHeaders["Authorization"] = `Bearer ${idToken}`;
        }
      } catch (tokenErr) {
        console.warn("[CHIPAKK API] Token retrieval notice:", tokenErr.message);
      }
    }

    const mergedHeaders = {
      ...(authHeaders),
      ...(options.headers || {})
    };

    return fetchApi(endpoint, {
      ...options,
      headers: mergedHeaders
    });
  }

  /**
   * Validate coupon code against authoritative backend API
   * POST /api/coupons/validate
   */
  async function validateCouponApi(code, subtotalRupees = 0) {
    if (!code || typeof code !== "string" || !code.trim()) {
      return { valid: false, message: "Coupon code is required." };
    }

    const cleanCode = code.trim().toUpperCase();
    const url = `${API_BASE}/coupons/validate`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          code: cleanCode,
          subtotal_in_rupees: Math.max(0, Math.round(subtotalRupees))
        })
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        return {
          valid: false,
          message: json.error || json.message || "Invalid or inactive coupon code."
        };
      }

      return {
        valid: true,
        message: json.message || "Coupon code applied successfully.",
        coupon: json.data || {}
      };
    } catch (err) {
      console.warn("[CHIPAKK Coupons] Validation network notice:", err.message);
      return {
        valid: false,
        message: "Unable to validate coupon right now. Please check your connection."
      };
    }
  }

  /**
   * Create Customer Order
   * POST /api/orders
   */
  async function createOrderApi(orderPayload) {
    return fetchAuthenticated("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    });
  }

  /**
   * Fetch Customer Orders
   * GET /api/orders
   */
  async function getCustomerOrdersApi({ limit = 20, offset = 0 } = {}) {
    return fetchAuthenticated(`/orders?limit=${limit}&offset=${offset}`);
  }

  /**
   * Fetch Single Customer Order by ID or Number
   * GET /api/orders/:id
   */
  async function getCustomerOrderByIdApi(id) {
    return fetchAuthenticated(`/orders/${encodeURIComponent(id)}`);
  }

  /**
   * Fetch Saved Customer Addresses
   * GET /api/customer/addresses
   */
  async function getCustomerAddressesApi() {
    return fetchAuthenticated("/customer/addresses");
  }

  /**
   * Save New Customer Address
   * POST /api/customer/addresses
   */
  async function createCustomerAddressApi(addressData) {
    return fetchAuthenticated("/customer/addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addressData)
    });
  }

  /**
   * Update Saved Customer Address
   * PUT /api/customer/addresses/:id
   */
  async function updateCustomerAddressApi(id, addressData) {
    return fetchAuthenticated(`/customer/addresses/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addressData)
    });
  }

  /**
   * Delete Saved Customer Address
   * DELETE /api/customer/addresses/:id
   */
  async function deleteCustomerAddressApi(id) {
    return fetchAuthenticated(`/customer/addresses/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  /**
   * Create Gateway Payment Order (Razorpay)
   * POST /api/payments/create
   */
  async function createPaymentOrderApi(orderId) {
    return fetchAuthenticated("/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId })
    });
  }

  /**
   * Verify Gateway Payment Signature
   * POST /api/payments/verify
   */
  async function verifyPaymentApi({ order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
    return fetchAuthenticated("/payments/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      })
    });
  }

  /**
   * Fetch Authoritative Order Payment Status
   * GET /api/payments/status/:orderId
   */
  async function getPaymentStatusApi(orderId) {
    return fetchAuthenticated(`/payments/status/${encodeURIComponent(orderId)}`);
  }

  /* ---------------------------------------------------------
     DATA NORMALIZATION HELPERS
     --------------------------------------------------------- */

  function normalizeProduct(p) {
    if (!p) return null;

    const id = String(p.id);
    const adminProductId = p.admin_product_id || p.sku || id;
    const name = p.name || p.title || "Sticker";
    const slug = p.slug || adminProductId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const price = typeof p.price === "number" ? p.price : (parseFloat(p.price) || 0);
    const compareAtPrice = p.compare_at_price ? (typeof p.compare_at_price === "number" ? p.compare_at_price : parseFloat(p.compare_at_price)) : (p.compareAtPrice || null);
    const rating = typeof p.average_rating === "number" ? p.average_rating : (typeof p.rating === "number" ? p.rating : (parseFloat(p.rating) || 4.7));
    const ratingCount = p.review_count !== undefined ? parseInt(p.review_count, 10) : (p.ratingCount !== undefined ? parseInt(p.ratingCount, 10) : 0);
    const ratingTier = p.rating_tier || getRatingTier(rating);
    const active = p.active === 1 || p.active === true || p.active === undefined;
    const featured = p.featured === 1 || p.featured === true;

    // Image resolution: primary image, images array, or fallback emoji
    let images = [];
    if (Array.isArray(p.images) && p.images.length > 0) {
      images = p.images.map(img => typeof img === "string" ? img : (img.image_url || img.external_url || img.url || "")).filter(Boolean);
    } else if (p.primary_image_url) {
      images = [p.primary_image_url];
    } else if (p.image && (p.image.startsWith("http") || p.image.includes("/"))) {
      images = [p.image];
    }

    const primaryImg = p.primary_image_url || (images.length > 0 ? images[0] : null) || p.image || "⚡";

    // Category mapping
    const categoryId = p.category_id !== undefined ? String(p.category_id) : (p.categoryId || "");
    const categoryName = p.category_name || p.categoryName || "";
    const categorySlug = p.category_slug || (categoryName ? categoryName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "");

    // Options mapping (materials & sizes)
    let materials = ["Glossy", "Matte", "Holographic", "Transparent"];
    let sizes = ['2"', '3"', '4"'];
    if (Array.isArray(p.options) && p.options.length > 0) {
      const matOpt = p.options.find(o => /material|finish/i.test(o.name));
      if (matOpt && Array.isArray(matOpt.values) && matOpt.values.length > 0) {
        materials = matOpt.values.map(v => typeof v === "string" ? v : (v.value || v.name));
      }
      const szOpt = p.options.find(o => /size|dimension/i.test(o.name));
      if (szOpt && Array.isArray(szOpt.values) && szOpt.values.length > 0) {
        sizes = szOpt.values.map(v => typeof v === "string" ? v : (v.value || v.name));
      }
    } else if (Array.isArray(p.materials) && p.materials.length > 0) {
      materials = p.materials;
    }

    const inStock = p.stock !== undefined ? p.stock > 0 : (p.inStock !== undefined ? p.inStock : true);

    return {
      id,
      admin_product_id: adminProductId,
      name,
      slug,
      price,
      compareAtPrice,
      rating,
      ratingCount,
      rating_tier: ratingTier,
      active,
      featured,
      image: primaryImg,
      images: images.length > 0 ? images : (primaryImg.startsWith("http") || primaryImg.includes("/") ? [primaryImg] : []),
      categoryId,
      categoryName,
      categorySlug,
      tags: Array.isArray(p.tags) ? p.tags : (typeof p.tags === "string" ? (function() { try { return JSON.parse(p.tags); } catch(e) { return []; } })() : []),
      description: p.description || "",
      materials,
      sizes,
      inStock,
      stock: p.stock !== undefined ? p.stock : 100
    };
  }

  function normalizeCategory(c) {
    if (!c) return null;
    const id = String(c.id);
    const name = c.name || "Category";
    const slug = c.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const active = c.active === 1 || c.active === true || c.active === undefined;
    const imageUrl = c.image_url || (typeof c.image === "string" && (c.image.startsWith("http") || c.image.includes("/")) ? c.image : null);
    const productCount = parseInt(c.product_count !== undefined ? c.product_count : (c.productCount || 0), 10) || 0;
    const icon = c.icon || c.image || "✨";

    return {
      id,
      name,
      slug,
      active,
      description: c.description || "",
      image_url: imageUrl,
      image: imageUrl || icon,
      icon,
      productCount
    };
  }

  function normalizeSettings(s) {
    if (!s) return CHIPAKK_DATA.settings;

    const storeName = s.store_name || s.storeName || "CHIPAKK";
    const storeStatus = (s.store_status || "OPEN").toUpperCase();
    const maintenanceActive = s.maintenance_active === true || s.maintenance_active === "true" || storeStatus === "MAINTENANCE";
    const storeClosed = storeStatus === "TEMPORARILY CLOSED";
    const storeOpen = !maintenanceActive && !storeClosed;
    const maintenanceMessage = s.maintenance_message || s.maintenance_msg || (storeClosed ? "Storefront is temporarily closed." : "We are currently down for scheduled maintenance.");

    let freeShippingThreshold = 0;
    if (s.free_shipping_threshold_rupees !== undefined && s.free_shipping_threshold_rupees !== null) {
      freeShippingThreshold = Number(s.free_shipping_threshold_rupees);
    } else if (s.free_shipping_threshold !== undefined && s.free_shipping_threshold !== null) {
      const raw = Number(s.free_shipping_threshold);
      freeShippingThreshold = raw > 1000 ? Math.round(raw / 100) : raw;
    } else if (s.freeShippingThreshold !== undefined && s.freeShippingThreshold !== null) {
      freeShippingThreshold = Number(s.freeShippingThreshold);
    }

    let shippingFee = 50;
    if (s.shipping_fee_rupees !== undefined && s.shipping_fee_rupees !== null) {
      shippingFee = Number(s.shipping_fee_rupees);
    } else if (s.shipping_fee !== undefined && s.shipping_fee !== null) {
      const raw = Number(s.shipping_fee);
      shippingFee = raw > 100 ? Math.round(raw / 100) : raw;
    }

    const gstRate = s.gst_pct !== undefined ? Number(s.gst_pct) : (s.gst_rate !== undefined ? Number(s.gst_rate) : 18);
    const gstin = s.gstin || "";

    const announcementActive = s.announcement_active !== false && Boolean(s.announcement_text);
    const announcementText = s.announcement_text || "";

    return {
      storeName,
      storeStatus,
      storeOpen,
      maintenanceActive,
      storeClosed,
      maintenanceMessage,
      maintenanceImage: s.maintenance_image || "",
      freeShippingThreshold,
      shippingFee,
      currency: s.currency || "INR",
      currencySymbol: "₹",
      gstRate,
      gstin,
      announcementActive,
      announcementText
    };
  }

  function normalizeEvent(e) {
    if (!e) return null;
    const id = String(e.id);
    const title = e.name || e.title || "Drop Event";
    const description = e.description || "Limited edition designs available now.";
    const eventType = (e.event_type || "drop").toUpperCase();
    const ribbon = `${eventType} DROP`;
    const cta = e.cta || "Shop The Drop";
    const ctaLink = e.ctaLink || "shop.html";
    const endsAt = e.end_time ? new Date(e.end_time).getTime() : (e.endsAt || (Date.now() + 24 * 60 * 60 * 1000));

    return {
      id,
      title,
      description,
      ribbon,
      cta,
      ctaLink,
      endsAt,
      active: e.active === 1 || e.active === true
    };
  }

  function normalizeHero(sb) {
    const fallback = CHIPAKK_DATA.hero;
    if (!sb || !sb.hero) return fallback;

    const hero = sb.hero;
    if (hero.mode === 'fixed') {
      return {
        ...fallback,
        enabled: hero.enabled !== false,
        mode: 'fixed',
        show_eyebrow: hero.show_eyebrow !== false,
        eyebrow: hero.eyebrow || fallback.eyebrow,
        show_title: hero.show_title !== false,
        titleLine1: hero.title || fallback.titleLine1,
        titleLine2: "",
        titleLine3: "",
        show_description: hero.show_description !== false,
        description: hero.description || fallback.description,
        show_primary_btn: hero.show_primary_btn !== false,
        primaryButtonText: hero.primary_btn_text || fallback.primaryButtonText,
        primaryButtonLink: hero.primary_btn_url || fallback.primaryButtonLink,
        show_secondary_btn: hero.show_secondary_btn !== false,
        secondaryButtonText: hero.secondary_btn_text || fallback.secondaryButtonText,
        secondaryButtonLink: hero.secondary_btn_url || fallback.secondaryButtonLink,
        image_url: hero.image_url || fallback.image,
        image: hero.image_url || fallback.image,
        imageAlt: hero.title || fallback.imageAlt
      };
    } else if (hero.mode === 'carousel' && Array.isArray(hero.slides) && hero.slides.length > 0) {
      const first = hero.slides[0];
      return {
        ...fallback,
        enabled: true,
        mode: 'carousel',
        slides: hero.slides,
        show_eyebrow: first.show_eyebrow !== false,
        eyebrow: first.eyebrow || fallback.eyebrow,
        show_title: first.show_title !== false,
        titleLine1: first.title || fallback.titleLine1,
        titleLine2: "",
        titleLine3: "",
        show_description: first.show_description !== false,
        description: first.description || fallback.description,
        show_primary_btn: first.show_primary_btn !== false,
        primaryButtonText: first.primary_btn_text || fallback.primaryButtonText,
        primaryButtonLink: first.primary_btn_url || fallback.primaryButtonLink,
        show_secondary_btn: first.show_secondary_btn !== false,
        secondaryButtonText: first.secondary_btn_text || fallback.secondaryButtonText,
        secondaryButtonLink: first.secondary_btn_url || fallback.secondaryButtonLink,
        image_url: first.image_url || fallback.image,
        image: first.image_url || fallback.image,
        imageAlt: first.title || fallback.imageAlt
      };
    }

    const slides = Array.isArray(hero.slides) ? hero.slides : [];
    if (slides.length === 0) return fallback;

    const first = slides[0];
    return {
      ...fallback,
      enabled: true,
      titleLine1: first.title || fallback.titleLine1,
      titleLine2: first.subtitle ? first.subtitle.slice(0, 15) : fallback.titleLine2,
      titleLine3: fallback.titleLine3,
      description: first.subtitle || fallback.description,
      primaryButtonText: first.cta_text || fallback.primaryButtonText,
      primaryButtonLink: first.target_url || fallback.primaryButtonLink,
      image: first.image_url || fallback.image,
      imageAlt: first.title || fallback.imageAlt
    };
  }

  /* ---------------------------------------------------------
     SETTINGS & STORE LIFECYCLE SYNCHRONIZATION
     --------------------------------------------------------- */

  function syncStoreSettingsUi(settings) {
    if (!settings) return;

    // 1. Check Maintenance Gate
    checkMaintenanceGate(settings);

    // 2. Global Announcement Bar
    syncAnnouncementBar(settings);

    // 3. Shipping threshold on trust strip / headings
    syncShippingThresholdUi(settings);

    // 4. Update Cart display with new threshold
    renderGlobalCart();
  }

  function checkMaintenanceGate(settings) {
    const isMaint = settings.maintenanceActive === true || settings.storeOpen === false;
    let overlay = $("#maintenanceOverlay");

    if (isMaint) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "maintenanceOverlay";
        overlay.className = "maintenance-screen";
        overlay.setAttribute("role", "alertdialog");
        overlay.setAttribute("aria-modal", "true");
        document.body.appendChild(overlay);
      }

      const isClosed = settings.storeClosed;
      const title = isClosed ? "CHIPAKK STORE CLOSED" : "CHIPAKK SYSTEM EXCEPTION";
      const sub = isClosed ? "We are currently not accepting visits or orders." : "CHIPAKK.EXE is currently undergoing scheduled updates.";
      const errCode = isClosed ? "ERROR CODE: STORE_TEMPORARILY_CLOSED" : "ERROR CODE: MAINTENANCE_MODE_ACTIVE";
      const msg = settings.maintenanceMessage || "We will be back shortly with brand new sticker deployments.";

      overlay.innerHTML = `
        <div class="maintenance-box">
          <div class="maintenance-icon">🚧</div>
          <h1 class="maintenance-title">${escapeHtml(title)}</h1>
          <p class="maintenance-sub">${escapeHtml(sub)}</p>
          <div class="maintenance-msg-box">${escapeHtml(msg)}</div>
          <span class="maintenance-code">${escapeHtml(errCode)}</span>
        </div>
      `;
      overlay.style.display = "flex";
      document.body.classList.add("no-scroll");
    } else if (overlay) {
      overlay.style.display = "none";
      document.body.classList.remove("no-scroll");
    }
  }

  function syncAnnouncementBar(settings) {
    let bar = $("#globalAnnouncementBar");
    if (!bar) {
      const header = $(".site-header");
      if (header) {
        bar = document.createElement("div");
        bar.id = "globalAnnouncementBar";
        bar.className = "global-announcement-bar";
        header.insertBefore(bar, header.firstChild);
      }
    }

    if (bar) {
      if (settings.announcementActive && settings.announcementText) {
        bar.textContent = settings.announcementText;
        bar.style.display = "block";
      } else {
        bar.style.display = "none";
      }
    }
  }

  function syncShippingThresholdUi(settings) {
    const thresh = settings.freeShippingThreshold !== undefined ? Number(settings.freeShippingThreshold) : 0;
    const formatted = formatPrice(thresh);

    const trustEl = $("#trustFreeShippingSub");
    if (trustEl) {
      trustEl.textContent = thresh > 0 ? `On orders above ${formatted}` : `On all orders`;
    }

    const prodBadge = $("#prodFreeShippingBadge");
    if (prodBadge) {
      prodBadge.textContent = thresh > 0 ? `Free Shipping on Orders > ${formatted}` : `Free Shipping on All Orders`;
    }

    const checkoutBadge = $("#checkoutShippingRuleBadge");
    if (checkoutBadge) {
      checkoutBadge.textContent = thresh > 0 ? `FREE on orders > ${formatted}` : `FREE Shipping`;
    }

    $$(".cart-note").forEach(el => {
      el.textContent = thresh > 0 ? `Free shipping automatically applied on orders above ${formatted}.` : `Free shipping applied on all orders.`;
    });

    if (typeof renderCartDrawer === "function") {
      renderCartDrawer();
    }
  }

  /* ---------------------------------------------------------
     ASYNC REPOSITORY FUNCTIONS (API-BACKED)
     --------------------------------------------------------- */

  async function getProducts(options = {}) {
    try {
      const data = await fetchApi("/products?limit=100", options);
      const rawList = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : null);
      if (rawList !== null) {
        const normalized = rawList.map(normalizeProduct).filter(Boolean);
        CHIPAKK_DATA.products = normalized;
        return normalized;
      }
      return [];
    } catch (err) {
      console.warn("[CHIPAKK] Falling back to local products repository:", err.message);
      return CHIPAKK_DATA.products.map(normalizeProduct).filter(Boolean);
    }
  }

  async function getProductById(id, options = {}) {
    if (!id) return null;
    try {
      const data = await fetchApi(`/products/${encodeURIComponent(id)}`, options);
      if (data && typeof data === "object") {
        const normalized = normalizeProduct(data);
        return normalized;
      }
    } catch (err) {
      // Endpoint error or 404, fallback to checking cached or mock products list
    }
    const products = await getProducts(options);
    const found = products.find(x => String(x.id) === String(id) || String(x.admin_product_id) === String(id) || x.slug === id);
    return found || null;
  }

  async function getCategories(options = {}) {
    try {
      const data = await fetchApi("/categories", options);
      if (Array.isArray(data)) {
        const normalized = data.map(normalizeCategory).filter(c => c && c.active);
        CHIPAKK_DATA.categories = normalized;
        return normalized;
      }
      return [];
    } catch (err) {
      console.warn("[CHIPAKK] Falling back to local categories repository:", err.message);
      return CHIPAKK_DATA.categories.map(normalizeCategory).filter(c => c && c.active);
    }
  }

  async function getEvents(options = {}) {
    try {
      const data = await fetchApi("/events?status=live", options);
      const rawList = Array.isArray(data) ? data : (data && Array.isArray(data.events) ? data.events : null);
      if (rawList !== null) {
        const normalized = rawList.map(normalizeEvent).filter(e => e && e.active);
        CHIPAKK_DATA.events = normalized;
        return normalized;
      }
      return [];
    } catch (err) {
      console.warn("[CHIPAKK] Falling back to local events repository:", err.message);
      return (CHIPAKK_DATA.events || []).map(normalizeEvent).filter(e => e && e.active);
    }
  }

  async function getStoreSettings(options = {}) {
    try {
      const data = await fetchApi("/settings", options);
      if (data && typeof data === "object") {
        const normalized = normalizeSettings(data);
        CHIPAKK_DATA.settings = normalized;
        syncStoreSettingsUi(normalized);
        return normalized;
      }
    } catch (err) {
      console.warn("[CHIPAKK] Falling back to local settings repository:", err.message);
    }
    const normalized = normalizeSettings(CHIPAKK_DATA.settings);
    CHIPAKK_DATA.settings = normalized;
    syncStoreSettingsUi(normalized);
    return normalized;
  }

  async function getHeroData(options = {}) {
    try {
      const data = await fetchApi("/store-builder", options);
      if (data && typeof data === "object") {
        const normalized = normalizeHero(data);
        CHIPAKK_DATA.hero = normalized;
        if (data.store_info) {
          const settingsNorm = normalizeSettings({ ...CHIPAKK_DATA.settings, ...data.store_info });
          CHIPAKK_DATA.settings = settingsNorm;
          syncStoreSettingsUi(settingsNorm);
        }
        return normalized;
      }
    } catch (err) {
      console.warn("[CHIPAKK] Falling back to local hero data:", err.message);
    }
    return CHIPAKK_DATA.hero;
  }

  /* =========================================================
     3. PERSISTENT CART MANAGER (localStorage)
     ========================================================= */

  const CART_STORAGE_KEY = "chipakk_cart_v1";

  class CartManager {
    constructor() {
      this.items = this.load();
    }

    load() {
      try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        console.warn("[CHIPAKK] Failed to load cart from localStorage", e);
        return [];
      }
    }

    save() {
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(this.items));
      } catch (e) {
        console.warn("[CHIPAKK] Failed to save cart to localStorage", e);
      }
      this.notify();
    }

    notify() {
      window.dispatchEvent(new CustomEvent("chipakk-cart-updated", { detail: { cart: this } }));
      renderGlobalCart();
    }

    addItem(product, qty = 1, options = {}) {
      const material = options.material || (product.materials && product.materials[0]) || "Glossy";
      const size = options.size || (product.sizes && product.sizes[0]) || '3"';
      const variantKey = `${product.id}_${material}_${size}`.toLowerCase().replace(/[^a-z0-9]/g, "_");

      // Robust image resolution: check images array first, then image URL or emoji
      const resolvedImage = (product.images && product.images.length > 0 && product.images[0]) || product.image || "⚡";

      const existingIndex = this.items.findIndex(i => i.variantKey === variantKey);
      if (existingIndex > -1) {
        this.items[existingIndex].qty += qty;
      } else {
        this.items.push({
          id: product.id,
          variantKey,
          name: product.name,
          price: product.price,
          image: resolvedImage,
          material,
          size,
          qty
        });
      }
      this.save();
      showToast(`${product.name} added to cart!`);
    }

    removeItem(variantKey) {
      this.items = this.items.filter(i => i.variantKey !== variantKey);
      this.save();
    }

    updateQty(variantKey, delta) {
      const item = this.items.find(i => i.variantKey === variantKey);
      if (!item) return;
      item.qty += delta;
      if (item.qty <= 0) {
        this.removeItem(variantKey);
      } else {
        this.save();
      }
    }

    getCount() {
      return this.items.reduce((sum, i) => sum + i.qty, 0);
    }

    getSubtotal() {
      return this.items.reduce((sum, i) => sum + (i.price * i.qty), 0);
    }

    getShippingThreshold() {
      const s = window.CHIPAKK?.DATA?.settings;
      if (s && s.freeShippingThreshold !== undefined && s.freeShippingThreshold !== null) {
        return Number(s.freeShippingThreshold);
      }
      return 0;
    }

    getShippingFee() {
      const subtotal = this.getSubtotal();
      if (subtotal === 0) return 0;
      const thresh = this.getShippingThreshold();
      if (thresh <= 0 || subtotal >= thresh) return 0;
      const s = window.CHIPAKK?.DATA?.settings;
      return (s && s.shippingFee !== undefined && s.shippingFee !== null) ? Number(s.shippingFee) : 50;
    }

    getTotal() {
      const subtotal = this.getSubtotal();
      if (subtotal === 0) return 0;
      return subtotal + this.getShippingFee();
    }

    clear() {
      this.items = [];
      this.save();
    }
  }

  const cart = new CartManager();

  /* =========================================================
     4. PERSISTENT WISHLIST MANAGER (localStorage)
     ========================================================= */

  const WISHLIST_STORAGE_KEY = "chipakk_wishlist_v1";

  class WishlistManager {
    constructor() {
      this.ids = this.load();
    }

    load() {
      try {
        const raw = localStorage.getItem(WISHLIST_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    save() {
      try {
        localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(this.ids));
      } catch (e) {}
      window.dispatchEvent(new CustomEvent("chipakk-wishlist-updated", { detail: { wishlist: this } }));
    }

    toggle(productId) {
      const idx = this.ids.indexOf(productId);
      const isAdded = idx === -1;
      if (isAdded) {
        this.ids.push(productId);
      } else {
        this.ids.splice(idx, 1);
      }
      this.save();
      showToast(isAdded ? "Added to wishlist ♥" : "Removed from wishlist");
      return isAdded;
    }

    has(productId) {
      return this.ids.includes(productId);
    }

    getAll() {
      return this.ids;
    }
  }

  const wishlist = new WishlistManager();

  /* =========================================================
     5. FORMATTING & DOM HELPERS
     ========================================================= */

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function formatPrice(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN");
  }

  function starsMarkup(rating) {
    const full = Math.round(rating || 5);
    let out = "";
    for (let i = 0; i < 5; i++) {
      out += i < full
        ? '<svg viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9.5 16.5 14 18 22 12 18 6 22 7.5 14 2 9.5 9 9"/></svg>'
        : '<svg class="star-empty" viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9.5 16.5 14 18 22 12 18 6 22 7.5 14 2 9.5 9 9"/></svg>';
    }
    return out;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  /* =========================================================
     AUTHENTIC RATING TIER & REUSABLE PRODUCT CARD CONTRACT
     ========================================================= */

  function getRatingTier(rating) {
    const r = Math.round((parseFloat(rating) || 0.0) * 10) / 10;
    if (r >= 4.9) return "LEGENDARY";
    if (r >= 4.7) return "RARE";
    if (r >= 4.4) return "EPIC";
    if (r >= 4.0) return "UNCOMMON";
    if (r >= 3.0) return "COMMON";
    return "BASIC";
  }

  function renderProductCard(p, options = {}) {
    if (!p) return "";
    const isWishlisted = options.isWishlisted !== undefined ? options.isWishlisted : wishlist.has(p.id);
    const mode = options.mode || "standard"; // 'standard' or 'wishlist'

    const ratingVal = typeof p.rating === "number" ? p.rating : (parseFloat(p.rating) || 4.7);
    const ratingCount = p.ratingCount !== undefined ? p.ratingCount : (p.review_count !== undefined ? p.review_count : 0);
    const ratingTier = p.rating_tier || getRatingTier(ratingVal);

    const isImgUrl = (p.image && (p.image.startsWith("http") || p.image.includes("/"))) ||
                     (p.images && p.images.length && (p.images[0].startsWith("http") || p.images[0].includes("/")));
    const imgSrc = (p.image && (p.image.startsWith("http") || p.image.includes("/"))) ? p.image : (p.images && p.images[0]);

    return `
      <article class="product-card" data-product-id="${p.id}">
        <!-- 1. LARGE SQUARE PRODUCT IMAGE (DOMINANT ELEMENT) -->
        <div class="product-media">
          ${mode !== "wishlist" ? `
            <button class="product-wishlist ${isWishlisted ? 'is-active' : ''}" type="button" data-wishlist-id="${p.id}" aria-label="Wishlist ${escapeAttr(p.name)}" aria-pressed="${isWishlisted}">
              <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.6-10-9.2C0 8 1.8 4 6 4c2.2 0 3.8 1.2 6 4 2.2-2.8 3.8-4 6-4 4.2 0 6 4 4 7.8C19 16.4 12 21 12 21z"/></svg>
            </button>
          ` : ""}
          <a href="product.html?id=${encodeURIComponent(p.id)}" class="product-media-link" aria-label="${escapeAttr(p.name)}">
            ${isImgUrl 
              ? `<img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(p.name)}" loading="lazy" />` 
              : `<div class="product-media-art"><span class="product-media-emoji">${p.image || "⚡"}</span></div>`
            }
          </a>
        </div>

        <div class="product-body">
          <!-- 2. RATING + RATING TIER (ABOVE PRODUCT NAME) -->
          <div class="product-rating" aria-label="${ratingVal.toFixed(1)} out of 5 stars, tier ${ratingTier}">
            <span class="stars">${starsMarkup(ratingVal)}</span>
            <span class="rating-val">${ratingVal.toFixed(1)}</span>
            ${ratingCount ? `<span class="rating-count">(${ratingCount})</span>` : ""}
            <span class="rating-divider" aria-hidden="true">·</span>
            <span class="rating-tier tier-${ratingTier.toLowerCase()}">${escapeHtml(ratingTier)}</span>
          </div>

          <!-- 3. PRODUCT NAME -->
          <h3 class="product-name">
            <a href="product.html?id=${encodeURIComponent(p.id)}">
              ${escapeHtml(p.name)}
            </a>
          </h3>

          <!-- 4. PRICE / COMPARE-AT PRICE -->
          <div class="product-pricing">
            <span class="product-price">${formatPrice(p.price)}</span>
            ${p.compareAtPrice ? `<span class="product-price-orig">${formatPrice(p.compareAtPrice)}</span>` : ""}
          </div>

          <!-- 5. ADD TO CART / ACTIONS -->
          ${mode === "wishlist" ? `
            <div class="product-card-actions" style="display: flex; gap: 8px; margin-top: 4px;">
              <button class="product-add move-to-cart-btn" type="button" data-move-cart="${p.id}" style="flex: 1; margin-top: 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="9.5" cy="21" r="1.4"/><circle cx="17.5" cy="21" r="1.4"/></svg>
                <span>Move to Cart</span>
              </button>
              <button type="button" class="btn-icon remove-wish-btn" data-remove-wish="${p.id}" style="border: 3px solid var(--black); border-radius: var(--radius-sm); box-shadow: 2px 2px 0 var(--black); padding: 10px;" aria-label="Remove from wishlist">
                ✕
              </button>
            </div>
          ` : `
            <button class="product-add" type="button" data-add-to-cart="${p.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="9.5" cy="21" r="1.4"/><circle cx="17.5" cy="21" r="1.4"/></svg>
              <span>Add to Cart</span>
            </button>
          `}
        </div>
      </article>
    `;
  }

  let toastTimer = null;
  function showToast(message) {
    let toast = $("#toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.className = "toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-active");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-active"), 2400);
  }

  /* =========================================================
     6. GLOBAL CART DRAWER CONTROLLER
     ========================================================= */

  function renderGlobalCart() {
    const list = $("#cartItems");
    const countBadge = $("#cartCount");
    const headerBadge = $("#cartHeaderBadge");
    const shippingBanner = $("#cartShippingBanner");
    const shippingIcon = $("#cartShippingIcon");
    const shippingMsg = $("#cartShippingMsg");
    const shippingBar = $("#cartShippingBar");
    const subtotalEl = $("#cartSubtotal");
    const shippingFeeEl = $("#cartShippingFee");
    const totalEl = $("#cartTotal");
    const checkoutBtn = $("#checkoutBtn");

    const totalCount = cart.getCount();
    const subtotal = cart.getSubtotal();
    const threshold = cart.getShippingThreshold();
    const shippingFee = cart.getShippingFee();
    const grandTotal = cart.getTotal();
    const isFreeShipping = totalCount > 0 && subtotal >= threshold;

    // 1. Update Header Nav Badge
    if (countBadge) {
      countBadge.textContent = String(totalCount);
      countBadge.hidden = totalCount === 0;
    }

    // 2. Update Drawer Header Badge
    if (headerBadge) {
      headerBadge.textContent = `[ ${totalCount} ${totalCount === 1 ? "ITEM" : "ITEMS"} ]`;
    }

    // 3. Update Free Shipping Progress Bar
    if (shippingBanner && shippingBar && shippingMsg) {
      if (totalCount === 0) {
        shippingBanner.classList.remove("is-unlocked");
        if (shippingIcon) shippingIcon.textContent = "🚚";
        shippingMsg.innerHTML = `Add <strong>₹${threshold}</strong> more for <strong>FREE SHIPPING</strong>`;
        shippingBar.style.width = "0%";
      } else if (isFreeShipping) {
        shippingBanner.classList.add("is-unlocked");
        if (shippingIcon) shippingIcon.textContent = "🎉";
        shippingMsg.innerHTML = "<strong>YOU UNLOCKED FREE SHIPPING!</strong>";
        shippingBar.style.width = "100%";
      } else {
        shippingBanner.classList.remove("is-unlocked");
        if (shippingIcon) shippingIcon.textContent = "🚚";
        const remaining = Math.max(0, threshold - subtotal);
        shippingMsg.innerHTML = `Add <strong>₹${remaining}</strong> more for <strong>FREE SHIPPING</strong>`;
        const percent = Math.min(100, Math.round((subtotal / threshold) * 100));
        shippingBar.style.width = `${percent}%`;
      }
    }

    // 4. Update Summary Section
    if (subtotalEl) {
      subtotalEl.textContent = formatPrice(subtotal);
    }

    if (shippingFeeEl) {
      if (totalCount === 0) {
        shippingFeeEl.textContent = "₹0";
      } else if (isFreeShipping) {
        shippingFeeEl.innerHTML = '<span class="cart-free-badge">FREE</span>';
      } else {
        shippingFeeEl.textContent = formatPrice(shippingFee);
      }
    }

    if (totalEl) {
      totalEl.textContent = formatPrice(grandTotal);
    }

    if (checkoutBtn) {
      checkoutBtn.disabled = totalCount === 0;
      checkoutBtn.onclick = () => {
        if (totalCount > 0) {
          window.location.href = "checkout.html";
        }
      };
    }

    // 5. Render Cart Items or Empty State
    if (!list) return;

    if (!cart.items.length) {
      list.innerHTML = `
        <div class="cart-empty-state">
          <div class="cart-empty-icon" aria-hidden="true">🛒</div>
          <h3 class="cart-empty-title">YOUR CART IS EMPTY</h3>
          <p class="cart-empty-desc">You haven't added any stickers yet. Check out our latest drops and epic designs!</p>
          <a href="shop.html" class="btn btn-primary cart-empty-btn">SHOP STICKERS →</a>
        </div>
      `;
      return;
    }

    list.innerHTML = cart.items.map(item => {
      const isImgUrl = typeof item.image === "string" && (item.image.startsWith("http") || item.image.includes("/"));
      const lineTotal = item.price * item.qty;

      return `
        <div class="cart-item" data-variant-key="${item.variantKey}">
          <div class="cart-item-media" aria-hidden="true">
            ${isImgUrl 
              ? `<img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)}" loading="lazy" />` 
              : `<span class="cart-item-emoji">${item.image || "⚡"}</span>`
            }
          </div>
          <div class="cart-item-info">
            <div class="cart-item-header">
              <h4 class="cart-item-name">${escapeHtml(item.name)}</h4>
              <button class="cart-item-remove" type="button" data-remove-item="${item.variantKey}" aria-label="Remove ${escapeAttr(item.name)}" title="Remove item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="cart-item-variant">${escapeHtml(item.material || "Glossy")} • ${escapeHtml(item.size || '3"')}</div>
            <div class="cart-item-bottom">
              <div class="cart-qty-stepper">
                <button type="button" class="cart-qty-btn" data-qty-decrease="${item.variantKey}" aria-label="Decrease quantity">−</button>
                <span class="cart-qty-val">${item.qty}</span>
                <button type="button" class="cart-qty-btn" data-qty-increase="${item.variantKey}" aria-label="Increase quantity">+</button>
              </div>
              <div class="cart-item-prices">
                ${item.qty > 1 ? `<span class="cart-item-unit-price">${formatPrice(item.price)} ea</span>` : ""}
                <span class="cart-item-total-price">${formatPrice(lineTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  /* =========================================================
     7. PANELS & OVERLAYS (Drawer, Search, Cart)
     ========================================================= */

  const backdrop = () => $("#overlayBackdrop");
  let activePanel = null;

  function lockBodyScroll(lock) {
    document.body.classList.toggle("no-scroll", lock);
  }

  function openPanel(panelEl, opts = {}) {
    if (!panelEl) return;
    panelEl.hidden = false;
    void panelEl.offsetWidth; // force reflow
    panelEl.classList.add("is-active");

    const bg = backdrop();
    if (bg) {
      bg.hidden = false;
      void bg.offsetWidth;
      bg.classList.add("is-active");
    }

    lockBodyScroll(true);
    activePanel = { el: panelEl, trigger: opts.trigger };
    if (opts.trigger) opts.trigger.setAttribute("aria-expanded", "true");

    const toFocus = opts.focusEl || panelEl.querySelector("input, button, a");
    if (toFocus) setTimeout(() => toFocus.focus(), 50);
  }

  function closePanel() {
    if (!activePanel) return;
    const { el, trigger } = activePanel;
    el.classList.remove("is-active");

    const bg = backdrop();
    if (bg) bg.classList.remove("is-active");

    lockBodyScroll(false);
    if (trigger) trigger.setAttribute("aria-expanded", "false");

    setTimeout(() => {
      el.hidden = true;
      if (bg) bg.hidden = true;
    }, 300);

    if (trigger) trigger.focus();
    activePanel = null;
  }

  function initPanels() {
    const bg = backdrop();
    if (bg) bg.addEventListener("click", closePanel);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && activePanel) closePanel();
    });

    // Mobile Drawer
    const drawer = $("#mobileDrawer");
    const hamburger = $("#hamburgerBtn");
    const drawerClose = $("#drawerCloseBtn");

    if (hamburger && drawer) {
      hamburger.addEventListener("click", () => openPanel(drawer, { trigger: hamburger }));
    }
    if (drawerClose) {
      drawerClose.addEventListener("click", closePanel);
    }

    // Cart Drawer
    const cartDrawer = $("#cartDrawer");
    const cartBtn = $("#cartBtn");
    const cartClose = $("#cartCloseBtn");

    if (cartBtn && cartDrawer) {
      cartBtn.addEventListener("click", () => openPanel(cartDrawer, { trigger: cartBtn }));
    }
    if (cartClose) {
      cartClose.addEventListener("click", closePanel);
    }

    // Cart event delegation
    if (cartDrawer) {
      cartDrawer.addEventListener("click", (e) => {
        const closeBtn = e.target.closest("#cartCloseBtn, .cart-close-trigger");
        if (closeBtn) {
          closePanel();
          return;
        }

        const decBtn = e.target.closest("[data-qty-decrease]");
        const incBtn = e.target.closest("[data-qty-increase]");
        const remBtn = e.target.closest("[data-remove-item]");

        if (decBtn) cart.updateQty(decBtn.dataset.qtyDecrease, -1);
        if (incBtn) cart.updateQty(incBtn.dataset.qtyIncrease, 1);
        if (remBtn) cart.removeItem(remBtn.dataset.removeItem);
      });
    }

    // Search Panel & Inline Form
    const searchPanel = $("#searchPanel");
    const mobileSearchBtn = $("#mobileSearchBtn");
    const searchCloseBtn = $("#searchCloseBtn");
    const searchPanelForm = $("#searchPanelForm");
    const headerSearchForm = $("#headerSearchForm");

    if (mobileSearchBtn && searchPanel) {
      mobileSearchBtn.addEventListener("click", () => openPanel(searchPanel, { trigger: mobileSearchBtn, focusEl: $("#searchPanelInput") }));
    }
    if (searchCloseBtn) {
      searchCloseBtn.addEventListener("click", closePanel);
    }

    function handleSearchSubmit(query) {
      const q = (query || "").trim();
      if (q) {
        window.location.href = `shop.html?search=${encodeURIComponent(q)}`;
      } else {
        showToast("Type something to search stickers!");
      }
    }

    if (searchPanelForm) {
      searchPanelForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = $("#searchPanelInput");
        handleSearchSubmit(input ? input.value : "");
      });
    }

    if (headerSearchForm) {
      headerSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = $("#headerSearchInput");
        handleSearchSubmit(input ? input.value : "");
      });
    }
  }

  /* =========================================================
     8. ACTIVE NAVIGATION HIGHLIGHTER
     ========================================================= */

  function initActiveNav() {
    const path = window.location.pathname.toLowerCase();
    const navLinks = $$(".main-nav a, .drawer-nav a");

    navLinks.forEach(link => {
      const href = link.getAttribute("href")?.toLowerCase() || "";
      let isActive = false;

      if (path.endsWith("shop.html") && href.includes("shop.html")) isActive = true;
      else if (path.endsWith("categories.html") && href.includes("categories.html")) isActive = true;
      else if (path.endsWith("custom-stickers.html") && href.includes("custom-stickers.html")) isActive = true;
      else if ((path.endsWith("index.html") || path.endsWith("/") || path === "") && (href.endsWith("index.html") || href === "#main" || href === "/")) {
        if (!path.includes(".html") || path.endsWith("index.html")) isActive = true;
      }

      if (isActive) {
        link.classList.add("is-active");
      } else {
        link.classList.remove("is-active");
      }
    });
  }

  /* =========================================================
     8B. HEADER AUTHENTICATION STATE
     ========================================================= */

  function initHeaderAuth() {
    const accountBtn = $("#accountBtn");
    const drawerAccountLink = $("#drawerAccountLink");

    function renderAuthState(user) {
      if (user) {
        const firstName = window.CHIPAKK?.auth?.getFirstName ? window.CHIPAKK.auth.getFirstName(user) : (user.displayName ? user.displayName.split(" ")[0] : "Member");
        if (accountBtn) {
          accountBtn.setAttribute("aria-label", `Account - Signed in as ${firstName}`);
          accountBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>
            <span class="header-account-text">ACCOUNT / ${escapeHtml(firstName)}</span>
            <span class="auth-status-dot" title="Authenticated"></span>
          `;
          accountBtn.classList.add("is-authenticated");
        }
        if (drawerAccountLink) {
          drawerAccountLink.textContent = `My Account (${firstName})`;
        }
      } else {
        if (accountBtn) {
          accountBtn.setAttribute("aria-label", "Account - Sign In");
          accountBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>
            <span class="header-account-text">ACCOUNT / SIGN IN</span>
          `;
          accountBtn.classList.remove("is-authenticated");
        }
        if (drawerAccountLink) {
          drawerAccountLink.textContent = "My Account / Sign In";
        }
      }
    }

    if (window.CHIPAKK?.auth?.onAuthStateChanged) {
      window.CHIPAKK.auth.onAuthStateChanged(renderAuthState);
    } else {
      window.addEventListener("chipakk-auth-changed", (e) => {
        renderAuthState(e.detail?.user);
      });
    }

    if (accountBtn) {
      accountBtn.addEventListener("click", () => {
        window.location.href = "account.html";
      });
    }
  }


  /* =========================================================
     9. CIRCULAR LOADING OVERLAY LIFECYCLE
     ========================================================= */

  function initLoadingOverlay() {
    const overlay = $("#loadingOverlay");
    if (!overlay) return;

    let hidden = false;
    function hideOverlay() {
      if (hidden) return;
      hidden = true;
      overlay.setAttribute("data-hidden", "true");
      overlay.setAttribute("aria-hidden", "true");
      setTimeout(() => {
        overlay.style.display = "none";
      }, 500);
    }

    const minTimer = setTimeout(hideOverlay, 750);
    window.addEventListener("load", () => {
      clearTimeout(minTimer);
      setTimeout(hideOverlay, 250);
    });
    setTimeout(hideOverlay, 3500);
  }

  /* =========================================================
     10. NEWSLETTER & FOOTER HELPERS
     ========================================================= */

  function initFooter() {
    const yearEl = $("#footerYear");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    const newsletterForm = $("#newsletterForm");
    if (newsletterForm) {
      newsletterForm.addEventListener("submit", (e) => {
        e.preventDefault();
        showToast("Thanks for subscribing to CHIPAKK drops!");
        newsletterForm.reset();
      });
    }
  }

  /* =========================================================
     11. INIT APP ENGINE
     ========================================================= */

  function initApp() {
    initLoadingOverlay();
    initPanels();
    initActiveNav();
    initHeaderAuth();
    initFooter();
    renderGlobalCart();
    getStoreSettings().catch(err => console.warn("[CHIPAKK] Settings init notice:", err.message));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }

  /* =========================================================
     12. EXPORTED API FOR PAGE SCRIPTS
     ========================================================= */

  const existingAuth = window.CHIPAKK?.auth;

  window.CHIPAKK = {
    auth: existingAuth,
    DATA: CHIPAKK_DATA,
    API_BASE,
    fetchApi,
    fetchAuthenticated,
    validateCouponApi,
    createOrderApi,
    getCustomerOrdersApi,
    getCustomerOrderByIdApi,
    getCustomerAddressesApi,
    createCustomerAddressApi,
    updateCustomerAddressApi,
    deleteCustomerAddressApi,
    createPaymentOrderApi,
    verifyPaymentApi,
    getPaymentStatusApi,
    api: {
      fetchPublic: fetchApi,
      fetchAuthenticated,
      validateCoupon: validateCouponApi,
      createOrder: createOrderApi,
      getOrders: getCustomerOrdersApi,
      getOrderById: getCustomerOrderByIdApi,
      getAddresses: getCustomerAddressesApi,
      createAddress: createCustomerAddressApi,
      updateAddress: updateCustomerAddressApi,
      deleteAddress: deleteCustomerAddressApi,
      createPaymentOrder: createPaymentOrderApi,
      verifyPayment: verifyPaymentApi,
      getPaymentStatus: getPaymentStatusApi
    },
    cart,
    wishlist,
    getHeroData,
    getProducts,
    getProductById,
    getCategories,
    getEvents,
    getStoreSettings,
    formatPrice,
    starsMarkup,
    getRatingTier,
    renderProductCard,
    showToast,
    escapeHtml,
    escapeAttr,
    openCart: () => openPanel($("#cartDrawer")),
    $,
    $$
  };


})();
