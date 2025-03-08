import { logError } from '../utils/logger.js';

// Custom error class for API errors
export class APIError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'APIError';
  }
}

// Custom error class for validation errors
export class ValidationError extends APIError {
  constructor(details) {
    super('Validation Error', 400, details);
    this.name = 'ValidationError';
  }
}

// Main error handler middleware
export const errorHandler = (err, req, res, next) => {
  // Log the error
  logError(err, `[${req.method}] ${req.path}`);

  // Default error values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    if (err.errors) {
      details = Object.values(err.errors).map(error => ({
        field: error.path,
        message: error.message
      }));
    }
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Prepare error response
  const errorResponse = {
    success: false,
    error: {
      message,
      ...(details && { details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  };

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// Async handler wrapper to eliminate try-catch blocks
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Not Found error handler
export const notFoundHandler = (req, res, next) => {
  const err = new APIError(`Not Found - ${req.originalUrl}`, 404);
  next(err);
};

// Rate limit error handler
export const rateLimitHandler = (req, res) => {
  const err = new APIError('Too many requests', 429);
  res.status(429).json({
    success: false,
    error: {
      message: err.message,
      details: {
        retryAfter: parseInt(res.getHeader('Retry-After') || 60)
      }
    }
  });
};

// Database connection error handler
export const databaseErrorHandler = (error) => {
  logError(error, 'Database Error');
  return new APIError('Database error occurred', 500);
};

// Authentication error handler
export const authErrorHandler = (error) => {
  if (error.name === 'JsonWebTokenError') {
    return new APIError('Invalid authentication token', 401);
  }
  if (error.name === 'TokenExpiredError') {
    return new APIError('Authentication token expired', 401);
  }
  return new APIError('Authentication failed', 401);
};