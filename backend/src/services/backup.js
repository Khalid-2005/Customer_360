import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { redis } from './redis.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

class BackupService {
  constructor() {
    this.backupPath = process.env.BACKUP_PATH || './backups';
    this.backupFrequency = parseInt(process.env.BACKUP_FREQUENCY) || 24 * 60 * 60 * 1000; // 24 hours
    this.maxBackups = parseInt(process.env.MAX_BACKUPS) || 7; // Keep last 7 backups
    this.compressionLevel = parseInt(process.env.BACKUP_COMPRESSION_LEVEL) || 9;
    this.backupTimer = null;
  }

  async initialize() {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupPath, { recursive: true });
      
      // Start backup schedule
      if (process.env.BACKUP_ENABLED === 'true') {
        this.scheduleBackups();
        logger.info('Backup service initialized successfully');
      } else {
        logger.info('Backup service is disabled');
      }
    } catch (error) {
      logger.error('Error initializing backup service:', error);
      throw error;
    }
  }

  scheduleBackups() {
    // Clear any existing schedule
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }

    // Schedule regular backups
    this.backupTimer = setInterval(async () => {
      try {
        await this.createBackup();
      } catch (error) {
        logger.error('Scheduled backup failed:', error);
      }
    }, this.backupFrequency);

    // Create initial backup
    this.createBackup().catch(error => {
      logger.error('Initial backup failed:', error);
    });
  }

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.backupPath, timestamp);

    try {
      // Create backup directory
      await fs.mkdir(backupDir, { recursive: true });

      // Backup MongoDB
      await this.backupMongoDB(backupDir);

      // Backup Redis
      await this.backupRedis(backupDir);

      // Backup uploaded files
      await this.backupFiles(backupDir);

      // Compress backup
      await this.compressBackup(backupDir, timestamp);

      // Clean up old backups
      await this.cleanupOldBackups();

      // Update backup status
      await this.updateBackupStatus(timestamp, true);

      logger.info(`Backup completed successfully: ${timestamp}`);
      return timestamp;
    } catch (error) {
      logger.error(`Backup failed for ${timestamp}:`, error);
      await this.updateBackupStatus(timestamp, false, error.message);
      throw error;
    }
  }

  async backupMongoDB(backupDir) {
    const dbName = new URL(process.env.MONGODB_URI).pathname.substring(1);
    const outputPath = path.join(backupDir, 'mongodb');
    
    try {
      await execAsync(`mongodump --uri="${process.env.MONGODB_URI}" --out="${outputPath}"`);
      logger.info('MongoDB backup completed');
    } catch (error) {
      logger.error('MongoDB backup failed:', error);
      throw new Error('MongoDB backup failed: ' + error.message);
    }
  }

  async backupRedis(backupDir) {
    try {
      // Trigger Redis SAVE command
      await redis.save();

      // Copy dump.rdb file
      const rdbPath = process.env.REDIS_RDB_PATH || '/var/lib/redis/dump.rdb';
      const backupPath = path.join(backupDir, 'redis', 'dump.rdb');
      
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(rdbPath, backupPath);
      
      logger.info('Redis backup completed');
    } catch (error) {
      logger.error('Redis backup failed:', error);
      throw new Error('Redis backup failed: ' + error.message);
    }
  }

  async backupFiles(backupDir) {
    try {
      const uploadsDir = process.env.UPLOADS_PATH || './uploads';
      const backupPath = path.join(backupDir, 'files');

      // Create backup directory
      await fs.mkdir(backupPath, { recursive: true });

      // Copy uploaded files
      await this.copyDirectory(uploadsDir, backupPath);
      
      logger.info('Files backup completed');
    } catch (error) {
      logger.error('Files backup failed:', error);
      throw new Error('Files backup failed: ' + error.message);
    }
  }

  async copyDirectory(source, destination) {
    try {
      const entries = await fs.readdir(source, { withFileTypes: true });

      await fs.mkdir(destination, { recursive: true });

      for (const entry of entries) {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(destination, entry.name);

        if (entry.isDirectory()) {
          await this.copyDirectory(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    } catch (error) {
      throw new Error(`Error copying directory: ${error.message}`);
    }
  }

  async compressBackup(backupDir, timestamp) {
    try {
      const outputFile = path.join(this.backupPath, `${timestamp}.tar.gz`);
      
      await execAsync(
        `tar -czf "${outputFile}" -C "${path.dirname(backupDir)}" "${path.basename(backupDir)}"`
      );

      // Remove uncompressed backup directory
      await fs.rm(backupDir, { recursive: true });
      
      logger.info('Backup compression completed');
    } catch (error) {
      logger.error('Backup compression failed:', error);
      throw new Error('Backup compression failed: ' + error.message);
    }
  }

  async cleanupOldBackups() {
    try {
      const backups = await fs.readdir(this.backupPath);
      
      // Sort backups by date (newest first)
      const sortedBackups = backups
        .filter(file => file.endsWith('.tar.gz'))
        .sort()
        .reverse();

      // Remove old backups
      if (sortedBackups.length > this.maxBackups) {
        const backupsToDelete = sortedBackups.slice(this.maxBackups);
        
        for (const backup of backupsToDelete) {
          const backupPath = path.join(this.backupPath, backup);
          await fs.unlink(backupPath);
          logger.info(`Deleted old backup: ${backup}`);
        }
      }
    } catch (error) {
      logger.error('Error cleaning up old backups:', error);
      throw error;
    }
  }

  async updateBackupStatus(timestamp, success, error = null) {
    try {
      const status = {
        timestamp,
        success,
        error,
        size: success ? await this.getBackupSize(timestamp) : 0
      };

      await redis.hset('backup:status', timestamp, JSON.stringify(status));
      await redis.set('backup:latest', timestamp);
      
      // Keep only last 30 days of status
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const allStatuses = await redis.hgetall('backup:status');
      for (const [key, value] of Object.entries(allStatuses)) {
        const backupDate = new Date(key.replace(/-/g, ':'));
        if (backupDate < thirtyDaysAgo) {
          await redis.hdel('backup:status', key);
        }
      }
    } catch (error) {
      logger.error('Error updating backup status:', error);
    }
  }

  async getBackupSize(timestamp) {
    try {
      const backupPath = path.join(this.backupPath, `${timestamp}.tar.gz`);
      const stats = await fs.stat(backupPath);
      return stats.size;
    } catch (error) {
      logger.error('Error getting backup size:', error);
      return 0;
    }
  }

  async restore(timestamp) {
    const backupFile = path.join(this.backupPath, `${timestamp}.tar.gz`);
    const restoreDir = path.join(this.backupPath, 'restore', timestamp);

    try {
      // Extract backup
      await fs.mkdir(restoreDir, { recursive: true });
      await execAsync(`tar -xzf "${backupFile}" -C "${restoreDir}"`);

      // Restore MongoDB
      await this.restoreMongoDB(path.join(restoreDir, timestamp, 'mongodb'));

      // Restore Redis
      await this.restoreRedis(path.join(restoreDir, timestamp, 'redis', 'dump.rdb'));

      // Restore files
      await this.restoreFiles(path.join(restoreDir, timestamp, 'files'));

      logger.info(`Restore completed successfully: ${timestamp}`);
    } catch (error) {
      logger.error(`Restore failed for ${timestamp}:`, error);
      throw error;
    } finally {
      // Cleanup restore directory
      await fs.rm(restoreDir, { recursive: true, force: true });
    }
  }

  async restoreMongoDB(backupPath) {
    try {
      await execAsync(`mongorestore --uri="${process.env.MONGODB_URI}" "${backupPath}"`);
      logger.info('MongoDB restore completed');
    } catch (error) {
      logger.error('MongoDB restore failed:', error);
      throw new Error('MongoDB restore failed: ' + error.message);
    }
  }

  async restoreRedis(backupPath) {
    try {
      // Stop Redis server
      await execAsync('redis-cli SHUTDOWN SAVE');

      // Replace dump.rdb file
      const rdbPath = process.env.REDIS_RDB_PATH || '/var/lib/redis/dump.rdb';
      await fs.copyFile(backupPath, rdbPath);

      // Start Redis server
      await execAsync('redis-server --daemonize yes');
      
      logger.info('Redis restore completed');
    } catch (error) {
      logger.error('Redis restore failed:', error);
      throw new Error('Redis restore failed: ' + error.message);
    }
  }

  async restoreFiles(backupPath) {
    try {
      const uploadsDir = process.env.UPLOADS_PATH || './uploads';
      await this.copyDirectory(backupPath, uploadsDir);
      logger.info('Files restore completed');
    } catch (error) {
      logger.error('Files restore failed:', error);
      throw new Error('Files restore failed: ' + error.message);
    }
  }

  async getBackupList() {
    try {
      const backups = await fs.readdir(this.backupPath);
      const backupList = [];

      for (const backup of backups) {
        if (backup.endsWith('.tar.gz')) {
          const timestamp = backup.replace('.tar.gz', '');
          const status = await redis.hget('backup:status', timestamp);
          const stats = await fs.stat(path.join(this.backupPath, backup));

          backupList.push({
            timestamp,
            size: stats.size,
            ...(status ? JSON.parse(status) : {})
          });
        }
      }

      return backupList.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch (error) {
      logger.error('Error getting backup list:', error);
      throw error;
    }
  }
}

export const backupService = new BackupService();