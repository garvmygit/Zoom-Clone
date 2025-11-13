/**
 * Unit tests for Redis caching functionality
 * 
 * These tests mock the Redis client to verify caching behavior
 * without requiring a live Redis connection.
 */

import { jest } from '@jest/globals';

// Mock the redis module before importing
const mockRedisClient = {
  isOpen: true,
  connect: jest.fn().mockResolvedValue(undefined),
  get: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  on: jest.fn()
};

// Mock redis module
jest.unstable_mockModule('redis', () => ({
  createClient: jest.fn(() => mockRedisClient)
}));

// Import after mocking (using dynamic import)
const redisClientModule = await import('../src/redisClient.js');
const { getOrSetCache } = redisClientModule;

describe('Redis Cache Helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.isOpen = true;
  });

  describe('getOrSetCache', () => {
    it('should return cached value when it exists', async () => {
      const cachedData = [{ id: 1, name: 'Cached Item' }];
      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await getOrSetCache('test:key', async () => {
        return [{ id: 2, name: 'New Item' }];
      }, 3600);

      expect(result).toEqual(cachedData);
      expect(mockRedisClient.get).toHaveBeenCalledWith('test:key');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should compute and cache value when cache miss', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const computedData = [{ id: 1, name: 'Computed Item' }];
      const computeFn = jest.fn().mockResolvedValue(computedData);

      const result = await getOrSetCache('test:key', computeFn, 3600);

      expect(result).toEqual(computedData);
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test:key',
        JSON.stringify(computedData),
        { EX: 3600 }
      );
    });

    it('should use custom TTL when provided', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const computedData = { data: 'test' };
      const computeFn = jest.fn().mockResolvedValue(computedData);

      await getOrSetCache('test:key', computeFn, 7200);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test:key',
        JSON.stringify(computedData),
        { EX: 7200 }
      );
    });

    it('should fall back to compute function when Redis is not connected', async () => {
      mockRedisClient.isOpen = false;
      const computedData = [{ id: 1, name: 'Fallback Item' }];
      const computeFn = jest.fn().mockResolvedValue(computedData);

      const result = await getOrSetCache('test:key', computeFn, 3600);

      expect(result).toEqual(computedData);
      expect(computeFn).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.get).not.toHaveBeenCalled();
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection error'));
      const computedData = [{ id: 1, name: 'Error Fallback' }];
      const computeFn = jest.fn().mockResolvedValue(computedData);

      const result = await getOrSetCache('test:key', computeFn, 3600);

      expect(result).toEqual(computedData);
      expect(computeFn).toHaveBeenCalledTimes(1);
    });

    it('should handle JSON parsing errors gracefully', async () => {
      mockRedisClient.get.mockResolvedValue('invalid json');
      const computedData = [{ id: 1, name: 'Parse Error Fallback' }];
      const computeFn = jest.fn().mockResolvedValue(computedData);

      // Should catch JSON parse error and fall back
      const result = await getOrSetCache('test:key', computeFn, 3600);

      // Should still return computed data after error
      expect(computeFn).toHaveBeenCalled();
    });
  });
});

describe('Cache Example Route Integration', () => {
  it('should demonstrate caching pattern', async () => {
    // This test shows how the cacheExample route would use getOrSetCache
    const routeKey = 'screenx:items';
    const mockItems = [
      { id: 1, name: 'Demo item' },
      { id: 2, name: 'Another item' }
    ];

    // First call - cache miss
    mockRedisClient.get.mockResolvedValueOnce(null);
    const computeFn = jest.fn().mockResolvedValue(mockItems);

    const firstResult = await getOrSetCache(routeKey, computeFn, 3600);
    expect(firstResult).toEqual(mockItems);
    expect(computeFn).toHaveBeenCalledTimes(1);

    // Second call - cache hit
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockItems));
    const secondResult = await getOrSetCache(routeKey, computeFn, 3600);
    expect(secondResult).toEqual(mockItems);
    expect(computeFn).toHaveBeenCalledTimes(1); // Should not be called again
  });
});

