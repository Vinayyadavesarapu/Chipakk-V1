#!/usr/bin/env node
/**
 * Media Integrity Verification and Recovery Manifest Tool
 * scripts/media-integrity-verify.js
 *
 * Implements Step 2 Production Hardening Requirements:
 *   1. Full DB-referenced files collection across all Store 1 (CHIPAKK) & Store 2 (MARSHANS) tables.
 *   2. Disk scan of persistent uploads directory (defaults to process.env.UPLOADS_DIR or canonical /home/u781826529/chipakk-uploads).
 *   3. Media integrity audits:
 *      - DB-referenced files
 *      - Missing files (referenced in DB, absent from disk)
 *      - Orphan files (present on disk, unreferenced in DB)
 *      - Zero-byte files (0-byte corrupted files)
 *      - Duplicate hashes (SHA-256 collisions / identical content)
 *      - Invalid extensions / MIME types
 *      - File sizes
 *      - SHA-256 checksums
 *   4. Recovery manifest generation (JSON and CSV) containing:
 *      - database_reference
 *      - original_filename
 *      - stored_filename
 *      - path
 *      - size
 *      - sha256
 *      - entity_type
 *      - entity_id
 *      - store_id
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg']);
const CANONICAL_PRODUCTION_DIR = '/home/u781826529/chipakk-uploads';

const MIME_MAP = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function getMimeType(filePathOrExt) {
  if (!filePathOrExt || typeof filePathOrExt !== 'string') return 'application/octet-stream';
  const ext = path.extname(filePathOrExt).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * Calculates SHA-256 checksum of a file on disk
 */
function calculateSha256(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch (_) {
    return null;
  }
}

/**
 * Normalizes an upload reference path to standard "/uploads/<filename>"
 */
function normalizeUploadPath(val) {
  if (!val || typeof val !== 'string') return null;
  let p = val.trim();
  try {
    if (/^https?:\/\//i.test(p)) {
      p = new URL(p).pathname;
    }
  } catch (_) {
    return null;
  }
  p = p.split('?')[0].split('#')[0];
  if (!p.startsWith('/uploads/') && p.startsWith('uploads/')) {
    p = '/' + p;
  }
  return /^\/uploads\/[^/]+$/.test(p) ? p : null;
}

/**
 * Extracts pure filename from an upload path
 */
function extractFilename(val) {
  const norm = normalizeUploadPath(val);
  return norm ? path.basename(norm) : null;
}

/**
 * Collects DB-referenced media paths directly via MySQL pool
 */
async function collectDbReferencesFromPool(pool) {
  const refs = [];

  const addRef = (dbRef, entityType, entityId, storeId) => {
    const norm = normalizeUploadPath(dbRef);
    if (!norm) return;
    const filename = path.basename(norm);
    refs.push({
      database_reference: norm,
      original_filename: filename,
      stored_filename: filename,
      entity_type: entityType,
      entity_id: entityId,
      store_id: storeId
    });
  };

  const safeQuery = async (query, params = []) => {
    try {
      const [rows] = await pool.execute(query, params);
      return rows || [];
    } catch (_) {
      return [];
    }
  };

  // 1. Store 1 (CHIPAKK) Products & Product Images
  const prodImgRows = await safeQuery('SELECT id, product_id, image_url FROM product_images WHERE image_url LIKE "%/uploads/%"');
  prodImgRows.forEach(r => addRef(r.image_url, 'product_image', r.product_id, 1));

  const prodRows = await safeQuery('SELECT id, lumo_light_image, lumo_dark_image FROM products');
  prodRows.forEach(r => {
    if (r.lumo_light_image) addRef(r.lumo_light_image, 'product_lumo_light', r.id, 1);
    if (r.lumo_dark_image) addRef(r.lumo_dark_image, 'product_lumo_dark', r.id, 1);
  });

  // 2. Store 1 (CHIPAKK) Categories & Category Media
  const catRows = await safeQuery('SELECT id, image_url FROM categories WHERE image_url LIKE "%/uploads/%"');
  catRows.forEach(r => addRef(r.image_url, 'category', r.id, 1));

  const catMediaRows = await safeQuery('SELECT id, category_id, image_url, media_type FROM category_media WHERE image_url LIKE "%/uploads/%"');
  catMediaRows.forEach(r => addRef(r.image_url, `category_media_${r.media_type || 'asset'}`, r.category_id, 1));

  // 3. Store 2 (THE MARSHANS) Products & Product Images
  const mProdImgRows = await safeQuery('SELECT id, product_id, image_url FROM marshans_product_images WHERE image_url LIKE "%/uploads/%"');
  mProdImgRows.forEach(r => addRef(r.image_url, 'marshans_product_image', r.product_id, 2));

  const mProdRows = await safeQuery('SELECT id, lumo_light_image, lumo_dark_image FROM marshans_products');
  mProdRows.forEach(r => {
    if (r.lumo_light_image) addRef(r.lumo_light_image, 'marshans_product_lumo_light', r.id, 2);
    if (r.lumo_dark_image) addRef(r.lumo_dark_image, 'marshans_product_lumo_dark', r.id, 2);
  });

  // 4. Store 2 (THE MARSHANS) Categories & Category Media
  const mCatRows = await safeQuery('SELECT id, image_url FROM marshans_categories WHERE image_url LIKE "%/uploads/%"');
  mCatRows.forEach(r => addRef(r.image_url, 'marshans_category', r.id, 2));

  const mCatMediaRows = await safeQuery('SELECT id, category_id, image_url, media_type FROM marshans_category_media WHERE image_url LIKE "%/uploads/%"');
  mCatMediaRows.forEach(r => addRef(r.image_url, `marshans_category_media_${r.media_type || 'asset'}`, r.category_id, 2));

  // 5. Banners & Campaigns
  const bannerRows = await safeQuery('SELECT id, image_url FROM banners WHERE image_url LIKE "%/uploads/%"');
  bannerRows.forEach(r => addRef(r.image_url, 'banner', r.id, 1));

  const campRows = await safeQuery('SELECT id, banner_url FROM campaigns WHERE banner_url LIKE "%/uploads/%"');
  campRows.forEach(r => addRef(r.banner_url, 'campaign', r.id, 1));

  // 6. Private Custom Artwork
  const designRows = await safeQuery('SELECT id, order_item_id, image_url FROM order_item_custom_designs WHERE image_url LIKE "%/uploads/%"');
  designRows.forEach(r => addRef(r.image_url, 'custom_design_private', r.order_item_id || r.id, 1));

  return refs;
}

