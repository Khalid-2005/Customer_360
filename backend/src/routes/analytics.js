import express from 'express';
import { analyticsController } from '../controllers/analyticsController.js';
import { 
  authenticate, 
  authorize, 
  requirePermissions 
} from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting configuration
const analyticsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many analytics requests, please try again later'
});

// Dashboard and real-time endpoints
router.get('/dashboard',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics'),
  analyticsController.getDashboardSummary
);

router.get('/real-time',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics'),
  analyticsController.getRealTimeSales
);

// Revenue analytics endpoints
router.get('/revenue',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics'),
  analyticsRateLimit,
  analyticsController.getRevenueAnalytics
);

// Inventory analytics endpoints
router.get('/inventory',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics', 'manage_inventory'),
  analyticsRateLimit,
  analyticsController.getInventoryAnalytics
);

// Customer analytics endpoints
router.get('/customers',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics', 'manage_customers'),
  analyticsRateLimit,
  analyticsController.getCustomerAnalytics
);

// Cart analytics endpoints
router.get('/carts',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics'),
  analyticsRateLimit,
  analyticsController.getCartAnalytics
);

// Report generation endpoints
router.post('/reports',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics', 'generate_reports'),
  analyticsRateLimit,
  analyticsController.generateReport
);

// Data export endpoints
router.post('/export',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('view_analytics', 'export_data'),
  analyticsRateLimit,
  analyticsController.exportData
);

// Validation middleware for date parameters
const validateDateParams = (req, res, next) => {
  const { startDate, endDate } = req.query;

  if (startDate && !isValidDate(startDate)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid start date format'
    });
  }

  if (endDate && !isValidDate(endDate)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid end date format'
    });
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return res.status(400).json({
      success: false,
      error: 'Start date cannot be after end date'
    });
  }

  next();
};

// Validation middleware for report parameters
const validateReportParams = (req, res, next) => {
  const { metrics, format } = req.body;

  if (!Array.isArray(metrics) || metrics.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'At least one metric must be specified'
    });
  }

  const validMetrics = ['revenue', 'inventory', 'customers', 'carts'];
  const invalidMetrics = metrics.filter(m => !validMetrics.includes(m));

  if (invalidMetrics.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Invalid metrics: ${invalidMetrics.join(', ')}`
    });
  }

  if (format && !['json', 'csv', 'pdf'].includes(format)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid format specified'
    });
  }

  next();
};

// Apply validation middleware to relevant routes
router.get('/revenue', validateDateParams);
router.get('/carts', validateDateParams);
router.post('/reports', validateReportParams);

// Helper function to validate date format
function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

export default router;