import webpush from 'web-push';
import { config } from '../config.js';
import { query } from '../db.js';
import { sendTelegramMessage, isTelegramConfigured } from './telegram.js';

/**
 * Notification core: creation (deduped), multi-channel delivery and pruning.
 *
 * A `notifications` row is BOTH the in-app feed item AND the delivery log:
 *   1. The scheduler INSERTs it with ON CONFLICT (user_id, dedupe_key) DO
 *      NOTHING, so a restart or double-tick can never create a duplicate.
 *   2. deliverPending() then pushes it over Telegram and Web Push, flipping
 *      sent_telegram / sent_push as each channel succeeds. Failed sends are
 *      retried on later ticks until the retry window passes.
 *
 * The in-app feed is therefore always complete, even when Telegram or push
 * are unconfigured or a send fails.
 */

export const PRAYER_LABELS = {
  subuh: 'Subuh',
  zuhur: 'Zuhur',
  asar: 'Asar',
  maghrib: 'Maghrib',
  isyak: 'Isyak',
};

let pushReady = false;

/** Configure Web Push (VAPID). No-op when keys are absent — push just stays off. */
export function initWebPush() {
  const { publicKey, privateKey, subject } = config.webpush;
  if (!publicKey || !privateKey) {
    console.log('[notify] Web Push disabled (WEBPUSH_PUBLIC_KEY / WEBPUSH_PRIVATE_KEY not set)');
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    pushReady = true;
    console.log('[notify] Web Push enabled');
  } catch (err) {
    console.error('[notify] invalid VAPID details:', err.message);
    pushReady = false;
  }
  return pushReady;
}

export function pushConfigured() {
  return pushReady;
}

/** Escape text for Telegram's HTML parse mode (program titles are user input). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Create a notification for a user. Returns the row when it was newly
 * created, or null when it already existed (dedupe_key hit).
 */
export async function createNotification({ userId, kind, title, body, link, dedupeKey }) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id, user_id, kind, title, body, link, dedupe_key, created_at`,
    [userId, kind, title, body ?? null, link ?? null, dedupeKey],
  );
  return rows[0] ?? null;
}

/** Format an instant in the surau's timezone, e.g. "7:30 PM". */
export function formatTimeInTz(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.prayer.timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Human "when" for a program start: "today at 7:30 PM" / "tomorrow ..." / "Mon, 14 Oct, 7:30 PM". */
export function formatWhenInTz(date, now = new Date()) {
  const tz = config.prayer.timezone;
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const today = dayFmt.format(now);
  const day = dayFmt.format(date);
  const time = formatTimeInTz(date);
  if (day === today) return `today at ${time}`;
  const tomorrow = dayFmt.format(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (day === tomorrow) return `tomorrow at ${time}`;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date);
  return `${weekday} at ${time}`;
}

/**
 * Deliver every pending (created within the retry window, at least one channel
 * still owed) notification. Sequential on purpose: Telegram rate-limits at
 * ~30 msg/s and the volumes here are tiny.
 */
export async function deliverPending() {
  if (!isTelegramConfigured() && !pushReady) return;

  const hours = Math.max(1, config.notifications.retryWindowHours);
  const { rows } = await query(
    `SELECT n.id, n.user_id, n.title, n.body, n.link, n.dedupe_key,
            n.sent_telegram, n.sent_push, u.telegram_chat_id,
            COALESCE(p.telegram_enabled, TRUE) AS telegram_enabled,
            COALESCE(p.push_enabled, TRUE) AS push_enabled
     FROM notifications n
     JOIN users u ON u.id = n.user_id
     LEFT JOIN notification_prefs p ON p.user_id = n.user_id
     WHERE n.created_at > now() - make_interval(hours => $1)
       AND u.is_active = TRUE
       AND (
         (n.sent_telegram = FALSE AND u.telegram_chat_id IS NOT NULL
          AND COALESCE(p.telegram_enabled, TRUE) AND $2)
         OR
         (n.sent_push = FALSE AND COALESCE(p.push_enabled, TRUE) AND $3
          AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = n.user_id))
       )
     ORDER BY n.created_at
     LIMIT 100`,
    [hours, isTelegramConfigured(), pushReady],
  );

  for (const row of rows) {
    const patch = {};

    if (!row.sent_telegram && row.telegram_chat_id && row.telegram_enabled && isTelegramConfigured()) {
      const text =
        `<b>${escapeHtml(row.title)}</b>\n` +
        `${escapeHtml(row.body || '')}\n` +
        `${appLink(row.link)}`;
      const res = await sendTelegramMessage(row.telegram_chat_id, text.trim());
      if (res.ok) patch.sent_telegram = true;
      else console.warn(`[notify] telegram delivery failed for ${row.user_id}: ${res.error}`);
    }

    if (!row.sent_push && row.push_enabled && pushReady) {
      const { rows: subs } = await query(
        `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
        [row.user_id],
      );
      if (subs.length) {
        let allOk = true;
        for (const sub of subs) {
          const result = await sendPushToSubscription(sub, row);
          if (result === 'dead') {
            // 404/410: the browser wiped the subscription. Drop it.
            await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
          } else if (result === 'error') {
            allOk = false;
          }
        }
        if (allOk) patch.sent_push = true;
      }
    }

    if (Object.keys(patch).length) {
      const sets = [];
      const params = [];
      if (patch.sent_telegram !== undefined) {
        params.push(patch.sent_telegram);
        sets.push(`sent_telegram = $${params.length}`);
      }
      if (patch.sent_push !== undefined) {
        params.push(patch.sent_push);
        sets.push(`sent_push = $${params.length}`);
      }
      params.push(row.id);
      await query(`UPDATE notifications SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
  }
}

/** Absolute app URL for a relative link, or '' when PUBLIC_URL is unset. */
function appLink(path) {
  if (!path || !config.publicUrl) return '';
  return `${config.publicUrl.replace(/\/$/, '')}${path}`;
}

/** Returns 'ok' | 'dead' | 'error'. */
async function sendPushToSubscription(sub, row) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: row.title,
        body: row.body || '',
        url: row.link || '/',
        tag: row.dedupe_key,
      }),
      { TTL: 4 * 60 * 60, urgency: 'normal' }, // reminders are only useful for a few hours
    );
    return 'ok';
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return 'dead';
    console.warn(`[notify] push delivery failed (${err.statusCode || err.message})`);
    return 'error';
  }
}

/** Prune in-app feed rows past the retention period. */
export async function pruneOldNotifications() {
  await query(
    `DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1)`,
    [Math.max(1, config.notifications.retentionDays)],
  );
}
