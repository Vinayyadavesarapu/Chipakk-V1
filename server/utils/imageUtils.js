const fs = require('fs');
const path = require('path');

const uploadsConfig = require('../config/uploads');

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
        const filePath = path.join(uploadsConfig.uploadDir, filename);
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
 * @param {string} [customUploadDir] Optional custom uploads directory for tests
 * @returns {boolean} True if file was deleted, false otherwise
 */
function safelyDeleteUploadedFile(imageUrl, storagePath, customUploadDir) {
  const target = storagePath || imageUrl;
  if (!target || typeof target !== 'string') return false;

  // External URLs (e.g. Google Drive, CDN) or inline base64 are not local files on disk
  if (target.startsWith('data:') || target.startsWith('http://') || target.startsWith('https://')) {
    return false;
  }

  // Reject null bytes and invalid characters
  if (target.includes('\0')) {
    console.warn('[Security Guard] Attempted file deletion with null byte:', target);
    return false;
  }

  // Decode URI components to prevent percent-encoded path traversal (%2e%2e)
  let decodedTarget = target;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch (_) {
    return false;
  }

  // Must reference the uploads directory
  if (!decodedTarget.includes('/uploads/') && !decodedTarget.startsWith('/uploads') && !decodedTarget.startsWith('uploads/')) {
    return false;
  }

  // Strip query strings and hash anchors
  const cleanTarget = decodedTarget.split('?')[0].split('#')[0];
  const filename = path.basename(cleanTarget);
  if (!filename || filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
    return false;
  }

  const baseUploadDir = customUploadDir || uploadsConfig.uploadDir;
  const resolvedUploadDir = path.resolve(baseUploadDir);
  const resolvedFilePath = path.resolve(resolvedUploadDir, filename);

  // Strict containment guard: resolved path must reside strictly inside the uploads directory
  const rel = path.relative(resolvedUploadDir, resolvedFilePath);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '' || !resolvedFilePath.startsWith(resolvedUploadDir + path.sep)) {
    console.warn('[Security Guard] Attempted file deletion outside uploads directory:', resolvedFilePath);
    return false;
  }

  try {
    if (fs.existsSync(resolvedFilePath)) {
      // Reject symlinks to prevent arbitrary filesystem unlinking
      const lstat = fs.lstatSync(resolvedFilePath);
      if (lstat.isSymbolicLink() || !lstat.isFile()) {
        console.warn('[Security Guard] Attempted deletion of non-regular file or symlink:', resolvedFilePath);
        return false;
      }
      fs.unlinkSync(resolvedFilePath);
      return true;
    }
  } catch (err) {
    console.warn('[SafelyDeleteUploadedFile Warning]', err.message);
  }
  return false;
}

/**
 * Checks whether an uploaded image file is referenced in ANY database table.
 * Strictly prevents unlinking a physical file if another product, category, banner,
 * or store builder configuration still points to it.
 *
 * @param {string} imageUrl Relative or full image URL
 * @param {object} pool MySQL connection pool
 * @param {object} [excludeContext] Optional context to exclude from the reference check
 *   e.g. { product_image_id: 123, product_id: 456, category_id: 789 }
 * @returns {Promise<{isReferenced: boolean, references: Array}>}
 */
