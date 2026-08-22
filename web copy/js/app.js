import { db } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Initialize default products if none exist in localStorage (Demo Mode)
const defaultProducts = [
    { id: 1, title: 'Cool Skull', price: 300, category: 'Funky', tags: 'skull, cool, bone', img: 'img/sticker_skull_1785947559034.jpg' },
    { id: 2, title: 'Stay Weird', price: 350, category: 'Funky', tags: 'text, typography, weird', img: 'img/sticker_text_1785947569619.jpg' },
    { id: 3, title: 'Skate Alien', price: 400, category: 'Funky', tags: 'alien, skate, space', img: 'img/sticker_alien_1785947580000.jpg' },
    { id: 4, title: 'Retro Abstract', price: 250, category: 'Funky', tags: 'abstract, shapes, retro', img: 'img/sticker_abstract_1785947591093.jpg' }
];

if (!localStorage.getItem('products')) {
    localStorage.setItem('products', JSON.stringify(defaultProducts));
}

let categories = JSON.parse(localStorage.getItem('categories') || '["Marvel", "DC", "Anime", "Funky"]');

let products = JSON.parse(localStorage.getItem('products'));
let filteredProducts = [...products];
let cart = [];

// DOM Elements
const productGrid = document.getElementById('product-grid');
const cartBtn = document.getElementById('cart-btn');
const cartSidebar = document.getElementById('cart-sidebar');
const closeCartBtn = document.getElementById('close-cart');
const overlay = document.getElementById('overlay');
const cartItemsContainer = document.getElementById('cart-items');
const cartTotalPrice = document.getElementById('cart-total-price');
const checkoutBtn = document.getElementById('checkout-btn');
const checkoutForm = document.getElementById('checkout-form');
const submitOrderBtn = document.getElementById('submit-order-btn');
const addCustomBtn = document.getElementById('add-custom-btn');
const toast = document.getElementById('toast');
const categoryBtns = document.querySelectorAll('#category-filters .btn');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

