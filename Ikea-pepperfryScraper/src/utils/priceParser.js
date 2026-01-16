/**
 * Utility functions for price extraction and normalization
 */

class PriceParser {
  /**
   * Extract price from text and normalize to number
   * @param {string} priceText - Raw price text
   * @returns {number|null} - Normalized price or null if invalid
   */
  static extractPrice(priceText) {
    if (!priceText || typeof priceText !== 'string') {
      return null;
    }

    try {
      // Remove all whitespace and common price formatting characters
      const cleaned = priceText
        .replace(/\s/g, '')
        .replace(/[₹$€£¥]/g, '')
        .replace(/,/g, '')
        .trim();

      // Extract numbers using regex
      const priceMatch = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
      if (!priceMatch) {
        return null;
      }

      const price = parseFloat(priceMatch[1]);
      return isNaN(price) ? null : price;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract both current price and original price (for discount calculation)
   * @param {string} currentPriceText - Current price text
   * @param {string} originalPriceText - Original price text (optional)
   * @returns {Object} - Object with currentPrice, originalPrice, and discountPercent
   */
  static extractPricePair(currentPriceText, originalPriceText = null) {
    const currentPrice = this.extractPrice(currentPriceText);
    const originalPrice = this.extractPrice(originalPriceText);

    let discountPercent = 0;
    if (originalPrice && currentPrice && originalPrice > currentPrice) {
      discountPercent = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
    }

    return {
      currentPrice,
      originalPrice,
      discountPercent
    };
  }

  /**
   * Validate if price is within expected range
   * @param {number} price - Price to validate
   * @param {number} minPrice - Minimum expected price (optional)
   * @param {number} maxPrice - Maximum expected price (optional)
   * @returns {boolean} - True if price is valid
   */
  static validatePrice(price, minPrice = 0, maxPrice = Infinity) {
    if (typeof price !== 'number' || isNaN(price)) {
      return false;
    }

    return price >= minPrice && price <= maxPrice;
  }

  /**
   * Format price for display with Indian Rupee symbol
   * @param {number} price - Price to format
   * @param {string} currency - Currency code (default: INR)
   * @returns {string} - Formatted price string
   */
  static formatPrice(price, currency = 'INR') {
    if (typeof price !== 'number' || isNaN(price)) {
      return 'N/A';
    }

    const symbols = {
      INR: '₹',
      USD: '$',
      EUR: '€',
      GBP: '£'
    };

    const symbol = symbols[currency] || currency;

    // Format with Indian numbering system (comma after hundreds, thousands, lakhs, crores)
    if (currency === 'INR') {
      let formatted = price.toFixed(2);
      const parts = formatted.split('.');
      let integerPart = parts[0];
      let result = '';

      if (integerPart.length > 3) {
        const lastThree = integerPart.slice(-3);
        const remaining = integerPart.slice(0, -3);
        result = remaining ? remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree : lastThree;
      } else {
        result = integerPart;
      }

      return `${symbol}${result}${parts[1] !== '00' ? '.' + parts[1] : ''}`;
    }

    // Standard international formatting
    return `${symbol}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Detect currency from price text
   * @param {string} priceText - Price text to analyze
   * @returns {string} - Currency code (INR, USD, EUR, GBP, or UNKNOWN)
   */
  static detectCurrency(priceText) {
    if (!priceText || typeof priceText !== 'string') {
      return 'UNKNOWN';
    }

    const text = priceText.toLowerCase();

    if (text.includes('₹') || text.includes('inr') || text.includes('rs') || text.includes('rupee')) {
      return 'INR';
    } else if (text.includes('$') || text.includes('usd')) {
      return 'USD';
    } else if (text.includes('€') || text.includes('eur')) {
      return 'EUR';
    } else if (text.includes('£') || text.includes('gbp')) {
      return 'GBP';
    }

    return 'UNKNOWN';
  }

  /**
   * Convert price to INR if in different currency (simplified conversion)
   * @param {number} price - Price amount
   * @param {string} fromCurrency - Source currency
   * @returns {number} - Price in INR
   */
  static convertToINR(price, fromCurrency) {
    if (typeof price !== 'number' || isNaN(price)) {
      return price;
    }

    // Simplified conversion rates (should be updated with real rates in production)
    const conversionRates = {
      INR: 1,
      USD: 83,    // 1 USD ≈ 83 INR
      EUR: 90,    // 1 EUR ≈ 90 INR
      GBP: 105    // 1 GBP ≈ 105 INR
    };

    const rate = conversionRates[fromCurrency];
    return rate ? Math.round(price * rate * 100) / 100 : price;
  }

  /**
   * Extract price range from text like "₹500-₹1000" or "500-1000"
   * @param {string} priceRangeText - Text containing price range
   * @returns {Object|null} - Object with minPrice and maxPrice or null
   */
  static extractPriceRange(priceRangeText) {
    if (!priceRangeText || typeof priceRangeText !== 'string') {
      return null;
    }

    const rangeMatch = priceRangeText.match(/(\d+(?:\.\d{2})?)\s*[-–]\s*(\d+(?:\.\d{2})?)/);
    if (!rangeMatch) {
      return null;
    }

    const minPrice = parseFloat(rangeMatch[1]);
    const maxPrice = parseFloat(rangeMatch[2]);

    if (isNaN(minPrice) || isNaN(maxPrice) || minPrice > maxPrice) {
      return null;
    }

    return { minPrice, maxPrice };
  }
}

module.exports = PriceParser;