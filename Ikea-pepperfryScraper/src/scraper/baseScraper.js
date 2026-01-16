const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const PriceParser = require('../utils/priceParser');
const logger = require('../utils/logger');

/**
 * Abstract base class for all website scrapers
 */
class BaseScraper {
  constructor(config) {
    this.config = config;
    this.siteName = config.name || 'unknown';
    this.baseUrl = config.baseUrl;
    this.userAgent = this.getRandomUserAgent();
    this.browser = null;
    this.page = null;
  }

  /**
   * Initialize browser instance
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.browser) {
      return;
    }

    const launchOptions = {
      headless: false, // Launch visible browser
      slowMo: 100,
      args: []
    };

    // Set platform-specific args
    if (process.platform === 'linux') {
      launchOptions.args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ];
    } else if (process.platform === 'win32') {
      // Windows-specific args (minimal to avoid issues)
      launchOptions.args = [
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ];
    } else if (process.platform === 'darwin') {
      // macOS
      launchOptions.args = [
        '--no-sandbox'
      ];
    }

    // Add proxy if configured
    if (this.config.proxy) {
      launchOptions.args.push(`--proxy-server=${this.config.proxy}`);
    }

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Set user agent and viewport
    await this.page.setUserAgent(this.userAgent);
    await this.page.setViewport({ width: 1366, height: 768 });

    // Set request headers to look more like a real browser
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    logger.debug(`${this.siteName} scraper initialized`);
  }

  /**
   * Abstract method - must be implemented by subclasses
   * Search for products and return results
   * @param {string} productQuery - Product search query
   * @returns {Promise<Array>} - Array of product results
   */
  async search(productQuery) {
    throw new Error('search() method must be implemented by subclass');
  }

  /**
   * Extract product details from product page
   * @param {string} productUrl - URL of product page
   * @returns {Promise<Object>} - Product details
   */
  async extractProductDetails(productUrl) {
    try {
      await this.initialize();
      await this.page.goto(productUrl, { waitUntil: 'networkidle2' });
      await this.randomDelay();

      const content = await this.page.content();
      const $ = cheerio.load(content);

      return this.extractDetailsFromPage($, productUrl);
    } catch (error) {
      logger.error(`Failed to extract product details from ${productUrl}`, error);
      return null;
    }
  }

  /**
   * Extract details from page content - to be implemented by subclasses
   * @param {CheerioAPI} $ - Cheerio instance
   * @param {string} productUrl - Product URL
   * @returns {Object} - Product details
   */
  extractDetailsFromPage($, productUrl) {
    throw new Error('extractDetailsFromPage() method must be implemented by subclass');
  }

  /**
   * Validate and normalize price format
   * @param {string} priceText - Raw price text
   * @returns {number|null} - Normalized price or null
   */
  validatePrice(priceText) {
    return PriceParser.extractPrice(priceText);
  }

  /**
   * Get random user agent to avoid detection
   * @returns {string} - Random user agent string
   */
  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
    ];

    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Implement random delay to avoid rate limiting
   * @param {number} minDelay - Minimum delay in ms
   * @param {number} maxDelay - Maximum delay in ms
   * @returns {Promise<void>}
   */
  async randomDelay(minDelay = null, maxDelay = null) {
    const min = minDelay || this.config.delays?.min || 2000;
    const max = maxDelay || this.config.delays?.max || 5000;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;

    logger.debug(`Delaying for ${delay}ms on ${this.siteName}`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Handle errors consistently
   * @param {Error} error - Error object
   * @param {string} context - Context where error occurred
   * @returns {Object} - Standardized error object
   */
  handleError(error, context) {
    const errorObj = {
      site: this.siteName,
      context,
      message: error.message,
      timestamp: new Date().toISOString()
    };

    // Add specific error types
    if (error.name === 'TimeoutError') {
      errorObj.type = 'timeout';
    } else if (error.message.includes('404')) {
      errorObj.type = 'not_found';
    } else if (error.message.includes('403') || error.message.includes('blocked')) {
      errorObj.type = 'blocked';
    } else if (error.message.includes('network')) {
      errorObj.type = 'network';
    } else {
      errorObj.type = 'unknown';
    }

    logger.error(`${this.siteName} error in ${context}: ${error.message}`, error);
    return errorObj;
  }

  /**
   * Retry mechanism for failed requests
   * @param {Function} fn - Function to retry
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} retryDelay - Delay between retries
   * @returns {Promise<any>} - Result of function call
   */
  async retry(fn, maxRetries = 3, retryDelay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        logger.warn(`${this.siteName} attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          const delay = retryDelay * attempt;
          logger.debug(`Retrying ${this.siteName} in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Clean and normalize product title
   * @param {string} title - Raw product title
   * @returns {string} - Cleaned title
   */
  cleanTitle(title) {
    if (!title || typeof title !== 'string') {
      return '';
    }

    return title
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-\(\)\[\].,]/g, '') // Remove special chars except basic punctuation
      .substring(0, 200); // Limit length
  }

  /**
   * Extract availability status
   * @param {string} availabilityText - Raw availability text
   * @returns {string} - Normalized availability status
   */
  extractAvailability(availabilityText) {
    if (!availabilityText) {
      return 'unknown';
    }

    const text = availabilityText.toLowerCase().trim();

    if (text.includes('in stock') || text.includes('available') || text.includes('buy now')) {
      return 'in_stock';
    } else if (text.includes('out of stock') || text.includes('unavailable') || text.includes('sold out')) {
      return 'out_of_stock';
    } else if (text.includes('pre-order') || text.includes('coming soon')) {
      return 'pre_order';
    } else {
      return 'unknown';
    }
  }

  /**
   * Extract rating number from text
   * @param {string} ratingText - Raw rating text
   * @returns {number|null} - Rating value or null
   */
  extractRating(ratingText) {
    if (!ratingText) return null;

    const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
    if (!ratingMatch) return null;

    const rating = parseFloat(ratingMatch[1]);
    return (rating >= 0 && rating <= 5) ? rating : null;
  }

  /**
   * Extract review count from text
   * @param {string} reviewText - Raw review text
   * @returns {number|null} - Review count or null
   */
  extractReviewCount(reviewText) {
    if (!reviewText) return null;

    const countMatch = reviewText.match(/(\d+(?:,\d+)*)/);
    if (!countMatch) return null;

    const count = parseInt(countMatch[1].replace(/,/g, ''));
    return !isNaN(count) ? count : null;
  }

  async autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}


  /**
   * Close browser and cleanup resources
   * @returns {Promise<void>}
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.debug(`${this.siteName} browser closed`);
    }
  }

  /**
   * Check if scraper is properly initialized
   * @returns {boolean} - True if ready to scrape
   */
  isReady() {
    return this.browser !== null && this.page !== null;
  }
}

module.exports = BaseScraper;