import { db, auth } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// DOM Elements
const loginSection = document.getElementById('login-section');
const dashboardContainer = document.getElementById('dashboard-container');
const loginBtn = document.getElementById('login-btn');
const emailInput = document.getElementById('admin-email');
const passwordInput = document.getElementById('admin-password');
const loginError = document.getElementById('login-error');
const toast = document.getElementById('toast');

// Data State (Demo Mode)
let categories = JSON.parse(localStorage.getItem('categories') || '["Marvel", "DC", "Anime", "Funky"]');
let products = JSON.parse(localStorage.getItem('products') || '[]');
let editingProductId = null;
let editingCategoryId = null;

// Ensure initial save
localStorage.setItem('categories', JSON.stringify(categories));

// --- DASHBOARD UI TEMPLATE ---
const dashboardHTML = `
    <div class="admin-dashboard">
        <div class="admin-header">
            <h2>Admin Dashboard</h2>
            <button class="btn" id="logout-btn">Logout</button>
        </div>

        <div class="tabs">
            <button class="tab-btn active" data-target="tab-orders">Orders</button>
            <button class="tab-btn" data-target="tab-products">Products</button>
            <button class="tab-btn" data-target="tab-categories">Categories</button>
        </div>

        <!-- Orders Tab -->
        <div id="tab-orders" class="tab-content active">
            <h3>Recent Orders</h3>
            <div class="orders-table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Customer</th>
                            <th>Contact & Address</th>
                            <th>Items Ordered</th>
                            <th>Total</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="orders-tbody">
                        <tr><td colspan="6" style="text-align:center;">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Products Tab -->
        <div id="tab-products" class="tab-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3>Manage Products</h3>
                <button class="btn btn-black" id="new-prod-btn">Add New Product</button>
            </div>
            
            <div id="product-form-container" class="add-product-form hidden" style="margin-bottom: 30px;">
                <h4 id="prod-form-title" style="margin-bottom: 20px;">Add New Sticker</h4>
                <div class="form-group">
                    <label for="prod-title">Sticker Title:</label>
                    <input type="text" id="prod-title" required placeholder="e.g. Iron Man Helmet">
                </div>
                <div class="form-group">
                    <label for="prod-price">Price (₹):</label>
                    <input type="number" id="prod-price" required placeholder="300" min="1">
                </div>
                <div class="form-group">
                    <label for="prod-category">Category:</label>
                    <select id="prod-category">
                        <!-- Populated via JS -->
                    </select>
                </div>
                <div class="form-group">
                    <label for="prod-tags">Tags (comma separated):</label>
                    <input type="text" id="prod-tags" placeholder="e.g. superhero, red, avengers">
                </div>
                <div class="form-group">
                    <label for="prod-image">Sticker Image:</label>
                    <input type="file" id="prod-image" accept="image/*">
                    <img id="image-preview" src="" alt="Preview" style="max-width: 150px; margin-top: 10px; display: none;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-black" id="save-prod-btn">Save Product</button>
                    <button class="btn" id="cancel-prod-btn">Cancel</button>
                </div>
            </div>

            <div class="orders-table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Image</th>
                            <th>Title</th>
                            <th>Price</th>
                            <th>Category</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="products-tbody"></tbody>
                </table>
            </div>
        </div>

        <!-- Categories Tab -->
        <div id="tab-categories" class="tab-content">
            <h3>Manage Categories</h3>
            <div style="margin-bottom: 20px; display: flex; gap: 10px;">
                <input type="text" id="new-cat-input" placeholder="New Category Name" style="max-width: 300px;">
                <button class="btn btn-black" id="add-cat-btn">Add Category</button>
            </div>
            <div class="orders-table-container" style="max-width: 600px;">
                <table>
                    <thead>
                        <tr>
                            <th>Category Name</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="categories-tbody"></tbody>
                </table>
            </div>
        </div>
    </div>
`;

// Auth State Observer
if (auth) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            initDashboard();
        } else {
            loginSection.classList.remove('hidden');
            dashboardContainer.innerHTML = '';
        }
    });
}

