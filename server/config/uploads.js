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

// Uploads inside the deployed app folder are lost whenever a deployment replaces that folder, while the database
// keeps pointing at "/uploads/<file>". Say so loudly at startup instead of failing silently.
const appRoot = path.resolve(__dirname, '..', '..');
/** realpath that also works for a path that does not exist yet: resolve the nearest existing ancestor, append the rest.
 *  (Comparing a resolved path with an unresolved one broke "is X inside Y" on symlinked roots such as macOS /var -> /private/var.) */
const realOrSelf = (p) => {
  const abs = path.resolve(p); const rest = [];
  let cur = abs;
  while (!fs.existsSync(cur) && path.dirname(cur) !== cur) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
  try { return path.join(fs.realpathSync(cur), ...rest); } catch (_) { return abs; }
};
const isInside = (child, parent) => { const rel = path.relative(realOrSelf(parent), realOrSelf(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const insideAppDirectory = isInside(uploadDir, appRoot);

/** Why the current setting would NOT survive a deployment (empty array = looks persistent). Never contains a path. */
const storageProblems = () => {
  const problems = [];
  if (!configured) problems.push('UPLOADS_DIR is not set: uploaded images are stored inside the deployed application folder and are LOST when a deployment replaces it. Set UPLOADS_DIR to a persistent absolute path outside the app folder.');
  else if (!path.isAbsolute(configured)) problems.push('UPLOADS_DIR is a relative path: it depends on the process working directory and is probably inside the app folder. Use an absolute path outside the app folder.');
  else if (insideAppDirectory) problems.push('UPLOADS_DIR points INSIDE the deployed application folder, so a deployment that replaces that folder still deletes the images. Use an absolute path outside the app folder.');
  return problems;
};
if (process.env.NODE_ENV === 'production') {
  storageProblems().forEach((msg) => console.warn(`[Uploads] WARNING: ${msg}`));
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
  const out = {
    configured: Boolean(configured),
    isAbsolute: Boolean(configured ? path.isAbsolute(configured) : path.isAbsolute(uploadDir)),
    outsideAppDirectory: !insideAppDirectory,
    insideAppDirectory: Boolean(insideAppDirectory),
    exists: fs.existsSync(uploadDir),
    writable,
    fileCount: typeof fileCount === 'number' ? fileCount : 0,
    serving: true,
    externalDirectory: Boolean(configured)
  };
  const problems = storageProblems();
  if (process.env.NODE_ENV === 'production' && problems.length) out.warning = problems.join(' ');
  return out;
};

module.exports = { uploadDir, describeUploads };
