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
 */
export async function sendTelegramMessage(chatId, text) {
  if (!isTelegramConfigured()) {
    return { ok: false, error: 'Telegram bot token not configured' };
  }
  try {
    const res = await fetch(apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
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
 * Register the webhook so Telegram forwards updates to our API.
 * Call once after deploying (or via the admin panel).
 */
export async function setTelegramWebhook(publicUrl) {
  if (!isTelegramConfigured()) {
    throw new Error('Telegram bot token not configured');
  }
  const url = `${publicUrl.replace(/\/$/, '')}/api/telegram/webhook`;
  const res = await fetch(apiUrl('setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: config.telegram.webhookSecret || undefined,
      allowed_updates: ['message'],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram error ${res.status}`);
  }
  return { ok: true, url };
}

export async function deleteTelegramWebhook() {
  if (!isTelegramConfigured()) return { ok: true };
  const res = await fetch(apiUrl('deleteWebhook'), { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok !== false };
}

export async function getTelegramWebhookInfo() {
  if (!isTelegramConfigured()) return null;
  const res = await fetch(apiUrl('getWebhookInfo'));
  const data = await res.json().catch(() => ({}));
  return data.result || null;
}

/**
 * Long-poll for updates. Used by polling mode (local development).
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