// Login
loginBtn.addEventListener('click', async () => {
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
        loginError.textContent = "Enter email and password";
        return;
    }

    loginBtn.textContent = "Logging in...";
    loginBtn.disabled = true;
    loginError.textContent = "";

    // Demo Mode Bypass
    if (email === "admin@dheeraj.com" && password === "G1wp23@sticker") {
        console.log("Demo Admin Login Success");
        showToast("Demo Mode: Logged in successfully");
        initDashboard();
        loginBtn.textContent = "Login";
        loginBtn.disabled = false;
        return;
    }

    try {
        if(!auth) throw new Error("Firebase Auth not configured");
        await signInWithEmailAndPassword(auth, email, password);
        showToast("Logged in successfully");
    } catch (error) {
        console.error(error);
        loginError.textContent = "Login failed: " + error.message;
    } finally {
        loginBtn.textContent = "Login";
        loginBtn.disabled = false;
    }
});

function initDashboard() {
    loginSection.classList.add('hidden');
    dashboardContainer.innerHTML = dashboardHTML;
    setupDashboardEvents();
    renderCategories();
    renderProductsTable();
    populateCategoryDropdown();
    
    // Fetch orders if firebase is linked
    if (!auth || Object.keys(auth).length === 0) {
        document.getElementById('orders-tbody').innerHTML = `<tr><td colspan="6" style="text-align:center;">Demo Mode: Real orders will appear here when Firebase is linked.</td></tr>`;
    } else {
        fetchOrders();
    }
}

function setupDashboardEvents() {
    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if(auth && auth.currentUser) {
            await signOut(auth);
        } else {
            loginSection.classList.remove('hidden');
            dashboardContainer.innerHTML = '';
            emailInput.value = '';
            passwordInput.value = '';
        }
        showToast("Logged out");
    });

    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    // Categories
    document.getElementById('add-cat-btn').addEventListener('click', () => {
        const val = document.getElementById('new-cat-input').value.trim();
        if(val && !categories.includes(val)) {
            categories.push(val);
            saveCategories();
            document.getElementById('new-cat-input').value = '';
            showToast("Category Added");
        }
    });

    // Products
    const prodFormContainer = document.getElementById('product-form-container');
    const prodImageInput = document.getElementById('prod-image');
    const imagePreview = document.getElementById('image-preview');
    let currentBase64Image = '';

    document.getElementById('new-prod-btn').addEventListener('click', () => {
        editingProductId = null;
        document.getElementById('prod-form-title').textContent = "Add New Sticker";
        resetProdForm();
        prodFormContainer.classList.remove('hidden');
    });

    document.getElementById('cancel-prod-btn').addEventListener('click', () => {
        prodFormContainer.classList.add('hidden');
        resetProdForm();
    });

    prodImageInput.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                currentBase64Image = e.target.result;
                imagePreview.src = currentBase64Image;
                imagePreview.style.display = 'block';
            }
            reader.readAsDataURL(file);
        } else {
            if(!editingProductId) {
                currentBase64Image = '';
                imagePreview.style.display = 'none';
            }
        }
    });

    document.getElementById('save-prod-btn').addEventListener('click', () => {
        const title = document.getElementById('prod-title').value;
        const price = document.getElementById('prod-price').value;
        const category = document.getElementById('prod-category').value;
        const tags = document.getElementById('prod-tags').value;

        if (!title || !price || !category) {
            showToast("Please fill all required fields.");
            return;
        }

        if(editingProductId) {
            const idx = products.findIndex(p => p.id === editingProductId);
            if(idx > -1) {
                products[idx].title = title;
                products[idx].price = parseInt(price);
                products[idx].category = category;
                products[idx].tags = tags;
                if(currentBase64Image) {
                    products[idx].img = currentBase64Image;
                }
            }
            showToast("Product Updated!");
        } else {
            if(!currentBase64Image) {
                showToast("Please upload an image.");
                return;
            }
            products.push({
                id: Date.now(),
                title,
                price: parseInt(price),
                category,
                tags,
                img: currentBase64Image
            });
            showToast("Product Added!");
        }

        saveProducts();
        prodFormContainer.classList.add('hidden');
        resetProdForm();
    });

    function resetProdForm() {
        document.getElementById('prod-title').value = '';
        document.getElementById('prod-price').value = '';
        document.getElementById('prod-tags').value = '';
        document.getElementById('prod-image').value = '';
        imagePreview.style.display = 'none';
        currentBase64Image = '';
    }

    // Attach global edit/delete handlers
    window.editProduct = (id) => {
        const p = products.find(p => p.id === id);
        if(!p) return;
        editingProductId = id;
        document.getElementById('prod-form-title').textContent = "Edit Sticker";
        document.getElementById('prod-title').value = p.title;
        document.getElementById('prod-price').value = p.price;
        document.getElementById('prod-category').value = p.category;
        document.getElementById('prod-tags').value = p.tags || '';
        imagePreview.src = p.img;
        imagePreview.style.display = 'block';
        currentBase64Image = ''; // Keep empty unless changed
        prodFormContainer.classList.remove('hidden');
    };

    window.deleteProduct = (id) => {
        if(confirm("Are you sure you want to delete this product?")) {
            products = products.filter(p => p.id !== id);
            saveProducts();
            showToast("Product Deleted");
        }
    };

    window.deleteCategory = (cat) => {
        if(confirm(`Delete category '${cat}'? Products in this category will still exist.`)) {
            categories = categories.filter(c => c !== cat);
            saveCategories();
            showToast("Category Deleted");
        }
    };
    
    window.editCategory = (oldCat) => {
        const newCat = prompt("Enter new category name:", oldCat);
        if(newCat && newCat.trim() !== "" && !categories.includes(newCat.trim())) {
            const idx = categories.indexOf(oldCat);
            if(idx > -1) {
                categories[idx] = newCat.trim();
                // Optionally update products associated with this category
                products.forEach(p => {
                    if(p.category === oldCat) p.category = newCat.trim();
                });
                saveProducts();
                saveCategories();
                showToast("Category Updated");
            }
        }
    }
}

