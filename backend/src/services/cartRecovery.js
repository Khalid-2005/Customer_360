import Cart from '../models/Cart.js';
import MessageTemplate from '../models/MessageTemplate.js';
import { whatsappService } from './whatsapp.js';
import { segmentationEngine } from './segmentation.js';
import { redis } from './redis.js';
import { logger } from '../utils/logger.js';

class CartRecoveryService {
  constructor() {
    this.ABANDONMENT_THRESHOLD = 30 * 60 * 1000; // 30 minutes
    this.RECOVERY_INTERVALS = [
      { hours: 1, channels: ['whatsapp'] },
      { hours: 24, channels: ['email', 'whatsapp'] },
      { hours: 72, channels: ['email'] }
    ];
    this.abTests = new Map();
    this.initializeABTests();
  }

  initializeABTests() {
    // Define A/B test variants for recovery messages
    this.abTests.set('message_style', {
      variants: ['persuasive', 'informative', 'urgent'],
      distribution: [0.33, 0.33, 0.34],
      active: true
    });

    this.abTests.set('discount_offer', {
      variants: ['none', '10_percent', '20_percent'],
      distribution: [0.33, 0.33, 0.34],
      active: true
    });

    this.abTests.set('timing', {
      variants: ['immediate', 'delayed'],
      distribution: [0.5, 0.5],
      active: true
    });
  }

  async detectAbandonedCarts() {
    try {
      const threshold = new Date(Date.now() - this.ABANDONMENT_THRESHOLD);
      
      const potentiallyAbandonedCarts = await Cart.find({
        status: 'active',
        lastActivity: { $lt: threshold },
        items: { $ne: [] }
      }).populate('customer');

      for (const cart of potentiallyAbandonedCarts) {
        await this.processAbandonedCart(cart);
      }
    } catch (error) {
      logger.error('Error detecting abandoned carts:', error);
    }
  }

  async processAbandonedCart(cart) {
    try {
      // Mark cart as abandoned
      await cart.abandon();

      // Get customer segments
      const segments = await segmentationEngine.segmentCustomer(cart.customer);

      // Determine best recovery strategy based on customer segments
      const strategy = await this.determineRecoveryStrategy(cart, segments);

      // Initialize recovery workflow
      await this.initializeRecoveryWorkflow(cart, strategy);

      // Log abandonment for analytics
      await this.logAbandonment(cart);
    } catch (error) {
      logger.error(`Error processing abandoned cart ${cart._id}:`, error);
    }
  }

  async determineRecoveryStrategy(cart, segments) {
    const strategy = {
      timing: await this.assignABTestVariant('timing', cart.customer._id),
      messageStyle: await this.assignABTestVariant('message_style', cart.customer._id),
      discountOffer: await this.assignABTestVariant('discount_offer', cart.customer._id),
      channels: []
    };

    // Determine channels based on segments and preferences
    if (segments.includes('high_value')) {
      strategy.channels = ['whatsapp', 'email'];
    } else if (cart.totalValue > 1000) {
      strategy.channels = ['whatsapp', 'email'];
    } else {
      strategy.channels = ['email'];
    }

    // Adjust based on customer preferences
    if (cart.customer.contactPreferences.whatsapp === false) {
      strategy.channels = strategy.channels.filter(c => c !== 'whatsapp');
    }

    return strategy;
  }

  async initializeRecoveryWorkflow(cart, strategy) {
    try {
      const recoveryPlan = await this.createRecoveryPlan(cart, strategy);
      
      // Store recovery plan in Redis for tracking
      await redis.setex(
        `cart:${cart._id}:recovery_plan`,
        7 * 24 * 60 * 60, // 7 days
        JSON.stringify(recoveryPlan)
      );

      // Schedule first recovery attempt
      await this.scheduleRecoveryAttempt(cart, recoveryPlan.attempts[0]);
    } catch (error) {
      logger.error(`Error initializing recovery workflow for cart ${cart._id}:`, error);
    }
  }

  async createRecoveryPlan(cart, strategy) {
    const plan = {
      cartId: cart._id,
      customerId: cart.customer._id,
      strategy,
      attempts: []
    };

    for (const interval of this.RECOVERY_INTERVALS) {
      const channels = interval.channels.filter(c => strategy.channels.includes(c));
      if (channels.length > 0) {
        plan.attempts.push({
          scheduledFor: new Date(Date.now() + interval.hours * 60 * 60 * 1000),
          channels,
          templates: await this.selectTemplates(cart, strategy, channels)
        });
      }
    }

    return plan;
  }

