/**
 * Single definition of where uploaded files live on disk.
 *
 * Default: server/uploads (local development).
 * Production: set UPLOADS_DIR to a directory that is NOT inside the deployed application tree
 * (for example /home/<account>/chipakk-uploads). Uploaded files are deliberately git-ignored, so
 * any deployment that replaces the application directory (fresh clone / re-upload) DELETES
 * server/uploads while the database keeps pointing at "/uploads/<file>" -- every product image then
 * answers 404. An external directory survives redeploys.
 */
const fs = require('fs');
const path = require('path');

const configured = process.env.UPLOADS_DIR && process.env.UPLOADS_DIR.trim();
const uploadDir = configured ? path.resolve(configured) : path.join(__dirname, '..', 'uploads');

try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  console.error('[Uploads] Could not create the uploads directory:', err.message);
}

/** Non-sensitive diagnostics for /api/health (never exposes the path). */
const describeUploads = () => {
  let writable = false;
  let fileCount = null;
  try {
    fs.accessSync(uploadDir, fs.constants.W_OK);
    writable = true;
  } catch (_) { /* not writable */ }
  try {
    fileCount = fs.readdirSync(uploadDir).filter((f) => !f.startsWith('.')).length;
  } catch (_) { /* unreadable */ }
  return { externalDirectory: Boolean(configured), writable, fileCount };
};

module.exports = { uploadDir, describeUploads };
