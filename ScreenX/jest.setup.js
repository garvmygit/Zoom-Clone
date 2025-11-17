// Jest setup file for ScreenX

// Set dummy Redis password for tests to silence warnings
// Tests use mocked Redis, so no real credentials are needed
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'dummy';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// General test setup logging
console.log('✅ Jest environment initialized for ScreenX');
