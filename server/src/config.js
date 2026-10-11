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
    // Per-prayer overrides for how early the window opens. Isyak defaults to 0
    // because Maghrib and Isyak are very close together, so opening Isyak early
    // would overlap the Maghrib window.
    beforeMinutesByPrayer: {
      isyak: Number(process.env.PRAYER_WINDOW_BEFORE_MINUTES_ISYAK || 0),
    },
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
  // Push-style notifications: prayer reminders + upcoming-program reminders,
  // delivered over Telegram and Web Push, plus an in-app feed.
  notifications: {
    enabled: (process.env.NOTIFICATIONS_ENABLED || 'true') !== 'false',
    // Scheduler tick interval. Every minute is plenty: the earliest useful
    // reminder (prayer -15 min) dwarfs the tick, and dedupe makes late ticks safe.
    tickMs: Number(process.env.NOTIFICATIONS_TICK_MS || 60_000),
    // Remind this many minutes BEFORE the adhan (matches the check-in window).
    prayerLeadMinutes: Number(process.env.NOTIFY_PRAYER_LEAD_MINUTES || 15),
    // Remind joined members this many hours before a program starts.
    programLeadHours: Number(process.env.NOTIFY_PROGRAM_LEAD_HOURS || 24),
    // How long an undeliverable notification keeps being retried before we
    // give up (it stays visible in the in-app feed regardless).
    retryWindowHours: Number(process.env.NOTIFY_RETRY_WINDOW_HOURS || 2),
    // In-app feed rows older than this are pruned on each tick.
    retentionDays: Number(process.env.NOTIFY_RETENTION_DAYS || 30),
  },
  // Web Push VAPID credentials. Generate with:
  //   npx web-push generate-vapid-keys
  // Empty keys = Web Push silently disabled (Telegram + in-app still work).
  webpush: {
    publicKey: process.env.WEBPUSH_PUBLIC_KEY || '',
    privateKey: process.env.WEBPUSH_PRIVATE_KEY || '',
    subject: process.env.WEBPUSH_SUBJECT || 'mailto:admin@surau.local',
  },
  // Public base URL of the app (used for Telegram webhook registration)
  publicUrl: process.env.PUBLIC_URL || '',
  adminPhones: (process.env.ADMIN_PHONES || '')
    .split(',')
    .map((p) => canonicalPhone(p.trim()))
    .filter(Boolean),
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

export const isProd = config.env === 'production';
