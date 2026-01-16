require('dotenv').config();
const JsonHandler = require('./utils/jsonHandler');
const ScraperManager = require('./scraper/scraperManager');
const logger = require('./utils/logger');
const path = require('path');
const { formatProduct } = require('./utils/outputFormatter');

/**
 * Main application entry point for the price comparison scraper
 */
class PriceComparisonApp {
  constructor() {
    this.jsonHandler = new JsonHandler();
    this.scraperManager = null;
    this.config = {};
  }

  /**
   * Initialize the application
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info('=== Initializing Price Comparison Scraper ===');

      // Load configuration
      await this.loadConfiguration();

      // Initialize scraper manager with site configurations
      this.scraperManager = new ScraperManager(this.config.sites);

      logger.info('Application initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize application', error);
      throw error;
    }
  }

  /**
   * Load configuration files
   * @returns {Promise<void>}
   */
  async loadConfiguration() {
    try {
      // Load sites configuration
      const sitesConfig = await this.jsonHandler.readInputFile('./src/config/sites.json');
      this.config.sites = sitesConfig.sites;

      // Load settings configuration
      const settingsConfig = await this.jsonHandler.readInputFile('./src/config/settings.json');
      this.config.settings = settingsConfig;

      logger.info('Configuration loaded successfully');
    } catch (error) {
      logger.error('Failed to load configuration', error);
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  /**
   * Run the price comparison scraper
   * @param {string} inputPath
   * @param {string} outputPath
   * @returns {Promise<Object>}
   */
  async run(inputPath = './data/input.json', outputPath = './data/output.json') {
    const startTime = Date.now();

    try {
      logger.info('Starting price comparison scraping process');

      // Read and validate input
      const inputData = await this.jsonHandler.readInputFile(inputPath);

      // Backup existing output file if it exists
      if (this.config.settings.output?.backupPrevious) {
        await this.jsonHandler.backupOutputFile(outputPath);
      }

      // Extract search queries and settings
      const searchQueries = inputData.searchQueries;
      const inputSettings = { ...this.config.settings.scraper, ...inputData.settings };

      logger.logScrapingStart({
        totalQueries: searchQueries.length,
        sitesEnabled: Object.keys(this.config.sites).filter(
          site => this.config.sites[site].enabled
        ),
        timestamp: new Date().toISOString()
      });

      // Run searches across all sites
      const results = await this.scraperManager.runSearches(
        searchQueries,
        inputSettings
      );

      // 🔥 FORMAT PRODUCTS HERE (IMPORTANT)
      results.results.forEach(queryResult => {
        queryResult.products = queryResult.products.map(formatProduct);
      });

      // 🔥 REMOVE RAW SITE PRODUCTS (cleanup output)
      results.results.forEach(queryResult => {
        if (queryResult.siteResults) {
          Object.values(queryResult.siteResults).forEach(site => {
            delete site.products;
          });
        }
      });


      // Add metadata to results
      results.metadata = {
        inputPath,
        outputPath,
        processingTime: Date.now() - startTime,
        settings: inputSettings,
        statistics: this.scraperManager.getStatistics(results)
      };

      // Write results to output file
      await this.jsonHandler.writeOutputFile(outputPath, results);

      // Display summary
      this.displaySummary(results);

      logger.info('Price comparison scraping completed successfully');
      return results;
    } catch (error) {
      logger.error('Price comparison scraping failed', error);

      const errorResults = {
        timestamp: new Date().toISOString(),
        searchQueriesProcessed: 0,
        totalResults: 0,
        results: [],
        errors: [
          {
            type: 'fatal',
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
          }
        ],
        sitesStatus: {},
        metadata: {
          inputPath,
          outputPath,
          processingTime: Date.now() - startTime,
          error: true
        }
      };

      try {
        await this.jsonHandler.writeOutputFile(outputPath, errorResults);
      } catch (writeError) {
        logger.error('Failed to write error results', writeError);
      }

      throw error;
    }
  }

  /**
   * Display a summary of scraping results
   * @param {Object} results
   */
  displaySummary(results) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PRICE COMPARISON SCRAPER SUMMARY');
    console.log('='.repeat(60));

    console.log(`🔍 Search Queries Processed: ${results.searchQueriesProcessed}`);
    console.log(`📦 Total Products Found: ${results.totalResults}`);
    console.log(
      `⏱️  Processing Time: ${Math.round(results.metadata.processingTime / 1000)}s`
    );

    console.log('\n📈 Sites Status:');
    Object.entries(results.sitesStatus).forEach(([site, status]) => {
      const statusIcon =
        status.status === 'success'
          ? '✅'
          : status.status === 'no_match'
          ? '⚠️'
          : '❌';

      console.log(
        `  ${statusIcon} ${site.charAt(0).toUpperCase() + site.slice(1)}: ${
          status.message
        } (${status.resultsFound} products)`
      );
    });

    console.log('\n🔍 Query Results:');
    results.results.forEach((queryResult, index) => {
      console.log(
        `  ${index + 1}. "${queryResult.originalQuery}" - ${
          queryResult.products.length
        } products found`
      );

      const prices = queryResult.products
        .map(p => p.Price)
        .filter(p => p > 0);

      if (prices.length > 0) {
        console.log(
          `     💰 Price range: ₹${Math.min(
            ...prices
          ).toLocaleString()} - ₹${Math.max(...prices).toLocaleString()}`
        );
      }
    });

    if (results.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      results.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.message}`);
      });
    }

    console.log('\n✨ Results saved to: data/output.json');
    console.log('='.repeat(60) + '\n');
  }

  async cleanup() {
    try {
      if (this.scraperManager) {
        await this.scraperManager.cleanup();
      }
      logger.info('Application cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup', error);
    }
  }

  async handleShutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await this.cleanup();
    process.exit(0);
  }
}

async function main() {
  const app = new PriceComparisonApp();

  process.on('SIGINT', () => app.handleShutdown('SIGINT'));
  process.on('SIGTERM', () => app.handleShutdown('SIGTERM'));

  process.on('uncaughtException', async error => {
    logger.error('Uncaught exception', error);
    await app.cleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled promise rejection', { reason, promise });
    await app.cleanup();
    process.exit(1);
  });

  try {
    await app.initialize();

    const inputPath = process.argv[2] || './data/input.json';
    const outputPath = process.argv[3] || './data/output.json';

    await app.run(inputPath, outputPath);

    await app.cleanup();
    process.exit(0);
  } catch (error) {
    logger.error('Application failed', error);
    await app.cleanup();
    process.exit(1);
  }
}

module.exports = {
  PriceComparisonApp,
  main
};

if (require.main === module) {
  main();
}
