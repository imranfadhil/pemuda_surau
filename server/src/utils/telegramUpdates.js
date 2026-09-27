import { query } from '../db.js';
import { config } from '../config.js';
import { sendTelegramMessage } from './telegram.js';
import { generateOtp, hashOtp, otpExpiryDate, normalizePhone } from './otp.js';

/**
 * Process a single Telegram update.
 *
 * Shared by both delivery modes:
 *   - webhook  (production): Telegram POSTs updates to /api/telegram/webhook
 *   - polling  (local dev):  we pull updates with getUpdates
 *
 * Handles two flows:
 *   1. Telegram-first login (primary): the user shares their phone number via
 *      the bot's "Share my number" button. Telegram verifies the number, so we
 *      can trust it, link the chat to the matching account and send a login
 *      code straight away - no admin involvement.
 *   2. /start <token> (secondary): links a chat to an already-authenticated
 *      account from the profile screen.
 */
export async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message) return;

  const chatId = message.chat?.id;
  if (!chatId) return;

  // Flow 1: the user shared their phone number (verified by Telegram).
  if (message.contact) {
    await handleContactShare(chatId, message);
    return;
  }

  const text = message.text || '';
  if (!text.startsWith('/start')) return;

  const token = text.split(/\s+/)[1];
  if (!token) {
    await promptPhoneShare(chatId);
    return;
  }

  await handleLinkToken(chatId, message.from?.username || null, token);
}

/** Ask the user to share their phone number so we can identify them. */
async function promptPhoneShare(chatId) {
  await sendTelegramMessage(
    chatId,
    'Welcome to Pemuda Surau Al-Abqori! 👋\n\n' +
      'Tap the button below to share your phone number. We use it to find your ' +
      'account and send your login code here.',
    {
      replyMarkup: {
        keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },
  );
}

/**
 * Handle a shared contact. Telegram only lets a user share their *own* number
 * via request_contact, and sets contact.user_id to their Telegram id, so we
 * verify that before trusting the number.
 */
async function handleContactShare(chatId, message) {
  const contact = message.contact;
  const fromId = message.from?.id;

  // Reject contacts that aren't the sender's own number.
  if (contact.user_id && String(contact.user_id) !== String(fromId)) {
    await sendTelegramMessage(chatId, 'Please share your own phone number using the button.');
    return;
  }

  const phone = normalizePhone(contact.phone_number);
  const user = await findUserByPhone(phone);

  if (!user) {
    await sendTelegramMessage(
      chatId,
      `We couldn't find an account for ${phone}.\n\n` +
        'Please register in the app first, then come back and share your number again.',
    );
    return;
  }

  if (!user.is_active) {
    await sendTelegramMessage(chatId, 'This account has been deactivated. Please contact an admin.');
    return;
  }

  if (user.guardian_id) {
    await sendTelegramMessage(
      chatId,
      'This is a dependent account. Please ask your guardian to check in for you.',
    );
    return;
  }

  // Ensure this chat isn't already linked to a different account.
  const { rows: existing } = await query(
    'SELECT id FROM users WHERE telegram_chat_id = $1 AND id <> $2',
    [String(chatId), user.id],
  );
  if (existing[0]) {
    await sendTelegramMessage(chatId, 'This Telegram account is already linked to another member.');
    return;
  }

  await query(
    `UPDATE users
     SET telegram_chat_id = $1, telegram_username = $2, telegram_linked_at = now(), updated_at = now()
     WHERE id = $3`,
    [String(chatId), message.from?.username || null, user.id],
  );

  // Issue a login code immediately so the user can sign in right away.
  const code = generateOtp();
  const codeHash = await hashOtp(code);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, 'login', $3)`,
    [user.phone, codeHash, otpExpiryDate()],
  );

  await sendTelegramMessage(
    chatId,
    `✅ Linked! You'll now receive your login codes here.\n\n` +
      `Your login code is <b>${code}</b>.\n` +
      `It expires in ${config.otpTtlMinutes} minutes. Enter it in the app to sign in.`,
    { replyMarkup: { remove_keyboard: true } },
  );
}

/** Link a chat to an account using a one-time token from the profile screen. */
async function handleLinkToken(chatId, username, token) {
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
    '✅ Linked! You will now receive your Pemuda Surau Al-Abqori login codes here.',
  );
}

/**
 * Find a user by phone, tolerating local vs international formatting
 * (e.g. 0123456789 vs +60123456789).
 */
async function findUserByPhone(phone) {
  const variants = new Set([phone]);
  if (phone.startsWith('+')) variants.add(phone.slice(1));
  if (phone.startsWith('0')) variants.add(`+60${phone.slice(1)}`);
  if (phone.startsWith('+60')) variants.add(`0${phone.slice(3)}`);

  const { rows } = await query(
    `SELECT * FROM users WHERE phone = ANY($1::text[]) LIMIT 1`,
    [[...variants]],
  );
  return rows[0] || null;
}
