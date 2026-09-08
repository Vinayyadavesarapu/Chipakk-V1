import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- STATE MANAGEMENT ---
let cart = JSON.parse(localStorage.getItem('chipakk_cart') || '[]');
let currentRoute = 'home';
let categoryFilter = 'All';
let appliedCoupon = null;

// Default Database states loaded from localStorage
let STICKER_CATALOG = JSON.parse(localStorage.getItem('products') || '[]');
let siteSettings = JSON.parse(localStorage.getItem('site_settings') || '{}');
let activeEvents = JSON.parse(localStorage.getItem('events') || '[]');
let couponsList = JSON.parse(localStorage.getItem('coupons') || '[]');

// Initialize defaults if missing
function initDataDefaults() {
    if (!localStorage.getItem('products')) {
        const defaultCatalog = [
            { id: 1, title: 'Pixel Game Boy', price: 99, category: 'Gaming', tags: 'gb, retro', img: 'https://img.icons8.com/color/150/000000/gameboy.png', rarity: 'common', rating: 4.5, description: 'Handheld 8-bit classic.', badge: 'NEW!', release_date: '' },
            { id: 2, title: 'Cyber Doom Skull', price: 199, category: 'Chaos', tags: 'skull, doom', img: 'https://img.icons8.com/color/150/000000/skull.png', rarity: 'rare', rating: 4.8, description: 'Neon vaporwave cyber skull.', badge: 'HOT!', release_date: '' },
            { id: 3, title: 'Meme Cat Keyboard', price: 120, category: 'Memes', tags: 'cat, clicky', img: 'https://img.icons8.com/color/150/000000/keyboard.png', rarity: 'uncommon', rating: 4.2, description: 'Clicky mech cat keys.', badge: '', release_date: '' },
            { id: 4, title: 'Vaporwave Sunset', price: 149, category: 'Retro', tags: 'outrun, sun', img: 'https://img.icons8.com/color/150/000000/sunrise.png', rarity: 'rare', rating: 4.7, description: 'Synthetic warm sunset grid.', badge: 'LIMITED', release_date: '' },
            { id: 5, title: 'Terminal Hacker', price: 249, category: 'Tech', tags: 'console, cmd', img: 'https://img.icons8.com/color/150/000000/console.png', rarity: 'epic', rating: 4.9, description: 'Command hacker prompt.', badge: 'NEW!', release_date: '' },
            { id: 6, title: 'Pixel Devil', price: 399, category: 'Gaming', tags: 'devil, boss', img: 'https://img.icons8.com/color/150/000000/devil.png', rarity: 'legendary', rating: 5.0, description: 'Extremely rare boss card.', badge: 'RARE', release_date: '' }
        ];
        localStorage.setItem('products', JSON.stringify(defaultCatalog));
        STICKER_CATALOG = defaultCatalog;
    }

    if (!localStorage.getItem('site_settings')) {
        const defaultSettings = {
            store_name: 'CHIPAKK',
            shipping_fee: 50,
            free_shipping_enabled: true,
            free_shipping_threshold: 300,
            free_shipping_calculation: 'after_discounts',
            announcement_text: '🚀 FREE SHIPPING ON ORDER DEPLOYMENTS ABOVE ₹300!',
            announcement_active: true,
            maintenance_active: false,
            hero_headline: 'STICKERS FOR YOUR CHAOTIC WORLD.',
            hero_subheadline: 'High-grade, durable vinyl decals featuring underground internet culture, retro gaming, and pixel aesthetics.'
        };
        localStorage.setItem('site_settings', JSON.stringify(defaultSettings));
        siteSettings = defaultSettings;
    }

    if (!localStorage.getItem('events')) {
        const defaultEvents = [
            {
                id: 1,
                name: 'Neon Weekend Flash',
                type: 'Flash Sale',
                start_time: new Date(Date.now() - 3600000).toISOString(), // started 1 hour ago
                end_time: new Date(Date.now() + 7200000).toISOString(),   // ends in 2 hours
                discount_amount: 20, // 20% off
                status: 'Live',
                products: [2, 4] // flash sale on Cyber Doom and Vaporwave
            }
        ];
        localStorage.setItem('events', JSON.stringify(defaultEvents));
        activeEvents = defaultEvents;
    }

    if (!localStorage.getItem('coupons')) {
        const defaultCoupons = [
            { code: 'START10', discount_type: 'percent', amount: 10, min_order: 0, active: true },
            { code: 'PIXELDEVIL', discount_type: 'percent', amount: 15, min_order: 300, active: true }
        ];
        localStorage.setItem('coupons', JSON.stringify(defaultCoupons));
        couponsList = defaultCoupons;
    }
}
initDataDefaults();

