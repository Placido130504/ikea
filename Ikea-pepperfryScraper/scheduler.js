require('dotenv').config();
const cron = require('node-cron');
const { PriceComparisonApp } = require('./src/index');
const logger = require('./src/utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Automated scheduler for price comparison scraper
 */
class ScraperScheduler {
  constructor() {
    this.app = new PriceComparisonApp();
    this.schedules = new Map();
    this.isRunning = false;
    this.config = null;
  }

  /**
   * Initialize the scheduler
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info('=== Initializing Price Comparison Scheduler ===');

      // Load schedule configuration
      await this.loadScheduleConfig();

      // Initialize the main app
      await this.app.initialize();

      logger.info('Scheduler initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize scheduler', error);
      throw error;
    }
  }

  /**
   * Load schedule configuration
   * @returns {Promise<void>}
   */
  async loadScheduleConfig() {
    try {
      const configPath = './src/config/schedule.json';
      const configData = await fs.readFile(configPath, 'utf8');
      this.config = JSON.parse(configData);

      logger.info('Schedule configuration loaded successfully');

    } catch (error) {
      logger.error('Failed to load schedule configuration', error);
      throw new Error(`Schedule configuration loading failed: ${error.message}`);
    }
  }

  /**
   * Start all enabled schedules
   * @returns {Promise<void>}
   */
  async start() {
    try {
      if (!this.config.enabled) {
        logger.info('Scheduler is disabled in configuration');
        return;
      }

      logger.info('Starting scheduler...');

      // Start the default schedule if enabled
      if (this.config.cronExpression) {
        this.addSchedule('default', this.config.cronExpression, 'Default schedule');
      }

      // Start additional schedules if configured
      if (this.config.schedules && Array.isArray(this.config.schedules)) {
        for (const schedule of this.config.schedules) {
          if (schedule.enabled) {
            this.addSchedule(schedule.name, schedule.cron, schedule.description);
          }
        }
      }

      logger.info(`Scheduler started with ${this.schedules.size} active schedules`);

      // Set up maintenance tasks
      this.setupMaintenanceTasks();

      // Handle graceful shutdown
      this.setupShutdownHandlers();

    } catch (error) {
      logger.error('Failed to start scheduler', error);
      throw error;
    }
  }

  /**
   * Add a new schedule
   * @param {string} name - Schedule name
   * @param {string} cronExpression - Cron expression
   * @param {string} description - Schedule description
   */
  addSchedule(name, cronExpression, description = '') {
    try {
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }

      // Stop existing schedule with same name
      if (this.schedules.has(name)) {
        this.schedules.get(name).task.stop();
        this.schedules.delete(name);
        logger.info(`Stopped existing schedule: ${name}`);
      }

      // Create new task
      const task = cron.schedule(cronExpression, () => {
        this.executeScheduledRun(name, description);
      }, {
        scheduled: false,
        timezone: this.config.timezone || 'Asia/Kolkata'
      });

      // Store schedule information
      this.schedules.set(name, {
        task,
        cronExpression,
        description,
        createdAt: new Date(),
        lastRun: null,
        runCount: 0,
        successCount: 0,
        failureCount: 0
      });

      // Start the task
      task.start();

      logger.info(`Schedule added: ${name} (${cronExpression}) - ${description}`);

    } catch (error) {
      logger.error(`Failed to add schedule ${name}`, error);
      throw error;
    }
  }

  /**
   * Execute a scheduled run
   * @param {string} scheduleName - Name of the schedule
   * @param {string} description - Schedule description
   */
  async executeScheduledRun(scheduleName, description) {
    if (this.isRunning) {
      logger.warn(`Scheduled run for ${scheduleName} skipped - another run is in progress`);
      return;
    }

    const startTime = Date.now();
    this.isRunning = true;

    try {
      logger.info(`🚀 Starting scheduled run: ${scheduleName} - ${description}`);

      // Update schedule statistics
      const schedule = this.schedules.get(scheduleName);
      if (schedule) {
        schedule.lastRun = new Date();
        schedule.runCount++;
      }

      // Run the price comparison scraper
      const results = await this.app.run(
        './data/input.json',
        `./data/scheduled_output_${Date.now()}.json`
      );

      // Update success statistics
      if (schedule) {
        schedule.successCount++;
      }

      // Send notifications if configured
      await this.sendNotifications(scheduleName, results);

      const duration = Date.now() - startTime;
      logger.info(`✅ Scheduled run completed: ${scheduleName} in ${Math.round(duration / 1000)}s`);

    } catch (error) {
      // Update failure statistics
      const schedule = this.schedules.get(scheduleName);
      if (schedule) {
        schedule.failureCount++;
      }

      logger.error(`❌ Scheduled run failed: ${scheduleName}`, error);

      // Send error notifications
      await this.sendErrorNotifications(scheduleName, error);

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Send notifications for successful runs
   * @param {string} scheduleName - Schedule name
   * @param {Object} results - Scraping results
   */
  async sendNotifications(scheduleName, results) {
    try {
      if (!this.config.notifications) return;

      // Send email notification
      if (this.config.notifications.email?.enabled) {
        await this.sendEmailNotification(scheduleName, results, false);
      }

      // Send webhook notification
      if (this.config.notifications.webhook?.enabled) {
        await this.sendWebhookNotification(scheduleName, results);
      }

    } catch (error) {
      logger.error('Failed to send notifications', error);
    }
  }

  /**
   * Send error notifications
   * @param {string} scheduleName - Schedule name
   * @param {Error} error - Error object
   */
  async sendErrorNotifications(scheduleName, error) {
    try {
      if (!this.config.notifications) return;

      // Send email notification for errors
      if (this.config.notifications.email?.enabled) {
        await this.sendEmailNotification(scheduleName, error, true);
      }

      // Send webhook notification for errors
      if (this.config.notifications.webhook?.enabled) {
        await this.sendWebhookErrorNotification(scheduleName, error);
      }

    } catch (notificationError) {
      logger.error('Failed to send error notifications', notificationError);
    }
  }

  /**
   * Send email notification
   * @param {string} scheduleName - Schedule name
   * @param {Object|Error} data - Results or error
   * @param {boolean} isError - Whether this is an error notification
   */
  async sendEmailNotification(scheduleName, data, isError = false) {
    // Email notification implementation would go here
    // This is a placeholder that would need to be implemented with a proper email service
    logger.info(`Email notification would be sent for ${scheduleName} (Error: ${isError})`);
  }

  /**
   * Send webhook notification
   * @param {string} scheduleName - Schedule name
   * @param {Object} results - Scraping results
   */
  async sendWebhookNotification(scheduleName, results) {
    // Webhook notification implementation would go here
    logger.info(`Webhook notification would be sent for ${scheduleName}`);
  }

  /**
   * Send webhook error notification
   * @param {string} scheduleName - Schedule name
   * @param {Error} error - Error object
   */
  async sendWebhookErrorNotification(scheduleName, error) {
    // Webhook error notification implementation would go here
    logger.info(`Webhook error notification would be sent for ${scheduleName}`);
  }

  /**
   * Setup maintenance tasks
   */
  setupMaintenanceTasks() {
    if (!this.config.maintenance) return;

    // Log cleanup task (runs daily at 3 AM)
    if (this.config.maintenance.cleanupLogs) {
      cron.schedule('0 3 * * *', async () => {
        await this.cleanupLogs();
      }, {
        scheduled: true,
        timezone: this.config.timezone || 'Asia/Kolkata'
      });
      logger.info('Log cleanup maintenance task scheduled');
    }

    // Backup cleanup task (runs weekly on Sunday at 4 AM)
    if (this.config.maintenance.cleanupBackups) {
      cron.schedule('0 4 * * 0', async () => {
        await this.cleanupBackups();
      }, {
        scheduled: true,
        timezone: this.config.timezone || 'Asia/Kolkata'
      });
      logger.info('Backup cleanup maintenance task scheduled');
    }
  }

  /**
   * Cleanup old log files
   */
  async cleanupLogs() {
    try {
      const logsDir = './logs';
      const retentionDays = this.config.maintenance.logRetentionDays || 30;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Implementation for log cleanup would go here
      logger.info(`Log cleanup: would remove files older than ${retentionDays} days`);

    } catch (error) {
      logger.error('Log cleanup failed', error);
    }
  }

  /**
   * Cleanup old backup files
   */
  async cleanupBackups() {
    try {
      const dataDir = './data';
      const retentionDays = this.config.maintenance.backupRetentionDays || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Implementation for backup cleanup would go here
      logger.info(`Backup cleanup: would remove files older than ${retentionDays} days`);

    } catch (error) {
      logger.error('Backup cleanup failed', error);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down scheduler...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Stop all schedules
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      logger.info('Stopping scheduler...');

      // Stop all scheduled tasks
      for (const [name, schedule] of this.schedules) {
        schedule.task.stop();
        logger.info(`Stopped schedule: ${name}`);
      }

      // Clear schedules map
      this.schedules.clear();

      // Cleanup the main app
      await this.app.cleanup();

      logger.info('Scheduler stopped successfully');

    } catch (error) {
      logger.error('Error stopping scheduler', error);
    }
  }

  /**
   * Get scheduler status
   * @returns {Object} - Scheduler status
   */
  getStatus() {
    const schedulesStatus = {};

    for (const [name, schedule] of this.schedules) {
      schedulesStatus[name] = {
        cronExpression: schedule.cronExpression,
        description: schedule.description,
        lastRun: schedule.lastRun,
        runCount: schedule.runCount,
        successCount: schedule.successCount,
        failureCount: schedule.failureCount,
        successRate: schedule.runCount > 0 ? (schedule.successCount / schedule.runCount * 100).toFixed(2) + '%' : '0%'
      };
    }

    return {
      enabled: this.config.enabled,
      isRunning: this.isRunning,
      activeSchedules: this.schedules.size,
      schedules: schedulesStatus,
      timezone: this.config.timezone
    };
  }

  /**
   * Run a manual scraping job
   * @param {string} inputPath - Input file path
   * @param {string} outputPath - Output file path
   * @returns {Promise<Object>} - Results
   */
  async runManual(inputPath = './data/input.json', outputPath = './data/manual_output.json') {
    logger.info('Starting manual scraping run...');

    try {
      const results = await this.app.run(inputPath, outputPath);
      logger.info('Manual scraping run completed successfully');
      return results;

    } catch (error) {
      logger.error('Manual scraping run failed', error);
      throw error;
    }
  }
}

/**
 * Main execution for scheduler
 */
async function main() {
  const scheduler = new ScraperScheduler();

  try {
    await scheduler.initialize();
    await scheduler.start();

    logger.info('🕐 Scheduler is running. Press Ctrl+C to stop.');

    // Keep the process running
    process.stdin.resume();

  } catch (error) {
    logger.error('Scheduler failed to start', error);
    process.exit(1);
  }
}

/**
 * Export for testing
 */
module.exports = {
  ScraperScheduler,
  main
};

// Run main function if this file is executed directly
if (require.main === module) {
  main();
}