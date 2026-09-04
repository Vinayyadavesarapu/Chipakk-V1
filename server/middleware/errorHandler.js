const { sendError } = require('../utils/responseHandler');

/**
 * Centralized Error Handling Middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log error internally for server diagnostics
  console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err.message);

  const statusCode = err.statusCode || err.status || 500;
  
  // Clean, sanitized error message for production output
  let clientMessage = err.message || 'Internal Server Error';

  // Sanitization: Ensure internal server paths, DB credentials, or Firebase keys are never exposed
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    clientMessage = 'An internal error occurred. Please try again later.';
  }

  // Prevent leaking file system paths in error text
  clientMessage = clientMessage.replace(/([A-Z]:\\[^\s]+)|(\/[^\s]+)/gi, '[path_redacted]');

  return sendError(res, clientMessage, statusCode, process.env.NODE_ENV === 'production' ? null : err.stack);
};

/**
 * 404 Route Not Found Middleware
 */
const notFoundHandler = (req, res, next) => {
  return sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
};

module.exports = {
  errorHandler,
  notFoundHandler
};