// --- DOM READY ---
document.addEventListener('DOMContentLoaded', () => {
    // Check maintenance mode gate
    checkMaintenanceGate();

    // Setup announcement bar
    const bar = document.getElementById('global-announcement-bar');
    if (siteSettings.announcement_active && bar) {
        bar.textContent = siteSettings.announcement_text;
        bar.style.display = 'block';
    }

    // Set Hero Texts
    const headline = document.getElementById('hero-headline');
    const subheadline = document.getElementById('hero-subheadline');
    if (headline && subheadline) {
        headline.textContent = siteSettings.hero_headline;
        subheadline.textContent = siteSettings.hero_subheadline;
    }

    // Nav Route Event Handlers
    document.querySelectorAll('[data-route]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const route = e.currentTarget.dataset.route;
            navigateToRoute(route);
        });
    });

    document.getElementById('logo-link').addEventListener('click', (e) => {
        e.preventDefault();
        navigateToRoute('home');
    });

    // Drawer Toggles
    const cartDrawer = document.getElementById('cart-drawer');
    const cartOverlay = document.getElementById('cart-drawer-overlay');
    const headerCartBtn = document.getElementById('header-cart-btn');
    const closeCartBtn = document.getElementById('close-cart-btn');
    const checkoutDrawerBtn = document.getElementById('checkout-drawer-btn');

    headerCartBtn.addEventListener('click', () => toggleCartDrawer(true));
    closeCartBtn.addEventListener('click', () => toggleCartDrawer(false));
    cartOverlay.addEventListener('click', () => toggleCartDrawer(false));
    checkoutDrawerBtn.addEventListener('click', () => {
        toggleCartDrawer(false);
        navigateToRoute('checkout');
    });

    // Mobile Menu Drawer
    const mobileMenuDrawer = document.getElementById('mobile-menu-drawer');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const closeMobileMenuBtn = document.getElementById('close-mobile-menu-btn');

    mobileMenuBtn.addEventListener('click', () => toggleMobileDrawer(true));
    closeMobileMenuBtn.addEventListener('click', () => toggleMobileDrawer(false));
    mobileMenuOverlay.addEventListener('click', () => toggleMobileDrawer(false));

    // Toast Close
    document.getElementById('close-toast-btn').addEventListener('click', hideToast);

    // Apply Coupon Code
    const applyCouponBtn = document.getElementById('apply-coupon-btn');
    if (applyCouponBtn) {
        applyCouponBtn.addEventListener('click', applyCouponCode);
    }

    // Initial render and data load
    reloadDatabase();
    startCountdownTimer();
    syncLiveStorefrontData();
});

