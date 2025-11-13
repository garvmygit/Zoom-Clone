/**
 * Sample test file for ScreenX
 * This file demonstrates basic Jest setup and can be used to verify configuration.
 */

test('ScreenX basic test', async () => {
  const sum = (a, b) => a + b;
  expect(sum(2, 3)).toBe(5);
});

test('Array operations work', () => {
  const arr = [1, 2, 3];
  expect(arr.length).toBe(3);
  expect(arr.includes(2)).toBe(true);
});

test('Async operations work', async () => {
  const asyncValue = await Promise.resolve(42);
  expect(asyncValue).toBe(42);
});


