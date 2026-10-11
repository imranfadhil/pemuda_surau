import './net.js'; // Must come first: configures outbound IPv4/IPv6 behaviour.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { startTelegramPolling, stopTelegramPolling } from './utils/telegramPolling.js';
import { initWebPush } from './utils/notify.js';
import { startScheduler, stopScheduler } from './utils/scheduler.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';
import programRoutes from './routes/programs.js';
import telegramRoutes from './routes/telegram.js';
import activityRoutes from './routes/activity.js';
import notificationRoutes from './routes/notifications.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
app.use(express.json({ limit: '2mb' })); // face descriptors + payloads
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// Throttle OTP requests to reduce SMS abuse.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/auth/request-otp', otpLimiter);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[api] listening on port ${config.port} (${config.env})`);

  // Pull Telegram updates (long-polling). No public URL or webhook required.
  startTelegramPolling().catch((err) =>
    console.error('[telegram:polling] failed to start', err.message),
  );

  // Prayer + program reminders over Telegram/Web Push, plus the in-app feed.
  initWebPush();
  if (config.notifications.enabled) startScheduler();
  else console.log('[scheduler] notifications disabled (NOTIFICATIONS_ENABLED=false)');
});

async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);
  stopScheduler();
  stopTelegramPolling();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