// --- MAINTENANCE WINDOW CHECKER ---
function checkMaintenanceGate() {
    const overlay = document.getElementById('maintenance-overlay');
    const customMessage = document.getElementById('maintenance-custom-message');
    const titleEl = document.getElementById('maintenance-title');
    const subtitleEl = document.getElementById('maintenance-subtitle');
    const errorCodeEl = document.getElementById('maintenance-error-code');
    const imgContainer = document.getElementById('maintenance-image-container');
    const displayImg = document.getElementById('maintenance-display-image');

    const isMaintenance = siteSettings.maintenance_active === true || siteSettings.maintenance_active === 'true' || siteSettings.store_status === 'MAINTENANCE';
    const isClosed = siteSettings.store_status === 'TEMPORARILY CLOSED';

    if ((isMaintenance || isClosed) && overlay) {
        overlay.style.display = 'flex';
        const msg = siteSettings.maintenance_message || siteSettings.maintenance_msg || (isClosed ? "Storefront is temporarily closed." : "We'll be back shortly with brand new sticker deployments.");
        if (customMessage) customMessage.textContent = msg;

        if (isClosed) {
            if (titleEl) titleEl.textContent = "CHIPAKK STORE CLOSED";
            if (subtitleEl) subtitleEl.textContent = "We are currently not accepting visits or orders.";
            if (errorCodeEl) errorCodeEl.textContent = "ERROR CODE: STORE_TEMPORARILY_CLOSED";
        } else {
            if (titleEl) titleEl.textContent = "CHIPAKK SYSTEM EXCEPTION";
            if (subtitleEl) subtitleEl.textContent = "CHIPAKK.EXE is currently undergoing scheduled updates.";
            if (errorCodeEl) errorCodeEl.textContent = "ERROR CODE: MAINTENANCE_MODE_ACTIVE";
        }

        const maintenanceImg = siteSettings.maintenance_image || '';
        if (maintenanceImg && imgContainer && displayImg) {
            const apiHost = 'https://api.chipakk.shop';
            const fullImgSrc = maintenanceImg.startsWith('http') ? maintenanceImg : (apiHost + maintenanceImg);
            displayImg.src = fullImgSrc;
            imgContainer.style.display = 'block';
        } else if (imgContainer) {
            imgContainer.style.display = 'none';
        }
    } else if (overlay) {
        overlay.style.display = 'none';
    }
}

async function syncLiveStorefrontData() {
    const apiHost = 'https://api.chipakk.shop';
    try {
        const [settingsRes, eventsRes] = await Promise.allSettled([
            fetch(`${apiHost}/api/settings`).then(r => r.json()),
            fetch(`${apiHost}/api/events?status=live`).then(r => r.json())
        ]);

        if (settingsRes.status === 'fulfilled' && settingsRes.value?.success && settingsRes.value?.data) {
            siteSettings = { ...siteSettings, ...settingsRes.value.data };
            localStorage.setItem('site_settings', JSON.stringify(siteSettings));
            checkMaintenanceGate();
        }

        if (eventsRes.status === 'fulfilled' && eventsRes.value?.success && eventsRes.value?.data?.events) {
            const liveEvts = eventsRes.value.data.events.map(evt => ({
                id: evt.id,
                name: evt.name,
                type: evt.event_type === 'flash_sale' ? 'Flash Sale' : evt.event_type,
                start_time: evt.start_time,
                end_time: evt.end_time,
                discount_amount: evt.discount_percent || 0,
                status: evt.status || 'Live',
                products: evt.product_ids || []
            }));
            activeEvents = liveEvts;
            localStorage.setItem('events', JSON.stringify(liveEvts));
            if (currentRoute === 'home') renderHomeGrids();
            if (currentRoute === 'shop') renderCatalog();
        }
    } catch (e) {
        console.warn('[Storefront live sync skipped]', e.message);
    }
}

// --- DYNAMIC DISCOUNT PRICE CALCULATOR ---
function getProductLivePrice(p) {
    let price = p.price;
    // Check if any flash sales cover this product
    const now = new Date();
    activeEvents.forEach(evt => {
        if (evt.status === 'Live' || (new Date(evt.start_time) <= now && new Date(evt.end_time) >= now)) {
            if (evt.products && evt.products.includes(p.id)) {
                // Apply Flash Sale discount
                if (evt.type === 'Flash Sale') {
                    price = Math.round(price * (1 - evt.discount_amount / 100));
                }
            }
        }
    });
    return price;
}

