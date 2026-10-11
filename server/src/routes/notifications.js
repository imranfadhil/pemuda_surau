import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { pushConfigured } from '../utils/notify.js';

const router = Router();

/**
 * In-app notification feed + delivery preferences + Web Push subscriptions.
 *
 * The feed is the `notifications` table itself (see utils/notify.js): every
 * reminder is stored there first, so the bell shows the same messages that
 * went out over Telegram/push — even on channels the member doesn't use.
 */

/** GET /api/notifications — recent notifications for the caller + unread count. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { rows } = await query(
      `SELECT id, kind, title, body, link, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.sub, limit],
    );
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS unread FROM notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.sub],
    );
    res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
      unread: countRows[0].unread,
    });
  }),
);

/** POST /api/notifications/read — mark all as read (or specific ids). */
const readSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
});

router.post(
  '/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = readSchema.parse(req.body ?? {});
    if (body.ids?.length) {
      await query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
        [req.user.sub, body.ids],
      );
    } else {
      await query(
        `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
        [req.user.sub],
      );
    }
    res.json({ ok: true });
  }),
);

/** GET /api/notifications/prefs — current preferences (defaults when unset). */
router.get(
  '/prefs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT prayer_reminders, program_reminders, telegram_enabled, push_enabled
       FROM notification_prefs WHERE user_id = $1`,
      [req.user.sub],
    );
    const row = rows[0];
    res.json({
      prayerReminders: row ? row.prayer_reminders : true,
      programReminders: row ? row.program_reminders : true,
      telegramEnabled: row ? row.telegram_enabled : true,
      pushEnabled: row ? row.push_enabled : true,
    });
  }),
);

/** PUT /api/notifications/prefs — update preferences (creates the row on first save). */
const prefsSchema = z.object({
  prayerReminders: z.boolean().optional(),
  programReminders: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
});

router.put(
  '/prefs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = prefsSchema.parse(req.body ?? {});
    const { rows } = await query(
      `INSERT INTO notification_prefs (user_id, prayer_reminders, program_reminders, telegram_enabled, push_enabled)
       VALUES ($1,
               COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), COALESCE($5, TRUE))
       ON CONFLICT (user_id) DO UPDATE SET
         prayer_reminders  = COALESCE($2, notification_prefs.prayer_reminders),
         program_reminders = COALESCE($3, notification_prefs.program_reminders),
         telegram_enabled  = COALESCE($4, notification_prefs.telegram_enabled),
         push_enabled      = COALESCE($5, notification_prefs.push_enabled),
         updated_at        = now()
       RETURNING prayer_reminders, program_reminders, telegram_enabled, push_enabled`,
      [req.user.sub, body.prayerReminders, body.programReminders, body.telegramEnabled, body.pushEnabled],
    );
    const row = rows[0];
    res.json({
      prayerReminders: row.prayer_reminders,
      programReminders: row.program_reminders,
      telegramEnabled: row.telegram_enabled,
      pushEnabled: row.push_enabled,
    });
  }),
);

/** GET /api/notifications/push/status — can this server push, and is the key usable by the client. */
router.get(
  '/push/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS devices FROM push_subscriptions WHERE user_id = $1`,
      [req.user.sub],
    );
    res.json({
      configured: pushConfigured(),
      publicKey: pushConfigured() ? config.webpush.publicKey : null,
      devices: rows[0].devices,
    });
  }),
);

/** POST /api/notifications/push/subscribe — register (or refresh) this device's subscription. */
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(10).max(512),
    auth: z.string().min(10).max(256),
  }),
});

router.post(
  '/push/subscribe',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!pushConfigured()) throw httpError(503, 'Web Push is not configured on this server');
    const sub = subscriptionSchema.parse(req.body);
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh  = EXCLUDED.p256dh,
         auth    = EXCLUDED.auth`,
      [req.user.sub, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );
    res.json({ ok: true });
  }),
);

/** POST /api/notifications/push/unsubscribe — remove this device (or all devices when no endpoint). */
const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048).optional(),
});

router.post(
  '/push/unsubscribe',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = unsubscribeSchema.parse(req.body ?? {});
    if (body.endpoint) {
      await query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [
        req.user.sub,
        body.endpoint,
      ]);
    } else {
      await query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [req.user.sub]);
    }
    res.json({ ok: true });
  }),
);

export default router;
