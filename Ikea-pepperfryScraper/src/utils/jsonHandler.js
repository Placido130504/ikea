const fs = require('fs').promises;
const path = require('path');

class JsonHandler {
  /**
   * Read and optionally validate a JSON file
   * Automatically skips validation for configuration files (sites, settings, etc.)
   * @param {string} filePath - Path to JSON file
   * @returns {Promise<Object>} - Parsed JSON data
   */
  async readInputFile(filePath) {
    try {
      const absolutePath = path.resolve(filePath);
      const data = await fs.readFile(absolutePath, 'utf8');
      const parsedData = JSON.parse(data);

      // Only validate actual scraper input files, not configs
      const isInputFile = filePath.toLowerCase().includes('input.json');
      if (isInputFile) {
        this.validateInputStructure(parsedData);
      }

      return parsedData;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Input file not found: ${filePath}`);
      } else if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in file: ${error.message}`);
      } else if (error.name === 'ValidationError') {
        throw error;
      } else {
        throw new Error(`Error reading input file: ${error.message}`);
      }
    }
  }

  /**
   * Write results to output JSON file with formatting and backup
   * @param {string} filePath - Path to output JSON file
   * @param {Object} data - Data to write
   */
  async writeOutputFile(filePath, data) {
    try {
      const absolutePath = path.resolve(filePath);
      const outputData = this.createOutputStructure(data);

      // Ensure directory exists
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });

      // Pretty-print JSON output
      const jsonString = JSON.stringify(outputData, null, 2);
      await fs.writeFile(absolutePath, jsonString, 'utf8');

      console.log(`✅ Results saved to: ${absolutePath}`);
    } catch (error) {
      throw new Error(`Error writing output file: ${error.message}`);
    }
  }

  /**
   * Validate structure of input.json (search queries + settings)
   * @param {Object} data - Input JSON data
   * @private
   */
  validateInputStructure(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid input: JSON must be an object');
    }

    // Validate searchQueries
    if (!Array.isArray(data.searchQueries)) {
      throw new Error('Invalid input: searchQueries must be an array');
    }

    if (data.searchQueries.length === 0) {
      throw new Error('Invalid input: searchQueries array cannot be empty');
    }

    data.searchQueries.forEach((query, index) => {
      if (!query.query || typeof query.query !== 'string') {
        throw new Error(`Invalid input: searchQueries[${index}].query is required and must be a string`);
      }

      if (!query.category || typeof query.category !== 'string') {
        throw new Error(`Invalid input: searchQueries[${index}].category is required and must be a string`);
      }

      if (query.maxPrice && (typeof query.maxPrice !== 'number' || query.maxPrice <= 0)) {
        throw new Error(`Invalid input: searchQueries[${index}].maxPrice must be a positive number`);
      }

      if (query.currency && typeof query.currency !== 'string') {
        throw new Error(`Invalid input: searchQueries[${index}].currency must be a string`);
      }
    });

    // Validate optional settings
    if (data.settings) {
      const settings = data.settings;

      if (settings.maxResultsPerSite && (typeof settings.maxResultsPerSite !== 'number' || settings.maxResultsPerSite <= 0)) {
        throw new Error('Invalid input: settings.maxResultsPerSite must be a positive number');
      }

      if (settings.minRating && (typeof settings.minRating !== 'number' || settings.minRating < 0 || settings.minRating > 5)) {
        throw new Error('Invalid input: settings.minRating must be between 0 and 5');
      }

      if (settings.sortBy && !['price_asc', 'price_desc', 'rating_desc', 'rating_asc'].includes(settings.sortBy)) {
        throw new Error('Invalid input: settings.sortBy must be one of: price_asc, price_desc, rating_desc, rating_asc');
      }
    }
  }

  /**
   * Create standardized output structure
   * @param {Object} results - Raw scraping results
   * @returns {Object} formatted output
   */
  createOutputStructure(results) {
    return {
      timestamp: new Date().toISOString(),
      searchQueriesProcessed: results.searchQueriesProcessed || 0,
      totalResults: results.totalResults || 0,
      results: results.results || [],
      errors: results.errors || [],
      sitesStatus: results.sitesStatus || {}
    };
  }

  /**
   * Backup previous output file before overwriting
   * @param {string} filePath - Output file path
   */
  async backupOutputFile(filePath) {
    try {
      const absolutePath = path.resolve(filePath);
      await fs.access(absolutePath);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = absolutePath.replace('.json', `_backup_${timestamp}.json`);

      await fs.copyFile(absolutePath, backupPath);
      console.log(`📦 Previous output backed up to: ${backupPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️ Warning: Could not backup output file: ${error.message}`);
      }
    }
  }
}

module.exports = JsonHandler;