// --- PRODUCT COUNTDOWNS ---
function startCountdownTimer() {
    setInterval(() => {
        document.querySelectorAll('[data-countdown-target]').forEach(el => {
            const releaseTime = new Date(el.dataset.countdownTarget);
            const now = new Date();
            const diff = releaseTime - now;

            if (diff <= 0) {
                // Time reached! Force reload catalog
                el.parentElement.style.display = 'none';
                reloadDatabase();
            } else {
                const hrs = Math.floor(diff / 3600000).toString().padStart(2, '0');
                const mins = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
                const secs = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                const digits = el.querySelector('.countdown-digits');
                if (digits) {
                    digits.textContent = `${hrs}:${mins}:${secs}`;
                }
            }
        });
    }, 1000);
}

// --- ROUTING ENGINE ---
window.navigateToRoute = function(route) {
    currentRoute = route;
    
    document.getElementById('page-home').style.display = 'none';
    document.getElementById('page-shop').style.display = 'none';
    document.getElementById('page-details').style.display = 'none';
    document.getElementById('page-checkout').style.display = 'none';
    document.getElementById('page-about').style.display = 'none';
    document.getElementById('page-success').style.display = 'none';

    if (route === 'home') {
        document.getElementById('page-home').style.display = 'block';
    } else if (route === 'shop' || route === 'new-drops' || route === 'collections') {
        document.getElementById('page-shop').style.display = 'block';
        renderCatalog();
    } else if (route === 'checkout') {
        document.getElementById('page-checkout').style.display = 'block';
        renderCheckoutSummary();
    } else if (route === 'about') {
        document.getElementById('page-about').style.display = 'block';
    } else if (route === 'success') {
        document.getElementById('page-success').style.display = 'block';
    }

    window.scrollTo({ top: 0 });
    toggleMobileDrawer(false);
};

// --- CATALOG RENDERING ---
function renderHomeGrids() {
    const newDropsGrid = document.getElementById('home-new-drops-grid');
    const bestSellersGrid = document.getElementById('home-best-sellers-grid');

    if (!newDropsGrid || !bestSellersGrid) return;

    // Filter subsets for homepage
    const newDrops = STICKER_CATALOG.slice(0, 4);
    const bestSellers = STICKER_CATALOG.slice(4, 8);

    newDropsGrid.innerHTML = newDrops.map(p => makeProductCardMarkup(p)).join('');
    bestSellersGrid.innerHTML = bestSellers.map(p => makeProductCardMarkup(p)).join('');
}

function renderCatalog() {
    const grid = document.getElementById('shop-catalog-grid');
    if (!grid) return;

    const categoryTabs = document.querySelectorAll('.filter-tab');
    categoryTabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.category === categoryFilter) {
            tab.classList.add('active');
        }
        
        tab.onclick = (e) => {
            categoryFilter = e.target.dataset.category;
            renderCatalog();
        };
    });

    const filtered = STICKER_CATALOG.filter(p => {
        return categoryFilter === 'All' || p.category === categoryFilter;
    });

    grid.innerHTML = filtered.map(p => makeProductCardMarkup(p)).join('');
}

function makeProductCardMarkup(p) {
    const livePrice = getProductLivePrice(p);
    const isDiscounted = livePrice < p.price;
    const now = new Date();

    // Check scheduling release date
    let countdownOverlay = '';
    if (p.release_date && new Date(p.release_date) > now) {
        countdownOverlay = `
            <div class="drop-countdown-overlay" data-countdown-target="${p.release_date}">
                <h4>COMING SOON</h4>
                <div class="countdown-digits">00:00:00</div>
            </div>
        `;
    }

    return `
        <div class="product-card">
            ${countdownOverlay}
            ${p.badge ? `<div class="card-badge badge-new">${p.badge}</div>` : ''}
            <div class="product-img-holder" onclick="viewProductDetail(${p.id})">
                <img class="product-img" src="${p.img}" alt="${p.title}">
            </div>
            <div class="product-info">
                <a href="#" class="product-title" onclick="event.preventDefault(); viewProductDetail(${p.id})">${p.title}</a>
                <div class="product-rating">★ ${p.rating} (${p.rarity.toUpperCase()})</div>
                <div class="product-footer">
                    <div class="product-price">
                        ${isDiscounted ? `<span style="text-decoration: line-through; font-size: 0.9rem; opacity: 0.5; margin-right: 5px;">₹${p.price}</span>` : ''}
                        <span>₹${livePrice}</span>
                    </div>
                    <button class="retro-btn retro-btn-primary" onclick="addItemToCart(${p.id})" style="padding: 6px 12px; font-size: 0.8rem;">
                        + ADD
                    </button>
                </div>
            </div>
        </div>
    `;
}

