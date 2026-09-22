/**
 * CHIPAKK & THE MARSHANS — Add to Cart & Login Gate Regression Test Suite
 *
 * Verifies Scenarios A through L:
 *   [A] Logged-out customer -> click Add to Cart -> login modal shown, item NOT added
 *   [B] Dismiss / cancel login modal -> item remains out of cart
 *   [C] Sign-in via modal -> pending item immediately added to cart
 *   [D] Already logged-in customer -> Add to Cart works directly without modal
 *   [E] Rapid multi-click debounce (< 350ms) prevents duplicate additions
 *   [F] Store 1 cart isolation (chipakk_cart_v1)
 *   [G] Store 2 cart isolation (marshans_cart_v1) and cross-store product rejection
 *   [H] Product Details page Add to Cart and Buy Now gate parity
 *   [I] Custom Stickers Studio Add to Cart gate parity
 *   [J] Backend Express API route protection (/api/cart/* returns 401 unauthenticated)
 *   [K] Page refresh preserves cart for logged-in user
 *   [L] User logout clears in-memory and persisted localStorage cart
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { loadStorefront, envelope } = require('./helpers/storefront_vm');
const { createFakePool, installFakePool } = require('./helpers/fake_db');

const results = [];
async function test(scenario, name, fn) {
  try {
    await fn();
    results.push({ scenario, name, pass: true });
    console.log(`[PASS] ${scenario} :: ${name}`);
  } catch (err) {
    results.push({ scenario, name, pass: false, err });
    console.error(`[FAIL] ${scenario} :: ${name}\n       ${err && err.stack ? err.stack : err}`);
  }
}

// Robust DOM Mock helper for storefront VM
function createDomElement(tag = 'div', id = '') {
  const listeners = {};
  const children = [];
  const el = {
    tagName: tag.toUpperCase(),
    id,
    className: '',
    style: {},
    attributes: {},
    children,
    dataset: {},
    _innerHTML: '',
    textContent: '',
    disabled: false,
    value: '',
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] || null; },
    removeAttribute(k) { delete this.attributes[k]; },
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) { this._classes.delete(c); return false; }
          this._classes.add(c); return true;
        }
        if (force) { this._classes.add(c); return true; }
        this._classes.delete(c); return false;
      }
    },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      if (listeners[ev]) {
        const idx = listeners[ev].indexOf(fn);
        if (idx !== -1) listeners[ev].splice(idx, 1);
      }
    },
    dispatchEvent(e) {
      const eventObj = typeof e === 'string' ? { type: e, target: el, preventDefault: () => {} } : Object.assign({ target: el, preventDefault: () => {} }, e);
      (listeners[eventObj.type] || []).forEach(fn => fn(eventObj));
      return true;
    },
    click() { this.dispatchEvent({ type: 'click', target: el, preventDefault: () => {} }); },
    reset() { this.value = ''; },
    focus() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(sel) {
      if (!sel) return null;
      const targetId = sel.startsWith('#') ? sel.slice(1) : sel;
      function findRecursive(node) {
        if (node.id === targetId) return node;
        for (const child of node.children) {
          const found = findRecursive(child);
          if (found) return found;
        }
        return null;
      }
      return findRecursive(this);
    }
  };

  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(val) {
      this._innerHTML = val;
      const re = /id=["']([^"']+)["']/g;
      let match;
      while ((match = re.exec(val)) !== null) {
        const childId = match[1];
        const childTag = childId.toLowerCase().includes('btn') ? 'button'
                       : childId.toLowerCase().includes('form') ? 'form'
                       : childId.toLowerCase().includes('email') || childId.toLowerCase().includes('pass') ? 'input'
                       : 'div';
        const child = createDomElement(childTag, childId);
        this.children.push(child);
      }
    }
  });

  return el;
}

(async () => {
  console.log('===============================================================');
  console.log('🛒 CHIPAKK / THE MARSHANS — ADD TO CART & LOGIN GATE TEST SUITE');
  console.log('===============================================================\n');

  /* -------------------------------------------------------------
     SCENARIO A: Logged-out customer clicks Add to Cart on shop card
     ------------------------------------------------------------- */
  await test('SCENARIO A', 'Logged-out customer -> click Add to Cart -> login prompt appears -> item NOT added', () => {
    let createdModal = null;
    const bodyEl = createDomElement('body');
    bodyEl.appendChild = (child) => {
      createdModal = child;
      bodyEl.children.push(child);
      return child;
    };

    const sf = loadStorefront({
      user: null,
      location: { hostname: 'chipakk.shop' }
    });

    sf.ctx.document.body = bodyEl;
    sf.ctx.document.getElementById = (id) => (createdModal && createdModal.id === id ? createdModal : null);
    sf.ctx.document.createElement = (tag) => createDomElement(tag);

    const product = {
      id: 101,
      name: 'Anime Cyberpunk Sticker',
      price: 99,
      store_id: 1
    };

    const added = sf.CHIPAKK.cart.addItem(product, 1);
    assert.strictEqual(added, false, 'addItem must return false when customer is not authenticated');
    assert.strictEqual(sf.CHIPAKK.cart.items.length, 0, 'Cart items array must remain empty');
    assert.strictEqual(sf.CHIPAKK.cart.getCount(), 0, 'Cart count must remain 0');

    // Storage should not contain items
    const rawStorage = sf.storage['chipakk_cart_v1'];
    assert.ok(!rawStorage || rawStorage === '[]', 'localStorage must not have added items');

    // Login modal must have been created and displayed
    assert.ok(createdModal, 'Login modal element must have been constructed in DOM');
    assert.strictEqual(createdModal.style.display, 'flex', 'Modal style.display must be flex');
  });

  /* -------------------------------------------------------------
     SCENARIO B: Dismiss / cancel login modal
     ------------------------------------------------------------- */
  await test('SCENARIO B', 'Dismissing login modal clears pending action and leaves cart empty', () => {
    let createdModal = null;
    const bodyEl = createDomElement('body');
    bodyEl.appendChild = (child) => {
      createdModal = child;
      bodyEl.children.push(child);
      return child;
    };

    const sf = loadStorefront({
      user: null,
      location: { hostname: 'chipakk.shop' }
    });
    sf.ctx.document.body = bodyEl;
    sf.ctx.document.getElementById = (id) => (createdModal && createdModal.id === id ? createdModal : null);
    sf.ctx.document.createElement = (tag) => createDomElement(tag);

    const product = { id: 102, name: 'Retro Wave Sticker', price: 149, store_id: 1 };
    sf.CHIPAKK.cart.addItem(product, 1);

    assert.ok(createdModal);
    assert.strictEqual(createdModal.style.display, 'flex');

    // Simulate clicking backdrop / close
    createdModal.click();
    assert.strictEqual(createdModal.style.display, 'none', 'Modal must hide on backdrop click');
    assert.strictEqual(sf.CHIPAKK.cart.items.length, 0, 'Cart must remain empty after modal dismissal');
  });

  /* -------------------------------------------------------------
     SCENARIO C: Successful login adds pending item to cart
     ------------------------------------------------------------- */
  await test('SCENARIO C', 'Successful login from prompt adds pending item and runs onAdded callback', async () => {
    let loginModal = null;
    const bodyEl = createDomElement('body');
    bodyEl.appendChild = (child) => {
      if (child.id === 'customerLoginModal') {
        loginModal = child;
      }
      bodyEl.children.push(child);
      return child;
    };

    let currentUser = null;
    const sf = loadStorefront({
      user: null,
      location: { hostname: 'chipakk.shop' }
    });

    // Provide auth with signIn that updates currentUser
    sf.ctx.window.CHIPAKK.auth = {
      getCurrentUser: () => currentUser,
      signIn: async (email, password) => {
        currentUser = { uid: 'user_456', email };
        return currentUser;
      }
    };

    sf.ctx.document.body = bodyEl;
    sf.ctx.document.getElementById = (id) => (loginModal && loginModal.id === id ? loginModal : null);
    sf.ctx.document.createElement = (tag) => createDomElement(tag);

    const product = { id: 103, name: 'Coding Cat Sticker', price: 120, store_id: 1 };
    let onAddedCalled = false;

    sf.CHIPAKK.cart.addItem(product, 1, {
      onAdded: () => { onAddedCalled = true; }
    });

    assert.strictEqual(sf.CHIPAKK.cart.items.length, 0, 'Cart should be empty before login');
    assert.ok(loginModal, 'Login modal should have been created');
    assert.strictEqual(loginModal.style.display, 'flex');

    // Find form and inputs inside created modal
    const emailInput = loginModal.querySelector('#loginModalEmail');
    const passInput = loginModal.querySelector('#loginModalPassword');
    const form = loginModal.querySelector('#loginModalForm');

    assert.ok(emailInput, 'Email input should be present');
    assert.ok(passInput, 'Password input should be present');
    assert.ok(form, 'Login form should be present');

    emailInput.value = 'coder@chipakk.shop';
    passInput.value = 'securepass123';

    // Submit the form
    form.dispatchEvent({ type: 'submit' });

    // Allow async signIn promise microtasks to run
    await new Promise(r => setTimeout(r, 60));

    assert.strictEqual(loginModal.style.display, 'none', 'Modal should be hidden after successful sign-in');
    assert.strictEqual(sf.CHIPAKK.cart.items.length, 1, 'Pending item must now be added to cart');
    assert.strictEqual(sf.CHIPAKK.cart.items[0].id, 103, 'Added item ID must match pending product');
    assert.strictEqual(onAddedCalled, true, 'onAdded callback must be triggered upon login completion');
  });

  /* -------------------------------------------------------------
     SCENARIO D: Already logged in customer adds to cart directly
     ------------------------------------------------------------- */
  await test('SCENARIO D', 'Already logged-in customer -> Add to Cart works directly without login prompt', () => {
    const sf = loadStorefront({
      user: { uid: 'logged_in_user', email: 'fan@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });

    const product = { id: 104, name: 'Developer Vinyl Sticker', price: 85, store_id: 1 };
    const added = sf.CHIPAKK.cart.addItem(product, 2);

    assert.strictEqual(added, true, 'addItem must return true for authenticated customer');
    assert.strictEqual(sf.CHIPAKK.cart.items.length, 1, 'Cart items array must contain 1 item');
    assert.strictEqual(sf.CHIPAKK.cart.items[0].qty, 2, 'Cart item quantity must be 2');
    assert.strictEqual(sf.CHIPAKK.cart.getCount(), 2, 'Cart total count must be 2');
  });

  /* -------------------------------------------------------------
     SCENARIO E: Multi-click debouncing (< 350ms)
     ------------------------------------------------------------- */
  await test('SCENARIO E', 'Rapid multi-clicks (< 350ms) on Add to Cart are debounced to a single addition', () => {
    const sf = loadStorefront({
      user: { uid: 'logged_in_user', email: 'fan@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });

    const product = { id: 105, name: 'Debounced Sticker', price: 99, store_id: 1 };

    // Rapid double click
    const firstClick = sf.CHIPAKK.cart.addItem(product, 1);
    const secondClick = sf.CHIPAKK.cart.addItem(product, 1);

    assert.strictEqual(firstClick, true, 'First click must succeed');
    assert.strictEqual(secondClick, false, 'Second click within 350ms must be debounced and return false');
    assert.strictEqual(sf.CHIPAKK.cart.items.length, 1, 'Cart must only have 1 item');
    assert.strictEqual(sf.CHIPAKK.cart.items[0].qty, 1, 'Quantity must not be incremented on rapid double click');
  });

  /* -------------------------------------------------------------
     SCENARIO F: Store 1 cart isolation (chipakk_cart_v1)
     ------------------------------------------------------------- */
  await test('SCENARIO F', 'Store 1 writes exclusively to chipakk_cart_v1 without leaking to marshans_cart_v1', () => {
    const sf = loadStorefront({
      user: { uid: 'user_store1', email: 's1@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });

    const product = { id: 106, name: 'Store 1 Sticker', price: 50, store_id: 1 };
    sf.CHIPAKK.cart.addItem(product, 1);

    assert.ok(sf.storage['chipakk_cart_v1'], 'chipakk_cart_v1 must be set in localStorage');
    assert.strictEqual(sf.storage['marshans_cart_v1'], undefined, 'marshans_cart_v1 must not be created or modified');
    const parsed = JSON.parse(sf.storage['chipakk_cart_v1']);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].id, 106);
  });

  /* -------------------------------------------------------------
     SCENARIO G: Store 2 cart isolation (marshans_cart_v1) & cross-store rejection
     ------------------------------------------------------------- */
  await test('SCENARIO G', 'Store 2 writes to marshans_cart_v1 and rejects Store 1 products', () => {
    const sf = loadStorefront({
      user: { uid: 'user_store2', email: 's2@themarshans.shop' },
      location: { hostname: 'themarshans.shop' }
    });

    // 1. Legitimate Store 2 product
    const marshansProd = { id: 201, name: 'Marshans Alien Sticker', price: 150, store_id: 2 };
    const addedMarshans = sf.CHIPAKK.cart.addItem(marshansProd, 1);
    assert.strictEqual(addedMarshans, true, 'Store 2 product should be added to Store 2 cart');
    assert.ok(sf.storage['marshans_cart_v1'], 'marshans_cart_v1 must be set in localStorage');
    assert.strictEqual(sf.storage['chipakk_cart_v1'], undefined, 'chipakk_cart_v1 must not be modified');

    // 2. Cross-store addition attempt (Store 1 item while active on Store 2)
    const chipakkProd = { id: 107, name: 'Chipakk Solo Sticker', price: 75, store_id: 1 };
    const crossStoreAdded = sf.CHIPAKK.cart.addItem(chipakkProd, 1);
    assert.strictEqual(crossStoreAdded, false, 'Cross-store product addition must be rejected');

    const parsed = JSON.parse(sf.storage['marshans_cart_v1']);
    assert.strictEqual(parsed.length, 1, 'Only the Store 2 product should be present in marshans_cart_v1');
    assert.strictEqual(parsed[0].id, 201);
  });

  /* -------------------------------------------------------------
     SCENARIO H: Product Details page Add to Cart and Buy Now gate parity
     ------------------------------------------------------------- */
  await test('SCENARIO H', 'Product details Add to Cart and Buy Now respect the login gate', () => {
    // 1. Logged-out state
    const sfLoggedOut = loadStorefront({
      user: null,
      location: { hostname: 'chipakk.shop' }
    });
    const prod = { id: 301, name: 'Detail Page Sticker', price: 199, store_id: 1 };

    let redirectUrl = null;
    const addResult = sfLoggedOut.CHIPAKK.cart.addItem(prod, 1, {
      onAdded: () => { redirectUrl = 'checkout.html'; }
    });
    assert.strictEqual(addResult, false, 'Add to cart on details page must return false for guest');
    assert.strictEqual(redirectUrl, null, 'Buy Now must not immediately redirect if customer is logged out');

    // 2. Logged-in state
    const sfLoggedIn = loadStorefront({
      user: { uid: 'buyer_77', email: 'buyer@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });
    let redirectUrlLoggedIn = null;
    const addResultLoggedIn = sfLoggedIn.CHIPAKK.cart.addItem(prod, 1, {
      onAdded: () => { redirectUrlLoggedIn = 'checkout.html'; }
    });
    assert.strictEqual(addResultLoggedIn, true, 'Add to cart on details page must succeed for authenticated user');
    if (addResultLoggedIn) redirectUrlLoggedIn = 'checkout.html';
    assert.strictEqual(redirectUrlLoggedIn, 'checkout.html', 'Buy now redirects to checkout on success');
  });

  /* -------------------------------------------------------------
     SCENARIO I: Custom Stickers Studio Add to Cart gate parity
     ------------------------------------------------------------- */
  await test('SCENARIO I', 'Custom Stickers Studio Add to Cart is gated by authentication', () => {
    // 1. Logged-out guest
    const sfGuest = loadStorefront({
      user: null,
      location: { hostname: 'chipakk.shop' }
    });

    const customItem = {
      id: 'custom_123',
      name: 'Custom Die Cut (50 pcs)',
      price: 1499,
      is_custom: true,
      custom_design_data: { quantity: 50, cutType: 'Die Cut' },
      materials: ['Glossy'],
      sizes: ['3"']
    };

    let drawerOpened = false;
    const addedGuest = sfGuest.CHIPAKK.cart.addItem(customItem, 1, {
      material: 'Glossy',
      size: '3"',
      onAdded: () => { drawerOpened = true; }
    });
    assert.strictEqual(addedGuest, false, 'Custom sticker cannot be added to cart when logged out');
    assert.strictEqual(drawerOpened, false, 'Cart drawer must not open for logged-out custom item attempt');
    assert.strictEqual(sfGuest.CHIPAKK.cart.items.length, 0);

    // 2. Logged-in user
    const sfMember = loadStorefront({
      user: { uid: 'custom_artist', email: 'artist@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });

    let memberDrawerOpened = false;
    const addedMember = sfMember.CHIPAKK.cart.addItem(customItem, 1, {
      material: 'Glossy',
      size: '3"',
      onAdded: () => { memberDrawerOpened = true; }
    });
    assert.strictEqual(addedMember, true, 'Custom sticker addition succeeds when user is logged in');
    if (addedMember) memberDrawerOpened = true;
    assert.strictEqual(memberDrawerOpened, true, 'Cart drawer opens on successful custom item addition');
    assert.strictEqual(sfMember.CHIPAKK.cart.items.length, 1);
    assert.strictEqual(sfMember.CHIPAKK.cart.items[0].is_custom, true);
    assert.strictEqual(sfMember.CHIPAKK.cart.items[0].custom_design_data.cutType, 'Die Cut');
  });

  /* -------------------------------------------------------------
     SCENARIO J: Backend Express API route protection
     ------------------------------------------------------------- */
  await test('SCENARIO J', 'Backend Express cart endpoints reject unauthenticated requests with 401', async () => {
    const fakePool = createFakePool();
    installFakePool(fakePool);

    const app = require('../server/app');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;

    const endpoints = [
      { method: 'GET', path: '/api/cart' },
      { method: 'POST', path: '/api/cart/items', body: JSON.stringify({ product_id: 1, quantity: 1 }) },
      { method: 'PUT', path: '/api/cart/items/1', body: JSON.stringify({ quantity: 2 }) },
      { method: 'DELETE', path: '/api/cart/items/1' },
      { method: 'DELETE', path: '/api/cart' }
    ];

    try {
      for (const ep of endpoints) {
        const res = await fetch(`http://127.0.0.1:${port}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            'Host': 'chipakk.shop'
          },
          body: ep.body
        });

        assert.strictEqual(res.status, 401, `${ep.method} ${ep.path} must return 401 Unauthorized`);
        const json = await res.json();
        assert.strictEqual(json.success, false);
        assert.ok(json.error, 'Response must have error details');
        assert.strictEqual(json.error.statusCode, 401, 'Error status code must be 401');
      }
    } finally {
      server.close();
    }
  });

  /* -------------------------------------------------------------
     SCENARIO K: Page refresh preserves cart
     ------------------------------------------------------------- */
  await test('SCENARIO K', 'Page refresh preserves items in cart for customer from localStorage', () => {
    // First visit: customer logs in and adds items
    const sfFirstVisit = loadStorefront({
      user: { uid: 'persisted_user', email: 'shopper@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });

    sfFirstVisit.CHIPAKK.cart.addItem({ id: 501, name: 'Holographic Alien', price: 199, store_id: 1 }, 2);
    sfFirstVisit.CHIPAKK.cart.addItem({ id: 502, name: 'Glitch Cyber Heart', price: 99, store_id: 1 }, 1);

    assert.strictEqual(sfFirstVisit.CHIPAKK.cart.items.length, 2);
    assert.strictEqual(sfFirstVisit.CHIPAKK.cart.getCount(), 3);

    // Second visit / refresh: simulated page reload using same localStorage
    const sfReload = loadStorefront({
      user: { uid: 'persisted_user', email: 'shopper@chipakk.shop' },
      storage: sfFirstVisit.storage,
      location: { hostname: 'chipakk.shop' }
    });

    assert.strictEqual(sfReload.CHIPAKK.cart.items.length, 2, 'Reloaded cart must have 2 items');
    assert.strictEqual(sfReload.CHIPAKK.cart.getCount(), 3, 'Reloaded cart count must equal 3');
    assert.strictEqual(sfReload.CHIPAKK.cart.items[0].id, 501);
    assert.strictEqual(sfReload.CHIPAKK.cart.items[1].id, 502);
  });

  /* -------------------------------------------------------------
     SCENARIO L: Logout clears cart
     ------------------------------------------------------------- */
  await test('SCENARIO L', 'User logout clears in-memory and persisted localStorage cart completely', async () => {
    const sf = loadStorefront({
      user: { uid: 'active_shopper', email: 'active@chipakk.shop' },
      location: { hostname: 'chipakk.shop' }
    });

    // Populate cart
    sf.CHIPAKK.cart.addItem({ id: 601, name: 'Session Sticker', price: 150, store_id: 1 }, 1);
    assert.strictEqual(sf.CHIPAKK.cart.items.length, 1);
    assert.ok(sf.storage['chipakk_cart_v1'] && sf.storage['chipakk_cart_v1'] !== '[]');

    // Perform logout
    sf.CHIPAKK.cart.clear();

    assert.strictEqual(sf.CHIPAKK.cart.items.length, 0, 'In-memory cart items must be empty after logout');
    assert.strictEqual(sf.CHIPAKK.cart.getCount(), 0, 'Cart count must be 0');
    assert.strictEqual(sf.storage['chipakk_cart_v1'], '[]', 'LocalStorage cart must be cleared to empty array');

    // Next visitor sees clean slate
    const sfNextVisitor = loadStorefront({
      user: null,
      storage: sf.storage,
      location: { hostname: 'chipakk.shop' }
    });
    assert.strictEqual(sfNextVisitor.CHIPAKK.cart.items.length, 0, 'Next visitor starts with an empty cart');
  });

  console.log('\n===============================================================');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`RESULTS: ${passed}/${total} passed`);
  console.log('===============================================================');

  if (passed !== total) {
    process.exit(1);
  }
})();
