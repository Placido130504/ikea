const BaseScraper = require('./baseScraper');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const fs = require('fs').promises;

const MAX_PRODUCTS = 150;
const PRODUCTS_PER_PAGE = 24;
const MAX_PAGES = Math.ceil(MAX_PRODUCTS / PRODUCTS_PER_PAGE);

/**
 * IKEA India-specific scraping implementation (with hydration wait fix + correct price extraction)
 */
class IkeaScraper extends BaseScraper {
  constructor(config) {
    super({
      ...config,
      name: 'ikea',
      baseUrl: 'https://www.ikea.com/in/en'
    });

    this.selectors = {
      productContainer: '[data-testid="plp-product-card"], .range-revamp-product-compact, .product-pipe, .product-px, .search-result__item',
      productTitle: '[data-testid="plp-product-card"] a span, .range-revamp-header-section__title--small, .product-px__header__title, .product-pipe__title',
      productUrl: 'a[href], .product-px__header__link, .product-pipe__link',
      price: '[data-testid="plp-price"], .range-revamp-price__integer, .product-px__price__value, .product-pipe__price',
      originalPrice: '.product-px__price__original, .product-pipe__price--original',
      imageUrl: 'img, .product-px__image__img, .product-pipe__image',
      availability: '.product-px__stock-text, .product-pipe__availability',
      rating: '.range__stars, .rating__stars',
      reviewCount: '.rating__count, .reviews-count',
      description: '.product-px__description, .product-pipe__description'
    };
  }


  async scrapeSearchPage(productQuery, pageNumber) {
  const page = await this.browser.newPage();

  try {
    const url = this.buildSearchUrl(productQuery, pageNumber);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    await this.autoScroll(page);

    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="plp-product-card"]').length > 0,
      { timeout: 20000 }
    );

    const content = await page.content();
    const $ = cheerio.load(content);