window.filterShopCollection = function(collectionName) {
    categoryFilter = collectionName;
    navigateToRoute('shop');
};

// --- PRODUCT DETAILS VIEW ---
window.viewProductDetail = function(id) {
    const p = STICKER_CATALOG.find(p => p.id === id);
    if (!p) return;

    const livePrice = getProductLivePrice(p);
    const isDiscounted = livePrice < p.price;

    const detailView = document.getElementById('product-detail-view');
    detailView.innerHTML = `
        <div class="retro-panel" style="background-color: #fff; display: flex; align-items: center; justify-content: center; padding: 30px;">
            <img src="${p.img}" style="max-width: 80%; height: auto; object-fit: contain;" alt="${p.title}">
        </div>
        <div style="display: flex; flex-direction: column; gap: 15px;">
            <h1 class="font-pixel" style="font-size: 2.8rem; line-height: 1.1;">${p.title}</h1>
            <div style="font-size: 1.15rem; font-weight: bold; display: flex; align-items: center; gap: 10px;">
                <span style="background-color: var(--text-color); color: #fff; padding: 2px 8px; font-size: 0.75rem;">${p.category.toUpperCase()}</span>
                <span>★ ${p.rating}</span>
            </div>
            <div style="font-size: 2rem; font-weight: bold; color: var(--accent-color);">
                ${isDiscounted ? `<span style="text-decoration: line-through; font-size: 1.3rem; opacity: 0.5; margin-right: 10px;">₹${p.price}</span>` : ''}
                <span>₹${livePrice}</span>
            </div>
            <div class="retro-panel" style="background-color:#fff; padding: 15px; font-size: 0.9rem;">
                ${p.description}
            </div>
            <div style="font-size: 0.85rem; line-height: 1.6;">
                <div><strong>Material:</strong> Premium Weatherproof Vinyl</div>
                <div><strong>Dimensions:</strong> ~ 3.5 inches longest side</div>
                <div><strong>Finish:</strong> Semi-Gloss UV protection laminate</div>
            </div>
            <div style="margin-top: 15px;">
                <button class="retro-btn retro-btn-primary" onclick="addItemToCart(${p.id})" style="width: 100%; padding: 15px;">
                    STICKER ACQUIRED! (ADD TO CART)
                </button>
            </div>
        </div>
    `;

    navigateToRoute('details');
};

// --- CART STATE MANAGEMENTS ---
window.addItemToCart = function(id) {
    const p = STICKER_CATALOG.find(p => p.id === id);
    if (!p) return;

    // Guard scheduled item
    if (p.release_date && new Date(p.release_date) > new Date()) {
        showToast("ERROR: Product drop has not launched yet.");
        return;
    }

    const livePrice = getProductLivePrice(p);

    const existing = cart.find(item => item.id === id);
    if (existing) {
        existing.qty++;
        existing.price = livePrice; // update price in cart
    } else {
        cart.push({ ...p, price: livePrice, qty: 1 });
    }

    localStorage.setItem('chipakk_cart', JSON.stringify(cart));
    updateCartUI();
    showToast(`✓ STICKER ACQUIRED!<br>Added "${p.title}" to cart.`);
};

window.removeCartItem = function(id) {
    cart = cart.filter(item => item.id !== id);
    localStorage.setItem('chipakk_cart', JSON.stringify(cart));
    updateCartUI();
    showToast(`✓ STICKER DE-INSTALLED.`);
};

