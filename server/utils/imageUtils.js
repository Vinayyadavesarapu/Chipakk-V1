const fs = require('fs');
const path = require('path');

const { uploadDir } = require('../config/uploads');

// Matches the whitelist enforced on the multer upload path (server/middleware/upload.js).
// SVG is intentionally excluded: an inline SVG can carry <script>/event-handler payloads and
// would be served back from /uploads as image/svg+xml, a stored-XSS vector if ever rendered
// outside a plain <img> tag.
const ALLOWED_BASE64_EXTENSIONS = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };
const MAX_BASE64_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB, matches uploadProductImage's fileSize limit

/**
 * Normalizes an image URL or decodes inline base64 data URLs to static disk files in /uploads/.
 * Also transforms Google Drive view links to direct view URLs.
 *
 * @param {string} rawUrl
 * @returns {string} Sanitized URL or file path
 */
function sanitizeProductImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // 1. Handle base64 data URIs: data:image/<type>;base64,<data>
  if (trimmed.startsWith('data:image/')) {
    const matches = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (matches) {
      const rawSubtype = matches[1].toLowerCase();
      const ext = ALLOWED_BASE64_EXTENSIONS[rawSubtype];
      const base64Data = matches[2];

      if (!ext) {
        console.error(`Rejected base64 image upload: unsupported image type "${rawSubtype}"`);
        return '';
      }

      // Reject oversized payloads before allocating the decode buffer (base64 is ~4/3 the
      // size of the decoded bytes, so this is a conservative pre-check).
      if (base64Data.length > Math.ceil(MAX_BASE64_IMAGE_BYTES * 4 / 3)) {
        console.error('Rejected base64 image upload: payload exceeds 5MB size limit');
        return '';
      }

      try {
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length === 0 || buffer.length > MAX_BASE64_IMAGE_BYTES) {
          console.error('Rejected base64 image upload: invalid or oversized decoded image');
          return '';
        }
        const filename = `product-b64-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        return `/uploads/${filename}`;
      } catch (err) {
        console.error('Failed to decode and save base64 image:', err.message);
        return '';
      }
    }
    return '';
  }

  // 2. Handle Google Drive URLs: convert /file/d/<id>/view or id=<id> to direct uc link
  if (trimmed.includes('drive.google.com')) {
    const fileIdMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      return `https://drive.google.com/uc?export=view&id=${fileIdMatch[1]}`;
    }
  }

  return trimmed;
}

/**
 * Safely deletes a local uploaded image from server/uploads.
 * Strictly prevents arbitrary filesystem deletion and path traversal.
 *
 * @param {string} imageUrl Relative or full image URL
 * @param {string} [storagePath] Optional explicit storage path
 * @returns {boolean} True if file was deleted, false otherwise
 */
function safelyDeleteUploadedFile(imageUrl, storagePath) {
  const target = storagePath || imageUrl;
  if (!target || typeof target !== 'string') return false;

  // External URLs (e.g. Google Drive, CDN) or inline base64 are not local files on disk
  if (target.startsWith('data:') || target.startsWith('http://') || target.startsWith('https://')) {
    return false;
  }

  // Must reference the uploads directory
  if (!target.includes('/uploads/') && !target.startsWith('/uploads') && !target.startsWith('uploads/')) {
    return false;
  }

  // Extract pure filename using path.basename to neutralize path traversal (e.g. '../../etc/passwd')
  const cleanTarget = target.split('?')[0].split('#')[0];
  const filename = path.basename(cleanTarget);
  if (!filename || filename === '.' || filename === '..') {
    return false;
  }

  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedFilePath = path.resolve(resolvedUploadDir, filename);

  // Guard: strictly ensure the resolved file path resides inside the uploads directory
  if (!resolvedFilePath.startsWith(resolvedUploadDir + path.sep)) {
    console.warn('[Security Guard] Attempted file deletion outside uploads directory:', resolvedFilePath);
    return false;
  }

  try {
    if (fs.existsSync(resolvedFilePath)) {
      fs.unlinkSync(resolvedFilePath);
      return true;
    }
  } catch (err) {
    console.warn('[SafelyDeleteUploadedFile Warning]', err.message);
  }
  return false;
}

module.exports = {
  sanitizeProductImageUrl,
  safelyDeleteUploadedFile
};
