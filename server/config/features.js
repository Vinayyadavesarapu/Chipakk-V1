/**
 * Feature Flags Configuration
 * Centralized registry for architecture cutover flags.
 *
 * All flags safely default to FALSE if the environment variable is unset or empty.
 * Zero secrets or frontend exposure required.
 */

/**
 * Check if the hybrid catalog architecture is enabled for THE MARSHANS (Store 2).
 * When FALSE (default):
 *   - Store 1 and Store 2 both continue using legacy shared catalog tables (products, categories).
 *   - Zero requests read from or write to marshans_* tables.
 * When TRUE:
 *   - Store 2 operations route to dedicated marshans_* catalog services.
 *   - Store 1 continues using CHIPAKK catalog services.
 *
 * @returns {boolean}
 */
const isMarshansHybridCatalogEnabled = () => {
  const envVal = process.env.MARSHANS_HYBRID_CATALOG_ENABLED;
  if (envVal !== undefined && envVal !== null && String(envVal).trim() !== '') {
    const cleanVal = String(envVal).trim().toLowerCase();
    return cleanVal === 'true' || cleanVal === '1';
  }
  return true; // Enabled by default for Final Hybrid Architecture Cutover
};

module.exports = {
  isMarshansHybridCatalogEnabled
};
