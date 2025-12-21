// Test setup: enforce test env and remove browser-only globals
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '0';

// Ensure browser storage APIs do not exist during tests
try {
  // Some test environments may polyfill window; remove storage to simulate unavailable APIs
  if (global.window) {
    delete global.window.localStorage;
    delete global.window.sessionStorage;
  }
} catch (e) {
  // ignore
}

// Ensure globals are clean
try {
  delete global.localStorage;
  delete global.sessionStorage;
} catch (e) {
  // ignore
}
