const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

// Import Routes
const healthRoutes = require('./routes/health');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const settingsRoutes = require('./routes/settings');
const couponRoutes = require('./routes/coupons');
const eventRoutes = require('./routes/events');
const orderRoutes = require('./routes/orders');
const customerRoutes = require('./routes/customer');
const paymentRoutes = require('./routes/payments');
const cartRoutes = require('./routes/cart');
const custom3dRoutes = require('./routes/custom3d');
const adminRoutes = require('./routes/admin');

// Import Middlewares
const { resolveStoreContext } = require('./middleware/storeContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// Explicit Allowed CORS Origins (No wildcard *)
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'https://chipakk.shop',
  'https://www.chipakk.shop',
  'https://chipakk.com',
  'https://www.chipakk.com',
  'https://api.chipakk.shop',
  'https://themarshans.shop',
  'https://www.themarshans.shop',
  'https://themarshans.com',
  'https://www.themarshans.com',
  'https://mediumturquoise-coyote-345247.hostingersite.com'
];

const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [];

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server / non-browser requests
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Dynamic localhost origin check in local development mode
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS policy violation: Origin '${origin}' is not permitted.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'x-session-id', 'X-Store-ID', 'x-store-id', 'X-Store-Code', 'x-store-code']
};

app.use(cors(corsOptions));

const path = require('path');
const fs = require('fs');

// Body Parsing Middlewares (Capturing rawBody for cryptographic webhook HMAC verification)
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Protect private custom artwork files from unauthenticated static access.
// The check MUST run on the DECODED, case-folded path: express.static percent-decodes the URL before it touches the
// disk, so testing the raw text let "custom%2Dartwork-..." / "%63ustom-artwork-..." through (private files served).
app.use('/uploads', (req, res, next) => {
  let decoded;
  try {
    decoded = decodeURIComponent(req.path);
  } catch (_) {
    return res.status(400).json({ success: false, error: { message: 'Malformed upload path', statusCode: 400 } });
  }
  if (decoded.toLowerCase().includes('custom-artwork')) {
    return res.status(403).json({
      success: false,
      error: 'Direct unauthenticated static access to private custom print artwork is prohibited.'
    });
  }
  next();
});

// Serve static uploaded public files (Hostinger / local storage). The ONLY directory exposed is uploadDir
// (config/uploads.js): express.static/send reject "..", encoded traversal and null bytes, and dotfiles are ignored.
// Filenames are unique (timestamp + random suffix), so a long immutable cache is safe for files that EXIST.
app.use('/uploads', express.static(require('./config/uploads').uploadDir, {
  maxAge: '30d',
  immutable: true,
  dotfiles: 'ignore',
  index: false,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); // never let a browser sniff an upload into something executable
    if (/\.svg$/i.test(filePath)) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
}));

// Terminal handler for /uploads: a file that is not on disk is an UPLOAD 404, answered here. Without this the request
// fell through to the API's generic "Route not found" (which reads like a routing bug and is not what happened), and
// with no Cache-Control a CDN may keep the 404 after the file is restored, so it is explicitly not cacheable.
app.use('/uploads', (req, res) => {
  const uploadDir = require('./config/uploads').uploadDir;
  const checkedPath = path.join(uploadDir, (req.path || '').replace(/^\//, ''));
  console.warn(`[Upload 404] Missing upload file: ${req.path} | Checked filesystem path: ${checkedPath}`);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const errorObj = {
    message: 'Upload file not found',
    code: 'UPLOAD_NOT_FOUND',
    statusCode: 404
  };
  if (req.headers['x-diagnostic-debug'] === 'chipakk-upload-debug') {
    errorObj.checkedPath = checkedPath;
  }
  return res.status(404).json({
    success: false,
    error: errorObj,
    timestamp: new Date().toISOString()
  });
});

const webDir = path.join(__dirname, '../web');
const customerDir = path.join(__dirname, '../customer-workspace');

// Explicit Logo Assets Routes (Prevents 404s, case sensitivity issues, or missing favicon)
app.get([
  '/assets/images/logo.png',
  '/assets/images/Logo.png',
  '/assets/images/LOGO.PNG',
  '/logo.png',
  '/Logo.png',
  '/LOGO.PNG',
  '/favicon.ico'
], (req, res) => {
  const customerLogo = path.join(customerDir, 'assets/images/logo.png');
  const webLogo = path.join(webDir, 'logo.png');
  if (fs.existsSync(customerLogo)) {
    return res.sendFile(customerLogo);
  }
  if (fs.existsSync(webLogo)) {
    return res.sendFile(webLogo);
  }
  return res.status(404).send('Logo not found');
});

// 1. CHIPAKK Admin Workspace Direct Routes
app.get(['/admin.html', '/admin'], (req, res) => {
  res.sendFile(path.join(webDir, 'admin.html'));
});

// Admin dedicated scripts
app.get(['/js/admin.js', '/js/api.js', '/js/firebase-config.js', '/js/migration.js'], (req, res) => {
  const scriptName = path.basename(req.path);
  res.sendFile(path.join(webDir, 'js', scriptName));
});

// Admin dedicated stylesheet
app.get('/css/admin.css', (req, res) => {
  res.sendFile(path.join(webDir, 'css/style.css'));
});

// 2. CHIPAKK Customer Storefront Direct Routes
const customerPages = [
  'shop', 'categories', 'custom-stickers', 'product', 'checkout', 'account', 'reset-password'
];
customerPages.forEach(page => {
  app.get([`/${page}.html`, `/${page}`], (req, res) => {
    res.sendFile(path.join(customerDir, `${page}.html`));
  });
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(customerDir, 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(customerDir, 'sitemap.xml'));
});

// 3. Base Root Route: Serves customer-workspace/index.html for browsers, or API info for JSON clients
app.get(['/', '/index.html'], (req, res) => {
  if (req.accepts('html') && !req.xhr) {
    return res.sendFile(path.join(customerDir, 'index.html'));
  }
  res.json({
    name: 'CHIPAKK Backend API',
    status: 'online',
    version: '1.0.0',
    documentation: '/api/health'
  });
});

// 4. Static Asset Serving: Customer assets first, then Admin assets
app.use(express.static(customerDir, { index: false }));
app.use(express.static(webDir, { index: false }));
app.use('/web', express.static(webDir));

const { getPublicStoreBuilderHandler } = require('./controllers/storeBuilderController');

// API Routes Mounting (with automatic multi-store resolution)
app.use('/api', resolveStoreContext);
app.use('/api/health', healthRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/store-builder', getPublicStoreBuilderHandler);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/custom-3d', custom3dRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 404 Route Not Found Handler
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;