/**
 * Scans disk directory for physical upload files
 */
function scanDiskDirectory(targetDir) {
  const diskFiles = new Map();
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    return diskFiles;
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // ignore hidden/dotfiles

    const fullPath = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) continue; // skip symlinks
    if (!entry.isFile()) continue;

    try {
      const stat = fs.statSync(fullPath);
      const ext = path.extname(entry.name).toLowerCase();
      const isZeroByte = stat.size === 0;
      const isValidExtension = ALLOWED_EXTENSIONS.has(ext);
      const sha256 = isZeroByte ? null : calculateSha256(fullPath);

      diskFiles.set(entry.name, {
        filename: entry.name,
        path: fullPath,
        size: stat.size,
        extension: ext,
        mime_type: getMimeType(entry.name),
        isZeroByte,
        isValidExtension,
        sha256,
        mtime: stat.mtime
      });
    } catch (_) {
      // unreadable file
    }
  }

  return diskFiles;
}

/**
 * Performs complete media integrity verification and compiles recovery manifest
 */
async function auditMediaIntegrity({
  uploadDirectory = null,
  pool = null,
  providedReferences = null
} = {}) {
  const resolvedDir = uploadDirectory
    ? path.resolve(uploadDirectory)
    : (process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : CANONICAL_PRODUCTION_DIR);

  // 1. Collect DB References
  let dbReferences = [];
  if (Array.isArray(providedReferences) && providedReferences.length > 0) {
    dbReferences = providedReferences;
  } else if (pool) {
    dbReferences = await collectDbReferencesFromPool(pool);
  } else {
    // If no pool or provided references, attempt to load local pool
    try {
      const dbConfig = require('../server/config/database');
      if (dbConfig && dbConfig.pool) {
        dbReferences = await collectDbReferencesFromPool(dbConfig.pool);
      }
    } catch (_) {
      dbReferences = [];
    }
  }

  // 2. Scan Disk Directory
  const diskFilesMap = scanDiskDirectory(resolvedDir);

  // 3. Media Integrity Verification:
  // Maps for analysis
  const dbReferencedFilenames = new Set();
  const dbReferenceMap = new Map();

  dbReferences.forEach(ref => {
    const filename = extractFilename(ref.database_reference);
    if (filename) {
      dbReferencedFilenames.add(filename);
      if (!dbReferenceMap.has(filename)) {
        dbReferenceMap.set(filename, []);
      }
      dbReferenceMap.get(filename).push(ref);
    }
  });

  const missingFiles = [];
  const validReferencedFiles = [];

  for (const filename of dbReferencedFilenames) {
    const diskInfo = diskFilesMap.get(filename);
    const uses = dbReferenceMap.get(filename) || [];

    if (!diskInfo) {
      missingFiles.push({
        filename,
        database_reference: `/uploads/${filename}`,
        uses
      });
    } else {
      validReferencedFiles.push({
        filename,
        database_reference: `/uploads/${filename}`,
        diskInfo,
        uses
      });
    }
  }

  // Orphan Files (on disk, not in DB)
  const orphanFiles = [];
  // Zero-byte Files
  const zeroByteFiles = [];
  // Invalid Extensions
  const invalidExtensionFiles = [];
  // Hash Map to detect duplicate content
  const hashGroups = new Map();

  for (const [filename, fileInfo] of diskFilesMap.entries()) {
    if (!dbReferencedFilenames.has(filename)) {
      orphanFiles.push(fileInfo);
    }

    if (fileInfo.isZeroByte) {
      zeroByteFiles.push(fileInfo);
    }

    if (!fileInfo.isValidExtension) {
      invalidExtensionFiles.push(fileInfo);
    }

    if (fileInfo.sha256) {
      if (!hashGroups.has(fileInfo.sha256)) {
        hashGroups.set(fileInfo.sha256, []);
      }
      hashGroups.get(fileInfo.sha256).push(fileInfo);
    }
  }

  // Duplicate Hash Collisions
  const duplicateHashes = [];
  for (const [hash, group] of hashGroups.entries()) {
    if (group.length > 1) {
      duplicateHashes.push({
        sha256: hash,
        count: group.length,
        size: group[0].size,
        files: group.map(g => g.filename)
      });
    }
  }

  // 4. Generate Comprehensive Recovery Manifest
  const recoveryManifest = [];

  // For every DB reference, create an authoritative entry
  dbReferences.forEach(ref => {
    const filename = extractFilename(ref.database_reference);
    const diskInfo = filename ? diskFilesMap.get(filename) : null;
    const canonicalPath = path.join(resolvedDir, filename || '');

    recoveryManifest.push({
      database_reference: ref.database_reference,
      original_filename: filename,
      stored_filename: filename,
      path: canonicalPath,
      size: diskInfo ? diskInfo.size : 0,
      mime_type: getMimeType(filename || ref.database_reference),
      sha256: diskInfo ? diskInfo.sha256 : null,
      status: diskInfo ? (diskInfo.isZeroByte ? 'CORRUPT_ZERO_BYTE' : 'PRESENT') : 'MISSING',
      entity_type: ref.entity_type,
      entity_id: ref.entity_id,
      store_id: ref.store_id
    });
  });

  return {
    directory: {
      path: resolvedDir,
      exists: fs.existsSync(resolvedDir),
      isCanonical: resolvedDir === CANONICAL_PRODUCTION_DIR,
      total_files_on_disk: diskFilesMap.size
    },
    integrity: {
      total_db_references: dbReferences.length,
      distinct_db_files: dbReferencedFilenames.size,
      present_and_verified: validReferencedFiles.length,
      missing_files_count: missingFiles.length,
      orphan_files_count: orphanFiles.length,
      zero_byte_files_count: zeroByteFiles.length,
      duplicate_hash_groups_count: duplicateHashes.length,
      invalid_extension_files_count: invalidExtensionFiles.length
    },
    details: {
      missing_files: missingFiles,
      orphan_files: orphanFiles.map(o => ({ filename: o.filename, size: o.size, mime_type: o.mime_type, sha256: o.sha256 })),
      zero_byte_files: zeroByteFiles.map(z => z.filename),
      invalid_extension_files: invalidExtensionFiles.map(i => ({ filename: i.filename, extension: i.extension })),
      duplicate_hashes: duplicateHashes
    },
    recovery_manifest: recoveryManifest
  };
}