window.adjustCartQty = function(id, amt) {
    const item = cart.find(item => item.id === id);
    if (!item) return;

    item.qty += amt;
    if (item.qty <= 0) {
        removeCartItem(id);
        return;
    }

    localStorage.setItem('chipakk_cart', JSON.stringify(cart));
    updateCartUI();
};

function updateCartUI() {
    const cartBadge = document.getElementById('cart-badge-count');
    const cartItemsContainer = document.getElementById('cart-items-container');
    const subtotalText = document.getElementById('cart-subtotal-price');

    if (!cartItemsContainer) return;

    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    cartBadge.textContent = totalQty;

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px 10px;">
                <h4 class="font-pixel" style="font-size: 1.5rem; margin-bottom: 10px;">INVENTORY EMPTY</h4>
                <p style="font-size: 0.8rem; color: #555;">No stickers detected in memory buffers.</p>
            </div>
        `;
        subtotalText.textContent = '₹0';
        return;
    }

    let subtotal = 0;
    cartItemsContainer.innerHTML = cart.map(item => {
        subtotal += item.price * item.qty;
        return `
            <div class="cart-item">
                <img src="${item.img}" alt="${item.title}">
                <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 3px;">
                    <div style="font-weight: bold; font-size: 0.85rem;">${item.title}</div>
                    <div style="font-size: 0.8rem; font-weight: bold; color: var(--accent-color);">₹${item.price}</div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 5px;">
                        <button class="retro-btn" onclick="adjustCartQty(${item.id}, -1)" style="padding: 2px 8px; font-size: 0.7rem; box-shadow: none;">-</button>
                        <span style="font-weight: bold; font-size: 0.85rem;">${item.qty}</span>
                        <button class="retro-btn" onclick="adjustCartQty(${item.id}, 1)" style="padding: 2px 8px; font-size: 0.7rem; box-shadow: none;">+</button>
                    </div>
                </div>
                <button class="icon-btn" onclick="removeCartItem(${item.id})" style="font-size: 1.2rem; color: var(--error-color);">×</button>
            </div>
        `;
    }).join('');

    subtotalText.textContent = `₹${subtotal}`;

    // Shipping progress indicator calculation
    const progressEl = document.getElementById('cart-shipping-progress');
    if (progressEl) {
        const threshold = siteSettings.free_shipping_threshold || 300;
        const enabled = siteSettings.free_shipping_enabled !== false;
        
        if (!enabled) {
            progressEl.style.display = 'none';
        } else {
            progressEl.style.display = 'block';
            if (subtotal >= threshold) {
                progressEl.innerHTML = `🎉 FREE DELIVERY UNLOCKED!`;
            } else {
                const diff = threshold - subtotal;
                progressEl.innerHTML = `ADD ₹${diff} MORE TO UNLOCK FREE DELIVERY 🚚`;
            }
        }
    }
}

function toggleCartDrawer(open) {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-drawer-overlay');
    if (open) {
        drawer.classList.add('open');
        overlay.classList.add('active');
    } else {
        drawer.classList.remove('open');
        overlay.classList.remove('active');
    }
}

function toggleMobileDrawer(open) {
    const drawer = document.getElementById('mobile-menu-drawer');
    const overlay = document.getElementById('mobile-menu-overlay');
    if (open) {
        drawer.style.right = '0';
        overlay.classList.add('active');
    } else {
        drawer.style.right = '-300px';
        overlay.classList.remove('active');
    }
}

// --- CHECKOUT ENGINE (PROMOTIONS & SHIPPING RULES) ---
async function applyCouponCode() {
    const code = document.getElementById('chk-coupon').value.trim().toUpperCase();
    if (!code) return;

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

    const applyBtn = document.getElementById('apply-coupon-btn');
    const originalText = applyBtn ? applyBtn.textContent : '';
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'CHECKING...'; }

    try {
        const apiHost = 'https://api.chipakk.shop';
        const response = await fetch(`${apiHost}/api/coupons/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, subtotal: subtotal * 100 })
        });

        const data = await response.json();

        if (response.ok && data.success && data.data) {
            const c = data.data;
            appliedCoupon = {
                code: c.code,
                type: c.discount_type,
                val: c.discount_type === 'percent' ? c.discount_value : c.discount_rupees,
                discount_amount: c.discount_rupees,
                min_order: c.min_order_value_rupees || 0,
                active: true
            };
            showToast("✓ CHEAT CODE ACTIVATED!");
            renderCheckoutSummary();
            return;
        } else {
            const errMsg = data.error || data.message || "ERROR: INVALID CHEAT CODE (COUPON)";
            showToast(errMsg);
            appliedCoupon = null;
            renderCheckoutSummary();
            return;
        }
    } catch (err) {
        // Fallback to local coupons if offline or network error
        const coupon = couponsList.find(c => c.code === code && c.active);
        if (!coupon) {
            showToast("ERROR: INVALID CHEAT CODE (COUPON)");
            appliedCoupon = null;
            renderCheckoutSummary();
            return;
        }
        if (subtotal < coupon.min_order) {
            showToast(`ERROR: Minimum order ₹${coupon.min_order} required.`);
            appliedCoupon = null;
            renderCheckoutSummary();
            return;
        }
        appliedCoupon = coupon;
        showToast("✓ CHEAT CODE ACTIVATED!");
        renderCheckoutSummary();
    } finally {
        if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = originalText || 'APPLY'; }
    }
}

