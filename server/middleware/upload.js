const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists locally
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Product image storage configuration
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate safe, unique timestamped filename without exposing original path
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${uniqueSuffix}${ext}`);
  }
});

// Custom artwork storage configuration
const customArtworkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate safe, unique timestamped filename without exposing original path
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `custom-artwork-${uniqueSuffix}${ext}`);
  }
});

// File filter: strict image mime type and extension validation
const imageFileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    return cb(null, true);
  }

  const error = new Error('Invalid file format. Only JPEG, PNG, WebP, and GIF images are permitted.');
  error.statusCode = 400;
  return cb(error, false);
};

// Multer upload middleware instances
const uploadProductImage = multer({
  storage: productStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max file size limit
  }
});

const uploadCustomArtwork = multer({
  storage: customArtworkStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max file size limit
  }
});

module.exports = {
  uploadProductImage,
  uploadCustomArtwork,
  uploadDir
};
