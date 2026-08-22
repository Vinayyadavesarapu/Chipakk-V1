import { db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// DOM Elements
const loginSection = document.getElementById('login-section');
const adminWorkspace = document.getElementById('admin-workspace');
const loginBtn = document.getElementById('login-btn');
const emailInput = document.getElementById('admin-email');
const passwordInput = document.getElementById('admin-password');
const loginError = document.getElementById('login-error');

// Database state
let products = JSON.parse(localStorage.getItem('products') || '[]');
let categories = JSON.parse(localStorage.getItem('categories') || '["Gaming", "Memes", "Cute", "Chaos", "Tech", "Retro"]');
let orders = JSON.parse(localStorage.getItem('mock_orders') || '[]');
let events = JSON.parse(localStorage.getItem('events') || '[]');
let coupons = JSON.parse(localStorage.getItem('coupons') || '[]');
let auditLogs = JSON.parse(localStorage.getItem('audit_logs') || '[]');
let siteSettings = JSON.parse(localStorage.getItem('site_settings') || '{}');

let editingProductId = null;
let editingEventId = null;
let editingCouponId = null;

// Auth observer
if (auth) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            initDashboard();
        } else {
            loginSection.style.display = 'block';
            adminWorkspace.style.display = 'none';
        }
    });
}

// Login
loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        loginError.textContent = "Please fill in email and password.";
        return;
    }

    loginError.textContent = "";
    loginBtn.textContent = "VERIFYING AUTHORIZATION...";
    loginBtn.disabled = true;

    if (email === "admin@dheeraj.com" && password === "G1wp23@sticker") {
        sessionStorage.setItem('chipakk_admin_auth', 'true');
        writeAuditLog("System", "Administrator session authorized via demo override.");
        initDashboard();
        loginBtn.textContent = "ACCESS TERMINAL";
        loginBtn.disabled = false;
        return;
    }

    try {
        if (!auth) throw new Error("Auth offline");
        await signInWithEmailAndPassword(auth, email, password);
        writeAuditLog(email, "Administrator logged in successfully.");
    } catch (e) {
        loginError.textContent = "Invalid login credentials.";
    } finally {
        loginBtn.textContent = "ACCESS TERMINAL";
        loginBtn.disabled = false;
    }
});

if (sessionStorage.getItem('chipakk_admin_auth') === 'true') {
    initDashboard();
}

function initDashboard() {
    loginSection.style.display = 'none';
    adminWorkspace.style.display = 'flex';
    
    setupNavigation();
    setupProductForm();
    setupEventForm();
    setupCouponForm();
    setupHomepageForm();
    setupSettingsForm();

    // Initial renders
    renderDashboardStats();
    renderProductsTable();
    renderEventsTable();
    renderCouponsTable();
    renderCategoriesTable();
    renderOrdersTable();
    renderAuditLogs();
    populateFormOptions();

    // Listeners
    document.getElementById('analytics-date-filter').addEventListener('change', renderDashboardStats);
}

// --- SETUP CONTROLLERS ---
function setupNavigation() {
    const navItems = document.querySelectorAll('.admin-nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    navItems.forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            tabContents.forEach(c => c.style.display = 'none');

            item.classList.add('active');
            const target = item.dataset.tab;
            document.getElementById(target).style.display = 'block';

            // Refresh specific tables
            if (target === 'tab-logs') renderAuditLogs();
            if (target === 'tab-dashboard') renderDashboardStats();
        };
    });

    document.getElementById('logout-btn').onclick = () => {
        sessionStorage.removeItem('chipakk_admin_auth');
        if (auth && auth.currentUser) signOut(auth);
        window.location.reload();
    };
}

