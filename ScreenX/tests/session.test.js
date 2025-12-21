import request from 'supertest';
import { app } from '../server.js';

test('session persists across requests and cookies are set', async () => {
  app.post('/__test/set-session', (req, res) => {
    req.session.testValue = 'hello-session';
    res.json({ ok: true });
  });

  app.get('/__test/get-session', (req, res) => {
    res.json({ value: req.session.testValue || null });
  });

  const agent = request.agent(app);
  const setRes = await agent.post('/__test/set-session').expect(200);
  expect(setRes.headers['set-cookie']).toBeDefined();

  const getRes = await agent.get('/__test/get-session').expect(200);
  expect(getRes.body.value).toBe('hello-session');
});
