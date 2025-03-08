import express from 'express';
import { backupController } from '../controllers/backupController.js';
import { 
  authenticate, 
  authorize, 
  requirePermissions 
} from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting configuration
const backupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 requests per hour
  message: 'Too many backup operations requested, please try again later'
});

// Middleware to ensure admin access
const ensureAdmin = [
  authenticate,
  authorize('admin'),
  requirePermissions('manage_backups')
];

// Get list of backups
router.get('/',
  ensureAdmin,
  backupController.getBackups
);

// Get backup configuration
router.get('/config',
  ensureAdmin,
  backupController.getBackupConfig
);

// Update backup configuration
router.put('/config',
  ensureAdmin,
  backupRateLimit,
  validateBackupConfig,
  backupController.updateBackupConfig
);

// Get specific backup status
router.get('/:timestamp',
  ensureAdmin,
  backupController.getBackupStatus
);

// Create new backup (manual trigger)
router.post('/create',
  ensureAdmin,
  backupRateLimit,
  backupController.createBackup
);

// Restore from backup
router.post('/restore/:timestamp',
  ensureAdmin,
  backupRateLimit,
  validateRestoreOperation,
  backupController.restoreBackup
);

// Delete backup
router.delete('/:timestamp',
  ensureAdmin,
  backupRateLimit,
  validateDeleteOperation,
  backupController.deleteBackup
);

// Validation middleware
function validateBackupConfig(req, res, next) {
  const { enabled, frequency, maxBackups, compressionLevel } = req.body;

  const errors = [];

  if (typeof enabled !== 'undefined' && typeof enabled !== 'boolean') {
    errors.push('Enabled must be a boolean value');
  }

  if (frequency && (
    typeof frequency !== 'number' ||
    frequency < 3600000 || // 1 hour
    frequency > 86400000 // 24 hours
  )) {
    errors.push('Frequency must be between 1 hour and 24 hours');
  }

  if (maxBackups && (
    typeof maxBackups !== 'number' ||
    maxBackups < 1 ||
    maxBackups > 30
  )) {
    errors.push('Max backups must be between 1 and 30');
  }

  if (compressionLevel && (
    typeof compressionLevel !== 'number' ||
    compressionLevel < 1 ||
    compressionLevel > 9
  )) {
    errors.push('Compression level must be between 1 and 9');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid configuration',
      details: errors
    });
  }

  next();
}

function validateRestoreOperation(req, res, next) {
  const { confirm } = req.body;

  if (!confirm) {
    return res.status(400).json({
      success: false,
      error: 'Restore operation must be explicitly confirmed',
      details: 'Set confirm: true in request body to proceed with restore'
    });
  }

  // Add confirmation code requirement for extra security
  const { confirmationCode } = req.body;
  if (!confirmationCode || confirmationCode !== process.env.BACKUP_RESTORE_CODE) {
    return res.status(400).json({
      success: false,
      error: 'Invalid confirmation code'
    });
  }

  next();
}

function validateDeleteOperation(req, res, next) {
  const { confirm } = req.body;

  if (!confirm) {
    return res.status(400).json({
      success: false,
      error: 'Delete operation must be explicitly confirmed',
      details: 'Set confirm: true in request body to proceed with deletion'
    });
  }

  next();
}

export default router;