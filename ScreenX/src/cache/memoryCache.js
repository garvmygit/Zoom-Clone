/**
 * Memory-based cache with TTL (Time To Live) support
 * Uses Map for fast lookups and automatic cleanup
 */

class MemoryCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map(); // Track TTL timers
    this.cleanupInterval = null;
    this.startAutoCleanup();
  }

  /**
   * Set a value in cache with optional TTL (in seconds)
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds (0 = no expiration)
   */
  set(key, value, ttlSeconds = 0) {
    // Remove existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    // Store value with timestamp
    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl: ttlSeconds * 1000 // Convert to milliseconds
    });

    // Set TTL timer if specified
    if (ttlSeconds > 0) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttlSeconds * 1000);
      this.timers.set(key, timer);
    }
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*|null} - Cached value or null if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (entry.ttl > 0) {
      const age = Date.now() - entry.createdAt;
      if (age >= entry.ttl) {
        this.delete(key);
        return null;
      }
    }

    return entry.value;
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete a key from cache
   * @param {string} key - Cache key
   * @returns {boolean} - True if key existed
   */
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getStats() {
    let expired = 0;
    let active = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl > 0) {
        const age = now - entry.createdAt;
        if (age >= entry.ttl) {
          expired++;
        } else {
          active++;
        }
      } else {
        active++;
      }
    }

    return {
      total: this.cache.size,
      active,
      expired,
      timers: this.timers.size
    };
  }

  /**
   * Remove expired entries from cache
   */
  autoCleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl > 0) {
        const age = now - entry.createdAt;
        if (age >= entry.ttl) {
          keysToDelete.push(key);
        }
      }
    }

    keysToDelete.forEach(key => this.delete(key));

    if (keysToDelete.length > 0) {
      console.log(`[Cache] Cleaned up ${keysToDelete.length} expired entries`);
    }
  }

  /**
   * Start automatic cleanup interval (runs every 5 minutes)
   */
  startAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cleanupInterval = setInterval(() => {
      this.autoCleanup();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Invalidate cache entries matching a pattern
   * @param {string|RegExp} pattern - Pattern to match keys
   * @returns {number} - Number of keys deleted
   */
  invalidatePattern(pattern) {
    let count = 0;
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        count++;
      }
    }

    return count;
  }
}

// Export singleton instance
const memoryCache = new MemoryCache();

export default memoryCache;


