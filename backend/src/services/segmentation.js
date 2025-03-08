import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import { redis } from './redis.js';
import { logger } from '../utils/logger.js';

class SegmentationEngine {
  constructor() {
    this.segmentationRules = new Map();
    this.CACHE_TTL = 3600; // 1 hour
    this.initializeDefaultRules();
  }

  initializeDefaultRules() {
    // Purchase frequency based segmentation
    this.addRule('purchase_frequency', async (customer) => {
      const orders = await Order.find({ customer: customer._id });
      if (orders.length === 0) return ['new_customer'];

      const firstOrder = orders[0];
      const lastOrder = orders[orders.length - 1];
      const daysSinceFirstPurchase = Math.floor(
        (Date.now() - firstOrder.createdAt) / (1000 * 60 * 60 * 24)
      );
      const purchaseFrequency = orders.length / daysSinceFirstPurchase;

      if (purchaseFrequency >= 0.5) return ['frequent_buyer'];
      if (purchaseFrequency >= 0.2) return ['regular_customer'];
      return ['occasional_buyer'];
    });

    // Spending based segmentation
    this.addRule('spending_level', async (customer) => {
      const totalSpent = customer.metrics.totalSpent;

      if (totalSpent >= 10000) return ['high_value'];
      if (totalSpent >= 5000) return ['medium_value'];
      return ['low_value'];
    });

    // Engagement based segmentation
    this.addRule('engagement_level', async (customer) => {
      const messageCount = await this.getCustomerMessageCount(customer._id);
      const tags = [];

      if (messageCount > 50) tags.push('highly_engaged');
      else if (messageCount > 20) tags.push('engaged');
      else tags.push('low_engagement');

      if (customer.contactPreferences.whatsapp) tags.push('whatsapp_enabled');
      
      return tags;
    });

    // Recency based segmentation
    this.addRule('purchase_recency', async (customer) => {
      if (!customer.metrics.lastPurchaseDate) return ['never_purchased'];

      const daysSinceLastPurchase = Math.floor(
        (Date.now() - new Date(customer.metrics.lastPurchaseDate)) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastPurchase <= 30) return ['active'];
      if (daysSinceLastPurchase <= 90) return ['at_risk'];
      return ['inactive'];
    });
  }

  addRule(name, ruleFn) {
    this.segmentationRules.set(name, ruleFn);
  }

  async getCustomerMessageCount(customerId) {
    const cacheKey = `customer:${customerId}:messageCount`;
    const cachedCount = await redis.get(cacheKey);

    if (cachedCount) return parseInt(cachedCount);

    const count = await mongoose.model('Message').countDocuments({
      customer: customerId
    });

    await redis.setex(cacheKey, this.CACHE_TTL, count.toString());
    return count;
  }

