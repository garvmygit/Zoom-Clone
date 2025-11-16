/**
 * Express Middleware for Backend Caching
 * Provides cache-first strategy for GET requests
 */

import dbCacheService from './dbCacheService.js';
import memoryCache from './memoryCache.js';

/**
 * Middleware to cache GET requests
 * Checks cache first, then queries DB if miss
 */
export const cacheMiddleware = (options = {}) => {
  const {
    ttl = 60, // Default TTL in seconds
    skipPaths = ['/auth', '/api/assistant', '/api/summary'], // Paths to skip caching
    cacheKeyGenerator = null // Custom cache key generator
  } = options;

  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip certain paths
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Skip WebRTC and Socket.io related paths
    if (req.path.includes('/socket.io') || req.path.includes('/webrtc')) {
      return next();
    }

    try {
      // Generate cache key
      const cacheKey = cacheKeyGenerator 
        ? cacheKeyGenerator(req)
        : `http:${req.method}:${req.originalUrl}`;

      // Check cache
      const cached = memoryCache.get(cacheKey);
      if (cached !== null) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }

      // Cache miss - intercept response
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          memoryCache.set(cacheKey, body, ttl);
          res.set('X-Cache', 'MISS');
        }
        return originalJson(body);
      };

      return next();
    } catch (error) {
      console.error('[Cache Middleware] Error:', error);
      return next();
    }
  };
};

/**
 * Middleware for room-specific caching
 * Automatically uses dbCacheService for room data
 */
export const roomCacheMiddleware = async (req, res, next) => {
  if (req.method !== 'GET' || !req.params.meetingId) {
    return next();
  }

  try {
    const { meetingId } = req.params;
    const room = await dbCacheService.getRoom(meetingId);
    
    if (room) {
      res.set('X-Cache', 'HIT');
      return res.json(room);
    }

    // If room not found, continue to route handler
    return next();
  } catch (error) {
    console.error('[Room Cache Middleware] Error:', error);
    return next();
  }
};

/**
 * Middleware for chat history caching
 */
export const chatCacheMiddleware = async (req, res, next) => {
  if (req.method !== 'GET' || !req.params.roomId && !req.query.meetingId) {
    return next();
  }

  try {
    const meetingId = req.params.roomId || req.query.meetingId;
    const messages = await dbCacheService.getChatHistory(meetingId);
    
    res.set('X-Cache', 'HIT');
    return res.json({ messages, cached: true });
  } catch (error) {
    console.error('[Chat Cache Middleware] Error:', error);
    return next();
  }
};

/**
 * Helper to invalidate cache after mutations
 */
export const invalidateCache = (pattern) => {
  if (typeof pattern === 'string') {
    // Invalidate specific meeting
    if (pattern.startsWith('meeting:')) {
      const meetingId = pattern.replace('meeting:', '');
      dbCacheService.invalidateMeeting(meetingId);
    } else if (pattern.startsWith('user:')) {
      const userId = pattern.replace('user:', '');
      dbCacheService.invalidateUser(userId);
    }
  } else {
    // Invalidate by regex pattern
    memoryCache.invalidatePattern(pattern);
  }
};

export default {
  cacheMiddleware,
  roomCacheMiddleware,
  chatCacheMiddleware,
  invalidateCache
};


