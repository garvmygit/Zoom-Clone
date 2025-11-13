import 'dotenv/config';
import fs from 'fs';
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
await connectRedis();

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

// Routes
app.use('/', meetingRouter);
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// Socket.IO session sharing
// Create HTTPS server with local certificates
function loadSSLOptions() {
  // Support both server.key/server.cert (our script) and key.pem/cert.pem (user-provided)
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
  throw new Error('SSL certificates not found. Generate them with: npm run generate-cert');
}

let httpsServer;
let io;
try {
  const sslOptions = loadSSLOptions();
  httpsServer = https.createServer(sslOptions, app);
  io = new SocketIOServer(httpsServer, { cors: { origin: '*' } });
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('❌ Failed to start HTTPS server:', e.message);
  // Surface a clearer message for certificate generation
  // eslint-disable-next-line no-console
  console.error('Run: npm run generate-cert');
  process.exit(1);
}

io.engine.use((req, res, next) => sessionMiddleware(req, res, next));
registerSocketHandlers(io);

// Environment variable validation
const requiredEnvVars = [];
const optionalEnvVars = ['OPENAI_API_KEY', 'MONGO_URI', 'SESSION_SECRET', 'PORT'];

console.log('\n[ScreenX] Environment Configuration:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✓ MongoDB URI:', mongoUri);
console.log('✓ Session Secret:', process.env.SESSION_SECRET ? 'Set' : 'Using default');
console.log('✓ OpenAI API Key:', process.env.OPENAI_API_KEY ? '✓ Loaded' : '✗ Missing (AI features disabled)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!process.env.OPENAI_API_KEY) {
  console.warn('[ScreenX] WARNING: OPENAI_API_KEY is not set.');
  console.warn('[ScreenX] AI features (meeting summaries, chatbot) will be disabled.');
  console.warn('[ScreenX] To enable: Add OPENAI_API_KEY=your_key_here to your .env file\n');
}

const PORT = Number(process.env.PORT) || 4433;
httpsServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[ScreenX] 🔒 HTTPS Server listening on https://localhost:${PORT}`);
  if (mongoConnected) {
    // eslint-disable-next-line no-console
    console.log('[ScreenX] ✓ MongoDB connected:', mongoUri);
  } else {
    console.warn('[ScreenX] ⚠ MongoDB not connected - using memory session store');
  }
  if (process.env.OPENAI_API_KEY) {
    console.log('[ScreenX] ✓ AI features enabled');
  }
  console.log('');
});