function renderCheckoutSummary() {
    const container = document.getElementById('checkout-summary-items');
    const totalText = document.getElementById('checkout-total-price');
    const discountText = document.getElementById('checkout-discount-val');
    const shippingText = document.getElementById('checkout-shipping-val');

    if (cart.length === 0) {
        container.innerHTML = '<div>No items in cart.</div>';
        totalText.textContent = '₹0';
        discountText.textContent = '₹0';
        shippingText.textContent = '₹0';
        return;
    }

    let subtotal = 0;
    container.innerHTML = cart.map(item => {
        subtotal += item.price * item.qty;
        return `
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 8px;">
                <span>${item.title} x${item.qty}</span>
                <span>₹${item.price * item.qty}</span>
            </div>
        `;
    }).join('');

    // Apply Coupon calculation
    let discount = 0;
    if (appliedCoupon) {
        if (appliedCoupon.discount_type === 'percent') {
            discount = Math.round(subtotal * (appliedCoupon.amount / 100));
        } else {
            discount = appliedCoupon.amount;
        }
    }

    // Apply Shipping charges rules
    const threshold = siteSettings.free_shipping_threshold || 300;
    const shippingFee = siteSettings.shipping_fee || 50;
    const enabled = siteSettings.free_shipping_enabled !== false;
    
    let shipping = shippingFee;
    if (enabled) {
        const calculationMode = siteSettings.free_shipping_calculation || 'after_discounts';
        const eligibleSubtotal = calculationMode === 'after_discounts' ? (subtotal - discount) : subtotal;
        
        if (eligibleSubtotal >= threshold) {
            shipping = 0;
        }
    }

    const finalTotal = Math.max(0, subtotal - discount + shipping);

    discountText.textContent = `-₹${discount}`;
    shippingText.textContent = shipping === 0 ? 'FREE' : `₹${shipping}`;
    totalText.textContent = `₹${finalTotal}`;
}

