/**
 * CHIPAKK — Indian Phone Number Normalization & Validation Utility
 * server/utils/phoneUtils.js
 *
 * Normalizes and validates Indian 10-digit mobile phone numbers.
 * Supported input formats include:
 *  - 9876543210 (10 digits starting with 6-9)
 *  - 09876543210 (11 digits starting with 0, followed by 10 valid digits)
 *  - +919876543210 (13 chars starting with +91, followed by 10 valid digits)
 *  - 919876543210 (12 digits starting with 91, followed by 10 valid digits)
 *  - Formats with whitespace or hyphens (e.g. "+91 98765-43210")
 *
 * Target valid format: ^[6-9]\d{9}$
 *
 * Returns: { valid: boolean, phone: string|null }
 */

function normalizeIndianPhoneNumber(rawPhone) {
  if (!rawPhone || (typeof rawPhone !== 'string' && typeof rawPhone !== 'number')) {
    return { valid: false, phone: null };
  }

  // 1. Trim and strip all whitespace and hyphens
  let cleaned = String(rawPhone).trim().replace(/[\s\-]/g, '');

  // 2. Safely strip +91, 91, or leading 0 ONLY when the remainder is exactly 10 digits
  if (cleaned.startsWith('+91')) {
    const remainder = cleaned.slice(3);
    if (/^\d{10}$/.test(remainder)) {
      cleaned = remainder;
    }
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    const remainder = cleaned.slice(2);
    if (/^\d{10}$/.test(remainder)) {
      cleaned = remainder;
    }
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    const remainder = cleaned.slice(1);
    if (/^\d{10}$/.test(remainder)) {
      cleaned = remainder;
    }
  }

  // 3. Validate against official Indian 10-digit mobile pattern: starts with 6, 7, 8, or 9
  const isValid = /^[6-9]\d{9}$/.test(cleaned);
  return {
    valid: isValid,
    phone: isValid ? cleaned : null
  };
}

module.exports = {
  normalizeIndianPhoneNumber
};