function populateFormOptions() {
    // Populate product category selects
    const select = document.getElementById('prod-category');
    if (select) {
        select.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

// --- TAB: DASHBOARD STATISTICS ---
function renderDashboardStats() {
    const filter = document.getElementById('analytics-date-filter').value;
    const now = new Date();
    
    let filteredOrders = [...orders];

    if (filter === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        filteredOrders = orders.filter(o => new Date(o.timestamp).getTime() >= startOfToday);
    } else if (filter === '7days') {
        const startOf7Days = now.getTime() - (7 * 24 * 3600000);
        filteredOrders = orders.filter(o => new Date(o.timestamp).getTime() >= startOf7Days);
    } else if (filter === '30days') {
        const startOf30Days = now.getTime() - (30 * 24 * 3600000);
        filteredOrders = orders.filter(o => new Date(o.timestamp).getTime() >= startOf30Days);
    }

    const totalOrders = filteredOrders.length;
    const totalRev = filteredOrders.reduce((sum, o) => sum + o.total_price, 0);
    const aov = totalOrders > 0 ? Math.round(totalRev / totalOrders) : 0;
    
    // Inventory metrics
    const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= 10).length;

    document.getElementById('stat-total-orders').textContent = totalOrders;
    document.getElementById('stat-total-revenue').textContent = `₹${totalRev}`;
    document.getElementById('stat-aov').textContent = `₹${aov}`;
    document.getElementById('stat-low-stock').textContent = lowStockCount;
}

// --- TAB: PRODUCTS & DROPS ---
function setupProductForm() {
    const btn = document.getElementById('new-prod-btn');
    const container = document.getElementById('product-form-container');
    const cancel = document.getElementById('cancel-prod-btn');
    const save = document.getElementById('save-prod-btn');

    btn.onclick = () => {
        editingProductId = null;
        document.getElementById('prod-form-title').textContent = '[ADD NEW STICKER]';
        resetProductInputs();
        container.style.display = 'block';
    };

    cancel.onclick = () => {
        container.style.display = 'none';
        resetProductInputs();
    };

    save.onclick = () => {
        const title = document.getElementById('prod-title').value.trim();
        const price = parseInt(document.getElementById('prod-price').value) || 0;
        const category = document.getElementById('prod-category').value;
        const tags = document.getElementById('prod-tags').value.trim();
        const stock = parseInt(document.getElementById('prod-stock').value) || 0;
        const rarity = document.getElementById('prod-rarity').value;
        const img = document.getElementById('prod-image').value.trim();
        const releaseDate = document.getElementById('prod-release-date').value;
        const desc = document.getElementById('prod-desc').value.trim();

        if (!title || price <= 0) {
            showToast("ERROR: Invalid product details.");
            return;
        }

        const imagePlaceholder = img || 'https://img.icons8.com/color/150/000000/sticker.png';

        if (editingProductId) {
            const idx = products.findIndex(p => p.id === editingProductId);
            if (idx > -1) {
                const oldPrice = products[idx].price;
                products[idx] = {
                    ...products[idx],
                    title,
                    price,
                    category,
                    tags,
                    stock,
                    rarity,
                    img: imagePlaceholder,
                    release_date: releaseDate ? new Date(releaseDate).toISOString() : '',
                    description: desc
                };
                writeAuditLog("Admin", `Updated product "${title}" (Price: ₹${oldPrice} -> ₹${price}).`);
            }
        } else {
            products.push({
                id: Date.now(),
                title,
                price,
                category,
                tags,
                stock,
                rarity,
                img: imagePlaceholder,
                rating: 4.5,
                release_date: releaseDate ? new Date(releaseDate).toISOString() : '',
                description: desc
            });
            writeAuditLog("Admin", `Created new product Drop "${title}".`);
        }

        localStorage.setItem('products', JSON.stringify(products));
        container.style.display = 'none';
        resetProductInputs();
        renderProductsTable();
        showToast("Sticker definition updated.");
    };
}

function resetProductInputs() {
    document.getElementById('prod-title').value = '';
    document.getElementById('prod-price').value = '';
    document.getElementById('prod-tags').value = '';
    document.getElementById('prod-stock').value = '100';
    document.getElementById('prod-image').value = '';
    document.getElementById('prod-release-date').value = '';
    document.getElementById('prod-desc').value = '';
}

function renderProductsTable() {
    const tbody = document.getElementById('products-tbody');
    tbody.innerHTML = '';

    products.forEach(p => {
        const releaseTime = p.release_date ? new Date(p.release_date).toLocaleString() : 'Immediate';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${p.img}" style="width: 40px; height: 40px; object-fit: contain;"></td>
            <td><strong>${p.title}</strong></td>
            <td>₹${p.price}</td>
            <td><span class="status-badge" style="background:#ece9d8;">${p.category}</span></td>
            <td><span class="status-badge ${p.stock <= 10 ? 'status-low-stock' : 'status-in-stock'}">${p.stock} Units</span></td>
            <td><span style="font-size: 0.8rem;">${releaseTime}</span></td>
            <td>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none;" onclick="editProduct(${p.id})">EDIT</button>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none; background-color: var(--error-color); color: #fff;" onclick="deleteProduct(${p.id})">DELETE</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editProduct = function(id) {
    const p = products.find(p => p.id === id);
    if (!p) return;

    editingProductId = id;
    document.getElementById('prod-form-title').textContent = '[EDIT STICKER]';
    document.getElementById('prod-title').value = p.title;
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-category').value = p.category;
    document.getElementById('prod-tags').value = p.tags || '';
    document.getElementById('prod-stock').value = p.stock || 0;
    document.getElementById('prod-rarity').value = p.rarity;
    document.getElementById('prod-image').value = p.img.startsWith('http') ? p.img : '';
    document.getElementById('prod-release-date').value = p.release_date ? p.release_date.slice(0, 16) : '';
    document.getElementById('prod-desc').value = p.description || '';

    document.getElementById('product-form-container').style.display = 'block';
};

window.deleteProduct = function(id) {
    const p = products.find(p => p.id === id);
    if (confirm("Erase this product?")) {
        products = products.filter(p => p.id !== id);
        localStorage.setItem('products', JSON.stringify(products));
        writeAuditLog("Admin", `Deleted product "${p.title}".`);
        renderProductsTable();
        showToast("Product erased.");
    }
};

// --- TAB: EVENTS & SALES ---
function setupEventForm() {
    const btn = document.getElementById('new-event-btn');
    const container = document.getElementById('event-form-container');
    const cancel = document.getElementById('cancel-event-btn');
    const save = document.getElementById('save-event-btn');

    btn.onclick = () => {
        editingEventId = null;
        resetEventInputs();
        container.style.display = 'block';
    };

    cancel.onclick = () => {
        container.style.display = 'none';
        resetEventInputs();
    };

    save.onclick = () => {
        const name = document.getElementById('evt-name').value.trim();
        const type = document.getElementById('evt-type').value;
        const discount = parseInt(document.getElementById('evt-discount').value) || 0;
        const start = document.getElementById('evt-start').value;
        const end = document.getElementById('evt-end').value;
        const status = document.getElementById('evt-status').value;

        // Collect checked products
        const targetProds = [];
        document.querySelectorAll('.evt-prod-chk:checked').forEach(chk => {
            targetProds.push(parseInt(chk.value));
        });

        if (!name || !start || !end) {
            showToast("ERROR: Fill in event parameters.");
            return;
        }

        if (editingEventId) {
            const idx = events.findIndex(e => e.id === editingEventId);
            if (idx > -1) {
                events[idx] = {
                    ...events[idx],
                    name,
                    type,
                    discount_amount: discount,
                    start_time: new Date(start).toISOString(),
                    end_time: new Date(end).toISOString(),
                    status,
                    products: targetProds
                };
                writeAuditLog("Admin", `Updated event "${name}".`);
            }
        } else {
            events.push({
                id: Date.now(),
                name,
                type,
                discount_amount: discount,
                start_time: new Date(start).toISOString(),
                end_time: new Date(end).toISOString(),
                status,
                products: targetProds
            });
            writeAuditLog("Admin", `Scheduled event "${name}" (Type: ${type}).`);
        }

        localStorage.setItem('events', JSON.stringify(events));
        container.style.display = 'none';
        resetEventInputs();
        renderEventsTable();
        showToast("Event scheduling completed.");
    };
}

function resetEventInputs() {
    document.getElementById('evt-name').value = '';
    document.getElementById('evt-discount').value = '10';
    document.getElementById('evt-start').value = '';
    document.getElementById('evt-end').value = '';

    const chkContainer = document.getElementById('evt-products-checkboxes');
    chkContainer.innerHTML = products.map(p => `
        <label style="display:block; font-size:0.8rem; text-transform:none;">
            <input type="checkbox" value="${p.id}" class="evt-prod-chk"> ${p.title}
        </label>
    `).join('');
}

function renderEventsTable() {
    const tbody = document.getElementById('events-tbody');
    tbody.innerHTML = '';
    events.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${e.name}</strong></td>
            <td>${e.type}</td>
            <td>${e.discount_amount}% OFF</td>
            <td><span style="font-size:0.75rem;">${new Date(e.start_time).toLocaleString()}</span></td>
            <td><span style="font-size:0.75rem;">${new Date(e.end_time).toLocaleString()}</span></td>
            <td><span class="status-badge status-low-stock">${e.status}</span></td>
            <td>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none;" onclick="editEvent(${e.id})">EDIT</button>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none; background-color: var(--error-color); color: #fff;" onclick="deleteEvent(${e.id})">DELETE</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editEvent = function(id) {
    const e = events.find(evt => evt.id === id);
    if (!e) return;

    editingEventId = id;
    container.style.display = 'block';
    
    document.getElementById('evt-name').value = e.name;
    document.getElementById('evt-type').value = e.type;
    document.getElementById('evt-discount').value = e.discount_amount;
    document.getElementById('evt-start').value = e.start_time.slice(0, 16);
    document.getElementById('evt-end').value = e.end_time.slice(0, 16);
    document.getElementById('evt-status').value = e.status;

    // Check targets
    const chkContainer = document.getElementById('evt-products-checkboxes');
    chkContainer.innerHTML = products.map(p => `
        <label style="display:block; font-size:0.8rem; text-transform:none;">
            <input type="checkbox" value="${p.id}" class="evt-prod-chk" ${e.products.includes(p.id) ? 'checked' : ''}> ${p.title}
        </label>
    `).join('');
};

window.deleteEvent = function(id) {
    if (confirm("Cancel and delete this event?")) {
        const evt = events.find(e => e.id === id);
        events = events.filter(e => e.id !== id);
        localStorage.setItem('events', JSON.stringify(events));
        writeAuditLog("Admin", `Cancelled scheduled event "${evt.name}".`);
        renderEventsTable();
        showToast("Event cancelled.");
    }
};

// --- TAB: COUPONS ---
function setupCouponForm() {
    const btn = document.getElementById('new-coupon-btn');
    const container = document.getElementById('coupon-form-container');
    const cancel = document.getElementById('cancel-coupon-btn');
    const save = document.getElementById('save-coupon-btn');

    btn.onclick = () => {
        editingCouponId = null;
        resetCouponInputs();
        container.style.display = 'block';
    };

    cancel.onclick = () => {
        container.style.display = 'none';
        resetCouponInputs();
    };

    save.onclick = () => {
        const code = document.getElementById('cpn-code').value.trim().toUpperCase();
        const type = document.getElementById('cpn-type').value;
        const amount = parseInt(document.getElementById('cpn-amount').value) || 0;
        const min = parseInt(document.getElementById('cpn-min').value) || 0;
        const active = document.getElementById('cpn-active').value === 'true';

        if (!code || amount <= 0) {
            showToast("ERROR: Fill coupon parameters.");
            return;
        }

        const couponData = { code, discount_type: type, amount, min_order: min, active };

        if (editingCouponId) {
            const idx = coupons.findIndex(c => c.code === editingCouponId);
            if (idx > -1) {
                coupons[idx] = couponData;
                writeAuditLog("Admin", `Updated coupon code "${code}".`);
            }
        } else {
            coupons.push(couponData);
            writeAuditLog("Admin", `Created coupon code "${code}".`);
        }

        localStorage.setItem('coupons', JSON.stringify(coupons));
        container.style.display = 'none';
        resetCouponInputs();
        renderCouponsTable();
        showToast("Coupon updated.");
    };
}

function resetCouponInputs() {
    document.getElementById('cpn-code').value = '';
    document.getElementById('cpn-amount').value = '';
    document.getElementById('cpn-min').value = '0';
    document.getElementById('cpn-active').value = 'true';
}

function renderCouponsTable() {
    const tbody = document.getElementById('coupons-tbody');
    tbody.innerHTML = '';
    coupons.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong class="font-pixel" style="font-size:1.25rem;">${c.code}</strong></td>
            <td>${c.discount_type === 'percent' ? 'Percent' : 'Fixed Amount'}</td>
            <td>${c.discount_type === 'percent' ? `${c.amount}%` : `₹${c.amount}`}</td>
            <td>₹${c.min_order}</td>
            <td><span class="status-badge ${c.active ? 'status-in-stock' : 'status-out-of-stock'}">${c.active ? 'Active' : 'Disabled'}</span></td>
            <td>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none;" onclick="editCoupon('${c.code}')">EDIT</button>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none; background-color: var(--error-color); color: #fff;" onclick="deleteCoupon('${c.code}')">DELETE</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editCoupon = function(code) {
    const c = coupons.find(cpn => cpn.code === code);
    if (!c) return;

    editingCouponId = code;
    document.getElementById('coupon-form-container').style.display = 'block';

    document.getElementById('cpn-code').value = c.code;
    document.getElementById('cpn-type').value = c.discount_type;
    document.getElementById('cpn-amount').value = c.amount;
    document.getElementById('cpn-min').value = c.min_order;
    document.getElementById('cpn-active').value = c.active ? 'true' : 'false';
};

window.deleteCoupon = function(code) {
    if (confirm(`Erase coupon code "${code}"?`)) {
        coupons = coupons.filter(c => c.code !== code);
        localStorage.setItem('coupons', JSON.stringify(coupons));
        writeAuditLog("Admin", `Deleted coupon code "${code}".`);
        renderCouponsTable();
        showToast("Coupon erased.");
    }
};

// --- TAB: CATEGORIES ---
function renderCategoriesTable() {
    const tbody = document.getElementById('categories-tbody');
    tbody.innerHTML = '';
    categories.forEach((cat, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${cat}</strong></td>
            <td>
                <button class="retro-btn" style="padding: 4px 8px; font-size: 0.75rem; box-shadow: none; background-color: var(--error-color); color: #fff;" onclick="deleteCategory(${index})">DELETE</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.deleteCategory = function(index) {
    const name = categories[index];
    if (confirm(`Erase category sector "${name}"?`)) {
        categories.splice(index, 1);
        localStorage.setItem('categories', JSON.stringify(categories));
        writeAuditLog("Admin", `Deleted category sector "${name}".`);
        renderCategoriesTable();
        populateFormOptions();
        showToast("Category sector removed.");
    }
};

// --- TAB: ORDERS ---
function renderOrdersTable() {
    const tbody = document.getElementById('orders-tbody');
    tbody.innerHTML = '';

    if (db) {
        // Sync online
        const q = query(collection(db, "orders"), orderBy("timestamp", "desc"));
        onSnapshot(q, (snapshot) => {
            tbody.innerHTML = '';
            snapshot.forEach(doc => {
                const o = doc.data();
                appendOrderRow(tbody, o);
            });
        }, (err) => {
            loadMockOrders(tbody);
        });
    } else {
        loadMockOrders(tbody);
    }
}

function loadMockOrders(tbody) {
    tbody.innerHTML = '';
    orders.forEach(o => appendOrderRow(tbody, o));
}

function appendOrderRow(tbody, o) {
    const tr = document.createElement('tr');
    const itemsList = o.items.map(i => `${i.title} (x${i.qty})`).join(', ');

    const shippingChargeText = o.shipping_charges === 0 ? 'FREE' : `₹${o.shipping_charges || 0}`;

    tr.innerHTML = `
        <td><strong class="font-pixel" style="font-size:1.15rem;">${o.order_id}</strong></td>
        <td>${o.customer_name}</td>
        <td><span style="font-size:0.8rem;">${o.address}</span></td>
        <td><span style="font-size:0.8rem;">${itemsList}</span></td>
        <td>
            <strong>₹${o.total_price}</strong>
            <div style="font-size: 0.75rem; color: #555; margin-top:2px;">Shipping: ${shippingChargeText}</div>
        </td>
        <td>
            <select class="retro-input" style="padding:2px; font-size:0.8rem; width:120px;" onchange="updateFulfillmentStatus('${o.order_id}', this.value)">
                <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>Pending</option>
                <option value="Processing" ${o.status === 'Processing' ? 'selected' : ''}>Processing</option>
                <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>Shipped</option>
                <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
        </td>
    `;
    tbody.appendChild(tr);
}

window.updateFulfillmentStatus = function(orderId, val) {
    const idx = orders.findIndex(o => o.order_id === orderId);
    if (idx > -1) {
        orders[idx].status = val;
        localStorage.setItem('mock_orders', JSON.stringify(orders));
        writeAuditLog("Admin", `Updated Order ${orderId} fulfillment status to "${val}".`);
        showToast(`Order status updated to ${val}.`);
        renderDashboardStats();
    }
};

// --- TAB: HOMEPAGE VISUAL BUILDER ---
function setupHomepageForm() {
    document.getElementById('set-announcement').value = siteSettings.announcement_text || '';
    document.getElementById('set-announcement-active').value = siteSettings.announcement_active ? 'true' : 'false';
    document.getElementById('set-hero-headline').value = siteSettings.hero_headline || '';
    document.getElementById('set-hero-subheadline').value = siteSettings.hero_subheadline || '';

    document.getElementById('save-homepage-btn').onclick = () => {
        siteSettings.announcement_text = document.getElementById('set-announcement').value.trim();
        siteSettings.announcement_active = document.getElementById('set-announcement-active').value === 'true';
        siteSettings.hero_headline = document.getElementById('set-hero-headline').value.trim();
        siteSettings.hero_subheadline = document.getElementById('set-hero-subheadline').value.trim();

        localStorage.setItem('site_settings', JSON.stringify(siteSettings));
        writeAuditLog("Admin", "Re-compiled homepage blocks and announcement bar configurations.");
        showToast("Homepage layout recompiled successfully.");
    };
}

// --- TAB: SYSTEM SETTINGS ---
function setupSettingsForm() {
    document.getElementById('set-shipping-fee').value = siteSettings.shipping_fee || 50;
    document.getElementById('set-free-shipping-enabled').value = siteSettings.free_shipping_enabled !== false ? 'true' : 'false';
    document.getElementById('set-shipping-threshold').value = siteSettings.free_shipping_threshold !== undefined ? siteSettings.free_shipping_threshold : 300;
    document.getElementById('set-free-shipping-calculation').value = siteSettings.free_shipping_calculation || 'after_discounts';
    document.getElementById('set-maintenance-active').value = siteSettings.maintenance_active ? 'true' : 'false';
    document.getElementById('set-maintenance-msg').value = siteSettings.maintenance_message || '';

    document.getElementById('save-settings-btn').onclick = () => {
        siteSettings.shipping_fee = parseInt(document.getElementById('set-shipping-fee').value) || 0;
        siteSettings.free_shipping_enabled = document.getElementById('set-free-shipping-enabled').value === 'true';
        siteSettings.free_shipping_threshold = parseInt(document.getElementById('set-shipping-threshold').value) || 0;
        siteSettings.free_shipping_calculation = document.getElementById('set-free-shipping-calculation').value;
        siteSettings.maintenance_active = document.getElementById('set-maintenance-active').value === 'true';
        siteSettings.maintenance_message = document.getElementById('set-maintenance-msg').value.trim();

        localStorage.setItem('site_settings', JSON.stringify(siteSettings));
        writeAuditLog("Admin", `Updated shipping configurations (Threshold: ₹${siteSettings.free_shipping_threshold}, Mode: ${siteSettings.free_shipping_calculation}).`);
        showToast("System settings updated.");
    };
}

// --- SECURITY AUDIT LOGGER ---
function writeAuditLog(actor, action) {
    const entry = {
        timestamp: new Date().toISOString(),
        actor,
        action
    };
    auditLogs.push(entry);
    localStorage.setItem('audit_logs', JSON.stringify(auditLogs));
}

function renderAuditLogs() {
    const container = document.getElementById('audit-logs-container');
    if (!container) return;

    if (auditLogs.length === 0) {
        container.innerHTML = '<div>System console clear. No security records.</div>';
        return;
    }

    container.innerHTML = auditLogs.map(log => `
        <div class="audit-log-entry">
            <span style="color:#aaa;">[${new Date(log.timestamp).toLocaleString()}]</span> 
            <strong style="color:var(--accent-yellow);">${log.actor}</strong>: 
            <span>${log.action}</span>
        </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
}

// Toast
let toastTimeout = null;
function showToast(msg) {
    const toast = document.getElementById('admin-toast');
    const txt = document.getElementById('admin-toast-text');
    txt.textContent = msg;
    toast.classList.add('show');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
