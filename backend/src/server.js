import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { configureRoutes } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { whatsappService } from './services/whatsapp.js';
import { segmentationEngine } from './services/segmentation.js';
import { backupService } from './services/backup.js';
import { analyticsService } from './services/analytics.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const httpServer = createServer(app);

// Configure Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL 
      : 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io available globally
global.io = io;

// Basic rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(limiter);

// API Documentation at root
app.get('/', (req, res) => {
  res.redirect('/api/docs');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Configure API routes
configureRoutes(app);

// Handle 404 errors
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// WebSocket event handlers
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });

  // Handle real-time analytics subscription
  socket.on('subscribe:analytics', async () => {
    socket.join('analytics');
    const realTimeData = await analyticsService.getRealTimeSales();
    socket.emit('analytics:update', realTimeData);
  });

  // Handle customer events subscription
  socket.on('subscribe:customer', (customerId) => {
    socket.join(`customer:${customerId}`);
  });
});

// Initialize services
const initializeServices = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    logger.info('Connected to MongoDB');

    // Initialize WhatsApp service
    await whatsappService.initialize();
    logger.info('WhatsApp service initialized');

    // Initialize backup service
    if (process.env.BACKUP_ENABLED === 'true') {
      await backupService.initialize();
      logger.info('Backup service initialized');
    }

    // Initialize segmentation engine
    await segmentationEngine.initialize();
    logger.info('Segmentation engine initialized');

    // Start real-time analytics updates
    setInterval(async () => {
      const realTimeData = await analyticsService.getRealTimeSales();
      io.to('analytics').emit('analytics:update', realTimeData);
    }, 5000); // Update every 5 seconds

  } catch (error) {
    logger.error('Error initializing services:', error);
    process.exit(1);
  }
};

// Handle server shutdown
const gracefulShutdown = async () => {
  logger.info('Received shutdown signal, starting graceful shutdown...');

  try {
    // Close WebSocket connections
    io.close();
    logger.info('Closed WebSocket connections');

    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('Closed MongoDB connection');

    // Cleanup WhatsApp service
    await whatsappService.cleanup();
    logger.info('WhatsApp service cleaned up');

    // Perform final backup if enabled
    if (process.env.BACKUP_ENABLED === 'true') {
      await backupService.createBackup();
      logger.info('Final backup created');
    }

    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await initializeServices();
    
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Export for testing
export default app;