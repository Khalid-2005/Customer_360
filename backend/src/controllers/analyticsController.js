import { analyticsService } from '../services/analytics.js';
import { APIError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export const analyticsController = {
  // Get real-time sales dashboard data
  async getRealTimeSales(req, res, next) {
    try {
      const data = await analyticsService.getRealTimeSales();
      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  // Get revenue analytics
  async getRevenueAnalytics(req, res, next) {
    try {
      const { startDate, endDate, groupBy } = req.query;
      
      if (!startDate || !endDate) {
        throw new APIError('Start date and end date are required', 400);
      }

      const data = await analyticsService.getRevenueAnalytics(
        startDate,
        endDate,
        groupBy
      );

      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  // Get inventory analytics
  async getInventoryAnalytics(req, res, next) {
    try {
      const data = await analyticsService.getInventoryAnalytics();
      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  // Get customer analytics
  async getCustomerAnalytics(req, res, next) {
    try {
      const data = await analyticsService.getCustomerAnalytics();
      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  // Get cart analytics
  async getCartAnalytics(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        throw new APIError('Start date and end date are required', 400);
      }

      const data = await analyticsService.getCartAnalytics(startDate, endDate);
      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  // Generate custom report
  async generateReport(req, res, next) {
    try {
      const {
        startDate,
        endDate,
        metrics,
        groupBy,
        format
      } = req.body;

      if (!startDate || !endDate || !metrics || !metrics.length) {
        throw new APIError('Invalid report parameters', 400);
      }

      const report = await analyticsService.generateReport({
        startDate,
        endDate,
        metrics,
        groupBy,
        format
      });

      // Handle different format responses
      switch (format) {
        case 'csv':
          res.header('Content-Type', 'text/csv');
          res.attachment(`report-${startDate}-${endDate}.csv`);
          res.send(report);
          break;

        case 'pdf':
          res.header('Content-Type', 'application/pdf');
          res.attachment(`report-${startDate}-${endDate}.pdf`);
          res.send(report);
          break;

        default:
          res.status(200).json({
            success: true,
            data: report
          });
      }
    } catch (error) {
      next(error);
    }
  },

  // Get dashboard summary
  async getDashboardSummary(req, res, next) {
    try {
      // Get today's date range
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      // Fetch all required metrics
      const [
        realTimeSales,
        todayRevenue,
        customerStats,
        cartStats
      ] = await Promise.all([
        analyticsService.getRealTimeSales(),
        analyticsService.getRevenueAnalytics(startOfDay, endOfDay, 'hour'),
        analyticsService.getCustomerAnalytics(),
        analyticsService.getCartAnalytics(startOfDay, endOfDay)
      ]);

      res.status(200).json({
        success: true,
        data: {
          realTime: {
            currentSales: realTimeSales.totalSales,
            currentRevenue: realTimeSales.totalRevenue,
            salesPerMinute: realTimeSales.salesPerMinute
          },
          today: {
            revenue: todayRevenue.reduce((sum, hour) => sum + hour.revenue, 0),
            orders: todayRevenue.reduce((sum, hour) => sum + hour.orders, 0),
            averageOrderValue: todayRevenue.reduce((sum, hour) => sum + hour.averageOrderValue, 0) / todayRevenue.length
          },
          customers: {
            totalCustomers: customerStats.totalCustomers,
            averageLifetimeValue: customerStats.averageLifetimeValue,
            repeatPurchaseRate: customerStats.repeatPurchaseRate
          },
          carts: {
            abandoned: cartStats.abandonment.find(s => s._id === 'abandoned')?.count || 0,
            recovered: cartStats.recovery.reduce((sum, r) => sum + r.successCount, 0)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // Export data
  async exportData(req, res, next) {
    try {
      const { type, format, filters } = req.body;
      let data;

      switch (type) {
        case 'revenue':
          data = await analyticsService.getRevenueAnalytics(
            filters.startDate,
            filters.endDate,
            filters.groupBy
          );
          break;
        case 'customers':
          data = await analyticsService.getCustomerAnalytics();
          break;
        case 'inventory':
          data = await analyticsService.getInventoryAnalytics();
          break;
        case 'carts':
          data = await analyticsService.getCartAnalytics(
            filters.startDate,
            filters.endDate
          );
          break;
        default:
          throw new APIError('Invalid export type', 400);
      }

      if (format === 'csv') {
        const csv = await analyticsService.formatReport(data, 'csv');
        res.header('Content-Type', 'text/csv');
        res.attachment(`${type}-export-${new Date().toISOString()}.csv`);
        res.send(csv);
      } else {
        res.status(200).json({
          success: true,
          data
        });
      }
    } catch (error) {
      next(error);
    }
  }
};