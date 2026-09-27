import { query } from '../db.js';
import { sendTelegramMessage } from './telegram.js';

/**
 * Process a single Telegram update.
 *
 * Shared by both delivery modes:
 *   - webhook  (production): Telegram POSTs updates to /api/telegram/webhook
 *   - polling  (local dev):  we pull updates with getUpdates
 *
 * Currently handles /start <token> to link a chat to a user account.
 */
export async function handleTelegramUpdate(update) {
  const message = update?.message;
  const text = message?.text || '';
  const chatId = message?.chat?.id;
  const username = message?.from?.username || null;

  if (!chatId || !text.startsWith('/start')) return;

  const token = text.split(/\s+/)[1];
  if (!token) {
    await sendTelegramMessage(
      chatId,
      'Welcome to Surau Al-Abqori! Open the app and tap "Link Telegram" to connect your account.',
    );
    return;
  }

  const { rows } = await query(
    `SELECT * FROM telegram_link_tokens
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()`,
    [token],
  );
  const link = rows[0];
  if (!link) {
    await sendTelegramMessage(
      chatId,
      'This link has expired or was already used. Please generate a new one in the app.',
    );
    return;
  }

  // Ensure this chat isn't already linked to a different account.
  const { rows: existing } = await query(
    'SELECT id FROM users WHERE telegram_chat_id = $1 AND id <> $2',
    [String(chatId), link.user_id],
  );
  if (existing[0]) {
    await sendTelegramMessage(chatId, 'This Telegram account is already linked to another member.');
    return;
  }

  await query(
    `UPDATE users
     SET telegram_chat_id = $1, telegram_username = $2, telegram_linked_at = now(), updated_at = now()
     WHERE id = $3`,
    [String(chatId), username, link.user_id],
  );
  await query('UPDATE telegram_link_tokens SET used_at = now() WHERE token = $1', [token]);

  await sendTelegramMessage(
    chatId,
    '✅ Linked! You will now receive your Surau Al-Abqori login codes here.',
  );
}
