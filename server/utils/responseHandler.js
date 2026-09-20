/**
 * Standardized API Response Utilities
 */

/**
 * Send a success response
 * @param {import('express').Response} res
 * @param {any} data
 * @param {string} [message]
 * @param {number} [statusCode=200]
 */
const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

/**
 * Send an error response
 * @param {import('express').Response} res
 * @param {string} [message]
 * @param {number} [statusCode=500]
 * @param {any} [errorDetails=null]
 */
const sendError = (res, message = 'An unexpected error occurred', statusCode = 500, errorDetails = null) => {
  const response = {
    success: false,
    error: {
      message,
      statusCode
    },
    timestamp: new Date().toISOString()
  };

  // Fail closed: diagnostics (stack traces, file paths) leave the server ONLY when NODE_ENV is explicitly
  // 'development'. An unset/misspelled NODE_ENV on a host must not turn them on.
  if (errorDetails && process.env.NODE_ENV === 'development') {
    response.error.details = errorDetails;
  }

  return res.status(statusCode).json(response);
};

module.exports = {
  sendSuccess,
  sendError
};
