const IkeaScraper = require('./ikeaScraper');

const logger = require('../utils/logger');

/**
 * Coordinates multiple scrapers and aggregates results
 */
class ScraperManager {
  constructor(siteConfigs) {
    this.scrapers = new Map();
    this.siteConfigs = siteConfigs;
    this.initializeScrapers();
  }

  /**
   * Initialize all configured scrapers
   * @private
   */
  initializeScrapers() {
    if (this.siteConfigs.ikea?.enabled) {
      this.scrapers.set('ikea', new IkeaScraper(this.siteConfigs.ikea));
    }

    logger.info(`Initialized ${this.scrapers.size} scrapers: ${Array.from(this.scrapers.keys()).join(', ')}`);
  }

  /**
   * Run searches in parallel across all sites
   * @param {Array} searchQueries - Array of search query objects
   * @param {Object} settings - Scraper settings
   * @returns {Promise<Object>} - Aggregated results
   */
  async runSearches(searchQueries, settings = {}) {
    const startTime = Date.now();
    const results = {
      results: [],
      errors: [],
      sitesStatus: {},
      searchQueriesProcessed: 0,
      totalResults: 0,
      duration: 0
    };

    logger.info(`Starting ${searchQueries.length} search queries across ${this.scrapers.size} sites`);

    try {
      // Process each search query
      for (const query of searchQueries) {
        logger.info(`Processing query: "${query.query}"`);

        const queryResult = await this.processQuery(query, settings);

        // Add query results to main results
        results.results.push(queryResult);
        results.searchQueriesProcessed++;

        // Update site status
        this.updateSitesStatus(results.sitesStatus, queryResult.siteResults);

        // Log progress
        logger.info(`Query "${query.query}" completed: ${queryResult.products.length} products found`);
      }

      // Calculate total results
      results.totalResults = results.results.reduce((total, queryResult) => {
        return total + queryResult.products.length;
      }, 0);

      // Sort and filter results
      this.sortAndFilterResults(results, settings);

    } catch (error) {
      logger.error('Error during scraping process', error);
      results.errors.push({
        type: 'general',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }

    // Calculate duration
    results.duration = Date.now() - startTime;

    logger.logScrapingComplete(results);

    return results;
  }

  /**
   * Process a single search query across all sites
   * @param {Object} query - Search query object
   * @param {Object} settings - Scraper settings
   * @returns {Promise<Object>} - Query results
   */
  async processQuery(query, settings) {
    const queryResult = {
      originalQuery: query.query,
      products: [],
      siteResults: {},
      errors: [],
      processingTime: 0
    };

    const startTime = Date.now();

    // Run searches in parallel across all enabled sites
    const sitePromises = Array.from(this.scrapers.entries()).map(async ([siteName, scraper]) => {
      try {
        const siteResults = await this.runSiteSearch(scraper, query, settings);
        queryResult.siteResults[siteName] = siteResults;
        return siteResults;
      } catch (error) {
        logger.error(`Site ${siteName} failed for query "${query.query}"`, error);
        queryResult.siteResults[siteName] = {
          success: false,
          error: error.message,
          products: []
        };
        queryResult.errors.push({
          site: siteName,
          query: query.query,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        return null;
      }
    });

    // Wait for all site searches to complete
    const siteResults = await Promise.allSettled(sitePromises);

    // Collect all products from successful site searches
    siteResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        const siteName = Array.from(this.scrapers.keys())[index];
        const siteProducts = result.value.products || [];

        // Add site name to each product if not already present
        siteProducts.forEach(product => {
          if (!product.site) product.site = siteName;
        });

        queryResult.products.push(...siteProducts);
      }
    });

    // Apply query-specific filters
    queryResult.products = this.applyQueryFilters(queryResult.products, query, settings);

    // Sort products according to settings
    queryResult.products = this.sortProducts(queryResult.products, settings.sortBy || 'price_asc');

    // Calculate processing time
    queryResult.processingTime = Date.now() - startTime;

    logger.logQueryProcessing(query.query, {
      resultsCount: queryResult.products.length,
      sitesFound: Object.keys(queryResult.siteResults).filter(site =>
        queryResult.siteResults[site].success
      ).length,
      processingTime: queryResult.processingTime
    });

    return queryResult;
  }

  /**
   * Run search on a specific site
   * @param {BaseScraper} scraper - Scraper instance
   * @param {Object} query - Search query object
   * @param {Object} settings - Scraper settings
   * @returns {Promise<Object>} - Site search results
   */
  async runSiteSearch(scraper, query, settings) {
    const startTime = Date.now();
    const siteName = scraper.siteName;

    try {
      logger.info(`Starting search on ${siteName} for "${query.query}"`);

      // Run the search
      let products = await scraper.search(query.query);

      // Apply site-specific filters
      products = this.applySiteFilters(products, siteName, settings);

      // Limit results per site if specified
      const maxResults = settings.maxResultsPerSite || 150;
      if (products.length > maxResults) {
        products = products.slice(0, maxResults);
      }

      const duration = Date.now() - startTime;

      const siteResult = {
        success: true,
        site: siteName,
        products,
        productsFound: products.length,
        duration,
        timestamp: new Date().toISOString()
      };

      logger.logSiteResults(siteName, siteResult);

      return siteResult;

    } catch (error) {
      const duration = Date.now() - startTime;

      const errorResult = {
        success: false,
        site: siteName,
        error: error.message,
        products: [],
        productsFound: 0,
        duration,
        timestamp: new Date().toISOString()
      };

      logger.logSiteResults(siteName, errorResult);
      throw error;
    }
  }

  /**
   * Apply site-specific filters
   * @param {Array} products - Array of products
   * @param {string} siteName - Site name
   * @param {Object} settings - Filter settings
   * @returns {Array} - Filtered products
   */
  applySiteFilters(products, siteName, settings) {
    let filteredProducts = [...products];

    // Filter by minimum rating
    if (settings.minRating && settings.minRating > 0) {
      filteredProducts = filteredProducts.filter(product =>
        !product.rating || product.rating >= settings.minRating
      );
    }

    // Filter by availability
    if (!settings.includeOutOfStock) {
      filteredProducts = filteredProducts.filter(product =>
        product.availability !== 'out_of_stock' && product.availability !== 'unavailable'
      );
    }

    // Filter by minimum discount
    if (settings.minDiscountPercent && settings.minDiscountPercent > 0) {
      filteredProducts = filteredProducts.filter(product =>
        !product.discountPercent || product.discountPercent >= settings.minDiscountPercent
      );
    }

    // Log filtering statistics
    const filterStats = {
      initialCount: products.length,
      finalCount: filteredProducts.length,
      filters: [`site: ${siteName}`, `minRating: ${settings.minRating || 'none'}`,
                `availability: ${settings.includeOutOfStock ? 'all' : 'in stock only'}`,
                `minDiscount: ${settings.minDiscountPercent || 'none'}%`]
    };

    if (filterStats.initialCount !== filterStats.finalCount) {
      logger.logProductFiltering(filterStats);
    }

    return filteredProducts;
  }

  /**
   * Apply query-specific filters
   * @param {Array} products - Array of products
   * @param {Object} query - Query object
   * @param {Object} settings - Settings object
   * @returns {Array} - Filtered products
   */
  applyQueryFilters(products, query, settings) {
    let filteredProducts = [...products];

    // Filter by maximum price specified in query
    if (query.maxPrice && query.maxPrice > 0) {
      filteredProducts = filteredProducts.filter(product =>
        product.price && product.price <= query.maxPrice
      );
    }

    // Filter by currency (should all be INR, but double-check)
    if (query.currency && query.currency !== 'INR') {
      // Convert prices to specified currency if needed
      filteredProducts = filteredProducts.map(product => {
        if (product.currency !== query.currency) {
          // Simple conversion (in real app, use exchange rates)
          // For now, assume all are INR
        }
        return product;
      });
    }

    return filteredProducts;
  }

  /**
   * Sort products according to specified criteria
   * @param {Array} products - Array of products
   * @param {string} sortBy - Sort criteria
   * @returns {Array} - Sorted products
   */
  sortProducts(products, sortBy) {
    const sortedProducts = [...products];

    switch (sortBy) {
      case 'price_asc':
        sortedProducts.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        sortedProducts.sort((a, b) => b.price - a.price);
        break;
      case 'rating_desc':
        sortedProducts.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case 'rating_asc':
        sortedProducts.sort((a, b) => (a.rating || 0) - (b.rating || 0));
        break;
      case 'discount_desc':
        sortedProducts.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
        break;
      default:
        // Default to price ascending
        sortedProducts.sort((a, b) => a.price - b.price);
    }

    return sortedProducts;
  }

  /**
   * Sort and filter overall results
   * @param {Object} results - Results object
   * @param {Object} settings - Settings object
   */
  sortAndFilterResults(results, settings) {
    // Sort each query's products
    results.results.forEach(queryResult => {
      queryResult.products = this.sortProducts(queryResult.products, settings.sortBy || 'price_asc');
    });

    // If global sorting is requested, sort across all queries
    if (settings.globalSort) {
      const allProducts = [];
      results.results.forEach(queryResult => {
        queryResult.products.forEach(product => {
          product.originalQuery = queryResult.originalQuery;
        });
        allProducts.push(...queryResult.products);
      });

      const sortedAll = this.sortProducts(allProducts, settings.sortBy || 'price_asc');

      // Distribute sorted products back to queries (keeping original query association)
      results.results.forEach(queryResult => {
        queryResult.products = sortedAll.filter(product =>
          product.originalQuery === queryResult.originalQuery
        );
      });
    }
  }

  /**
   * Update sites status based on query results
   * @param {Object} sitesStatus - Sites status object to update
   * @param {Object} siteResults - Site results from query
   */
  updateSitesStatus(sitesStatus, siteResults) {
    Object.keys(siteResults).forEach(siteName =>  {
      const siteResult = siteResults[siteName];

      if (!sitesStatus[siteName]) {
        sitesStatus[siteName] = {
          status: 'unknown',
          message: '',
          resultsFound: 0,
          errors: 0,
          lastChecked: null
        };
      }

      sitesStatus[siteName].searched = true;
      sitesStatus[siteName].resultsFound += siteResult.productsFound || 0;

      if (siteResult.success) {
        sitesStatus[siteName].status = 'success';
        sitesStatus[siteName].message = `Found ${siteResult.productsFound} products`;
      } else {
        sitesStatus[siteName].status = 'error';
        sitesStatus[siteName].errors++;
        sitesStatus[siteName].message = siteResult.error || 'Unknown error';
      }

      sitesStatus[siteName].lastChecked = new Date().toISOString();
    });
  }

  /**
   * Get statistics about scraping performance
   * @param {Object} results - Results object
   * @returns {Object} - Statistics object
   */
  getStatistics(results) {
    const stats = {
      totalQueries: results.searchQueriesProcessed,
      totalProducts: results.totalResults,
      successfulQueries: results.results.filter(q => q.products.length > 0).length,
      failedQueries: results.results.filter(q => q.products.length === 0).length,
      sitesTried: Object.keys(results.sitesStatus).length,
      successfulSites: Object.keys(results.sitesStatus).filter(site =>
        results.sitesStatus[site].status === 'success' || results.sitesStatus[site].status === 'no_match'
      ).length,
      failedSites: Object.keys(results.sitesStatus).filter(site =>
        results.sitesStatus[site].status === 'error'
      ).length,
      averageProductsPerQuery: results.totalResults / Math.max(results.searchQueriesProcessed, 1),
      averageProcessingTime: results.duration / Math.max(results.searchQueriesProcessed, 1)
    };

    return stats;
  }

  /**
   * Clean up all scrapers
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.info('Cleaning up scrapers...');

    const cleanupPromises = Array.from(this.scrapers.values()).map(async (scraper) => {
      try {
        await scraper.close();
      } catch (error) {
        logger.error(`Error closing scraper`, error);
      }
    });

    await Promise.allSettled(cleanupPromises);
    logger.info('Scraper cleanup completed');
  }
}

module.exports = ScraperManager;