import server from '../server.js';

test('server starts without SSL (binds to a port)', async () => {
  const srv = server.listen(0);
  await new Promise((resolve) => srv.once('listening', resolve));
  const addr = srv.address();
  expect(addr && addr.port).toBeGreaterThan(0);
  await new Promise((resolve) => srv.close(resolve));
});
