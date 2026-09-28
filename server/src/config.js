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
  // Registration gate: a NEW account may only be created within this radius of
  // the surau (anti-abuse). Deliberately far wider than the check-in radius -
  // it covers the "go home first, then sign up" gap. Applies to new accounts
  // only, so existing members can always log in from anywhere.
  registration: {
    geofenceEnabled: (process.env.REGISTRATION_GEOFENCE_ENABLED || 'true') !== 'false',
    radiusMeters: Number(process.env.REGISTRATION_GEOFENCE_RADIUS_METERS || 1500),
  },
  // Quran self-logging: every log must be at the surau, and at most one log per
  // member per this many minutes.
  quran: {
    cooldownMinutes: Number(process.env.QURAN_LOG_COOLDOWN_MINUTES || 60),
  },
  // The programme is for YOUTH. Dashboard stats and the leaderboard only count
  // members younger than this age, so adult/committee accounts (teachers, AJK,
  // parents) do not skew the numbers. Age is derived from `birth_date`.
  dashboard: {
    maxAge: Number(process.env.DASHBOARD_MAX_AGE || 19),
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