  async segmentCustomer(customer) {
    try {
      const cacheKey = `customer:${customer._id}:segments`;
      const cachedSegments = await redis.get(cacheKey);

      if (cachedSegments) {
        return JSON.parse(cachedSegments);
      }

      const segments = new Set();

      // Apply each segmentation rule
      for (const [ruleName, ruleFn] of this.segmentationRules) {
        const ruleSegments = await ruleFn(customer);
        ruleSegments.forEach(segment => segments.add(segment));
      }

      // Add custom segments based on customer attributes
      if (customer.type === 'business') {
        segments.add('business_account');
      }

      if (customer.loyalty.tier) {
        segments.add(`loyalty_${customer.loyalty.tier}`);
      }

      // Convert Set to Array
      const segmentArray = Array.from(segments);

      // Cache the results
      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(segmentArray));

      return segmentArray;
    } catch (error) {
      logger.error('Error in customer segmentation:', error);
      throw error;
    }
  }

  async updateCustomerSegments(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const segments = await this.segmentCustomer(customer);
      customer.segments = segments;
      await customer.save();

      // Clear cache
      await redis.del(`customer:${customerId}:segments`);

      return segments;
    } catch (error) {
      logger.error(`Error updating segments for customer ${customerId}:`, error);
      throw error;
    }
  }

  async analyzeCustomerBehavior(customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const orders = await Order.find({ customer: customerId })
        .sort({ createdAt: -1 })
        .limit(100);

      const behavior = {
        purchasePatterns: await this.analyzePurchasePatterns(orders),
        productPreferences: await this.analyzeProductPreferences(orders),
        engagementMetrics: await this.analyzeEngagement(customerId),
        seasonality: await this.analyzeSeasonality(orders)
      };

      // Cache behavior analysis
      await redis.setex(
        `customer:${customerId}:behavior`,
        this.CACHE_TTL,
        JSON.stringify(behavior)
      );

      return behavior;
    } catch (error) {
      logger.error(`Error analyzing behavior for customer ${customerId}:`, error);
      throw error;
    }
  }

  async analyzePurchasePatterns(orders) {
    const patterns = {
      averageOrderValue: 0,
      preferredPaymentMethods: new Map(),
      preferredDaysOfWeek: new Map(),
      timeBetweenPurchases: []
    };

    if (orders.length === 0) return patterns;

    // Calculate metrics
    let totalValue = 0;
    orders.forEach((order, index) => {
      totalValue += order.total;
      
      // Payment methods
      const method = order.payment.method;
      patterns.preferredPaymentMethods.set(
        method,
        (patterns.preferredPaymentMethods.get(method) || 0) + 1
      );

      // Days of week
      const dayOfWeek = order.createdAt.getDay();
      patterns.preferredDaysOfWeek.set(
        dayOfWeek,
        (patterns.preferredDaysOfWeek.get(dayOfWeek) || 0) + 1
      );

      // Time between purchases
      if (index < orders.length - 1) {
        const timeDiff = order.createdAt - orders[index + 1].createdAt;
        patterns.timeBetweenPurchases.push(timeDiff / (1000 * 60 * 60 * 24));
      }
    });

    patterns.averageOrderValue = totalValue / orders.length;

    return patterns;
  }

  async analyzeProductPreferences(orders) {
    const preferences = {
      categories: new Map(),
      brands: new Map(),
      priceRanges: new Map()
    };

    orders.forEach(order => {
      order.items.forEach(item => {
        // Categories
        item.product.categories?.forEach(category => {
          preferences.categories.set(
            category,
            (preferences.categories.get(category) || 0) + 1
          );
        });

        // Brands
        const brand = item.product.brand;
        if (brand) {
          preferences.brands.set(
            brand,
            (preferences.brands.get(brand) || 0) + 1
          );
        }

        // Price ranges
        const priceRange = this.getPriceRange(item.price);
        preferences.priceRanges.set(
          priceRange,
          (preferences.priceRanges.get(priceRange) || 0) + 1
        );
      });
    });

    return preferences;
  }

  async analyzeEngagement(customerId) {
    const messages = await mongoose.model('Message').find({
      customer: customerId
    }).sort({ createdAt: -1 });

    const engagement = {
      messageCount: messages.length,
      responseRate: 0,
      averageResponseTime: 0,
      channelPreferences: new Map()
    };

    messages.forEach(message => {
      engagement.channelPreferences.set(
        message.channel,
        (engagement.channelPreferences.get(message.channel) || 0) + 1
      );
    });

    return engagement;
  }

  async analyzeSeasonality(orders) {
    const seasonality = {
      monthlyDistribution: new Map(),
      quarterlyDistribution: new Map()
    };

    orders.forEach(order => {
      const month = order.createdAt.getMonth();
      const quarter = Math.floor(month / 3);

      seasonality.monthlyDistribution.set(
        month,
        (seasonality.monthlyDistribution.get(month) || 0) + 1
      );

      seasonality.quarterlyDistribution.set(
        quarter,
        (seasonality.quarterlyDistribution.get(quarter) || 0) + 1
      );
    });

    return seasonality;
  }

  getPriceRange(price) {
    if (price <= 50) return 'budget';
    if (price <= 200) return 'mid_range';
    return 'premium';
  }
}

export const segmentationEngine = new SegmentationEngine();