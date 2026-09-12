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
const adminRoutes = require('./routes/admin');

// Import Middlewares
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'x-session-id']
};

app.use(cors(corsOptions));

const path = require('path');

// Body Parsing Middlewares (Capturing rawBody for cryptographic webhook HMAC verification)
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Protect private custom artwork files from unauthenticated static access
app.use('/uploads', (req, res, next) => {
  if (req.path.includes('custom-artwork') || req.path.startsWith('/custom-artwork-')) {
    return res.status(403).json({
      success: false,
      error: 'Direct unauthenticated static access to private custom print artwork is prohibited.'
    });
  }
  next();
});

// Serve static uploaded public files (Hostinger / local storage)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const webDir = path.join(__dirname, '../web');
const customerDir = path.join(__dirname, '../customer-workspace');

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

// API Routes Mounting
app.use('/api/health', healthRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/store-builder', getPublicStoreBuilderHandler);
app.use('/api/orders', orderRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 404 Route Not Found Handler
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;
