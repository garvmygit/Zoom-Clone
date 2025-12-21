import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import cors from 'cors';
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

// Trust proxy in production (Render/behind proxy)
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
// Body size limits to protect from large payloads
app.use(express.json({ limit: process.env.BODY_LIMIT || '100kb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.BODY_LIMIT || '100kb' }));

// CORS - use ALLOWED_ORIGIN environment variable in production
const allowedOrigin = process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*');
app.use(cors({ origin: allowedOrigin || true, credentials: true }));

// Basic in-memory rate limiter (per IP) for critical routes
const rateWindows = new Map();
function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  return (req, res, next) => {
    try {
      const key = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'anon';
      const now = Date.now();
      let entry = rateWindows.get(key);
      if (!entry || now - entry.start > windowMs) {
        entry = { start: now, count: 0 };
      }
      entry.count += 1;
      rateWindows.set(key, entry);
      if (entry.count > max) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      return next();
    } catch (e) {
      return next();
    }
  };
}

// Apply conservative limiter to auth and api routes
app.use('/auth', rateLimit({ windowMs: 60000, max: 30 }));
app.use('/api', rateLimit({ windowMs: 60000, max: 60 }));

// Sessions & Passport
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'screenx-secret',
  name: process.env.SESSION_COOKIE_NAME || 'screenx.sid',
  resave: false,
  saveUninitialized: false,
  store: mongoConnected ? MongoStore.create({ mongoUrl: mongoUri }) : new session.MemoryStore(),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax'
  }
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
// Render provides TLS termination; do not require local certs in production
if (sslOptions && process.env.NODE_ENV !== 'production') {
  server = https.createServer(sslOptions, app);
} else {
  // fallback to plain HTTP for local/dev/test or when certs absent
  server = http.createServer(app);
}

const sioCors = {
  origin: process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*'),
  methods: ['GET', 'POST'],
  credentials: true
};

io = new SocketIOServer(server, {
  cors: sioCors,
  pingInterval: 25000,
  pingTimeout: 60000,
  transports: ['websocket', 'polling']
});
io.engine.use((req, res, next) => sessionMiddleware(req, res, next));
// Socket.IO middleware: origin check and simple rate limiting per socket
const socketRate = new Map();
io.use((socket, next) => {
  try {
    const origin = socket.handshake.headers.origin;
    if (process.env.ALLOWED_ORIGIN && process.env.ALLOWED_ORIGIN !== '' && origin && origin !== process.env.ALLOWED_ORIGIN) {
      return next(new Error('Origin not allowed'));
    }
    const addr = socket.handshake.address || socket.handshake.headers['x-forwarded-for'] || socket.conn?.remoteAddress || 'anon';
    let entry = socketRate.get(addr);
    const now = Date.now();
    if (!entry || now - entry.start > 60000) entry = { start: now, count: 0 };
    entry.count += 1;
    socketRate.set(addr, entry);
    if (entry.count > 300) return next(new Error('Rate limit')); // permissive default
    return next();
  } catch (e) {
    return next();
  }
});
registerSocketHandlers(io);

// Only listen when not running tests
const PORT = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[ScreenX] Server listening on port ${PORT}`);
  });
}

// Basic error handler to avoid leaking stack traces in production
app.use((err, req, res, _next) => {
  // eslint-disable-next-line no-console
  if (process.env.NODE_ENV !== 'production') console.error(err);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// Graceful shutdown
async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[ScreenX] Received ${signal}, shutting down`);
  try {
    if (io && io.close) io.close();
    if (server && server.close) await new Promise((r) => server.close(r));
    try { await mongoose.disconnect(); } catch (e) {}
    try { await redisClient.disconnect(); } catch (e) {}
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error during shutdown', e);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app };
export default server;
export { io };

