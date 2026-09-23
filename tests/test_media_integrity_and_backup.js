/**
 * tests/test_media_integrity_and_backup.js
 *
 * Dedicated Test Suite for STEP 2 - PERMANENT MEDIA + BACKUP FOUNDATION
 *
 * Tests:
 * 1. Absolute UPLOADS_DIR & canonical production path enforcement.
 * 2. In-app upload directory rejection / warning guards.
 * 3. safelyDeleteUploadedFile security:
 *    - Valid file deletion inside uploadDir
 *    - Null byte rejection
 *    - Path traversal rejection (regular & URL-encoded %2e%2e)
 *    - Symlink deletion rejection
 *    - External URL / data: URL rejection
 * 4. media-integrity-verify.js auditing:
 *    - Present & verified DB references
 *    - Missing DB files
 *    - Orphan files on disk
 *    - Zero-byte files
 *    - Duplicate SHA-256 content hashes
 *    - Invalid file extensions
 *    - Recovery manifest schema validation (9 fields)
 *    - CSV export generation
 * 5. CLI execution of media-integrity-verify.js:
 *    - Flags: --references, --dir, --out-json, --out-csv, --out-missing, --json
 * 6. Safe restore tooling with SHA-256 verification:
 *    - --manifest-json and --verify-sha256 detection
 *    - Non-destructive destination behavior
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const os = require('os');
const { spawnSync } = require('child_process');

const uploadsConfig = require('../server/config/uploads');
const { safelyDeleteUploadedFile } = require('../server/utils/imageUtils');
const {
  auditMediaIntegrity,
  calculateSha256,
  scanDiskDirectory,
  manifestToCsv,
  CANONICAL_PRODUCTION_DIR
} = require('../scripts/media-integrity-verify');

// Setup temporary test sandbox strictly outside app root (in os.tmpdir)
const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chipakk_media_test_'));

function cleanup() {
  try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  } catch (_) {}
}

process.on('exit', cleanup);

console.log('Running STEP 2: Media Integrity & Backup Foundation Test Suite...\n');

let passedTests = 0;
let totalTests = 0;

function runTest(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

async function runAsyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

(async () => {
  // Test 1: Canonical production path & uploads config
  runTest('CONFIG :: canonical production uploads path is /home/u781826529/chipakk-uploads', () => {
    assert.strictEqual(uploadsConfig.CANONICAL_PRODUCTION_UPLOADS, '/home/u781826529/chipakk-uploads');
    assert.strictEqual(CANONICAL_PRODUCTION_DIR, '/home/u781826529/chipakk-uploads');
  });

  runTest('CONFIG :: isInside correctly detects nested vs external directory relationships', () => {
    const parent = path.resolve('/app/root');
    const childInside = path.resolve('/app/root/server/uploads');
    const outside = path.resolve('/home/u781826529/chipakk-uploads');
    assert.strictEqual(uploadsConfig.isInside(childInside, parent), true);
    assert.strictEqual(uploadsConfig.isInside(outside, parent), false);
    assert.strictEqual(uploadsConfig.isInside(parent, parent), true);
  });

  // Test 2: safelyDeleteUploadedFile security guards
  const uploadsMockDir = path.join(testTmpDir, 'mock_uploads');
  fs.mkdirSync(uploadsMockDir, { recursive: true });

  // Temporarily point uploadDir to test sandbox for testing
  const originalUploadDir = uploadsConfig.uploadDir;
  uploadsConfig.uploadDir = uploadsMockDir;

  runTest('SECURITY :: safelyDeleteUploadedFile deletes legitimate file within uploadDir', () => {
    const testFile = path.join(uploadsMockDir, 'valid-image-1.webp');
    fs.writeFileSync(testFile, 'dummy-image-content');
    assert.strictEqual(fs.existsSync(testFile), true);

    const deleted = safelyDeleteUploadedFile('/uploads/valid-image-1.webp');
    assert.strictEqual(deleted, true);
    assert.strictEqual(fs.existsSync(testFile), false);
  });

  runTest('SECURITY :: safelyDeleteUploadedFile rejects null byte in path', () => {
    const testFile = path.join(uploadsMockDir, 'target.png');
    fs.writeFileSync(testFile, 'target');
    const res = safelyDeleteUploadedFile('/uploads/target.png\0.txt');
    assert.strictEqual(res, false);
    assert.strictEqual(fs.existsSync(testFile), true);
  });

  runTest('SECURITY :: safelyDeleteUploadedFile blocks traversal (regular & encoded %2e%2e)', () => {
    const sensitiveFile = path.join(testTmpDir, 'sensitive.txt');
    fs.writeFileSync(sensitiveFile, 'TOP_SECRET');

    // Attempt plain traversal
    const res1 = safelyDeleteUploadedFile('/uploads/../sensitive.txt');
    assert.strictEqual(res1, false);
    assert.strictEqual(fs.existsSync(sensitiveFile), true);

    // Attempt URL-encoded traversal
    const res2 = safelyDeleteUploadedFile('/uploads/%2e%2e/sensitive.txt');
    assert.strictEqual(res2, false);
    assert.strictEqual(fs.existsSync(sensitiveFile), true);

    // Attempt double encoded
    const res3 = safelyDeleteUploadedFile('/uploads/%252e%252e/sensitive.txt');
    assert.strictEqual(res3, false);
    assert.strictEqual(fs.existsSync(sensitiveFile), true);
  });

  runTest('SECURITY :: safelyDeleteUploadedFile rejects external URLs and data: URIs', () => {
    assert.strictEqual(safelyDeleteUploadedFile('https://example.com/uploads/foo.jpg'), false);
    assert.strictEqual(safelyDeleteUploadedFile('http://evil.com/uploads/bar.png'), false);
    assert.strictEqual(safelyDeleteUploadedFile('data:image/png;base64,iVBORw0KGgoAAAANS'), false);
  });

  runTest('SECURITY :: safelyDeleteUploadedFile refuses to unlink symlinks', () => {
    const targetFile = path.join(testTmpDir, 'real_target.txt');
    fs.writeFileSync(targetFile, 'do not delete me');
    const symlinkPath = path.join(uploadsMockDir, 'product-symlink.png');
    try {
      fs.symlinkSync(targetFile, symlinkPath);
      const res = safelyDeleteUploadedFile('/uploads/product-symlink.png');
      assert.strictEqual(res, false);
      assert.strictEqual(fs.existsSync(targetFile), true);
    } catch (e) {
      if (e.code !== 'EPERM') throw e; // skip symlink test only if OS denies symlink creation
    }
  });

  // Restore uploadsConfig
  uploadsConfig.uploadDir = originalUploadDir;

  // Test 3: Media Integrity Verification & Recovery Manifest Schema
  await runAsyncTest('INTEGRITY :: auditMediaIntegrity detects missing, orphan, zero-byte, duplicates, invalid exts', async () => {
    const testStorageDir = path.join(testTmpDir, 'storage_audit');
    fs.mkdirSync(testStorageDir, { recursive: true });

    // Populate disk with various test files
    const valid1Content = Buffer.from('VALID_IMAGE_1_BYTES');
    const valid2Content = Buffer.from('VALID_IMAGE_2_BYTES');
    const dupContent = Buffer.from('DUPLICATE_IDENTICAL_CONTENT');

    fs.writeFileSync(path.join(testStorageDir, 'prod-1.webp'), valid1Content);
    fs.writeFileSync(path.join(testStorageDir, 'prod-2.png'), valid2Content);
    fs.writeFileSync(path.join(testStorageDir, 'prod-dup-a.jpg'), dupContent);
    fs.writeFileSync(path.join(testStorageDir, 'prod-dup-b.jpg'), dupContent);
    fs.writeFileSync(path.join(testStorageDir, 'empty-corrupted.png'), Buffer.alloc(0)); // 0-byte
    fs.writeFileSync(path.join(testStorageDir, 'orphan-disk-only.webp'), Buffer.from('ORPHAN'));
    fs.writeFileSync(path.join(testStorageDir, 'bad-script.sh'), Buffer.from('#!/bin/bash'));

    // Simulated DB references
    const mockDbReferences = [
      {
        database_reference: '/uploads/prod-1.webp',
        original_filename: 'prod-1.webp',
        stored_filename: 'prod-1.webp',
        entity_type: 'product',
        entity_id: 101,
        store_id: 1
      },
      {
        database_reference: '/uploads/prod-2.png',
        original_filename: 'prod-2.png',
        stored_filename: 'prod-2.png',
        entity_type: 'category',
        entity_id: 201,
        store_id: 2
      },
      {
        database_reference: '/uploads/prod-dup-a.jpg',
        original_filename: 'prod-dup-a.jpg',
        stored_filename: 'prod-dup-a.jpg',
        entity_type: 'product',
        entity_id: 102,
        store_id: 1
      },
      {
        database_reference: '/uploads/missing-from-disk.webp', // Missing
        original_filename: 'missing-from-disk.webp',
        stored_filename: 'missing-from-disk.webp',
        entity_type: 'product',
        entity_id: 103,
        store_id: 1
      }
    ];

    const audit = await auditMediaIntegrity({
      uploadDirectory: testStorageDir,
      providedReferences: mockDbReferences
    });

    assert.strictEqual(audit.integrity.distinct_db_files, 4);
    assert.strictEqual(audit.integrity.present_and_verified, 3);
    assert.strictEqual(audit.integrity.missing_files_count, 1);
    assert.strictEqual(audit.integrity.zero_byte_files_count, 1);
    assert.strictEqual(audit.integrity.orphan_files_count, 4); // prod-dup-b, empty-corrupted, orphan-disk-only, bad-script.sh
    assert.strictEqual(audit.integrity.invalid_extension_files_count, 1); // bad-script.sh
    assert.strictEqual(audit.integrity.duplicate_hash_groups_count, 1); // dup-a and dup-b

    // Validate recovery manifest schema (all 9 fields)
    assert.ok(Array.isArray(audit.recovery_manifest));
    assert.strictEqual(audit.recovery_manifest.length, 4); // 4 DB references recorded with statuses

    const item = audit.recovery_manifest.find(m => m.stored_filename === 'prod-1.webp');
    assert.ok(item, 'prod-1.webp found in manifest');
    assert.strictEqual(item.database_reference, '/uploads/prod-1.webp');
    assert.strictEqual(item.original_filename, 'prod-1.webp');
    assert.strictEqual(item.stored_filename, 'prod-1.webp');
    assert.strictEqual(item.path, path.join(testStorageDir, 'prod-1.webp'));
    assert.strictEqual(item.size, valid1Content.length);
    assert.strictEqual(item.sha256, crypto.createHash('sha256').update(valid1Content).digest('hex'));
    assert.strictEqual(item.mime_type, 'image/webp');
    assert.strictEqual(item.entity_type, 'product');
    assert.strictEqual(item.entity_id, 101);
    assert.strictEqual(item.store_id, 1);

    // Validate CSV conversion
    const csv = manifestToCsv(audit.recovery_manifest);
    assert.ok(csv.includes('database_reference,original_filename,stored_filename,path,size,mime_type,sha256,status,entity_type,entity_id,store_id'));
    assert.ok(csv.includes('/uploads/prod-1.webp'));
  });

  // Test 4: CLI Execution of media-integrity-verify.js with output files
  await runAsyncTest('CLI :: media-integrity-verify writes JSON, CSV, and missing files via CLI flags', async () => {
    const cliStorageDir = path.join(testTmpDir, 'cli_storage');
    fs.mkdirSync(cliStorageDir, { recursive: true });
    fs.writeFileSync(path.join(cliStorageDir, 'exists.png'), Buffer.from('CLI_EXISTS_IMAGE'));

    const refsJsonPath = path.join(testTmpDir, 'mock_refs.json');
    const mockRefs = [
      { database_reference: '/uploads/exists.png', original_filename: 'exists.png', stored_filename: 'exists.png', entity_type: 'product', entity_id: 1, store_id: 1 },
      { database_reference: '/uploads/missing.png', original_filename: 'missing.png', stored_filename: 'missing.png', entity_type: 'product', entity_id: 2, store_id: 1 }
    ];
    fs.writeFileSync(refsJsonPath, JSON.stringify(mockRefs));

    const outJsonPath = path.join(testTmpDir, 'cli_audit.json');
    const outCsvPath = path.join(testTmpDir, 'cli_manifest.csv');
    const outMissingPath = path.join(testTmpDir, 'cli_missing.txt');

    const cliScript = path.resolve(__dirname, '../scripts/media-integrity-verify.js');
    const res = spawnSync(process.execPath, [
      cliScript,
      '--dir', cliStorageDir,
      '--references', refsJsonPath,
      '--out-json', outJsonPath,
      '--out-csv', outCsvPath,
      '--out-missing', outMissingPath,
      '--json'
    ], { encoding: 'utf8' });

    // Missing file should produce exit code 1
    assert.strictEqual(res.status, 1);
    assert.ok(fs.existsSync(outJsonPath), 'out-json exists');
    assert.ok(fs.existsSync(outCsvPath), 'out-csv exists');
    assert.ok(fs.existsSync(outMissingPath), 'out-missing exists');

    const missingContent = fs.readFileSync(outMissingPath, 'utf8');
    assert.ok(missingContent.includes('missing.png'));

    const parsedJson = JSON.parse(fs.readFileSync(outJsonPath, 'utf8'));
    assert.strictEqual(parsedJson.integrity.missing_files_count, 1);
    assert.strictEqual(parsedJson.integrity.present_and_verified, 1);
  });

  // Test 5: Safe Restore with --manifest-json & --verify-sha256
  await runAsyncTest('RESTORE :: restore-uploads.js validates SHA-256 against recovery manifest JSON', async () => {
    const backupDir = path.join(testTmpDir, 'backup_src');
    const restoreDestDir = path.join(testTmpDir, 'restore_dst');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(restoreDestDir, { recursive: true });

    const goodImage = Buffer.from('RESTORE_GOOD_IMAGE_CONTENT');
    fs.writeFileSync(path.join(backupDir, 'restored-1.png'), goodImage);

    // Apply restore
    const restoreScript = path.resolve(__dirname, '../scripts/restore-uploads.js');
    const applyRes = spawnSync(process.execPath, [
      restoreScript,
      '--from', backupDir,
      '--to', restoreDestDir,
      '--apply'
    ], { encoding: 'utf8' });

    assert.strictEqual(applyRes.status, 0);
    assert.ok(fs.existsSync(path.join(restoreDestDir, 'restored-1.png')));

    // Create manifest with matching SHA-256
    const manifestJsonGood = path.join(testTmpDir, 'manifest_good.json');
    const shaGood = crypto.createHash('sha256').update(goodImage).digest('hex');
    fs.writeFileSync(manifestJsonGood, JSON.stringify([
      { stored_filename: 'restored-1.png', sha256: shaGood }
    ]));

    const verifyRes = spawnSync(process.execPath, [
      restoreScript,
      '--from', backupDir,
      '--to', restoreDestDir,
      '--manifest-json', manifestJsonGood,
      '--verify-sha256'
    ], { encoding: 'utf8' });

    assert.strictEqual(verifyRes.status, 0, verifyRes.stderr);
    assert.ok(verifyRes.stdout.includes('verified in destination: 1'));

    // Create manifest with mismatched SHA-256
    const manifestJsonBad = path.join(testTmpDir, 'manifest_bad.json');
    fs.writeFileSync(manifestJsonBad, JSON.stringify([
      { stored_filename: 'restored-1.png', sha256: 'deadbeef00000000000000000000000000000000000000000000000000000000' }
    ]));

    const mismatchRes = spawnSync(process.execPath, [
      restoreScript,
      '--from', backupDir,
      '--to', restoreDestDir,
      '--manifest-json', manifestJsonBad,
      '--verify-sha256'
    ], { encoding: 'utf8' });

    assert.strictEqual(mismatchRes.status, 1, 'Mismatched SHA-256 exits with code 1');
    assert.ok(mismatchRes.stderr.includes('SHA-256 MISMATCH'));
  });

  // Test 6: In-app destination refusal
  await runAsyncTest('RESTORE :: restore-uploads.js refuses in-app destination and relative path', async () => {
    const backupDir = path.join(testTmpDir, 'backup_src2');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'test.png'), Buffer.from('TEST'));

    const restoreScript = path.resolve(__dirname, '../scripts/restore-uploads.js');
    const inAppDest = path.resolve(__dirname, '../server/uploads');

    const inAppRes = spawnSync(process.execPath, [
      restoreScript,
      '--from', backupDir,
      '--to', inAppDest,
      '--apply'
    ], { encoding: 'utf8' });

    assert.strictEqual(inAppRes.status, 2, 'In-app destination must exit with code 2');
    assert.ok(inAppRes.stderr.includes('inside the application folder'));

    const relRes = spawnSync(process.execPath, [
      restoreScript,
      '--from', backupDir,
      '--to', 'relative/path',
      '--apply'
    ], { encoding: 'utf8' });

    assert.strictEqual(relRes.status, 2, 'Relative path must exit with code 2');
    assert.ok(relRes.stderr.includes('ABSOLUTE'));
  });

  cleanup();
  console.log(`\n==============================================`);
  console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests} tests successful.`);
  console.log(`==============================================\n`);
})();