/**
 * Exports recovery manifest to CSV format
 */
function manifestToCsv(manifest) {
  const headers = [
    'database_reference',
    'original_filename',
    'stored_filename',
    'path',
    'size',
    'mime_type',
    'sha256',
    'status',
    'entity_type',
    'entity_id',
    'store_id'
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [headers.join(',')];
  manifest.forEach(item => {
    rows.push([
      escapeCsv(item.database_reference),
      escapeCsv(item.original_filename),
      escapeCsv(item.stored_filename),
      escapeCsv(item.path),
      escapeCsv(item.size),
      escapeCsv(item.mime_type),
      escapeCsv(item.sha256),
      escapeCsv(item.status),
      escapeCsv(item.entity_type),
      escapeCsv(item.entity_id),
      escapeCsv(item.store_id)
    ].join(','));
  });

  return rows.join('\n');
}

// CLI Execution Handler
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const getArg = (name, def = null) => {
      const idx = args.indexOf('--' + name);
      return idx > -1 && args[idx + 1] ? args[idx + 1] : def;
    };

    if (args.includes('--help')) {
      console.log(`
Media Integrity Verification & Recovery Manifest Tool
Usage:
  node scripts/media-integrity-verify.js [options]

Options:
  --dir <path>          Target uploads directory (default: process.env.UPLOADS_DIR or ${CANONICAL_PRODUCTION_DIR})
  --out-json <path>     Write full audit & recovery manifest to JSON file
  --out-csv <path>      Write recovery manifest to CSV file
  --out-missing <path>  Write list of missing filenames to text file
  --json                Output clean JSON report to stdout
  --help                Show this message
      `);
      process.exit(0);
    }

    const dirArg = getArg('dir', process.env.UPLOADS_DIR || CANONICAL_PRODUCTION_DIR);
    const refFile = getArg('references');
    const outJson = getArg('out-json');
    const outCsv = getArg('out-csv');
    const outMissing = getArg('out-missing');
    const isJsonOnly = args.includes('--json');

    let providedReferences = null;
    if (refFile) {
      if (!fs.existsSync(refFile)) {
        console.error(`References file not found: ${refFile}`);
        process.exit(2);
      }
      try {
        const rawRefs = JSON.parse(fs.readFileSync(path.resolve(refFile), 'utf8'));
        providedReferences = Array.isArray(rawRefs) ? rawRefs : (rawRefs.references || rawRefs.recovery_manifest || []);
      } catch (e) {
        console.error(`Invalid references JSON: ${e.message}`);
        process.exit(2);
      }
    }

    const result = await auditMediaIntegrity({ uploadDirectory: dirArg, providedReferences });

    if (outJson) {
      fs.writeFileSync(path.resolve(outJson), JSON.stringify(result, null, 2));
      if (!isJsonOnly) console.log(`✓ Full JSON report saved to: ${outJson}`);
    }

    if (outCsv) {
      fs.writeFileSync(path.resolve(outCsv), manifestToCsv(result.recovery_manifest));
      if (!isJsonOnly) console.log(`✓ Recovery manifest CSV saved to: ${outCsv}`);
    }

    if (outMissing) {
      const missingNames = result.details.missing_files.map(m => m.filename).join('\n');
      fs.writeFileSync(path.resolve(outMissing), missingNames + (missingNames ? '\n' : ''));
      if (!isJsonOnly) console.log(`✓ Missing filenames saved to: ${outMissing}`);
    }

    if (isJsonOnly) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n===============================================================');
      console.log('🛡️ MEDIA INTEGRITY & RECOVERY MANIFEST REPORT');
      console.log('===============================================================');
      console.log(`Directory Audited:     ${result.directory.path}`);
      console.log(`Directory Exists:      ${result.directory.exists ? 'YES' : 'NO'}`);
      console.log(`Total Files on Disk:   ${result.directory.total_files_on_disk}`);
      console.log('---------------------------------------------------------------');
      console.log(`DB-Referenced Files:   ${result.integrity.distinct_db_files} (${result.integrity.total_db_references} total row references)`);
      console.log(`Present & Verified:    ${result.integrity.present_and_verified}`);
      console.log(`Missing Files:         ${result.integrity.missing_files_count}`);
      console.log(`Orphan Files on Disk:  ${result.integrity.orphan_files_count}`);
      console.log(`Zero-Byte Files:       ${result.integrity.zero_byte_files_count}`);
      console.log(`Duplicate Hash Groups: ${result.integrity.duplicate_hash_groups_count}`);
      console.log(`Invalid Extensions:    ${result.integrity.invalid_extension_files_count}`);
      console.log('===============================================================\n');

      if (result.details.missing_files.length > 0) {
        console.log(`Sample Missing Files (${Math.min(5, result.details.missing_files.length)} of ${result.details.missing_files.length}):`);
        result.details.missing_files.slice(0, 5).forEach(m => console.log(`  - ${m.filename}`));
      }

      if (result.details.duplicate_hashes.length > 0) {
        console.log(`\nDuplicate Content Groups:`);
        result.details.duplicate_hashes.forEach(d => {
          console.log(`  - SHA-256: ${d.sha256.substring(0, 16)}... (${d.count} identical files, ${d.size} bytes each)`);
          console.log(`    Files: ${d.files.join(', ')}`);
        });
      }
    }

    process.exit(result.integrity.missing_files_count > 0 ? 1 : 0);
  })().catch(err => {
    console.error('Fatal audit error:', err.message);
    process.exit(2);
  });
}

module.exports = {
  auditMediaIntegrity,
  calculateSha256,
  scanDiskDirectory,
  collectDbReferencesFromPool,
  manifestToCsv,
  CANONICAL_PRODUCTION_DIR,
  ALLOWED_EXTENSIONS
};
