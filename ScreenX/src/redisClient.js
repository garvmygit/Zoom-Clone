import { createClient } from 'redis';

// Read Redis configuration from environment variables
// IMPORTANT: Never commit the actual password to the repository.
// Store REDIS_PASSWORD in environment variables or a secrets manager (e.g., GitHub Actions Secrets, AWS Secrets Manager).
const REDIS_HOST = process.env.REDIS_HOST || 'redis-11745.crce182.ap-south-1-1.ec2.cloud.redislabs.com';
const REDIS_PORT = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 11745;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_USERNAME = process.env.REDIS_USERNAME || 'default';

if (!REDIS_PASSWORD) {
  console.warn('[Redis] Warning: REDIS_PASSWORD not set. Caching will be disabled.');
}

// Use URL format for Redis Cloud (more reliable)
const connectionString = REDIS_PASSWORD 
  ? `redis://${REDIS_USERNAME}:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`
  : `redis://${REDIS_HOST}:${REDIS_PORT}`;

const redisClient = createClient({
  url: connectionString,
  socket: {
    reconnectStrategy: (retries) => {
      // Stop retrying after 3 attempts to prevent infinite loops
      if (retries > 3) {
        console.error('[Redis] Max reconnection attempts reached. Stopping retries.');
        return false; // Stop reconnecting
      }
      return Math.min(retries * 100, 3000); // Exponential backoff
    }
  }
});

let connectionAttempted = false;
let connectionSuccessful = false;

redisClient.on('connect', () => {
  if (!connectionSuccessful) {
    console.log('✅ Redis connected successfully.');
    connectionSuccessful = true;
  }
});

redisClient.on('ready', () => {
  if (!connectionSuccessful) {
    console.log('✅ Redis ready and operational.');
    connectionSuccessful = true;
  }
});

redisClient.on('error', (err) => {
  // Only log errors if we haven't successfully connected
  if (!connectionSuccessful) {
    console.error('❌ Redis connection error:', err.message);
    // If it's an authentication error, don't keep retrying
    if (err.message.includes('WRONGPASS') || err.message.includes('AUTH') || err.message.includes('NOAUTH')) {
      console.error('[Redis] Authentication failed. Please check REDIS_PASSWORD and REDIS_USERNAME in .env');
      console.error('[Redis] Caching will be disabled until credentials are corrected.');
    }
  }
});

/**
 * Connect to Redis server
 * @returns {Promise<void>}
 */
export async function connectRedis() {
  // Prevent multiple connection attempts
  if (connectionAttempted) {
    return;
  }
  
  connectionAttempted = true;
  
  // Don't attempt connection if password is missing
  if (!REDIS_PASSWORD) {
    console.warn('[Redis] Skipping connection - REDIS_PASSWORD not set.');
    return;
  }
  
  try {
    if (!redisClient.isOpen && !connectionSuccessful) {
      await redisClient.connect();
    }
  } catch (err) {
    console.error('[Redis] Connection failed:', err.message);
    // Don't throw - allow app to continue without Redis (graceful degradation)
    connectionAttempted = false; // Allow retry on next server restart
  }
}

/**
 * Get cached value or compute and cache it
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function that returns the value to cache
 * @param {number} ttl - Time to live in seconds (default: 3600)
 * @returns {Promise<any>} - Cached or computed value
 */
export async function getOrSetCache(key, fetchFn, ttl = 3600) {
  try {
    if (!redisClient.isOpen) return await fetchFn();

    const cached = await redisClient.get(key);
    if (cached) {
      console.log(`📦 Cache hit for key: ${key}`);
      return JSON.parse(cached);
    }

    const data = await fetchFn();
    await redisClient.set(key, JSON.stringify(data), { EX: ttl });
    console.log(`💾 Cache stored for key: ${key}`);
    return data;
  } catch (err) {
    console.error('[Redis] Cache error:', err.message);
    return await fetchFn();
  }
}

export default redisClient;

