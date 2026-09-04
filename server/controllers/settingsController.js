const settingsService = require('../services/settingsService');
const { sendSuccess } = require('../utils/responseHandler');

/**
 * Get Site Settings Handler
 * GET /api/settings
 */
const getSettingsHandler = async (req, res, next) => {
  try {
    const settings = await settingsService.getSiteSettings();

    return sendSuccess(res, {
      settings
    }, 'Site settings retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getSettingsHandler
};