    return this.extractProductsFromSearchResults($, productQuery);
  } catch (err) {
    logger.warn(`IKEA page ${pageNumber} failed`);
    return [];
  } finally {
    await page.close();
  }
}

  /**
   * Search for products on IKEA India
   */
  async search(productQuery) {
  try {
    await this.initialize();

    const seen = new Set();
    const allProducts = [];

    // Create page numbers: IKEA uses ?page=1,2,3...
    const pageNumbers = Array.from({ length: MAX_PAGES }, (_, i) => i + 1);

    // 🚀 PARALLEL scraping
    const results = await Promise.all(
      pageNumbers.map(async (pageNumber) => {
        const page = await this.browser.newPage();

        try {
          const searchUrl = this.buildSearchUrl(productQuery, pageNumber);
          await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await this.randomDelay(1500, 3000);

          await this.autoScroll(page);

          await page.waitForFunction(
            () => document.querySelectorAll('[data-testid="plp-product-card"]').length > 0,
            { timeout: 20000 }
          );

          const content = await page.content();
          const $ = cheerio.load(content);

          let products = this.extractProductsFromSearchResults($, productQuery);

          // 🔁 Fallback if Cheerio fails
          if (!products.length) {
            products = await page.evaluate(() => {
              const cards = document.querySelectorAll('[data-testid="plp-product-card"]');

              function numericFromText(text) {
                if (!text) return null;
                const matches =
                  text.match(/\d{1,3}(?:,\d{3})+/g) ||
                  text.match(/\d{4,6}/g);

                if (!matches) return null;
                return Math.max(...matches.map(n => parseInt(n.replace(/,/g, ''), 10)));
              }

              return Array.from(cards).map(card => {
                const title = card.querySelector('a span')?.innerText?.trim() || '';

                const attrPrice =
                  card.getAttribute('data-price') ||
                  card.dataset?.price ||
                  card.dataset?.priceAmount ||
                  card.dataset?.amount;

                let price = attrPrice ? parseInt(attrPrice, 10) : null;

                if (!price) {
                  const priceNode =
                    card.querySelector('[data-testid="plp-price"]') ||
                    card.querySelector('.range-revamp-price');

                  if (priceNode) price = numericFromText(priceNode.innerText);
                }

                const image =
                  card.querySelector('img')?.src ||
                  card.querySelector('img')?.getAttribute('data-src') ||
                  '';

                const href = card.querySelector('a')?.href || '';

                return {
                  title,
                  price,
                  imageUrl: image,
                  url: href,
                  site: 'ikea'
                };
              });
            });
          }

          return products;
        } catch (err) {
          logger.warn(`IKEA page ${pageNumber} failed`);
          return [];
        } finally {
          try {
            if (!page.isClosed()) {
              await page.close();
            }
          } catch (e) {
            // Ignore close errors
          }
          await this.randomDelay(1000, 2000);
        }
      })
    );

    // 🔗 Merge + dedupe
    for (const pageProducts of results) {
      for (const product of pageProducts) {
        if (
          product?.url &&
          product?.price > 0 &&
          !seen.has(product.url)
        ) {
          seen.add(product.url);
          allProducts.push(product);
        }
      }
    }

    logger.info(`Total IKEA products collected: ${allProducts.length}`);
    return allProducts.slice(0, MAX_PRODUCTS);

  } catch (error) {
    logger.error(`IKEA parallel search failed for "${productQuery}"`, error);
    return [];
  }
}


  /**
   * Build IKEA search URL
   */
    buildSearchUrl(query, page = 0) {
      return `${this.baseUrl}/search/?q=${encodeURIComponent(query)}&page=${page}`;
    }

  /**
   * Wait for IKEA products to load completely
   */
  async waitForProductsToLoad() {
    try {
      await this.page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="plp-product-card"]');
          return el && el.innerText.length > 10;
        },
        { timeout: 20000 }
      );
    } catch (err) {
      logger.warn('⚠️ IKEA products did not fully render within expected time');
    }
  }

  /**
   * Wait for network idle (custom fallback)
   */
  async waitForNetworkIdle(page, timeout = 10000) {
    let idleResolve;
    const idlePromise = new Promise((resolve) => (idleResolve = resolve));
    let timeoutId;

    const checkIdle = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        page.removeListener('request', onRequest);
        page.removeListener('requestfinished', onRequestFinished);
        page.removeListener('requestfailed', onRequestFinished);
        idleResolve();
      }, 500);
    };

    const onRequest = checkIdle;
    const onRequestFinished = checkIdle;

    page.on('request', onRequest);
    page.on('requestfinished', onRequestFinished);
    page.on('requestfailed', onRequestFinished);

    setTimeout(() => idleResolve(), timeout);
    return idlePromise;
  }

  /**
   * Extract products from IKEA search results
   */
  extractProductsFromSearchResults($, originalQuery) {
    const products = [];

    $(this.selectors.productContainer).each((i, el) => {
      try {
        const $p = $(el);
        const product = this.extractProductData($p, originalQuery);
        if (product && this.isValidProduct(product)) {
          products.push(product);
        }
      } catch (err) {
        logger.debug(`Error parsing IKEA product ${i}`, err);
      }
    });

    return products;
  }

  /**
   * Extract single product data
   */
  extractProductData($p, originalQuery) {
    const title = this.cleanTitle(
      $p.find(this.selectors.productTitle).first().text()
    );

    if (!title) return null;

    // URL
    let url = $p.find(this.selectors.productUrl).attr('href') || '';
    if (url && !url.startsWith('http')) url = this.baseUrl + url;

    // Price
    const priceText = $p.find(this.selectors.price).first().text().trim();
    const price = this.validatePrice(priceText);

    // Original price (if any)
    const originalPriceText = $p.find(this.selectors.originalPrice).first().text();
    const originalPrice = this.validatePrice(originalPriceText);

    // Discount
    let discountPercent = 0;
    if (originalPrice && price && originalPrice > price) {
      discountPercent = Math.round(((originalPrice - price) / originalPrice) * 100);
    }

    // Image
    const imageUrl = $p.find(this.selectors.imageUrl).attr('src') || '';

    const availability =
      $p.find(this.selectors.availability).text().trim() || 'available';

    return {
      title,
      price: price || 0,
      currency: 'INR',
      originalPrice: originalPrice || price || 0,
      discountPercent,
      url,
      site: 'ikea',
      availability,
      rating: 0,
      reviewCount: 0,
      imageUrl,
      description: '',
      originalQuery,
      extractedAt: new Date().toISOString()
    };
  }

  /**
   * Validate final product object
   */
  isValidProduct(p) {
    return p.title && p.url && p.price > 0;
  }
}

module.exports = IkeaScraper;
