import express from 'express';
import { getOrSetCache } from '../redisClient.js';

const router = express.Router();

/**
 * Example route demonstrating Redis caching
 * GET /api/cache-example/items
 * 
 * This route caches the result of a simulated database query for 3600 seconds (1 hour).
 * On first request, it fetches data (simulated), stores it in Redis, and returns it.
 * Subsequent requests within the TTL period will return the cached value.
 */
router.get('/items', async (req, res) => {
  try {
    const items = await getOrSetCache(
      'screenx:items',
      async () => {
        // Simulate a database query (replace with actual DB call)
        console.log('[CacheExample] Fetching items from database (cache miss)');
        return [
          { id: 1, name: 'Demo item', description: 'This is a cached item' },
          { id: 2, name: 'Another item', description: 'Also cached' },
          { id: 3, name: 'Third item', description: 'Cached for 1 hour' }
        ];
      },
      3600 // Cache for 1 hour
    );

    res.json({
      success: true,
      items,
      cached: true, // In production, you might want to track if it was from cache
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[CacheExample] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch items',
      message: error.message
    });
  }
});

export default router;