async function isMediaReferencedElsewhere(imageUrl, pool, excludeContext = {}) {
  if (!imageUrl || typeof imageUrl !== 'string' || !pool) {
    return { isReferenced: false, references: [] };
  }

  // Extract pure filename
  const cleanTarget = decodeURIComponent(imageUrl).split('?')[0].split('#')[0];
  const filename = path.basename(cleanTarget);
  if (!filename || filename === '.' || filename === '..') {
    return { isReferenced: false, references: [] };
  }

  const filePattern = `%${filename}%`;
  const references = [];

  const safeCheck = async (query, params, entityType) => {
    try {
      const [rows] = await pool.execute(query, params);
      if (rows && rows.length > 0) {
        rows.forEach(r => references.push({ entity: entityType, id: r.id, match: r }));
      }
    } catch (_) {
      // Table or column might not exist in some environments; ignore gracefully
    }
  };

  // 1. Check product_images (Store 1)
  let piQuery = 'SELECT id, product_id FROM product_images WHERE image_url LIKE ?';
  const piParams = [filePattern];
  if (excludeContext.product_image_id) {
    piQuery += ' AND id != ?';
    piParams.push(excludeContext.product_image_id);
  }
  await safeCheck(piQuery, piParams, 'product_images');

  // 2. Check products (Store 1)
  let prodQuery = 'SELECT id FROM products WHERE (image_url LIKE ? OR lumo_light_image LIKE ? OR lumo_dark_image LIKE ?)';
  const prodParams = [filePattern, filePattern, filePattern];
  if (excludeContext.product_id) {
    prodQuery += ' AND id != ?';
    prodParams.push(excludeContext.product_id);
  }
  await safeCheck(prodQuery, prodParams, 'products');

  // 3. Check categories (Store 1)
  let catQuery = 'SELECT id FROM categories WHERE image_url LIKE ?';
  const catParams = [filePattern];
  if (excludeContext.category_id) {
    catQuery += ' AND id != ?';
    catParams.push(excludeContext.category_id);
  }
  await safeCheck(catQuery, catParams, 'categories');

  // 4. Check category_media (Store 1)
  let catMediaQuery = 'SELECT id, category_id FROM category_media WHERE image_url LIKE ?';
  const catMediaParams = [filePattern];
  if (excludeContext.category_media_id) {
    catMediaQuery += ' AND id != ?';
    catMediaParams.push(excludeContext.category_media_id);
  }
  await safeCheck(catMediaQuery, catMediaParams, 'category_media');

  // 5. Check marshans_product_images (Store 2)
  let mpiQuery = 'SELECT id, product_id FROM marshans_product_images WHERE image_url LIKE ?';
  const mpiParams = [filePattern];
  if (excludeContext.marshans_product_image_id) {
    mpiQuery += ' AND id != ?';
    mpiParams.push(excludeContext.marshans_product_image_id);
  }
  await safeCheck(mpiQuery, mpiParams, 'marshans_product_images');

  // 6. Check marshans_products (Store 2)
  let mprodQuery = 'SELECT id FROM marshans_products WHERE (image_url LIKE ? OR primary_image_url LIKE ?)';
  const mprodParams = [filePattern, filePattern];
  if (excludeContext.marshans_product_id) {
    mprodQuery += ' AND id != ?';
    mprodParams.push(excludeContext.marshans_product_id);
  }
  await safeCheck(mprodQuery, mprodParams, 'marshans_products');

  // 7. Check marshans_categories (Store 2)
  let mcatQuery = 'SELECT id FROM marshans_categories WHERE image_url LIKE ?';
  const mcatParams = [filePattern];
  if (excludeContext.marshans_category_id) {
    mcatQuery += ' AND id != ?';
    mcatParams.push(excludeContext.marshans_category_id);
  }
  await safeCheck(mcatQuery, mcatParams, 'marshans_categories');

  // 8. Check marshans_category_media (Store 2)
  let mcatMediaQuery = 'SELECT id, category_id FROM marshans_category_media WHERE image_url LIKE ?';
  const mcatMediaParams = [filePattern];
  if (excludeContext.marshans_category_media_id) {
    mcatMediaQuery += ' AND id != ?';
    mcatMediaParams.push(excludeContext.marshans_category_media_id);
  }
  await safeCheck(mcatMediaQuery, mcatMediaParams, 'marshans_category_media');

  // 9. Check events
  let evQuery = 'SELECT id FROM events WHERE banner_image LIKE ?';
  const evParams = [filePattern];
  if (excludeContext.event_id) {
    evQuery += ' AND id != ?';
    evParams.push(excludeContext.event_id);
  }
  await safeCheck(evQuery, evParams, 'events');

  // 10. Check site_settings
  await safeCheck('SELECT id, setting_key FROM site_settings WHERE setting_value LIKE ?', [filePattern], 'site_settings');

  return {
    isReferenced: references.length > 0,
    references
  };
}

/**
 * Safely deletes a local file from disk ONLY if it is not referenced elsewhere in the database.
 * If referenced, logs an informative notice and skips unlinking to guarantee media durability.
 */
async function safelyDeleteUploadedFileIfUnreferenced(imageUrl, storagePath, pool, excludeContext = {}, customUploadDir = null) {
  if (pool) {
    const { isReferenced, references } = await isMediaReferencedElsewhere(imageUrl, pool, excludeContext);
    if (isReferenced) {
      console.log(`[Media Protection] Preserved physical file for ${imageUrl}. It is still referenced by ${references.length} database entities:`, references.map(r => `${r.entity}:${r.id}`));
      return false;
    }
  }
  return safelyDeleteUploadedFile(imageUrl, storagePath, customUploadDir);
}

module.exports = {
  sanitizeProductImageUrl,
  safelyDeleteUploadedFile,
  isMediaReferencedElsewhere,
  safelyDeleteUploadedFileIfUnreferenced
};
