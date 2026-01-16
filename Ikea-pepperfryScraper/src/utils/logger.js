const winston = require('winston');
const path = require('path');

/**
 * Winston logger configuration for the scraper
 */
class Logger {
  constructor() {
    this.logger = this.createLogger();
  }

  /**
   * Create winston logger instance
   * @returns {winston.Logger} - Configured logger
   */
  createLogger() {
    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');

    const logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
      ),
      transports: [
        // Console output
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),

        // File output for all logs
        new winston.transports.File({
          filename: path.join(logsDir, 'scraper.log'),
          level: 'info',
          maxsize: 5242880, // 5MB
          maxFiles: 5
        }),

        // File output for errors only
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 3
        })
      ]
    });

    return logger;
  }

  /**
   * Log info message
   * @param {string} message - Message to log
   * @param {Object} meta - Additional metadata
   */
  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  /**
   * Log error message
   * @param {string} message - Error message
   * @param {Error|Object} error - Error object or additional data
   */
  error(message, error = {}) {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: error.message,
        stack: error.stack,
        name: error.name
      });
    } else {
      this.logger.error(message, error);
    }
  }

  /**
   * Log warning message
   * @param {string} message - Warning message
   * @param {Object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  /**
   * Log debug message
   * @param {string} message - Debug message
   * @param {Object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  /**
   * Log scraping start
   * @param {Object} config - Scraping configuration
   */
  logScrapingStart(config) {
    this.info('=== Starting Price Comparison Scraper ===', {
      totalQueries: config.totalQueries,
      sitesEnabled: config.sitesEnabled,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log scraping completion
   * @param {Object} results - Scraping results
   */
  logScrapingComplete(results) {
    this.info('=== Scraping Complete ===', {
      duration: results.duration,
      totalResults: results.totalResults,
      successfulQueries: results.successfulQueries,
      failedQueries: results.failedQueries,
      sitesStatus: results.sitesStatus
    });
  }

  /**
   * Log individual query processing
   * @param {string} query - Search query
   * @param {Object} results - Results for this query
   */
  logQueryProcessing(query, results) {
    this.info(`Processing query: "${query}"`, {
      resultsCount: results.resultsCount,
      sitesFound: results.sitesFound,
      processingTime: results.processingTime
    });
  }

  /**
   * Log site-specific results
   * @param {string} site - Site name
   * @param {Object} results - Site scraping results
   */
  logSiteResults(site, results) {
    if (results.success) {
      this.info(`${site} scraping successful`, {
        productsFound: results.productsFound,
        duration: results.duration
      });
    } else {
      this.error(`${site} scraping failed`, results.error);
    }
  }

  /**
   * Log rate limiting activity
   * @param {string} site - Site being rate limited
   * @param {number} delay - Delay in milliseconds
   */
  logRateLimit(site, delay) {
    this.debug(`Rate limiting ${site}`, { delay });
  }

  /**
   * Log product filtering
   * @param {Object} filterStats - Filtering statistics
   */
  logProductFiltering(filterStats) {
    this.info('Product filtering applied', {
      initialCount: filterStats.initialCount,
      finalCount: filterStats.finalCount,
      filters: filterStats.filters
    });
  }

  /**
   * Create child logger with additional context
   * @param {Object} defaultMeta - Default metadata for child logger
   * @returns {winston.Logger} - Child logger instance
   */
  child(defaultMeta) {
    return this.logger.child(defaultMeta);
  }
}

// Export singleton instance
module.exports = new Logger();