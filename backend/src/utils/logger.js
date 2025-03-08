import winston from 'winston';
import path from 'path';

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

winston.addColors(logColors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

const prodTransports = [
  new winston.transports.File({ 
    filename: path.join('logs', 'error.log'), 
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5
  }),
  new winston.transports.File({ 
    filename: path.join('logs', 'combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5
  })
];

const devTransports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    )
  })
];

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  levels: logLevels,
  format,
  transports: process.env.NODE_ENV === 'production' 
    ? prodTransports 
    : devTransports
});

// Create a stream object for Morgan HTTP request logging
export const stream = {
  write: (message) => logger.http(message.trim())
};

// Utility function to log errors with stack traces
export const logError = (error, context = '') => {
  const errorMessage = error.stack || error.message;
  logger.error(`${context ? context + ': ' : ''}${errorMessage}`);
};

// Utility function to log API requests
export const logAPIRequest = (req, message) => {
  logger.http(`[${req.method}] ${req.originalUrl} - ${message}`);
};

// Monitor unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Monitor uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});