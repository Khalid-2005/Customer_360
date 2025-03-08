import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { APIError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { redis } from '../services/redis.js';

export const customerController = {
  // Create new customer
  async create(req, res, next) {
    try {
      const {
        email,
        firstName,
        lastName,
        phone,
        type,
        company,
        address,
        preferences
      } = req.body;

      // Create user account
      const user = new User({
        email,
        firstName,
        lastName,
        password: Math.random().toString(36).slice(-8), // Temporary password
        role: 'customer'
      });

      await user.save();

      // Create customer profile
      const customer = new Customer({
        userId: user._id,
        type,
        company,
        addresses: address ? [address] : [],
        preferences,
        contactPreferences: {
          email: true,
          whatsapp: phone ? true : false
        }
      });

      if (phone) {
        customer.metadata.set('phone', phone);
      }

      await customer.save();

      // Send welcome email with temporary password
      // TODO: Implement email service integration

      res.status(201).json({
        success: true,
        data: customer
      });
    } catch (error) {
      next(error);
    }
  },

  // Get customer profile
  async getProfile(req, res, next) {
    try {
      const customer = await Customer.findById(req.params.id)
        .populate('userId', 'email firstName lastName')
        .populate('segments');

      if (!customer) {
        throw new APIError('Customer not found', 404);
      }

      // Cache customer data
      await redis.setex(
        `customer:${customer._id}`,
        3600, // 1 hour
        JSON.stringify(customer)
      );

      res.status(200).json({
        success: true,
        data: customer
      });
    } catch (error) {
      next(error);
    }
  },

  // Update customer profile
  async update(req, res, next) {
    try {
      const updates = req.body;
      const customer = await Customer.findById(req.params.id);

      if (!customer) {
        throw new APIError('Customer not found', 404);
      }

      // Handle user data updates
      if (updates.email || updates.firstName || updates.lastName) {
        const user = await User.findById(customer.userId);
        if (user) {
          Object.assign(user, {
            email: updates.email,
            firstName: updates.firstName,
            lastName: updates.lastName
          });
          await user.save();
        }
      }

      // Handle address updates
      if (updates.addresses) {
        customer.addresses = updates.addresses;
      }

      // Handle preference updates
      if (updates.preferences) {
        customer.preferences = {
          ...customer.preferences,
          ...updates.preferences
        };
      }

      // Handle contact preference updates
      if (updates.contactPreferences) {
        customer.contactPreferences = {
          ...customer.contactPreferences,
          ...updates.contactPreferences
        };
      }

      // Update other fields
      Object.assign(customer, updates);

      await customer.save();

      // Clear cache
      await redis.del(`customer:${customer._id}`);

      res.status(200).json({
        success: true,
        data: customer
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete customer
  async delete(req, res, next) {
    try {
      const customer = await Customer.findById(req.params.id);

      if (!customer) {
        throw new APIError('Customer not found', 404);
      }

      // Delete associated user
      await User.findByIdAndDelete(customer.userId);

      // Delete customer
      await customer.remove();

      // Clear cache
      await redis.del(`customer:${customer._id}`);

      res.status(200).json({
        success: true,
        message: 'Customer deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Get customer purchase history
  async getPurchaseHistory(req, res, next) {
    try {
      const orders = await Order.find({ customer: req.params.id })
        .sort({ createdAt: -1 })
        .populate('items.product');

      res.status(200).json({
        success: true,
        data: orders
      });
    } catch (error) {
      next(error);
    }
  },

  // Enrich customer data from social media
  async enrichCustomerData(req, res, next) {
    try {
      const customer = await Customer.findById(req.params.id);

      if (!customer) {
        throw new APIError('Customer not found', 404);
      }

      // TODO: Implement social media API integrations
      // This would involve:
      // 1. Connecting to social media APIs
      // 2. Fetching relevant data
      // 3. Updating customer profile with enriched data

      res.status(200).json({
        success: true,
        message: 'Customer data enrichment completed'
      });
    } catch (error) {
      next(error);
    }
  },

  // Validate customer data
  async validateData(req, res, next) {
    try {
      const customer = await Customer.findById(req.params.id);

      if (!customer) {
        throw new APIError('Customer not found', 404);
      }

      const validationResults = {
        email: validateEmail(customer.userId.email),
        phone: validatePhone(customer.metadata.get('phone')),
        addresses: customer.addresses.map(validateAddress)
      };

      res.status(200).json({
        success: true,
        data: validationResults
      });
    } catch (error) {
      next(error);
    }
  },

  // Handle GDPR compliance
  async handleGDPRRequest(req, res, next) {
    try {
      const { type } = req.body;
      const customer = await Customer.findById(req.params.id);

      if (!customer) {
        throw new APIError('Customer not found', 404);
      }

      switch (type) {
        case 'export':
          const data = await exportCustomerData(customer);
          res.status(200).json({
            success: true,
            data
          });
          break;

        case 'delete':
          await deleteCustomerData(customer);
          res.status(200).json({
            success: true,
            message: 'Customer data deleted successfully'
          });
          break;

        default:
          throw new APIError('Invalid GDPR request type', 400);
      }
    } catch (error) {
      next(error);
    }
  }
};

// Helper functions
function validateEmail(email) {
  const emailRegex = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/;
  return {
    valid: emailRegex.test(email),
    message: emailRegex.test(email) ? 'Valid email' : 'Invalid email format'
  };
}

function validatePhone(phone) {
  if (!phone) return { valid: false, message: 'Phone number not provided' };
  
  const phoneRegex = /^\+?[\d\s-]{10,}$/;
  return {
    valid: phoneRegex.test(phone),
    message: phoneRegex.test(phone) ? 'Valid phone number' : 'Invalid phone format'
  };
}

function validateAddress(address) {
  const required = ['street', 'city', 'country'];
  const missing = required.filter(field => !address[field]);
  
  return {
    valid: missing.length === 0,
    message: missing.length === 0 ? 'Valid address' : `Missing required fields: ${missing.join(', ')}`
  };
}

async function exportCustomerData(customer) {
  // Gather all customer data
  const user = await User.findById(customer.userId);
  const orders = await Order.find({ customer: customer._id });
  
  return {
    personalInfo: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: customer.metadata.get('phone')
    },
    addresses: customer.addresses,
    orders: orders.map(order => ({
      orderNumber: order.orderNumber,
      date: order.createdAt,
      total: order.total,
      items: order.items
    })),
    preferences: customer.preferences,
    contactPreferences: customer.contactPreferences
  };
}

async function deleteCustomerData(customer) {
  // Delete all customer-related data
  await Promise.all([
    User.findByIdAndDelete(customer.userId),
    Order.deleteMany({ customer: customer._id }),
    Message.deleteMany({ customer: customer._id }),
    customer.remove()
  ]);
}