// Render Products
function renderProducts(productsToRender) {
    productGrid.innerHTML = '';
    
    if (productsToRender.length === 0) {
        productGrid.innerHTML = '<p>No stickers found.</p>';
        return;
    }

    productsToRender.forEach(p => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-category-badge">${p.category}</div>
            <img src="${p.img}" alt="${p.title}" class="product-img">
            <div class="product-info">
                <div class="product-title">${p.title}</div>
                <div class="product-tags">${p.tags || ''}</div>
                <div class="product-price">₹${p.price}</div>
                <button class="btn add-to-cart" data-id="${p.id}">Add to Cart</button>
            </div>
        `;
        productGrid.appendChild(card);
    });

    document.querySelectorAll('.add-to-cart').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Using dataset.id which is string, handle both string and int ids
            const id = e.target.dataset.id;
            const product = products.find(p => p.id.toString() === id);
            if(product) addToCart(product);
        });
    });
}

// Search and Filter Logic
function applyFilters(category, searchTerm) {
    filteredProducts = products.filter(p => {
        const matchesCategory = category === 'All' || p.category === category;
        const matchesSearch = p.title.toLowerCase().includes(searchTerm) || 
                              (p.tags && p.tags.toLowerCase().includes(searchTerm));
        return matchesCategory && matchesSearch;
    });
    renderProducts(filteredProducts);
}

// Category Buttons
function renderCategoryButtons() {
    const filtersDiv = document.getElementById('category-filters');
    filtersDiv.innerHTML = '<button class="btn active" data-category="All">All</button>';
    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.dataset.category = cat;
        btn.textContent = cat;
        filtersDiv.appendChild(btn);
    });

    // Always append Custom category
    const customBtn = document.createElement('button');
    customBtn.className = 'btn';
    customBtn.dataset.category = 'Custom';
    customBtn.textContent = 'Custom';
    filtersDiv.appendChild(customBtn);

    const newBtns = document.querySelectorAll('#category-filters .btn');
    newBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            newBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const category = e.target.dataset.category;
            
            const searchBar = document.querySelector('.search-bar');
            const customSection = document.getElementById('custom-section');
            const productGrid = document.getElementById('product-grid');

            if (category === 'Custom') {
                productGrid.style.display = 'none';
                searchBar.style.display = 'none';
                customSection.style.display = 'block';
            } else {
                productGrid.style.display = 'grid'; // or whatever the default is
                searchBar.style.display = 'flex';
                customSection.style.display = 'none';
                const searchTerm = searchInput.value.toLowerCase().trim();
                applyFilters(category, searchTerm);
            }
        });
    });
}
renderCategoryButtons();

// Search Input
searchInput.addEventListener('input', () => {
    const activeCategory = document.querySelector('#category-filters .btn.active').dataset.category;
    const searchTerm = searchInput.value.toLowerCase().trim();
    applyFilters(activeCategory, searchTerm);
});
searchBtn.addEventListener('click', () => {
    const activeCategory = document.querySelector('#category-filters .btn.active').dataset.category;
    const searchTerm = searchInput.value.toLowerCase().trim();
    applyFilters(activeCategory, searchTerm);
});

// Custom Sticker Logic
const customImageInput = document.getElementById('custom-image');
let currentCustomBase64Image = '';

if(customImageInput) {
    customImageInput.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                currentCustomBase64Image = e.target.result;
            }
            reader.readAsDataURL(file);
        } else {
            currentCustomBase64Image = '';
        }
    });
}

function calculateCustomPrice() {
    const type = document.getElementById('custom-type').value;
    const sizeStr = document.getElementById('custom-size').value; // e.g. "2x2"
    const qty = parseInt(document.getElementById('custom-qty').value) || 50;
    
    // Parse size to get Square Inches
    const [w, h] = sizeStr.split('x').map(Number);
    const sqInches = w * h;
    
    const baseCostPerSqIn = 2.5;
    
    let materialMultiplier = 1.0;
    if (type === 'Holographic' || type === 'Glitter') materialMultiplier = 1.5;
    if (type === 'Reflective') materialMultiplier = 2.0;
    
    let discount = 0;
    if (qty >= 100) discount = 0.10;
    if (qty >= 250) discount = 0.20;
    if (qty >= 500) discount = 0.35;
    if (qty >= 1000) discount = 0.50;
    if (qty >= 2500) discount = 0.60;
    if (qty >= 5000) discount = 0.70;
    
    const unitPrice = (baseCostPerSqIn * sqInches * materialMultiplier) * (1 - discount);
    const totalPrice = unitPrice * qty;
    
    document.getElementById('custom-total-price').textContent = `₹${Math.round(totalPrice)}`;
    document.getElementById('custom-unit-price').textContent = `₹${unitPrice.toFixed(2)} / sticker`;
    
    return { totalPrice: Math.round(totalPrice) };
}

// Update price automatically
document.getElementById('custom-type').addEventListener('change', calculateCustomPrice);
document.getElementById('custom-shape').addEventListener('change', calculateCustomPrice);
document.getElementById('custom-size').addEventListener('change', calculateCustomPrice);
document.getElementById('custom-qty').addEventListener('change', calculateCustomPrice);

// Initialize initial price
calculateCustomPrice();

addCustomBtn.addEventListener('click', () => {
    const type = document.getElementById('custom-type').value;
    const shape = document.getElementById('custom-shape').value;
    const sizeStr = document.getElementById('custom-size').value;
    const qty = parseInt(document.getElementById('custom-qty').value) || 50;
    
    const { totalPrice } = calculateCustomPrice();
    
    addToCart({
        id: 'custom_' + Date.now(),
        title: `Custom ${sizeStr} ${type} (${shape}) x${qty}`,
        price: totalPrice,
        img: currentCustomBase64Image || 'https://via.placeholder.com/150/000000/FFFFFF?text=CUSTOM'
    });
    
    if(customImageInput) customImageInput.value = '';
    currentCustomBase64Image = '';
});

// Cart Logic
function addToCart(product) {
    cart.push(product);
    updateCartUI();
    showToast(`${product.title} added to cart!`);
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

function updateCartUI() {
    cartBtn.textContent = `Cart (${cart.length})`;
    cartItemsContainer.innerHTML = '';
    
    let total = 0;
    cart.forEach((item, index) => {
        total += parseInt(item.price);
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';
        itemEl.innerHTML = `
            <img src="${item.img}" alt="${item.title}">
            <div class="cart-item-details">
                <span class="cart-item-title">${item.title}</span>
                <span>₹${item.price}</span>
            </div>
            <button class="cart-item-remove" data-index="${index}">X</button>
        `;
        cartItemsContainer.appendChild(itemEl);
    });

    cartTotalPrice.textContent = `₹${total}`;

    document.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            removeFromCart(index);
        });
    });

    if (cart.length === 0) {
        checkoutForm.classList.add('hidden');
        checkoutBtn.classList.remove('hidden');
    }
}

// Sidebar Toggle
function toggleCart() {
    cartSidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

cartBtn.addEventListener('click', toggleCart);
closeCartBtn.addEventListener('click', toggleCart);
overlay.addEventListener('click', toggleCart);

// Checkout Process
checkoutBtn.addEventListener('click', () => {
    if (cart.length === 0) {
        showToast("Cart is empty!");
        return;
    }
    checkoutBtn.classList.add('hidden');
    checkoutForm.classList.remove('hidden');
});

submitOrderBtn.addEventListener('click', async () => {
    const name = document.getElementById('buyer-name').value;
    const email = document.getElementById('buyer-email').value;
    const address = document.getElementById('buyer-address').value;

    if (!name || !email || !address) {
        showToast("Please fill all details");
        return;
    }

    const orderTotal = cart.reduce((sum, item) => sum + parseInt(item.price), 0);

    const orderData = {
        customer_name: name,
        email: email,
        address: address,
        items: cart,
        total_price: orderTotal,
        status: 'Pending',
        timestamp: serverTimestamp()
    };

    submitOrderBtn.textContent = "Processing...";
    submitOrderBtn.disabled = true;

    try {
        if (!db) throw new Error("Firebase not configured");
        await addDoc(collection(db, "orders"), orderData);
        showToast("Order Placed Successfully!");
        
        // Reset
        cart = [];
        updateCartUI();
        document.getElementById('buyer-name').value = '';
        document.getElementById('buyer-email').value = '';
        document.getElementById('buyer-address').value = '';
        toggleCart();
    } catch (error) {
        console.error("Error adding document: ", error);
        // Fallback for demonstration when Firebase is not configured
        if(error.message.includes("Firebase not configured") || error.code === 'failed-precondition' || error.code === 'invalid-argument') {
            console.log("Mock Order Placed:", orderData);
            showToast("Demo Mode: Order received (Firebase config missing)");
            cart = [];
            updateCartUI();
            toggleCart();
        } else {
             showToast("Error placing order. Please try again.");
        }
    } finally {
        submitOrderBtn.textContent = "Submit Order";
        submitOrderBtn.disabled = false;
    }
});

// Utility
function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Init
// Listen for changes in localStorage in case admin adds product/category in another tab
window.addEventListener('storage', (e) => {
    if (e.key === 'products') {
        products = JSON.parse(e.newValue);
        const activeCategory = document.querySelector('#category-filters .btn.active').dataset.category;
        const searchTerm = searchInput.value.toLowerCase().trim();
        applyFilters(activeCategory, searchTerm);
    }
    if (e.key === 'categories') {
        categories = JSON.parse(e.newValue);
        renderCategoryButtons();
    }
});

renderProducts(filteredProducts);
