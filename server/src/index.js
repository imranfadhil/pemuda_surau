import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { startTelegramPolling, stopTelegramPolling } from './utils/telegramPolling.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';
import programRoutes from './routes/programs.js';
import telegramRoutes from './routes/telegram.js';

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

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[api] listening on port ${config.port} (${config.env})`);

  // Local development: pull Telegram updates instead of receiving webhooks.
  if (config.telegram.mode === 'polling') {
    startTelegramPolling().catch((err) =>
      console.error('[telegram:polling] failed to start', err.message),
    );
  }
});

async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);
  stopTelegramPolling();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
