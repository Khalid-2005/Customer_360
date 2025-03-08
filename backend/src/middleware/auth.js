import jwt from 'jsonwebtoken';
import { APIError } from './errorHandler.js';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';

/**
 * Authentication middleware to verify JWT tokens
 */
export const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new APIError('No authentication token provided', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+permissions');

    if (!user) {
      throw new APIError('User not found', 401);
    }

    if (!user.active) {
      throw new APIError('User account is deactivated', 403);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new APIError('Invalid authentication token', 401));
    } else if (error.name === 'TokenExpiredError') {
      next(new APIError('Authentication token expired', 401));
    } else {
      next(error);
    }
  }
};

/**
 * Role-based authorization middleware
 * @param {...string} roles - Allowed roles
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new APIError('User not authenticated', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new APIError('Not authorized to access this route', 403));
    }

    next();
  };
};

/**
 * Permission-based authorization middleware
 * @param {...string} permissions - Required permissions
 */
export const requirePermissions = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new APIError('User not authenticated', 401));
    }

    const hasAllPermissions = permissions.every(permission =>
      req.user.hasPermission(permission)
    );

    if (!hasAllPermissions) {
      return next(new APIError('Insufficient permissions', 403));
    }

    next();
  };
};

/**
 * Owner authorization middleware
 * Checks if the authenticated user owns the resource
 * @param {string} paramField - Request parameter field containing resource ID
 * @param {string} userField - Field in the resource that references the user
 */
export const authorizeOwner = (paramField, userField = 'user') => {
  return async (req, res, next) => {
    if (!req.user) {
      return next(new APIError('User not authenticated', 401));
    }

    const resourceId = req.params[paramField];
    if (!resourceId) {
      return next(new APIError('Resource ID not provided', 400));
    }

    const Model = req.model; // Model should be attached by previous middleware
    if (!Model) {
      return next(new APIError('Model not specified', 500));
    }

    try {
      const resource = await Model.findById(resourceId);
      if (!resource) {
        return next(new APIError('Resource not found', 404));
      }

      if (resource[userField].toString() !== req.user.id &&
          req.user.role !== 'admin') {
        return next(new APIError('Not authorized to access this resource', 403));
      }

      req.resource = resource;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Rate limiting middleware based on user role
 */
export const roleBasedRateLimit = {
  admin: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },
  manager: {
    windowMs: 15 * 60 * 1000,
    max: 75
  },
  staff: {
    windowMs: 15 * 60 * 1000,
    max: 50
  },
  customer: {
    windowMs: 15 * 60 * 1000,
    max: 30
  }
};

/**
 * Extract JWT token from request
 */
const extractToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  
  return null;
};

/**
 * Middleware to log API access
 */
export const logAccess = (req, res, next) => {
  logger.info(`API Access: [${req.method}] ${req.originalUrl} - User: ${req.user?.email || 'Anonymous'}`);
  next();
};

/**
 * Middleware to check API key for external services
 */
export const checkApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return next(new APIError('Invalid API key', 401));
  }
  
  next();
};

/**
 * Middleware to validate user session
 */
export const validateSession = async (req, res, next) => {
  const sessionId = req.cookies.sessionId;
  
  if (!sessionId) {
    return next(new APIError('No session found', 401));
  }
  
  try {
    // Implement session validation logic here
    // This could involve checking Redis for session data
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to handle CORS preflight requests
 */
export const handlePreflight = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).json({});
  }
  next();
};