// --- RENDERING LOGIC ---
function renderCategories() {
    const tbody = document.getElementById('categories-tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    categories.forEach(cat => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${cat}</strong></td>
            <td>
                <button class="btn" style="padding: 5px; font-size: 0.8rem;" onclick="editCategory('${cat}')">Edit</button>
                <button class="btn btn-black" style="padding: 5px; font-size: 0.8rem;" onclick="deleteCategory('${cat}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    populateCategoryDropdown();
}

function populateCategoryDropdown() {
    const select = document.getElementById('prod-category');
    if(!select) return;
    select.innerHTML = '';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
}

function renderProductsTable() {
    const tbody = document.getElementById('products-tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    // Sort products by newest
    const sorted = [...products].sort((a,b) => b.id - a.id);
    
    sorted.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img src="${p.img}" style="width:50px; height:50px; object-fit:cover; border: 2px solid #000;"></td>
            <td><strong>${p.title}</strong></td>
            <td>₹${p.price}</td>
            <td><span style="background:#000; color:#fff; padding: 2px 5px; font-size: 0.7rem;">${p.category}</span></td>
            <td>
                <button class="btn" style="padding: 5px; font-size: 0.8rem;" onclick="editProduct(${p.id})">Edit</button>
                <button class="btn btn-black" style="padding: 5px; font-size: 0.8rem;" onclick="deleteProduct(${p.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function saveCategories() {
    localStorage.setItem('categories', JSON.stringify(categories));
    renderCategories();
}

function saveProducts() {
    localStorage.setItem('products', JSON.stringify(products));
    renderProductsTable();
}

function fetchOrders() {
    if (!db) return;
    const q = query(collection(db, "orders"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const tbody = document.getElementById('orders-tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No orders yet.</td></tr>`;
            return;
        }

        snapshot.forEach((doc) => {
            const order = doc.data();
            const date = order.timestamp ? order.timestamp.toDate().toLocaleString() : 'Just now';
            
            let itemsHtml = '<ul class="order-items-list">';
            order.items.forEach(item => {
                itemsHtml += `<li>${item.title} (₹${item.price})</li>`;
            });
            itemsHtml += '</ul>';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${date}</td>
                <td><strong>${order.customer_name}</strong></td>
                <td>
                    <a href="mailto:${order.email}" style="color:var(--text-color);">${order.email}</a><br>
                    <small>${order.address}</small>
                </td>
                <td>${itemsHtml}</td>
                <td><strong>₹${order.total_price}</strong></td>
                <td><button class="btn btn-black" style="padding: 5px 10px; font-size: 0.8rem;" onclick="alert('Update status feature coming soon!')">Mark Done</button></td>
            `;
            tbody.appendChild(tr);
        });
    }, (error) => {
        const tbody = document.getElementById('orders-tbody');
        if(tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Error fetching orders. Check security rules.</td></tr>`;
    });
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
