import { backupService } from '../services/backup.js';
import { APIError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export const backupController = {
  // Get list of backups
  async getBackups(req, res, next) {
    try {
      const backups = await backupService.getBackupList();
      
      res.status(200).json({
        success: true,
        data: backups
      });
    } catch (error) {
      next(error);
    }
  },

  // Create new backup (manual trigger)
  async createBackup(req, res, next) {
    try {
      const timestamp = await backupService.createBackup();
      
      res.status(200).json({
        success: true,
        message: 'Backup initiated successfully',
        data: { timestamp }
      });
    } catch (error) {
      next(error);
    }
  },

  // Restore from backup
  async restoreBackup(req, res, next) {
    try {
      const { timestamp } = req.params;
      
      if (!timestamp) {
        throw new APIError('Backup timestamp is required', 400);
      }

      // Validate backup exists
      const backups = await backupService.getBackupList();
      const backupExists = backups.some(backup => backup.timestamp === timestamp);
      
      if (!backupExists) {
        throw new APIError('Backup not found', 404);
      }

      // Confirm restore was explicitly requested
      const { confirm } = req.body;
      if (!confirm) {
        throw new APIError(
          'Restore operation must be explicitly confirmed',
          400
        );
      }

      // Log restore attempt
      logger.warn(`Backup restore initiated for timestamp: ${timestamp}`);

      // Perform restore
      await backupService.restore(timestamp);

      res.status(200).json({
        success: true,
        message: 'Backup restored successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Get backup status
  async getBackupStatus(req, res, next) {
    try {
      const { timestamp } = req.params;
      
      if (!timestamp) {
        throw new APIError('Backup timestamp is required', 400);
      }

      const backups = await backupService.getBackupList();
      const backup = backups.find(b => b.timestamp === timestamp);

      if (!backup) {
        throw new APIError('Backup not found', 404);
      }

      res.status(200).json({
        success: true,
        data: backup
      });
    } catch (error) {
      next(error);
    }
  },

  // Get backup configuration
  async getBackupConfig(req, res, next) {
    try {
      const config = {
        enabled: process.env.BACKUP_ENABLED === 'true',
        frequency: parseInt(process.env.BACKUP_FREQUENCY) || 24 * 60 * 60 * 1000,
        maxBackups: parseInt(process.env.MAX_BACKUPS) || 7,
        compressionLevel: parseInt(process.env.BACKUP_COMPRESSION_LEVEL) || 9,
        path: process.env.BACKUP_PATH || './backups'
      };

      res.status(200).json({
        success: true,
        data: config
      });
    } catch (error) {
      next(error);
    }
  },

  // Update backup configuration
  async updateBackupConfig(req, res, next) {
    try {
      const {
        enabled,
        frequency,
        maxBackups,
        compressionLevel
      } = req.body;

      // Validate configuration
      if (frequency && (frequency < 3600000 || frequency > 86400000)) {
        throw new APIError('Backup frequency must be between 1 hour and 24 hours', 400);
      }

      if (maxBackups && (maxBackups < 1 || maxBackups > 30)) {
        throw new APIError('Max backups must be between 1 and 30', 400);
      }

      if (compressionLevel && (compressionLevel < 1 || compressionLevel > 9)) {
        throw new APIError('Compression level must be between 1 and 9', 400);
      }

      // Update environment variables
      if (typeof enabled === 'boolean') {
        process.env.BACKUP_ENABLED = enabled.toString();
      }
      if (frequency) {
        process.env.BACKUP_FREQUENCY = frequency.toString();
      }
      if (maxBackups) {
        process.env.MAX_BACKUPS = maxBackups.toString();
      }
      if (compressionLevel) {
        process.env.BACKUP_COMPRESSION_LEVEL = compressionLevel.toString();
      }

      // Reinitialize backup service with new configuration
      await backupService.initialize();

      res.status(200).json({
        success: true,
        message: 'Backup configuration updated successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete backup
  async deleteBackup(req, res, next) {
    try {
      const { timestamp } = req.params;
      
      if (!timestamp) {
        throw new APIError('Backup timestamp is required', 400);
      }

      // Validate backup exists
      const backups = await backupService.getBackupList();
      const backup = backups.find(b => b.timestamp === timestamp);
      
      if (!backup) {
        throw new APIError('Backup not found', 404);
      }

      // Prevent deletion of latest backup
      const latestBackup = backups[0];
      if (latestBackup.timestamp === timestamp) {
        throw new APIError('Cannot delete the most recent backup', 400);
      }

      // Delete backup file and status
      await backupService.deleteBackup(timestamp);

      res.status(200).json({
        success: true,
        message: 'Backup deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
};