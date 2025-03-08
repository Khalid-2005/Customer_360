import express from 'express';
import { customerController } from '../controllers/customerController.js';
import { 
  authenticate, 
  authorize, 
  requirePermissions, 
  authorizeOwner 
} from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting configuration
const createCustomerLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // limit each IP to 50 customer creations per hour
  message: 'Too many customer accounts created, please try again later'
});

// Validation schemas
const customerValidation = {
  create: {
    body: {
      email: { type: 'string', required: true },
      firstName: { type: 'string', required: true },
      lastName: { type: 'string', required: true },
      phone: { type: 'string', required: false },
      type: { type: 'string', enum: ['individual', 'business'], required: true },
      company: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          registrationNumber: { type: 'string' },
          taxId: { type: 'string' }
        },
        required: false
      },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string', required: true },
          city: { type: 'string', required: true },
          state: { type: 'string' },
          postalCode: { type: 'string' },
          country: { type: 'string', required: true }
        },
        required: false
      }
    }
  },
  update: {
    body: {
      email: { type: 'string' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      phone: { type: 'string' },
      addresses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            street: { type: 'string', required: true },
            city: { type: 'string', required: true },
            state: { type: 'string' },
            postalCode: { type: 'string' },
            country: { type: 'string', required: true }
          }
        }
      },
      preferences: { type: 'object' },
      contactPreferences: { 
        type: 'object',
        properties: {
          email: { type: 'boolean' },
          sms: { type: 'boolean' },
          whatsapp: { type: 'boolean' },
          phone: { type: 'boolean' }
        }
      }
    }
  }
};

// Routes
router.post('/',
  createCustomerLimit,
  authorize('admin', 'manager'),
  requirePermissions('manage_customers'),
  validateRequest(customerValidation.create),
  customerController.create
);

router.get('/:id',
  authenticate,
  authorize('admin', 'manager', 'staff', 'customer'),
  authorizeOwner('id', 'userId'),
  customerController.getProfile
);

router.put('/:id',
  authenticate,
  authorize('admin', 'manager', 'customer'),
  authorizeOwner('id', 'userId'),
  validateRequest(customerValidation.update),
  customerController.update
);

router.delete('/:id',
  authenticate,
  authorize('admin'),
  requirePermissions('manage_customers'),
  customerController.delete
);

router.get('/:id/purchase-history',
  authenticate,
  authorize('admin', 'manager', 'staff', 'customer'),
  authorizeOwner('id', 'userId'),
  customerController.getPurchaseHistory
);

router.post('/:id/enrich',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('manage_customers'),
  customerController.enrichCustomerData
);

router.post('/:id/validate',
  authenticate,
  authorize('admin', 'manager', 'staff'),
  requirePermissions('manage_customers'),
  customerController.validateData
);

router.post('/:id/gdpr',
  authenticate,
  authorize('admin', 'manager', 'customer'),
  authorizeOwner('id', 'userId'),
  customerController.handleGDPRRequest
);

// Bulk operations (for admin and managers)
router.post('/bulk/validate',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('manage_customers'),
  async (req, res, next) => {
    try {
      const { customerIds } = req.body;
      const validationResults = await Promise.all(
        customerIds.map(id => customerController.validateData({ params: { id } }))
      );
      
      res.status(200).json({
        success: true,
        data: validationResults
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/bulk/enrich',
  authenticate,
  authorize('admin', 'manager'),
  requirePermissions('manage_customers'),
  async (req, res, next) => {
    try {
      const { customerIds } = req.body;
      const enrichmentResults = await Promise.all(
        customerIds.map(id => customerController.enrichCustomerData({ params: { id } }))
      );
      
      res.status(200).json({
        success: true,
        data: enrichmentResults
      });
    } catch (error) {
      next(error);
    }
  }
);

// Export customer data (GDPR compliance)
router.get('/export/all',
  authenticate,
  authorize('admin'),
  requirePermissions('manage_customers'),
  async (req, res, next) => {
    try {
      const { format = 'json' } = req.query;
      const customers = await Customer.find()
        .populate('userId', 'email firstName lastName')
        .select('-__v');

      if (format === 'csv') {
        // Convert to CSV format
        const csv = convertToCSV(customers);
        res.header('Content-Type', 'text/csv');
        res.attachment('customers-export.csv');
        return res.send(csv);
      }

      res.status(200).json({
        success: true,
        data: customers
      });
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to convert data to CSV
function convertToCSV(customers) {
  const fields = [
    'customerNumber',
    'email',
    'firstName',
    'lastName',
    'type',
    'status',
    'createdAt'
  ];

  const csv = customers.map(customer => {
    const user = customer.userId;
    return fields.map(field => {
      if (['email', 'firstName', 'lastName'].includes(field)) {
        return user[field];
      }
      return customer[field];
    }).join(',');
  });

  return [fields.join(','), ...csv].join('\n');
}

export default router;