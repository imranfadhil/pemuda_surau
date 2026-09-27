import crypto from 'node:crypto';
import { Router } from 'express';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import {
  isTelegramConfigured,
  buildLinkUrl,
  setTelegramWebhook,
  getTelegramWebhookInfo,
} from '../utils/telegram.js';
import { handleTelegramUpdate } from '../utils/telegramUpdates.js';

const router = Router();

const LINK_TTL_MINUTES = 15;

/**
 * Create a one-time link token for the current user.
 * The client shows a t.me deep link; tapping it starts the bot with this token.
 */
router.post(
  '/link-token',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isTelegramConfigured()) {
      throw httpError(503, 'Telegram is not configured on this server');
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + LINK_TTL_MINUTES * 60 * 1000);

    await query(
      `INSERT INTO telegram_link_tokens (token, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [token, req.user.sub, expiresAt],
    );

    res.json({
      token,
      linkUrl: buildLinkUrl(token),
      botUsername: config.telegram.botUsername,
      expiresAt,
    });
  }),
);

/** Unlink the current user's Telegram account. */
router.delete(
  '/link',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query(
      `UPDATE users
       SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [req.user.sub],
    );
    res.json({ ok: true });
  }),
);

/** Status of the Telegram integration (for the admin panel). */
router.get(
  '/status',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const info = await getTelegramWebhookInfo();
    const { rows } = await query(
      `SELECT COUNT(*)::int AS linked FROM users WHERE telegram_chat_id IS NOT NULL`,
    );
    res.json({
      configured: isTelegramConfigured(),
      mode: config.telegram.mode,
      botUsername: config.telegram.botUsername || null,
      linkedUsers: rows[0].linked,
      webhook: info,
    });
  }),
);

/** Admin: (re)register the webhook with Telegram. */
router.post(
  '/set-webhook',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const publicUrl = req.body?.publicUrl || config.publicUrl;
    if (!publicUrl) {
      throw httpError(400, 'A public URL is required (set PUBLIC_URL or pass publicUrl)');
    }
    const result = await setTelegramWebhook(publicUrl);
    res.json(result);
  }),
);

/**
 * Telegram webhook. Telegram POSTs updates here.
 * Handles /start <token> to link a chat to a user account.
 */
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    // Verify the secret token if one is configured.
    if (config.telegram.webhookSecret) {
      const provided = req.headers['x-telegram-bot-api-secret-token'];
      if (provided !== config.telegram.webhookSecret) {
        return res.status(401).json({ ok: false });
      }
    }

    // Always ack quickly so Telegram doesn't retry.
    res.json({ ok: true });

    try {
      await handleTelegramUpdate(req.body);
    } catch (err) {
      console.error('[telegram:webhook] failed to handle update', err.message);
    }
  }),
);

export default router;
