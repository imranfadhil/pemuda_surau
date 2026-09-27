import { config } from '../config.js';

const API_BASE = 'https://api.telegram.org';

function apiUrl(method) {
  return `${API_BASE}/bot${config.telegram.botToken}/${method}`;
}

export function isTelegramConfigured() {
  return Boolean(config.telegram.botToken);
}

/**
 * Send a message to a Telegram chat.
 * Returns { ok: true } on success, or { ok: false, error } on failure.
 *
 * Pass `options.replyMarkup` to attach a keyboard (e.g. a request_contact
 * button used to link an account from a verified phone number).
 */
export async function sendTelegramMessage(chatId, text, options = {}) {
  if (!isTelegramConfigured()) {
    return { ok: false, error: 'Telegram bot token not configured' };
  }
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (options.replyMarkup) body.reply_markup = options.replyMarkup;

    const res = await fetch(apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.description || `Telegram error ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Remove any registered webhook.
 *
 * Telegram allows only ONE delivery method at a time, so polling must clear a
 * webhook before getUpdates will return anything. Called on startup.
 */
export async function deleteTelegramWebhook() {
  if (!isTelegramConfigured()) return { ok: true };
  const res = await fetch(apiUrl('deleteWebhook'), { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false };
}

/**
 * Long-poll for updates. Used by the polling loop.
 * `timeout` is the long-poll duration in seconds.
 */
export async function getUpdates(offset, timeout = 30) {
  if (!isTelegramConfigured()) return [];
  const res = await fetch(apiUrl('getUpdates'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offset,
      timeout,
      allowed_updates: ['message'],
    }),
    // Allow the request to outlive the long-poll window.
    signal: AbortSignal.timeout((timeout + 10) * 1000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram error ${res.status}`);
  }
  return data.result || [];
}

/** Build the deep link a user taps to start the bot with a link token. */
export function buildLinkUrl(token) {
  const username = config.telegram.botUsername;
  if (!username) return null;
  return `https://t.me/${username.replace(/^@/, '')}?start=${token}`;
}

/** Plain deep link to open the bot (used for Telegram-first login). */
export function buildBotUrl() {
  const username = config.telegram.botUsername;
  if (!username) return null;
  return `https://t.me/${username.replace(/^@/, '')}`;
}