// Order placement
document.getElementById('place-order-btn').addEventListener('click', async () => {
    const firstName = document.getElementById('chk-first-name').value.trim();
    const lastName = document.getElementById('chk-last-name').value.trim();
    const email = document.getElementById('chk-email').value.trim();
    const address = document.getElementById('chk-address').value.trim();
    const city = document.getElementById('chk-city').value.trim();
    const zip = document.getElementById('chk-zip').value.trim();
    const payment = document.getElementById('chk-payment').value;

    if (!firstName || !lastName || !email || !address || !city || !zip) {
        showToast("ERROR: Invalid details. Fill all forms.");
        return;
    }

    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    let discount = 0;
    if (appliedCoupon) {
        if (appliedCoupon.discount_type === 'percent') {
            discount = Math.round(subtotal * (appliedCoupon.amount / 100));
        } else {
            discount = appliedCoupon.amount;
        }
    }
    
    // Apply Shipping charges rules
    const threshold = siteSettings.free_shipping_threshold || 300;
    const shippingFee = siteSettings.shipping_fee || 50;
    const enabled = siteSettings.free_shipping_enabled !== false;
    
    let shipping = shippingFee;
    if (enabled) {
        const calculationMode = siteSettings.free_shipping_calculation || 'after_discounts';
        const eligibleSubtotal = calculationMode === 'after_discounts' ? (subtotal - discount) : subtotal;
        
        if (eligibleSubtotal >= threshold) {
            shipping = 0;
        }
    }

    const finalTotal = Math.max(0, subtotal - discount + shipping);

    const placeBtn = document.getElementById('place-order-btn');
    placeBtn.textContent = 'COMPILING PACKAGE...';
    placeBtn.disabled = true;

    const orderId = `CHP-${Math.floor(100000 + Math.random() * 900000)}`;

    const orderData = {
        order_id: orderId,
        customer_name: `${firstName} ${lastName}`,
        email: email,
        address: `${address}, ${city} - ${zip}`,
        items: cart.map(i => ({ id: i.id, title: i.title, price: i.price, qty: i.qty })),
        subtotal: subtotal,
        discount_applied: discount,
        shipping_charges: shipping,
        total_price: finalTotal,
        payment_method: payment,
        status: 'Pending',
        timestamp: new Date().toISOString()
    };

    try {
        if (!db) throw new Error("Offline mode");
        await addDoc(collection(db, "orders"), orderData);
    } catch (e) {
        const mockOrders = JSON.parse(localStorage.getItem('mock_orders') || '[]');
        mockOrders.push(orderData);
        localStorage.setItem('mock_orders', JSON.stringify(mockOrders));
    }

    // Success Screen
    document.getElementById('success-order-id').textContent = orderId;
    navigateToRoute('success');
    
    // Clear cart & variables
    cart = [];
    appliedCoupon = null;
    document.getElementById('chk-coupon').value = '';
    localStorage.removeItem('chipakk_cart');
    updateCartUI();

    placeBtn.textContent = 'INSTALL STICKER PACKAGE';
    placeBtn.disabled = false;
});

function reloadDatabase() {
    STICKER_CATALOG = JSON.parse(localStorage.getItem('products') || '[]');
    siteSettings = JSON.parse(localStorage.getItem('site_settings') || '{}');
    activeEvents = JSON.parse(localStorage.getItem('events') || '[]');
    couponsList = JSON.parse(localStorage.getItem('coupons') || '[]');
    
    checkMaintenanceGate();
    
    // Update shop notice banner
    const thresholdText = document.getElementById('shop-shipping-threshold-text');
    const noticeEl = document.getElementById('shop-shipping-notice');
    if (thresholdText && noticeEl) {
        const threshold = siteSettings.free_shipping_threshold || 300;
        const enabled = siteSettings.free_shipping_enabled !== false;
        if (enabled) {
            noticeEl.style.display = 'inline-flex';
            thresholdText.textContent = `₹${threshold}+`;
        } else {
            noticeEl.style.display = 'none';
        }
    }

    if (currentRoute === 'home') renderHomeGrids();
    if (currentRoute === 'shop') renderCatalog();
    updateCartUI();
}

// Window Storage synchronizer
window.addEventListener('storage', (e) => {
    if (['products', 'site_settings', 'events', 'coupons'].includes(e.key)) {
        reloadDatabase();
    }
});

// Toast Notifications
let toastTimeout = null;
function showToast(msg) {
    const toast = document.getElementById('retro-system-toast');
    const message = document.getElementById('toast-message-text');
    message.innerHTML = msg;
    toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(hideToast, 4000);
}
function hideToast() {
    const toast = document.getElementById('retro-system-toast');
    if (toast) toast.classList.remove('show');
}
