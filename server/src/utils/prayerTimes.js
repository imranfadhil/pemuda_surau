import { config } from '../config.js';
import { zonedTimeToUtc, dateInTz, minutesInTz } from './timezone.js';

/**
 * Prayer times for the surau, fetched from the Aladhan API and cached per day.
 *
 * The API returns wall-clock times in the surau's timezone; we convert them to
 * real UTC instants so check-in windows can be compared against `Date.now()`.
 */

// Our prayer keys -> Aladhan timing keys.
const TIMING_KEYS = {
  subuh: 'Fajr',
  zuhur: 'Dhuhr',
  asar: 'Asr',
  maghrib: 'Maghrib',
  isyak: 'Isha',
};

export const PRAYER_KEYS = Object.keys(TIMING_KEYS);

const cache = new Map(); // dateStr -> { times, fetchedAt }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // refresh at most every 6h
// Keep serving a stale value for this long if a refresh fails, so a temporary
// network blip never takes check-in down.
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch timings with a short timeout and a couple of retries. A single network
 * hiccup (or a slow response) should not fail the whole request.
 */
async function fetchTimings(dateStr, attempts = 3) {
  const { latitude, longitude, method } = config.prayer;
  const [y, m, d] = dateStr.split('-');
  const url =
    `https://api.aladhan.com/v1/timings/${d}-${m}-${y}` +
    `?latitude=${latitude}&longitude=${longitude}&method=${method}`;

  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Aladhan responded ${res.status}`);
      const body = await res.json();
      const timings = body?.data?.timings;
      if (!timings) throw new Error('Aladhan response missing timings');
      return timings;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(400 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Get prayer times (as UTC Dates) for a calendar date in the surau timezone.
 * Returns { subuh: Date, zuhur: Date, ... }.
 */
export async function getPrayerTimes(dateStr) {
  const cached = cache.get(dateStr);
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age < CACHE_TTL_MS) return cached.times;

  try {
    const timings = await fetchTimings(dateStr);
    const times = {};
    for (const [key, apiKey] of Object.entries(TIMING_KEYS)) {
      const raw = timings[apiKey];
      if (!raw) throw new Error(`Aladhan response missing ${apiKey}`);
      // Aladhan sometimes appends a timezone suffix, e.g. "05:52 (MYT)".
      const hhmm = raw.split(' ')[0];
      times[key] = zonedTimeToUtc(dateStr, hhmm, config.prayer.timezone);
    }

    cache.set(dateStr, { times, fetchedAt: Date.now() });
    return times;
  } catch (err) {
    // Fall back to a stale cached value rather than failing the request.
    if (cached && age < STALE_MAX_MS) {
      console.warn(`[prayerTimes] refresh failed for ${dateStr}, using cached times:`, err.message);
      return cached.times;
    }
    throw err;
  }
}

/**
 * Compute the check-in window for each prayer on a given date.
 * Returns { subuh: { start, end, adhan }, ... } as UTC Dates.
 */
export async function getPrayerWindows(dateStr) {
  const times = await getPrayerTimes(dateStr);
  const { beforeMinutes, afterMinutes } = config.prayer;
  const windows = {};
  for (const [key, adhan] of Object.entries(times)) {
    windows[key] = {
      adhan,
      start: new Date(adhan.getTime() - beforeMinutes * 60 * 1000),
      end: new Date(adhan.getTime() + afterMinutes * 60 * 1000),
    };
  }
  return windows;
}

/**
 * Which prayer (if any) is currently open for check-in.
 * Returns { prayer, window, nextPrayer, nextWindow } or nulls when none.
 */
export async function getCurrentWindow(now = new Date()) {
  const today = dateInTz(now, config.prayer.timezone);
  const windows = await getPrayerWindows(today);

  let current = null;
  let next = null;
  for (const key of PRAYER_KEYS) {
    const w = windows[key];
    if (now >= w.start && now <= w.end) current = { prayer: key, ...w };
    if (w.start > now && (!next || w.start < next.start)) next = { prayer: key, ...w };
  }

  // If nothing is open today, look at tomorrow's Subuh so the UI can show a countdown.
  if (!current && !next) {
    const tomorrow = dateInTz(new Date(now.getTime() + 24 * 60 * 60 * 1000), config.prayer.timezone);
    const tomorrowWindows = await getPrayerWindows(tomorrow);
    const subuh = tomorrowWindows.subuh;
    next = { prayer: 'subuh', ...subuh };
  }

  return { current, next, date: today };
}

/** Minutes since midnight (surau timezone) for an instant. */
export function minutesSinceMidnight(date) {
  return minutesInTz(date, config.prayer.timezone);
}
