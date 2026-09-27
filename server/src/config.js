import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL', 'postgres://surau:surau_password@localhost:5432/pemuda_surau'),
  jwtSecret: required('JWT_SECRET', 'dev_only_secret_change_me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  faceMatchThreshold: Number(process.env.FACE_MATCH_THRESHOLD || 0.55),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 5),
  sms: {
    provider: process.env.SMS_PROVIDER || 'console',
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    // Delivery mode: webhook (production) | polling (local dev)
    mode: process.env.TELEGRAM_MODE || 'webhook',
    pollTimeoutSeconds: Number(process.env.TELEGRAM_POLL_TIMEOUT || 30),
  },
  // How OTP codes are delivered: telegram | sms | console
  otpChannel: process.env.OTP_CHANNEL || 'console',
  // Public base URL of the app (used for Telegram webhook registration)
  publicUrl: process.env.PUBLIC_URL || '',
  adminPhones: (process.env.ADMIN_PHONES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

export const isProd = config.env === 'production';
