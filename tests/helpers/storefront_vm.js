/**
 * Loads the REAL storefront scripts (media.js -> catalog.js -> app.js) into a Node vm with a
 * permissive DOM stub, so tests execute the shipped code instead of matching source text.
 *
 *   const sf = loadStorefront({ fetch: async (url, opts) => ({ ok, status, json }), storage: {...} });
 *   sf.CHIPAKK.getProducts() ...
 *
 * `record` collects every fetch() URL so tests can assert on network behaviour.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', '..', 'customer-workspace', 'js');

function makeNoop() {
  const noop = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : noop)),
    apply: () => noop,
    construct: () => noop,
    set: () => true
  });
  return noop;
}

function envelope(data, status = 200) {
  return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'ERR', json: async () => ({ success: status < 400, message: 'ok', data }) };
}

function loadStorefront(opts = {}) {
  const noop = makeNoop();
  const store = Object.assign({}, opts.storage || {});
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const record = [];
  const logs = { warn: [], error: [] };
  const fetchImpl = opts.fetch || (async () => envelope({}));
  const fetch = async (url, o) => { record.push({ url: String(url), method: (o && o.method) || 'GET', headers: (o && o.headers) || {} }); return fetchImpl(String(url), o); };

  const listeners = {};
  const win = {
    location: Object.assign({ hostname: 'chipakk.shop', search: '', origin: 'https://chipakk.shop', port: '', pathname: '/shop.html', hash: '', href: 'https://chipakk.shop/shop.html' }, opts.location || {}),
    localStorage, sessionStorage: localStorage,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent: (e) => { (listeners[e && e.type] || []).forEach((fn) => fn(e)); return true; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    CHIPAKK: { auth: { getCurrentUser: () => (opts.user || null), onAuthStateChanged() {}, isAuthReady: () => Promise.resolve(null) } },
    API_BASE_URL: opts.apiBase,
    CHIPAKK_LOADER_MAX_WAIT_MS: opts.loaderMaxWaitMs
  };
  win.window = win;

  const elements = opts.elements || {};
  const docStore = { readyState: 'complete', addEventListener() {}, querySelector: (sel) => (typeof sel === 'string' && sel[0] === '#' ? (elements[sel.slice(1)] || null) : null), querySelectorAll: () => [], getElementById: (id) => elements[id] || null, createElement: () => noop, body: noop, documentElement: { style: { setProperty() {} } } };
  const document = new Proxy(docStore, { get: (t, k) => (k in t ? t[k] : noop) });

  const ctx = vm.createContext({
    window: win, self: win, document, localStorage, sessionStorage: localStorage, fetch,
    navigator: { userAgent: 'node-test' },
    console: { log() {}, warn: (...a) => logs.warn.push(a.join(' ')), error: (...a) => logs.error.push(a.join(' ')) },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    AbortController, URLSearchParams, URL, CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }, Event: function () {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0), IntersectionObserver: function () { return { observe() {}, disconnect() {} }; },
    Intl, Map, Set, Promise, JSON, Math, Date, Number, String, Array, Object, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, Boolean, Error, RegExp, Symbol, alert() {}, location: win.location
  });

  for (const f of ['media.js', 'catalog.js', 'tax.js', 'app.js'].concat(opts.extraScripts || [])) { // tax.js: window.CHIPAKK_TAX (checkout.html loads it too)
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    // media.js / catalog.js are UMD: in the browser they publish window.CHIPAKK_MEDIA / CHIPAKK_CATALOG
    vm.runInContext(src, ctx, { filename: f, timeout: 5000 });
  }
  return { window: win, CHIPAKK: win.CHIPAKK, ctx, record, logs, storage: store };
}

module.exports = { loadStorefront, envelope, JS_DIR };
