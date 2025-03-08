import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Cart from '../models/Cart.js';
import { redis } from './redis.js';
import { logger } from '../utils/logger.js';

class AnalyticsService {
  constructor() {
    this.CACHE_TTL = 3600; // 1 hour
    this.REAL_TIME_WINDOW = 300; // 5 minutes
  }

  // Real-time sales tracking
  async trackSaleEvent(order) {
    try {
      const timestamp = Date.now();
      const eventData = {
        orderId: order._id.toString(),
        amount: order.total,
        customerId: order.customer.toString(),
        items: order.items.length,
        timestamp
      };

      // Store in Redis for real-time tracking
      await redis.zadd('sales:realtime', timestamp, JSON.stringify(eventData));
      await redis.zremrangebyscore('sales:realtime', 0, timestamp - (this.REAL_TIME_WINDOW * 1000));

      // Update daily stats
      const dateKey = new Date().toISOString().split('T')[0];
      await redis.hincrby(`sales:daily:${dateKey}`, 'count', 1);
      await redis.hincrby(`sales:daily:${dateKey}`, 'revenue', Math.floor(order.total));
      
      // Track customer segments
      if (order.customer) {
        const customer = await Customer.findById(order.customer);
        if (customer && customer.segments) {
          for (const segment of customer.segments) {
            await redis.hincrby(`sales:segments:${dateKey}`, segment, 1);
          }
        }
      }
    } catch (error) {
      logger.error('Error tracking sale event:', error);
    }
  }

  // Get real-time sales data
  async getRealTimeSales() {
    try {
      const endTime = Date.now();
      const startTime = endTime - (this.REAL_TIME_WINDOW * 1000);
      
      const events = await redis.zrangebyscore('sales:realtime', startTime, endTime);
      
      const stats = {
        totalSales: 0,
        totalRevenue: 0,
        salesPerMinute: 0,
        revenuePerMinute: 0,
        orders: []
      };

      events.forEach(event => {
        const data = JSON.parse(event);
        stats.totalSales++;
        stats.totalRevenue += data.amount;
        stats.orders.push(data);
      });

      stats.salesPerMinute = stats.totalSales / (this.REAL_TIME_WINDOW / 60);
      stats.revenuePerMinute = stats.totalRevenue / (this.REAL_TIME_WINDOW / 60);

      return stats;
    } catch (error) {
      logger.error('Error getting real-time sales:', error);
      throw error;
    }
  }

  // Revenue analytics
  async getRevenueAnalytics(startDate, endDate, groupBy = 'day') {
    try {
      const pipeline = [
        {
          $match: {
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
            status: { $in: ['delivered', 'completed'] }
          }
        },
        {
          $group: {
            _id: this.getGroupByExpression(groupBy),
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
            averageOrderValue: { $avg: '$total' }
          }
        },
        { $sort: { '_id': 1 } }
      ];

      const results = await Order.aggregate(pipeline);
      
      // Calculate growth rates
      const analytics = this.calculateGrowthRates(results);
      
      // Cache results
      const cacheKey = `analytics:revenue:${startDate}:${endDate}:${groupBy}`;
      await redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(analytics));

      return analytics;
    } catch (error) {
      logger.error('Error generating revenue analytics:', error);
      throw error;
    }
  }

  // Inventory analytics
  async getInventoryAnalytics() {
    try {
      const pipeline = [
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'productDetails'
          }
        },
        {
          $unwind: '$productDetails'
        },
        {
          $group: {
            _id: '$productDetails._id',
            productName: { $first: '$productDetails.name' },
            totalSold: { $sum: '$items.quantity' },
            totalRevenue: {
              $sum: { $multiply: ['$items.quantity', '$items.price'] }
            },
            currentStock: { $first: '$productDetails.stockLevel' }
          }
        }
      ];

      return await Order.aggregate(pipeline);
    } catch (error) {
      logger.error('Error generating inventory analytics:', error);
      throw error;
    }
  }

  // Customer analytics
  async getCustomerAnalytics() {
    try {
      const customerMetrics = await Customer.aggregate([
        {
          $group: {
            _id: null,
            totalCustomers: { $sum: 1 },
            averageLifetimeValue: { $avg: '$metrics.totalSpent' },
            segmentDistribution: {
              $push: '$segments'
            }
          }
        }
      ]);

      const orderMetrics = await Order.aggregate([
        {
          $group: {
            _id: '$customer',
            orderCount: { $sum: 1 },
            totalSpent: { $sum: '$total' }
          }
        },
        {
          $group: {
            _id: null,
            averageOrdersPerCustomer: { $avg: '$orderCount' },
            repeatPurchaseRate: {
              $avg: { $cond: [{ $gt: ['$orderCount', 1] }, 1, 0] }
            }
          }
        }
      ]);

      return {
        ...customerMetrics[0],
        ...orderMetrics[0]
      };
    } catch (error) {
      logger.error('Error generating customer analytics:', error);
      throw error;
    }
  }

  // Cart analytics
  async getCartAnalytics(startDate, endDate) {
    try {
      const abandonmentStats = await Cart.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$totalValue' }
          }
        }
      ]);

      const recoveryStats = await Cart.aggregate([
        {
          $match: {
            status: 'converted',
            'recoveryAttempts.0': { $exists: true }
          }
        },
        {
          $group: {
            _id: '$recoveryAttempts.type',
            successCount: { $sum: 1 },
            recoveredValue: { $sum: '$totalValue' }
          }
        }
      ]);

      return {
        abandonment: abandonmentStats,
        recovery: recoveryStats
      };
    } catch (error) {
      logger.error('Error generating cart analytics:', error);
      throw error;
    }
  }

  // Generate custom report
  async generateReport(options) {
    try {
      const {
        startDate,
        endDate,
        metrics,
        groupBy,
        format = 'json'
      } = options;

      const reportData = {};

      // Gather requested metrics
      for (const metric of metrics) {
        switch (metric) {
          case 'revenue':
            reportData.revenue = await this.getRevenueAnalytics(startDate, endDate, groupBy);
            break;
          case 'inventory':
            reportData.inventory = await this.getInventoryAnalytics();
            break;
          case 'customers':
            reportData.customers = await this.getCustomerAnalytics();
            break;
          case 'carts':
            reportData.carts = await this.getCartAnalytics(startDate, endDate);
            break;
        }
      }

      // Format report
      return this.formatReport(reportData, format);
    } catch (error) {
      logger.error('Error generating report:', error);
      throw error;
    }
  }

  // Helper methods
  getGroupByExpression(groupBy) {
    switch (groupBy) {
      case 'hour':
        return {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
          hour: { $hour: '$createdAt' }
        };
      case 'day':
        return {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
      case 'week':
        return {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
      case 'month':
        return {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
      default:
        return {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
    }
  }

  calculateGrowthRates(results) {
    return results.map((current, index) => {
      const previous = results[index - 1];
      let growthRate = 0;

      if (previous) {
        growthRate = ((current.revenue - previous.revenue) / previous.revenue) * 100;
      }

      return {
        ...current,
        growthRate
      };
    });
  }

  formatReport(data, format) {
    switch (format) {
      case 'csv':
        return this.convertToCSV(data);
      case 'pdf':
        return this.convertToPDF(data);
      default:
        return data;
    }
  }

  convertToCSV(data) {
    // Implement CSV conversion logic
    return 'csv-data';
  }

  convertToPDF(data) {
    // Implement PDF conversion logic
    return 'pdf-data';
  }
}

export const analyticsService = new AnalyticsService();