import 'dotenv/config';
import { canonicalPhone } from './utils/phone.js';

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
    // Long-poll duration in seconds.
    pollTimeoutSeconds: Number(process.env.TELEGRAM_POLL_TIMEOUT || 30),
  },
  // Prayer times + automatic check-in windows (Aladhan API).
  prayer: {
    latitude: Number(process.env.PRAYER_LATITUDE || 2.93276),
    longitude: Number(process.env.PRAYER_LONGITUDE || 101.8047),
    timezone: process.env.PRAYER_TIMEZONE || 'Asia/Kuala_Lumpur',
    // Aladhan calculation method id. 17 = JAKIM (Malaysia).
    method: Number(process.env.PRAYER_CALC_METHOD || 17),
    // Check-in window: opens N minutes before the adhan, closes M minutes after.
    beforeMinutes: Number(process.env.PRAYER_WINDOW_BEFORE_MINUTES || 15),
    afterMinutes: Number(process.env.PRAYER_WINDOW_AFTER_MINUTES || 60),
    // When false, the client may pick any prayer (legacy behaviour).
    enforceWindow: (process.env.PRAYER_WINDOW_ENFORCED || 'true') !== 'false',
  },
  // Geofence: check-ins are only accepted within this radius of the surau.
  // Uses the same coordinates as prayer times.
  geofence: {
    enabled: (process.env.GEOFENCE_ENABLED || 'true') !== 'false',
    radiusMeters: Number(process.env.GEOFENCE_RADIUS_METERS || 150),
  },
  // How OTP codes are delivered: telegram | sms | console
  otpChannel: process.env.OTP_CHANNEL || 'console',
  // Public base URL of the app (used for Telegram webhook registration)
  publicUrl: process.env.PUBLIC_URL || '',
  adminPhones: (process.env.ADMIN_PHONES || '')
    .split(',')
    .map((p) => canonicalPhone(p.trim()))
    .filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

export const isProd = config.env === 'production';
