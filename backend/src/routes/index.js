import express from 'express';
import customerRoutes from './customer.js';
import analyticsRoutes from './analytics.js';
import backupRoutes from './backup.js';

export const configureRoutes = (app) => {
  const apiRouter = express.Router();

  // Mount route groups
  apiRouter.use('/customers', customerRoutes);
  apiRouter.use('/analytics', analyticsRoutes);
  apiRouter.use('/backups', backupRoutes);

  // Mount API router under /api/v1
  app.use('/api/v1', apiRouter);

  // Add API documentation route
  app.get('/api/docs', (req, res) => {
    res.json({
      version: '1.0.0',
      description: 'Retail Management System API',
      endpoints: {
        customers: {
          base: '/api/v1/customers',
          methods: {
            'GET /': 'List all customers',
            'POST /': 'Create new customer',
            'GET /:id': 'Get customer details',
            'PUT /:id': 'Update customer',
            'DELETE /:id': 'Delete customer',
            'GET /:id/purchase-history': 'Get customer purchase history',
            'POST /:id/enrich': 'Enrich customer data',
            'POST /:id/validate': 'Validate customer data',
            'POST /:id/gdpr': 'Handle GDPR request'
          }
        },
        analytics: {
          base: '/api/v1/analytics',
          methods: {
            'GET /dashboard': 'Get dashboard summary',
            'GET /real-time': 'Get real-time sales data',
            'GET /revenue': 'Get revenue analytics',
            'GET /inventory': 'Get inventory analytics',
            'GET /customers': 'Get customer analytics',
            'GET /carts': 'Get cart analytics',
            'POST /reports': 'Generate custom report',
            'POST /export': 'Export data'
          }
        },
        backups: {
          base: '/api/v1/backups',
          methods: {
            'GET /': 'List all backups',
            'GET /config': 'Get backup configuration',
            'PUT /config': 'Update backup configuration',
            'GET /:timestamp': 'Get backup status',
            'POST /create': 'Create new backup',
            'POST /restore/:timestamp': 'Restore from backup',
            'DELETE /:timestamp': 'Delete backup'
          }
        }
      }
    });
  });

  // Return router for testing purposes
  return apiRouter;
};

// Export route configuration
export default configureRoutes;