#!/usr/bin/env node
/**
 * Alert Device Key Generator & Rotation Tool
 * Generates high-entropy cryptographically secure credentials for the order alert companion service.
 *
 * Usage:
 *   node scripts/generate_alert_device_key.js
 *   node scripts/generate_alert_device_key.js --count=2
 */

const crypto = require('crypto');

function generateKey(prefix = 'mrsh_alert_live_') {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${prefix}${randomBytes}`;
}

const args = process.argv.slice(2);
let count = 1;
for (const arg of args) {
  if (arg.startsWith('--count=')) {
    count = parseInt(arg.split('=')[1], 10) || 1;
  }
}

console.log('=================================================================');
console.log('🔑  ORDER ALERT COMPANION — DEVICE KEY GENERATOR');
console.log('=================================================================\n');

const generatedKeys = [];
for (let i = 0; i < count; i++) {
  const key = generateKey();
  generatedKeys.push(key);
  console.log(`Generated Key #${i + 1}:`);
  console.log(`  ${key}\n`);
}

console.log('--- PRODUCTION BACKEND CONFIGURATION (.env) ---');
console.log('Add the key to your production backend environment:');
console.log(`ALERT_DEVICE_KEYS="${generatedKeys.join(',')}"\n`);

console.log('--- LOCAL COMPANION SERVICE CONFIGURATION (.env) ---');
console.log('Add the primary key to your local companion service environment:');
console.log(`ALERT_DEVICE_KEY="${generatedKeys[0]}"`);
console.log('ALERT_FEED_URL="https://api.chipakk.shop/api/alerts/feed"\n');

console.log('--- ZERO-DOWNTIME KEY ROTATION PROCEDURE ---');
console.log('1. Run this script to generate a new key.');
console.log('2. In production .env, append the new key: ALERT_DEVICE_KEYS="new_key,old_key"');
console.log('3. Restart or reload the backend service.');
console.log('4. Update the local companion service .env with the new key and restart it.');
console.log('5. Once verified working, remove the old key: ALERT_DEVICE_KEYS="new_key"');
console.log('6. Reload backend service. The old key is now permanently revoked.\n');

console.log('--- IMMEDIATE REVOCATION ---');
console.log('To immediately revoke access for a compromised key, remove it from');
console.log('ALERT_DEVICE_KEYS in the backend .env and restart the service.');
console.log('=================================================================');