  async selectTemplates(cart, strategy, channels) {
    const templates = {};

    for (const channel of channels) {
      const template = await MessageTemplate.findOne({
        category: 'cart_recovery',
        channels: channel,
        'metadata.style': strategy.messageStyle,
        'metadata.discountOffer': strategy.discountOffer
      });

      if (template) {
        templates[channel] = template._id;
      }
    }

    return templates;
  }

  async scheduleRecoveryAttempt(cart, attempt) {
    const delay = attempt.scheduledFor.getTime() - Date.now();
    
    setTimeout(async () => {
      await this.executeRecoveryAttempt(cart._id, attempt);
    }, Math.max(0, delay));
  }

  async executeRecoveryAttempt(cartId, attempt) {
    try {
      const cart = await Cart.findById(cartId).populate('customer');
      
      if (!cart || cart.status !== 'abandoned') {
        return;
      }

      for (const channel of attempt.channels) {
        const templateId = attempt.templates[channel];
        if (!templateId) continue;

        await this.sendRecoveryMessage(cart, channel, templateId);
        await cart.logRecoveryAttempt(channel, templateId);
      }
    } catch (error) {
      logger.error(`Error executing recovery attempt for cart ${cartId}:`, error);
    }
  }

  async sendRecoveryMessage(cart, channel, templateId) {
    try {
      const template = await MessageTemplate.findById(templateId);
      if (!template) return;

      const variables = {
        customerName: `${cart.customer.firstName} ${cart.customer.lastName}`,
        cartTotal: cart.totalValue.toFixed(2),
        itemCount: cart.items.length,
        recoveryLink: this.generateRecoveryLink(cart._id)
      };

      switch (channel) {
        case 'whatsapp':
          await whatsappService.sendMessage(
            cart.customer.metadata.get('phone'),
            null, // content will be generated from template
            {
              template: templateId,
              variables,
              customer: cart.customer._id
            }
          );
          break;
          
        case 'email':
          // Implement email sending logic
          break;
      }
    } catch (error) {
      logger.error(`Error sending recovery message for cart ${cart._id}:`, error);
    }
  }

  generateRecoveryLink(cartId) {
    const baseUrl = process.env.FRONTEND_URL;
    const token = this.generateRecoveryToken(cartId);
    return `${baseUrl}/recover-cart/${cartId}?token=${token}`;
  }

  generateRecoveryToken(cartId) {
    // Implement secure token generation
    return 'recovery-token'; // Placeholder
  }

  async trackRecoveryAttemptResponse(cartId, attemptId, response) {
    try {
      const cart = await Cart.findById(cartId);
      if (!cart) return;

      await cart.updateRecoveryResponse(attemptId, response);

      // Update A/B test results
      if (response === 'converted') {
        await this.updateABTestResults(cart);
      }
    } catch (error) {
      logger.error(`Error tracking recovery attempt response for cart ${cartId}:`, error);
    }
  }

  async assignABTestVariant(testName, customerId) {
    const test = this.abTests.get(testName);
    if (!test || !test.active) return null;

    const cacheKey = `abtest:${testName}:${customerId}`;
    let variant = await redis.get(cacheKey);

    if (!variant) {
      variant = this.selectVariant(test.variants, test.distribution);
      await redis.set(cacheKey, variant);
    }

    return variant;
  }

  selectVariant(variants, distribution) {
    const random = Math.random();
    let cumulativeProbability = 0;

    for (let i = 0; i < variants.length; i++) {
      cumulativeProbability += distribution[i];
      if (random <= cumulativeProbability) {
        return variants[i];
      }
    }

    return variants[variants.length - 1];
  }

  async updateABTestResults(cart) {
    try {
      const testResults = new Map();

      for (const [testName, test] of this.abTests) {
        const variant = await this.assignABTestVariant(testName, cart.customer._id);
        if (variant) {
          const resultKey = `abtest:${testName}:${variant}:conversions`;
          await redis.incr(resultKey);
          
          const impressionKey = `abtest:${testName}:${variant}:impressions`;
          const conversions = await redis.get(resultKey);
          const impressions = await redis.get(impressionKey);
          
          if (impressions) {
            testResults.set(testName, {
              variant,
              conversionRate: (conversions / impressions) * 100
            });
          }
        }
      }

      return testResults;
    } catch (error) {
      logger.error('Error updating A/B test results:', error);
    }
  }

  async logAbandonment(cart) {
    try {
      await redis.incr('stats:abandonments:total');
      await redis.incrBy('stats:abandonments:value', Math.floor(cart.totalValue));
      
      const key = `stats:abandonments:${new Date().toISOString().split('T')[0]}`;
      await redis.incr(key);
    } catch (error) {
      logger.error('Error logging cart abandonment:', error);
    }
  }
}

export const cartRecoveryService = new CartRecoveryService();