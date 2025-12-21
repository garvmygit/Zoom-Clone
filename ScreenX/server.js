import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import passport from 'passport';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { Server as SocketIOServer } from 'socket.io';

import authRouter from './src/routes/auth.js';
import meetingRouter from './src/routes/meeting.js';
import apiRouter from './src/routes/api.js';
import { configurePassport } from './src/services/passport.js';
import { registerSocketHandlers } from './src/sockets/index.js';
import redisClient, { connectRedis } from './src/redisClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy in production (Vercel etc.)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// DB (tolerate missing Mongo by falling back to memory session store)
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/screenx';
let mongoConnected = false;
try {
  await mongoose.connect(mongoUri);
  mongoConnected = true;
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[ScreenX] MongoDB not available, continuing with memory session store. Some features may be limited.');
}

// Redis (graceful if credentials missing)
try {
  await connectRedis();
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[ScreenX] Redis not available, continuing without redis cache.');
}

// Security & parsing
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions & Passport
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'screenx-secret',
  resave: false,
  saveUninitialized: false,
  store: mongoConnected ? MongoStore.create({ mongoUrl: mongoUri }) : new session.MemoryStore(),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// Simple Redis caching middleware for GET requests
app.use(async (req, res, next) => {
  try {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/auth')) return next();
    if (!redisClient?.isOpen) return next();

    const cacheKey = `cache:${req.originalUrl}`;
    const cachedValue = await redisClient.get(cacheKey);
    if (cachedValue) {
      // eslint-disable-next-line no-console
      console.log('⚡ Cache hit:', req.originalUrl);
      res.set('X-Cache', 'HIT');
      try {
        return res.send(JSON.parse(cachedValue));
      } catch {
        return res.send(cachedValue);
      }
    }

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      const ttlSeconds = Number(process.env.CACHE_TTL_SECONDS || 60);
      const shouldCache = res.statusCode >= 200 && res.statusCode < 300;
      if (shouldCache) {
        let payload;
        if (Buffer.isBuffer(body)) {
          payload = body.toString();
        } else if (typeof body === 'string') {
          payload = body;
        } else {
          try {
            payload = JSON.stringify(body);
          } catch {
            payload = String(body);
          }
        }
        redisClient.set(cacheKey, payload, { EX: ttlSeconds }).catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[Cache] Failed to set cache:', e?.message);
        });
        res.set('X-Cache', 'MISS');
      }
      return originalSend(body);
    };
    return next();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Cache] Middleware error:', e?.message);
    return next();
  }
});

// Views & static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Basic health endpoint required by tests
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/', meetingRouter);
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// Socket.IO session sharing
let server;
let io;

function loadSSLOptions() {
  const candidates = [
    { key: path.join(__dirname, 'cert', 'server.key'), cert: path.join(__dirname, 'cert', 'server.cert') },
    { key: path.join(__dirname, 'cert', 'key.pem'), cert: path.join(__dirname, 'cert', 'cert.pem') }
  ];
  for (const pair of candidates) {
    if (fs.existsSync(pair.key) && fs.existsSync(pair.cert)) {
      return {
        key: fs.readFileSync(pair.key),
        cert: fs.readFileSync(pair.cert)
      };
    }
  }
  return null;
}

const sslOptions = loadSSLOptions();
if (sslOptions) {
  server = https.createServer(sslOptions, app);
} else {
  // fallback to plain HTTP for local/dev/test environments
  server = http.createServer(app);
}

io = new SocketIOServer(server, { cors: { origin: '*' } });
io.engine.use((req, res, next) => sessionMiddleware(req, res, next));
registerSocketHandlers(io);

// Only listen when not running tests
const PORT = Number(process.env.PORT) || (sslOptions ? 4433 : 3000);
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`${sslOptions ? '[ScreenX] 🔒 HTTPS' : '[ScreenX] HTTP'} Server listening on port ${PORT}`);
  });
}

export { app };
export default server;
export { io };

