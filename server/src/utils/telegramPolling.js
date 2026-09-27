import { config } from '../config.js';
import { isTelegramConfigured, getUpdates, deleteTelegramWebhook } from './telegram.js';
import { handleTelegramUpdate } from './telegramUpdates.js';

let running = false;
let stopped = false;
let offset = 0;

/**
 * Long-poll Telegram for updates.
 *
 * This is the only delivery mode: it needs no public HTTPS URL, so it keeps
 * working even though the quick-tunnel URL changes on every restart.
 *
 * Note: Telegram only allows ONE delivery method at a time, so we delete any
 * existing webhook before polling starts.
 */
export async function startTelegramPolling() {
  if (!isTelegramConfigured()) {
    console.warn('[telegram:polling] TELEGRAM_BOT_TOKEN not set - polling disabled');
    return;
  }
  if (running) return;
  running = true;

  // A webhook and getUpdates are mutually exclusive.
  await deleteTelegramWebhook().catch(() => {});
  console.log('[telegram:polling] started (long-polling for updates)');

  // Run the loop without blocking server startup.
  void pollLoop();
}

export function stopTelegramPolling() {
  stopped = true;
  running = false;
}

async function pollLoop() {
  while (!stopped) {
    try {
      const updates = await getUpdates(offset, config.telegram.pollTimeoutSeconds);
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleTelegramUpdate(update);
        } catch (err) {
          console.error('[telegram:polling] failed to handle update', err.message);
        }
      }
    } catch (err) {
      console.error('[telegram:polling] getUpdates failed:', err.message);
      // Back off briefly so we don't hammer the API on repeated failures.
      await sleep(3000);
    }
  }
  console.log('[telegram:polling] stopped');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
