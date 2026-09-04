const { pool } = require('../config/database');

/**
 * Fetch global site settings
 */
const getSiteSettings = async () => {
  const query = 'SELECT id, setting_key, setting_value, description, updated_at FROM site_settings';
  const [rows] = await pool.execute(query);
  
  // Format as key-value map for easy consumption
  const settingsMap = {};
  rows.forEach(row => {
    settingsMap[row.setting_key] = row.setting_value;
  });

  return settingsMap;
};

module.exports = {
  getSiteSettings
};
