import request from 'supertest';
import { app } from '../server.js';

test('GET /health returns status ok', async () => {
  const res = await request(app).get('/health').expect(200);
  expect(res.body).toEqual({ status: 'ok' });
});
