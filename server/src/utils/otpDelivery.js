import { config } from '../config.js';
import { sendSms } from './sms.js';
import { sendTelegramMessage, isTelegramConfigured } from './telegram.js';

/**
 * Deliver an OTP code to a user.
 *
 * Channel priority:
 *   1. Telegram  - if the user has linked a chat and the bot is configured (free)
 *   2. SMS       - if SMS_PROVIDER is a real provider (paid)
 *   3. Console   - fallback; logs the code (dev / admin-assisted)
 *
 * Returns { channel, ok, error? } so callers can tell the user what happened.
 */
export async function deliverOtp({ user, phone, code }) {
  const message =
    `Your Pemuda Surau Al-Abqori verification code is <b>${code}</b>.\n` +
    `It expires in ${config.otpTtlMinutes} minutes.`;

  // 1. Telegram (preferred - free)
  if (user?.telegram_chat_id && isTelegramConfigured()) {
    const result = await sendTelegramMessage(user.telegram_chat_id, message);
    if (result.ok) return { channel: 'telegram', ok: true };
    console.warn(`[otp] Telegram delivery failed for ${phone}: ${result.error}`);
    // fall through to SMS/console
  }

  // 2. SMS (paid)
  if (config.sms.provider !== 'console') {
    try {
      await sendSms(phone, message.replace(/<\/?b>/g, ''));
      return { channel: 'sms', ok: true };
    } catch (err) {
      console.warn(`[otp] SMS delivery failed for ${phone}: ${err.message}`);
      // fall through to console
    }
  }

  // 3. Console fallback
  console.log(`[otp:console] to=${phone} code=${code}`);
  return { channel: 'console', ok: true };
}

/**
 * Whether we can actually reach this user without an admin reading the code out.
 */
export function canReachUser(user) {
  if (user?.telegram_chat_id && isTelegramConfigured()) return true;
  if (config.sms.provider !== 'console') return true;
  return false;
}
