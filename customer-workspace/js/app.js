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
      freeShippingThreshold: 300,
      shippingFee: 50,
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

  /* ---------------------------------------------------------
     SHARED MEDIA + CATALOG MODULES (js/media.js, js/catalog.js)
     One image resolver, one <img> builder, one product model and
     one product-card renderer for the whole storefront.
     --------------------------------------------------------- */
  if (!window.CHIPAKK_MEDIA || !window.CHIPAKK_CATALOG) {
    console.error("[CHIPAKK] js/media.js and js/catalog.js must load before js/app.js");
  }
  const media = window.CHIPAKK_MEDIA.createMedia({ apiBase: API_BASE });
  window.CHIPAKK_MEDIA.installFallback(document, (failedSrc) => {
    console.warn("[CHIPAKK Media] Image unavailable, showing placeholder:", failedSrc);
  });

  // Back-compat alias: every image reference is resolved by media.resolve()
  function resolveCustomerImageUrl(url) {
    return media.resolve(url);
  }

  function getActiveStoreId() {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const storeParam = urlParams.get('store_id') || urlParams.get('store');
      if (storeParam === '2' || storeParam === 'marshans' || storeParam === 'themarshans') return 2;
      if (storeParam === '1' || storeParam === 'chipakk') return 1;
      const host = (window.location.hostname || '').toLowerCase();
      if (host === 'themarshans.shop' || host === 'www.themarshans.shop') return 2;
      if (host === 'chipakk.shop' || host === 'www.chipakk.shop') return 1;
      if (window.CHIPAKK_STORE_ID) return Number(window.CHIPAKK_STORE_ID);
      try {
        const stored = localStorage.getItem('chipakk_active_store_id');
        if (stored) return Number(stored);
      } catch (_) {}
    }
    return 1;
  }

  // In-memory session cache to avoid duplicate API requests during a single page visit
  const apiCache = new Map();
  const inflightRequests = new Map();

  function extractApiErrorMessage(errJson, fallback = "An unexpected error occurred") {
    if (!errJson) return fallback;
    if (typeof errJson === "string") return errJson;
    if (typeof errJson === "object") {
      if (errJson.error) {
        if (typeof errJson.error === "string") return errJson.error;
        if (typeof errJson.error === "object" && errJson.error.message) {
          return String(errJson.error.message);
        }
      }
      if (errJson.message) {
        if (typeof errJson.message === "string") return errJson.message;
        if (typeof errJson.message === "object" && errJson.message.message) {
          return String(errJson.message.message);
        }
      }
    }
    return fallback;
  }

  async function fetchApi(endpoint, options = {}) {
    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const cleanEndpoint = endpoint.replace(/^\/?api\//i, '').replace(/^\//, '');
    const isPrivateEndpoint = /^(orders|payments|addresses|cart|admin|users|auth)(\/|$)/i.test(cleanEndpoint);
    const hasAuthHeader = Boolean(options.headers && (options.headers['Authorization'] || options.headers['authorization']));
    const isAuthOrCustomerPrivate = isPrivateEndpoint || hasAuthHeader || /^customer(\/|$)/i.test(cleanEndpoint);
    const storeId = options.storeId || (options.headers && (options.headers['X-Store-ID'] || options.headers['x-store-id'])) || getActiveStoreId();
    const isGet = !options.method || options.method === "GET";
    const cacheKey = `${options.method || "GET"}:store${storeId}:${url}`;

    if (!options.refresh && !isPrivateEndpoint && !isAuthOrCustomerPrivate && isGet) {
      if (apiCache.has(cacheKey)) {
        return apiCache.get(cacheKey);
      }
      if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey);
      }
    }

    const controller = (typeof AbortController !== "undefined" && !options.signal) ? new AbortController() : null;
    const timeoutMs = options.timeout !== undefined ? options.timeout : (options.method === "POST" ? 45000 : 15000);
    const timeoutId = (controller && timeoutMs > 0) ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const requestPromise = (async () => {
      try {
        const fetchSignal = options.signal || (controller ? controller.signal : undefined);
        const res = await fetch(url, {
          headers: {
            "Accept": "application/json",
            "X-Store-ID": String(storeId),
            ...(options.headers || {})
          },
          signal: fetchSignal,
          ...options
        });

        if (timeoutId) clearTimeout(timeoutId);

        if (!res.ok) {
          let errMsg = `HTTP ${res.status}: ${res.statusText}`;
          try {
            const errJson = await res.json();
            errMsg = extractApiErrorMessage(errJson, errMsg);
          } catch (_) {}
          const errorObj = new Error(errMsg);
          errorObj.status = res.status;
          throw errorObj;
        }

        const json = await res.json();
        const payload = json && typeof json === "object" && "data" in json ? json.data : json;
        if (!isPrivateEndpoint && !isAuthOrCustomerPrivate && isGet) {
          apiCache.set(cacheKey, payload);
        }
        return payload;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        console.warn(`[CHIPAKK API] Failed to fetch ${endpoint}:`, err.message);
        throw err;
      } finally {
        inflightRequests.delete(cacheKey);
      }
    })();

    if (!isPrivateEndpoint && !isAuthOrCustomerPrivate && isGet) {
      inflightRequests.set(cacheKey, requestPromise);
    }

    return requestPromise;
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
          "Accept": "application/json",
          "X-Store-ID": String(getActiveStoreId() || 1)
        },
        body: JSON.stringify({
          code: cleanCode,
          subtotal_in_rupees: Math.max(0, Math.round(subtotalRupees))
        })
      });

      const json = await res.json().catch(() => ({}));

      if (res.status >= 500) {
        // Never surface server wording for unexpected failures
        return { valid: false, serverError: true, message: "We couldn't check that code right now. Please try again in a moment." };
      }
      if (!res.ok || !json.success) {
        return {
          valid: false,
          message: extractApiErrorMessage(json, "Invalid or inactive coupon code.")
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
   * Fetch Authenticated Customer Profile
   * GET /api/customer/me
   */
  async function getCustomerProfileApi() {
    return fetchAuthenticated("/customer/me");
  }

  /**
   * Update Authenticated Customer Profile (full_name, phone)
   * PUT /api/customer/me
   */
  async function updateCustomerProfileApi(profileData) {
    return fetchAuthenticated("/customer/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileData)
    });
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

  const catalog = window.CHIPAKK_CATALOG.createCatalog({
    media,
    formatPrice: (n) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN"),
    storeId: () => getActiveStoreId()
  });

  function normalizeProduct(p) {
    return catalog.normalizeProduct(p);
  }

  function normalizeCategory(c) {
    return catalog.normalizeCategory(c);
  }

  function normalizeSettings(s) {
    if (!s) return CHIPAKK_DATA.settings;
    const actual = (s.settings && typeof s.settings === "object") ? s.settings : s;

    const storeName = actual.store_name || actual.storeName || "CHIPAKK";
    const storeStatus = (actual.store_status || "OPEN").toUpperCase();
    const maintenanceActive = actual.maintenance_active === true || actual.maintenance_active === "true" || storeStatus === "MAINTENANCE";
    const storeClosed = storeStatus === "TEMPORARILY CLOSED";
    const storeOpen = !maintenanceActive && !storeClosed;
    const maintenanceMessage = actual.maintenance_message || actual.maintenance_msg || (storeClosed ? "Storefront is temporarily closed." : "We are currently down for scheduled maintenance.");

    let freeShippingThreshold = 300;
    if (actual.free_shipping_threshold_rupees !== undefined && actual.free_shipping_threshold_rupees !== null) {
      freeShippingThreshold = Number(actual.free_shipping_threshold_rupees);
    } else if (actual.free_shipping_threshold !== undefined && actual.free_shipping_threshold !== null) {
      const raw = Number(actual.free_shipping_threshold);
      // For Store 1, values are whole rupees (e.g. 300). Only legacy paise > 10000 might need scaling.
      freeShippingThreshold = raw >= 10000 ? Math.round(raw / 100) : raw;
    } else if (actual.freeShippingThreshold !== undefined && actual.freeShippingThreshold !== null) {
      freeShippingThreshold = Number(actual.freeShippingThreshold);
    }

    let shippingFee = 50;
    if (actual.shipping_fee_rupees !== undefined && actual.shipping_fee_rupees !== null) {
      shippingFee = Number(actual.shipping_fee_rupees);
    } else if (actual.shipping_fee !== undefined && actual.shipping_fee !== null) {
      const raw = Number(actual.shipping_fee);
      shippingFee = raw >= 1000 ? Math.round(raw / 100) : raw;
    }

    const gstRate = actual.gst_pct !== undefined ? Number(actual.gst_pct) : (actual.gst_rate !== undefined ? Number(actual.gst_rate) : 0);
    const gstin = actual.gstin || "";
    // GST is permanently inactive: gstEnabled defaults to false, checkoutTaxReady is always true
    const gstEnabled = actual.gst_enabled === true;
    const checkoutTaxReady = actual.checkout_tax_ready !== false;
    const tradeName = actual.trade_name || storeName;
    const legalSupplierName = actual.legal_supplier_name || "";

    const announcementActive = actual.announcement_active !== false && Boolean(actual.announcement_text);
    const announcementText = actual.announcement_text || "";

    return {
      storeName,
      storeStatus,
      storeOpen,
      maintenanceActive,
      storeClosed,
      maintenanceMessage,
      maintenanceImage: actual.maintenance_image || "",
      freeShippingThreshold,
      shippingFee,
      currency: actual.currency || "INR",
      currencySymbol: "₹",
      gstRate,
      gstin,
      gstEnabled,
      checkoutTaxReady,
      tradeName,
      legalSupplierName,
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

    // 5. Let page scripts (checkout totals) recompute with the real store settings
    try { window.dispatchEvent(new CustomEvent("chipakk-settings-updated", { detail: { settings } })); } catch (_) {}
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
    // Free shipping is INCLUSIVE: a gross subtotal >= threshold ships free ("₹300+"), never "> ₹300".
    const thresh = (settings && settings.freeShippingThreshold !== undefined && settings.freeShippingThreshold !== null)
      ? Number(settings.freeShippingThreshold)
      : 300;
    const formatted = formatPrice(thresh);
    const fee = (settings && settings.shippingFee !== undefined && settings.shippingFee !== null) ? Number(settings.shippingFee) : 50;

    const trustEl = $("#trustFreeShippingSub");
    if (trustEl) {
      trustEl.textContent = thresh > 0 ? `On orders of ${formatted}+` : `On all orders`;
    }

    const prodBadge = $("#prodFreeShippingBadge");
    if (prodBadge) {
      prodBadge.textContent = thresh > 0 ? `Free Shipping on Orders of ${formatted}+` : `Free Shipping on All Orders`;
    }

    const checkoutBadge = $("#checkoutShippingRuleBadge");
    if (checkoutBadge) {
      checkoutBadge.textContent = thresh > 0 ? `${formatPrice(fee)} · FREE ${formatted}+` : `FREE Shipping`;
    }
    const checkoutNote = $("#checkoutShippingRuleNote");
    if (checkoutNote) {
      checkoutNote.textContent = thresh > 0
        ? `Rigid stay-flat cardboard mailer • Free on orders ${formatted}+`
        : `Rigid stay-flat cardboard mailer • Free shipping on all orders`;
    }

    $$(".cart-note").forEach(el => {
      el.textContent = thresh > 0 ? `Free shipping automatically applied on orders of ${formatted} or more.` : `Free shipping applied on all orders.`;
    });
  }

  /* ---------------------------------------------------------
     ASYNC REPOSITORY FUNCTIONS (API-BACKED)
     --------------------------------------------------------- */

  // One in-flight catalog load shared by every caller on the page (home, cart checks, ...)
  let catalogInflight = null;

  function forActiveStore(list) {
    const storeId = getActiveStoreId();
    return list.filter((p) => p && (p.store_id === undefined || p.store_id === null || Number(p.store_id) === Number(storeId)));
  }

  async function loadFullCatalog(params, fetchOpts) {
    const PAGE_CHUNK = 100;
    const MAX_PAGES = 20; // safe termination ceiling
    const seenIds = new Set();
    const all = [];
    const pageUrl = (offset) => {
      const p = new URLSearchParams(params.toString());
      p.set("limit", PAGE_CHUNK);
      p.set("offset", offset);
      return `/products?${p.toString()}`;
    };
    const rowsOf = (data) => (Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []));
    const take = (data) => {
      for (const item of rowsOf(data)) {
        const norm = normalizeProduct(item);
        if (norm && !seenIds.has(norm.id)) { seenIds.add(norm.id); all.push(norm); }
      }
    };

    // Page 1 reveals `total`; every remaining page is then requested IN PARALLEL, so the loader waits for two
    // round-trips whatever the catalogue size (sequential paging cost one round-trip per 100 products).
    const first = await fetchApi(pageUrl(0), fetchOpts);
    const firstRows = rowsOf(first);
    const total = (first && typeof first.total === "number") ? first.total : firstRows.length;
    take(first);
    if (firstRows.length >= PAGE_CHUNK && total > firstRows.length) {
      const pages = Math.min(Math.ceil(total / PAGE_CHUNK), MAX_PAGES);
      const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchApi(pageUrl((i + 1) * PAGE_CHUNK), fetchOpts)));
      rest.forEach(take); // in offset order, so the catalogue order is identical to sequential paging
    }
    return forActiveStore(all);
  }

  async function getProducts(options = {}) {
    try {
      const params = new URLSearchParams();
      if (options.category_id !== undefined && options.category_id !== null && options.category_id !== '') {
        params.set('category_id', options.category_id);
      }
      if (options.search) params.set('search', options.search);
      if (options.active !== undefined && options.active !== null) params.set('active', options.active);
      if (options.featured !== undefined && options.featured !== null) params.set('featured', options.featured);
      if (options.is_best_seller !== undefined && options.is_best_seller !== null) params.set('is_best_seller', options.is_best_seller);
      if (options.drop_status) params.set('drop_status', options.drop_status);

      const fetchOpts = { ...(options.fetchOptions || {}), ...(options.refresh ? { refresh: true } : {}) };

      // Single-page pagination explicitly requested
      if (options.offset !== undefined || options.page !== undefined) {
        const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 100);
        const offset = options.offset !== undefined
          ? Math.max(parseInt(options.offset, 10) || 0, 0)
          : Math.max(((parseInt(options.page, 10) || 1) - 1) * limit, 0);

        params.set('limit', limit);
        params.set('offset', offset);

        const data = await fetchApi(`/products?${params.toString()}`, fetchOpts);
        const rawList = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
        const total = (data && typeof data.total === 'number') ? data.total : rawList.length;
        return {
          products: forActiveStore(rawList.map(normalizeProduct).filter(Boolean)),
          total,
          limit,
          offset,
          hasMore: offset + rawList.length < total
        };
      }

      const isPlainCatalogQuery = (options.category_id === undefined || options.category_id === null || options.category_id === '') &&
        !options.search && options.active === undefined && options.featured === undefined &&
        options.is_best_seller === undefined && !options.drop_status;

      if (isPlainCatalogQuery && !options.refresh) {
        if (Array.isArray(CHIPAKK_DATA.products) && CHIPAKK_DATA.products.length > 0) return CHIPAKK_DATA.products;
        if (catalogInflight) return await catalogInflight;
      }

      const run = loadFullCatalog(params, fetchOpts).then((list) => {
        if (isPlainCatalogQuery) CHIPAKK_DATA.products = list;
        return list;
      });
      if (isPlainCatalogQuery) {
        catalogInflight = run.finally(() => { catalogInflight = null; });
        return await catalogInflight;
      }
      return await run;
    } catch (err) {
      if (options.strict) throw err;
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
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.categories) ? data.categories : []);
      if (Array.isArray(list) && list.length > 0) {
        const normalized = list
          .map(normalizeCategory)
          .filter(c => c && c.active && (c.name || '').toLowerCase().trim() !== 'best seller' && (c.slug || '').toLowerCase().trim() !== 'best-seller');
        CHIPAKK_DATA.categories = normalized;
        return normalized;
      }
      return [];
    } catch (err) {
      console.warn("[CHIPAKK] Falling back to local categories repository:", err.message);
      return (CHIPAKK_DATA.categories || [])
        .map(normalizeCategory)
        .filter(c => c && c.active && (c.name || '').toLowerCase().trim() !== 'best seller' && (c.slug || '').toLowerCase().trim() !== 'best-seller');
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

  /* =========================================================
     2.5 AUTHENTICATION / LOGIN PROMPT MODAL
     ========================================================= */

  let pendingCartAction = null;

  function ensureLoginModal() {
    if (typeof document === "undefined" || !document.body) return null;
    let modal = document.getElementById("customerLoginModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "order-success-modal";
    modal.id = "customerLoginModal";
    modal.style.display = "none";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "loginModalTitle");

    modal.innerHTML = `
      <div class="order-success-card" style="text-align: left; max-width: 440px; padding: 28px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 2px solid var(--black); padding-bottom: 12px;">
          <div>
            <span style="display: inline-block; font-size: 11px; font-weight: 800; text-transform: uppercase; background: var(--yellow); border: 1.5px solid var(--black); border-radius: 4px; padding: 2px 8px; margin-bottom: 6px; box-shadow: 1px 1px 0 var(--black);">Sign In Required</span>
            <h3 style="font-family: var(--font-display); font-size: 22px; text-transform: uppercase; margin: 0;" id="loginModalTitle">Sign In to Continue</h3>
          </div>
          <button type="button" class="panel-close" id="closeLoginModalBtn" aria-label="Close modal" style="font-size: 16px;">✕</button>
        </div>
        <p style="font-size: 13px; color: #444; margin: 0 0 16px 0; line-height: 1.4;" id="loginModalSubtitle">
          Please sign in to your account to add items to your cart.
        </p>
        <div class="auth-alert-error" id="loginModalError" style="display: none; background: #fef2f2; border: 1.5px solid #b91c1c; color: #991b1b; padding: 8px 12px; font-size: 13px; font-weight: 600; border-radius: var(--radius-sm); margin-bottom: 14px;"></div>
        <form id="loginModalForm" novalidate>
          <div class="form-field" style="margin-bottom: 12px;">
            <label for="loginModalEmail" style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Email Address *</label>
            <input type="email" id="loginModalEmail" required placeholder="you@domain.com" autocomplete="email" style="width: 100%; border: 2px solid var(--black); border-radius: var(--radius-sm); padding: 9px 12px; font-family: inherit; font-size: 14px;" />
          </div>
          <div class="form-field" style="margin-bottom: 16px;">
            <label for="loginModalPassword" style="font-size: 12px; font-weight: 700; display: block; margin-bottom: 4px;">Password *</label>
            <input type="password" id="loginModalPassword" required placeholder="Your password" autocomplete="current-password" style="width: 100%; border: 2px solid var(--black); border-radius: var(--radius-sm); padding: 9px 12px; font-family: inherit; font-size: 14px;" />
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="loginModalSubmitBtn" style="width: 100%; padding: 12px; font-size: 14px; font-weight: 700; margin-bottom: 10px;">Sign In & Add to Cart</button>
        </form>
        <div style="text-align: center; margin: 10px 0 12px 0; position: relative;">
          <span style="background: var(--white); padding: 0 10px; font-size: 12px; font-weight: 700; color: #888; position: relative; z-index: 1;">OR</span>
          <div style="position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #ddd; z-index: 0;"></div>
        </div>
        <button type="button" class="btn btn-block google-auth-btn" id="loginModalGoogleBtn" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: #ffffff; border: 2px solid var(--black); border-radius: var(--radius-sm); padding: 10px; font-weight: 700; font-size: 13px; cursor: pointer; box-shadow: 2px 2px 0 var(--black); margin-bottom: 14px;">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
          Sign in with Google
        </button>
        <div style="text-align: center; font-size: 12px; color: #555;">
          Don't have an account? <a href="account.html" id="loginModalSignupLink" style="font-weight: 700; color: var(--blue); text-decoration: underline;">Create one →</a>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector("#closeLoginModalBtn");
    const form = modal.querySelector("#loginModalForm");
    const googleBtn = modal.querySelector("#loginModalGoogleBtn");
    const errorBox = modal.querySelector("#loginModalError");
    const submitBtn = modal.querySelector("#loginModalSubmitBtn");

    const hide = () => {
      modal.style.display = "none";
      if (errorBox) {
        errorBox.style.display = "none";
        errorBox.textContent = "";
      }
      form?.reset();
      pendingCartAction = null;
    };

    modal.addEventListener("click", (e) => {
      if (e.target === modal) hide();
    });
    closeBtn?.addEventListener("click", hide);

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = modal.querySelector("#loginModalEmail")?.value.trim();
      const password = modal.querySelector("#loginModalPassword")?.value;

      if (!email || !password) {
        if (errorBox) {
          errorBox.style.display = "block";
          errorBox.textContent = "Please enter both email and password.";
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Signing In...";
      if (errorBox) errorBox.style.display = "none";

      try {
        if (window.CHIPAKK?.auth?.signIn) {
          await window.CHIPAKK.auth.signIn(email, password);
        }
        const action = pendingCartAction;
        hide();
        if (action && typeof action.onSuccess === "function") {
          action.onSuccess();
        }
      } catch (err) {
        if (errorBox) {
          errorBox.style.display = "block";
          errorBox.textContent = err.message || "Failed to sign in. Please check your credentials.";
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In & Add to Cart";
      }
    });

    googleBtn?.addEventListener("click", async () => {
      googleBtn.disabled = true;
      if (errorBox) errorBox.style.display = "none";
      try {
        if (window.CHIPAKK?.auth?.signInWithGoogle) {
          await window.CHIPAKK.auth.signInWithGoogle();
        }
        const action = pendingCartAction;
        hide();
        if (action && typeof action.onSuccess === "function") {
          action.onSuccess();
        }
      } catch (err) {
        if (errorBox) {
          errorBox.style.display = "block";
          errorBox.textContent = err.message || "Google sign-in was not completed.";
        }
      } finally {
        googleBtn.disabled = false;
      }
    });

    return modal;
  }

  function showLoginPrompt({ productName, onSuccess, onCancel } = {}) {
    const modal = ensureLoginModal();
    pendingCartAction = { productName, onSuccess, onCancel };

    if (modal) {
      const subtitle = modal.querySelector("#loginModalSubtitle");
      if (subtitle) {
        subtitle.textContent = productName
          ? `Please sign in to add "${productName}" to your cart.`
          : "Please sign in to add items to your cart.";
      }
      modal.style.display = "flex";
      const emailInput = modal.querySelector("#loginModalEmail");
      if (emailInput) setTimeout(() => emailInput.focus(), 50);
    }
  }

  const CART_STORAGE_KEY = "chipakk_cart_v1";

  function getCartStorageKey() {
    const storeId = typeof getActiveStoreId === 'function' ? getActiveStoreId() : (typeof window !== 'undefined' && window.CHIPAKK?.getActiveStoreId ? window.CHIPAKK.getActiveStoreId() : 1);
    return storeId === 2 ? "marshans_cart_v1" : "chipakk_cart_v1";
  }

  /* =========================================================
     3. PERSISTENT CART MANAGER (localStorage)
     ========================================================= */

  class CartManager {
    constructor() {
      this.items = this.load();
      this._lastAddKey = null;
      this._lastAddTime = 0;
    }

    load() {
      try {
        const key = getCartStorageKey();
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        // NOTE: do not "self-heal" prices by dividing values >= 1000 by 100 (CHIPAKK legitimately
        // sells at >= ₹1000). The server recomputes every price from product_id at checkout.
        // Images ARE re-resolved on load: older carts persisted URLs that were resolved against the
        // wrong origin (https://chipakk.shop/uploads/...) - the shared resolver rewrites those.
        return parsed
          .filter((item) => item && typeof item === "object" && item.variantKey)
          .map((item) => {
            const qty = parseInt(item.qty, 10);
            const image = typeof item.image === "string" ? media.resolve(item.image) : "";
            return { ...item, qty: qty > 0 ? qty : 1, image };
          });
      } catch (e) {
        console.warn("[CHIPAKK] Failed to load cart from localStorage", e);
        return [];
      }
    }

    save() {
      try {
        const key = getCartStorageKey();
        localStorage.setItem(key, JSON.stringify(this.items));
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
      if (!product) return false;

      // 1. Store isolation guard
      const activeStore = typeof getActiveStoreId === 'function' ? getActiveStoreId() : (typeof window !== 'undefined' && window.CHIPAKK?.getActiveStoreId ? window.CHIPAKK.getActiveStoreId() : 1);
      const prodStore = product.store_id || product.storeId;
      if (prodStore && Number(prodStore) !== activeStore) {
        console.warn(`[CHIPAKK Cart] Store isolation rejection: product store (${prodStore}) does not match active store (${activeStore})`);
        if (typeof showToast === 'function') showToast("This item is not available in the current store.", "error");
        return false;
      }

      // 2. Rapid double-click debounce (< 350ms)
      const now = Date.now();
      const clickKey = `${product.id || ''}_${options.material || ''}_${options.size || ''}_${options.variantId || ''}`;
      if (!options.skipAuthCheck && this._lastAddKey === clickKey && (now - this._lastAddTime) < 350) {
        return false;
      }
      this._lastAddKey = clickKey;
      this._lastAddTime = now;

      // 3. Login Gate: require authenticated customer
      const user = (typeof window !== 'undefined' && window.CHIPAKK?.auth?.getCurrentUser) ? window.CHIPAKK.auth.getCurrentUser() : null;
      if (!user && !options.skipAuthCheck) {
        if (typeof showLoginPrompt === 'function') {
          showLoginPrompt({
            productName: product.name,
            onSuccess: () => {
              this.addItem(product, qty, { ...options, skipAuthCheck: true });
              if (typeof options.onAdded === "function") options.onAdded();
            },
            onCancel: options.onCancel
          });
        }
        return false;
      }

      // 4. Continue with item preparation & storage
      const material = options.material || (product.materials && product.materials[0]) || "Glossy";
      const size = options.size || (product.sizes && product.sizes[0]) || '3"';
      const isCustom = Boolean(product.is_custom || (!product.id && product.name) || String(product.id || '').startsWith('custom_'));
      const variantId = options.variantId || product.variantId || product.variant_id || null;
      const variantKey = isCustom
        ? `custom_${product.id || Date.now()}_${material}_${size}`.toLowerCase().replace(/[^a-z0-9]/g, "_")
        : (variantId ? `${product.id}_v${variantId}` : `${product.id}_${material}_${size}`).toLowerCase().replace(/[^a-z0-9]/g, "_");

      // One resolver for every image reference (gallery first, then the primary image)
      const resolvedImage = media.resolveFirst(product.images) || media.resolve(product.imageUrl) || media.resolve(product.image) || "";

      const existingIndex = this.items.findIndex(i => i.variantKey === variantKey);
      if (existingIndex > -1) {
        this.items[existingIndex].qty += qty;
        if (product.custom_design_data) {
          this.items[existingIndex].custom_design_data = product.custom_design_data;
        }
      } else {
        this.items.push({
          id: product.id,
          store_id: activeStore,
          variantId: variantId,
          variantKey,
          name: product.name,
          price: options.price !== undefined ? options.price : product.price,
          // GST rate of this product (product > category); null = the store default. The server re-resolves it.
          gstRate: product.gstRate === undefined ? null : product.gstRate,
          image: resolvedImage,
          material,
          size,
          options: options.selectedOptions || { material, size },
          options_snapshot: options.selectedOptions || { material, size },
          materials: product.materials || (material ? [material] : []),
          sizes: product.sizes || (size ? [size] : []),
          is_custom: isCustom,
          custom_design_data: product.custom_design_data || null,
          qty
        });
      }
      this.save();
      if (typeof showToast === 'function') showToast(`${product.name} added to cart!`);

      // Background server cart sync when authenticated
      if (user && product.id && !isCustom && !isNaN(Number(product.id)) && typeof fetchAuthenticated === 'function') {
        fetchAuthenticated('/cart/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: Number(product.id),
            variant_id: variantId ? Number(variantId) : null,
            quantity: qty,
            options: options.selectedOptions || { material, size }
          })
        }).catch(err => {
          console.warn('[CHIPAKK Cart] Server cart sync notice:', err.message);
        });
      }

      return true;
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
      return 300;
    }

    getShippingFee() {
      const subtotal = this.getSubtotal();
      if (subtotal === 0) return 0;
      const thresh = this.getShippingThreshold();
      if (thresh > 0 && subtotal >= thresh) return 0;
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
    return "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
  }

  const { starsMarkup, getRatingTier } = window.CHIPAKK_CATALOG;

  function escapeHtml(str) {
    return String(str === undefined || str === null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  /* =========================================================
     REUSABLE PRODUCT CARD (single renderer: js/catalog.js)
     ========================================================= */

  function renderProductCard(p, options = {}) {
    if (!p) return "";
    const isWishlisted = options.isWishlisted !== undefined ? options.isWishlisted : wishlist.has(p.id);
    return catalog.productCardHtml(p, { ...options, isWishlisted });
  }

  /** Whole grid: tolerant of non-arrays, de-duplicates ids, eager-loads the first row. */
  function renderProductGrid(list, options = {}) {
    return catalog.productGridHtml(list, {
      mode: options.mode,
      emptyHtml: options.emptyHtml,
      priorityCount: options.priorityCount,
      isWishlisted: options.isWishlisted || ((p) => wishlist.has(p.id))
    });
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
      const lineTotal = item.price * item.qty;
      const thumb = media.imgHtml({ src: item.image, alt: "", width: 64, height: 64 });

      return `
        <div class="cart-item" data-variant-key="${escapeAttr(item.variantKey)}">
          <div class="cart-item-media">${thumb}</div>
          <div class="cart-item-info">
            <div class="cart-item-header">
              <h4 class="cart-item-name">${escapeHtml(item.name)}</h4>
              <button class="cart-item-remove" type="button" data-remove-item="${escapeAttr(item.variantKey)}" aria-label="Remove ${escapeAttr(item.name)}" title="Remove item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="cart-item-variant">${escapeHtml(item.material || "Glossy")} • ${escapeHtml(item.size || '3"')}</div>
            <div class="cart-item-bottom">
              <div class="cart-qty-stepper">
                <button type="button" class="cart-qty-btn" data-qty-decrease="${escapeAttr(item.variantKey)}" aria-label="Decrease quantity">−</button>
                <span class="cart-qty-val">${item.qty}</span>
                <button type="button" class="cart-qty-btn" data-qty-increase="${escapeAttr(item.variantKey)}" aria-label="Increase quantity">+</button>
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

    async function handleSearchSubmit(query) {
      const q = (query || "").trim();
      if (!q) {
        showToast("Type something to search stickers!");
        return;
      }

      // Priority 1 & 2: Check if query matches a category in the active store
      try {
        let categories = CHIPAKK_DATA.categories;
        if (!Array.isArray(categories) || categories.length === 0) {
          categories = await getCategories();
        }
        const matched = catalog.matchCategoryQuery(q, categories);
        if (matched && matched.slug) {
          window.location.href = `shop.html?category=${encodeURIComponent(matched.slug)}`;
          return;
        }
      } catch (err) {
        console.warn("[CHIPAKK Search] Category match lookup notice:", err);
      }

      // Priority 3: Fallback to standard product text search
      window.location.href = `shop.html?search=${encodeURIComponent(q)}`;
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
    let previousUser = undefined;

    async function renderAuthState(user) {
      if (previousUser && !user) {
        cart.clear();
      }
      previousUser = user;

      if (user) {
        // Enforce Admin vs Customer Isolation: verify via /customer/me
        try {
          const meData = await fetchAuthenticated("/customer/me");
          if (meData && meData.is_admin) {
            // Logged in user is an Administrator — do NOT display admin identity on customer storefront
            renderSignedOutHeader();
            return;
          }
        } catch (_) {}

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
        renderSignedOutHeader();
      }
    }

    function renderSignedOutHeader() {
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

  /**
   * State-driven loader shared by every storefront page.
   *
   *   const done = CHIPAKK.loader.hold("products");   // synchronously, at script start
   *   try { await ...critical work... } finally { done(); }
   *
   * The overlay fades out as soon as (a) the DOM is ready AND (b) every hold has been
   * released. There is no fixed delay. Holds must be released in a `finally`, so a failed
   * API request can never keep the overlay up; a hard ceiling (MAX_WAIT_MS) is the last
   * line of defence against a hung request/handler, not part of the normal lifecycle.
   * Nothing here waits for the window "load" event, so large non-critical assets (images,
   * the loader video itself) can never delay the content.
   */
  const loader = (() => {
    const MAX_WAIT_MS = Number(window.CHIPAKK_LOADER_MAX_WAIT_MS) || 8000; // override only in tests
    const holds = new Map();
    let seq = 0;
    let domReady = document.readyState !== "loading";
    let hidden = false;
    let checkQueued = false;

    const overlayEl = () => document.getElementById("loadingOverlay");

    function startVideo() {
      const vid = overlayEl()?.querySelector("video");
      if (!vid) return;
      // iOS/Android autoplay policy: the *property* must be muted + inline before play()
      vid.muted = true;
      vid.defaultMuted = true;
      vid.playsInline = true;
      vid.setAttribute("webkit-playsinline", "");
      const played = vid.play();
      if (played && typeof played.catch === "function") played.catch(() => { /* badge stays visible */ });
    }

    function hide(reason) {
      if (hidden) return;
      hidden = true;
      const overlay = overlayEl();
      if (!overlay) return;
      overlay.setAttribute("data-hidden", "true");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("data-hide-reason", reason);
      const vid = overlay.querySelector("video");
      const finish = () => {
        overlay.style.display = "none";
        if (vid) { try { vid.pause(); } catch (_) {} }
      };
      overlay.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 600); // cleanup only: the overlay is already fading
    }

    function check() {
      checkQueued = false;
      if (hidden) return;
      if (domReady && holds.size === 0) hide("ready");
    }

    // Evaluate on the frame *after* the current task so every synchronous hold() taken by
    // page scripts during DOMContentLoaded is visible before we decide.
    function queueCheck() {
      if (checkQueued || hidden) return;
      checkQueued = true;
      requestAnimationFrame(check);
    }

    function hold(name) {
      const id = ++seq;
      holds.set(id, name || "task");
      let released = false;
      return function release() {
        if (released) return;
        released = true;
        holds.delete(id);
        queueCheck();
      };
    }

    function init() {
      startVideo();
      // init() runs from the DOMContentLoaded handler (or later), never while parsing, so the
      // DOM is ready here. Re-read the state instead of relying on the value captured at load.
      domReady = document.readyState !== "loading";
      if (domReady) queueCheck();
      else document.addEventListener("DOMContentLoaded", () => { domReady = true; queueCheck(); }, { once: true });
      setTimeout(() => {
        if (!hidden) {
          console.warn("[CHIPAKK Loader] Ceiling reached; releasing overlay. Pending:", Array.from(holds.values()));
          hide("ceiling");
        }
      }, MAX_WAIT_MS);
      // Back/forward cache restore must never resurrect a stale overlay
      window.addEventListener("pageshow", (e) => { if (e.persisted) hide("pageshow"); });
    }

    return { hold, init, isHidden: () => hidden, pending: () => Array.from(holds.values()) };
  })();

  function initLoadingOverlay() {
    loader.init();
  }

  /* =========================================================
     10. NEWSLETTER & FOOTER HELPERS
     ========================================================= */

  async function renderFooterCategories() {
    const listEl = $("#footerCategoryList");
    if (!listEl) return;

    try {
      let categories = CHIPAKK_DATA.categories;
      if (!Array.isArray(categories) || categories.length === 0) {
        categories = await getCategories();
      }
      const activeCats = (categories || []).filter(c => c && c.active !== false && c.slug).slice(0, 6);
      if (activeCats.length > 0) {
        listEl.innerHTML = activeCats.map(c => `
          <li>
            <a href="shop.html?category=${encodeURIComponent(c.slug)}">
              ${escapeHtml(c.name)}
            </a>
          </li>
        `).join("");
      } else {
        listEl.innerHTML = `<li><a href="shop.html">All Stickers</a></li><li><a href="categories.html">All Categories</a></li>`;
      }
    } catch (err) {
      console.warn("[CHIPAKK Footer] Could not load dynamic categories:", err);
      listEl.innerHTML = `<li><a href="shop.html">All Stickers</a></li><li><a href="categories.html">All Categories</a></li>`;
    }
  }

  function initFooter() {
    const yearEl = $("#footerYear");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    const brandNameEl = $("#footerBrandName");
    if (brandNameEl) {
      brandNameEl.textContent = getActiveStoreId() === 2 ? "THE MARSHANS" : "CHIPAKK";
    }

    const newsletterForm = $("#newsletterForm");
    if (newsletterForm) {
      newsletterForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const storeLabel = getActiveStoreId() === 2 ? "THE MARSHANS" : "CHIPAKK";
        showToast(`Thanks for subscribing to ${storeLabel} drops!`);
        newsletterForm.reset();
      });
    }

    // Populate dynamic categories
    renderFooterCategories();

    // Friendly click feedback for placeholder support/policy links
    document.addEventListener("click", (e) => {
      const link = e.target.closest("a[data-placeholder]");
      if (link) {
        const href = link.getAttribute("href") || "";
        if (href.startsWith("#")) {
          e.preventDefault();
          const placeholderMsg = link.dataset.placeholder || "Coming soon";
          if (placeholderMsg.includes("INSTAGRAM") || placeholderMsg.includes("YOUTUBE")) {
            showToast("Official social channel launching soon!");
          } else {
            showToast("This policy is currently being updated for compliance. Coming soon!");
          }
        }
      }
    });
  }

  /* =========================================================
     11. INIT APP ENGINE
     ========================================================= */

  function initHeaderCollapse() {
    const header = document.querySelector(".site-header");
    if (!header) return;
    const apply = () => {
      const bars = header.querySelectorAll("#globalAnnouncementBar, .brand-family-bar");
      let h = 0;
      bars.forEach((el) => { if (el.offsetParent !== null) h += el.getBoundingClientRect().height; });
      document.documentElement.style.setProperty("--header-collapse", `${Math.round(h)}px`);
    };
    apply();
    window.addEventListener("resize", apply, { passive: true });
    window.addEventListener("chipakk-settings-updated", apply);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(apply);
      header.querySelectorAll("#globalAnnouncementBar, .brand-family-bar").forEach((el) => ro.observe(el));
    }
  }

  function initApp() {
    initLoadingOverlay();
    initHeaderCollapse();
    initPanels();
    initActiveNav();
    initHeaderAuth();
    initFooter();
    renderGlobalCart();
    const releaseSettings = loader.hold("settings");
    getStoreSettings()
      .catch(err => console.warn("[CHIPAKK] Settings init notice:", err.message))
      .finally(releaseSettings);
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
    getActiveStoreId,
    DATA: CHIPAKK_DATA,
    API_BASE,
    fetchApi,
    fetchAuthenticated,
    validateCouponApi,
    createOrderApi,
    getCustomerOrdersApi,
    getCustomerOrderByIdApi,
    getCustomerProfileApi,
    updateCustomerProfileApi,
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
      getProfile: getCustomerProfileApi,
      updateProfile: updateCustomerProfileApi,
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
    renderProductGrid,
    categoryMediaHtml: catalog.categoryMediaHtml,
    compareAtHtml: catalog.compareAtHtml,
    matchCategoryQuery: catalog.matchCategoryQuery,
    media,
    imgHtml: media.imgHtml,
    loader,
    showToast,
    escapeHtml,
    escapeAttr,
    resolveImageUrl: resolveCustomerImageUrl,
    resolveCustomerImageUrl,
    openCart: () => openPanel($("#cartDrawer")),
    showLoginModal: showLoginPrompt,
    $,
    $$
  };


})();
