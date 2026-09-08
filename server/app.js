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
  'https://chipakk.shop'
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
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

const path = require('path');

// Body Parsing Middlewares
app.use(express.json({ limit: '10mb' }));
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

// Base Root Route
app.get('/', (req, res) => {
  res.json({
    name: 'CHIPAKK Backend API',
    status: 'online',
    version: '1.0.0',
    documentation: '/api/health'
  });
});

const { getPublicStoreBuilderHandler } = require('./controllers/storeBuilderController');

// API Routes Mounting
app.use('/api/health', healthRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/store-builder', getPublicStoreBuilderHandler);
app.use('/api/admin', adminRoutes);

// 404 Route Not Found Handler
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;
