import 'dotenv/config';
import express from 'express';
import http from 'http';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*'} });

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

// Views & static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', meetingRouter);
app.use('/auth', authRouter);
app.use('/api', apiRouter);

// Socket.IO session sharing
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[ScreenX] Server listening on http://localhost:${PORT}`);
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

