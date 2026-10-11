import { config } from '../config.js';
import { getPrayerTimes } from './prayerTimes.js';
import { dateInTz, zonedTimeToUtc } from './timezone.js';

/**
 * Recurring programs.
 *
 * A program may repeat weekly on a set of weekdays. The start/end time of each
 * occurrence is either:
 *   - `fixed`   : a wall-clock time (e.g. 19:30), or
 *   - `prayer`  : anchored to a prayer (e.g. Maghrib), optionally offset by a
 *                 number of minutes (e.g. Maghrib + 0, Isyak - 15).
 *
 * Prayer-anchored times are resolved per occurrence date, because prayer times
 * shift through the year. Everything is computed in the surau's timezone.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Parse 'HH:MM' into minutes since midnight. Returns null when invalid. */
function parseHHMM(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Weekday key ('mon') for a YYYY-MM-DD calendar date. */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Add `days` to a YYYY-MM-DD string, returning a new YYYY-MM-DD string. */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Resolve the start/end instants (UTC Dates) for one occurrence date.
 * Returns null when the times cannot be resolved (e.g. prayer times offline).
 */
async function resolveTimes(program, dateStr) {
  const tz = config.prayer.timezone;
  const startMode = program.recurrence_start_mode || 'fixed';
  const endMode = program.recurrence_end_mode || 'fixed';

  let start;
  let end;

  try {
    if (startMode === 'prayer') {
      const times = await getPrayerTimes(dateStr);
      const base = times[program.recurrence_start_prayer];
      if (!base) return null;
      start = new Date(base.getTime() + (program.recurrence_start_offset_minutes || 0) * 60000);
    } else {
      const mins = parseHHMM(program.recurrence_start_time);
      if (mins == null) return null;
      start = zonedTimeToUtc(dateStr, program.recurrence_start_time, tz);
    }

    if (endMode === 'prayer') {
      const times = await getPrayerTimes(dateStr);
      const base = times[program.recurrence_end_prayer];
      if (!base) return null;
      end = new Date(base.getTime() + (program.recurrence_end_offset_minutes || 0) * 60000);
    } else if (program.recurrence_end_time) {
      const mins = parseHHMM(program.recurrence_end_time);
      if (mins == null) return null;
      end = zonedTimeToUtc(dateStr, program.recurrence_end_time, tz);
    } else {
      end = null;
    }
  } catch (err) {
    // Prayer times unreachable — treat the occurrence as unresolvable rather
    // than failing the whole request.
    console.warn(`[recurrence] could not resolve times for ${dateStr}:`, err.message);
    return null;
  }

  // A prayer-anchored end that lands before the start (e.g. Isyak after
  // midnight) is treated as the next day.
  if (end && end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

/**
 * The next occurrence of a recurring program at or after `from`.
 * Returns { date, start, end } or null when there is none within the horizon.
 */
export async function nextOccurrence(program, from = new Date()) {
  const days = Array.isArray(program.recurrence_days) ? program.recurrence_days : [];
  if (!days.length) return null;

  const tz = config.prayer.timezone;
  const today = dateInTz(from, tz);
  const until = program.recurrence_until ? String(program.recurrence_until).slice(0, 10) : null;

  // Look ahead far enough to cover a weekly pattern plus a little slack.
  for (let i = 0; i < 60; i += 1) {
    const dateStr = addDays(today, i);
    if (until && dateStr > until) return null;
    if (!days.includes(weekdayOf(dateStr))) continue;

    const times = await resolveTimes(program, dateStr);
    if (!times) continue;
    if (times.start.getTime() >= from.getTime()) {
      return { date: dateStr, start: times.start, end: times.end };
    }
  }
  return null;
}

/**
 * The occurrence currently in progress, if any. Used so a recurring program
 * can accept check-ins during its window without materialising every session.
 */
export async function currentOccurrence(program, now = new Date()) {
  const days = Array.isArray(program.recurrence_days) ? program.recurrence_days : [];
  if (!days.length) return null;

  const tz = config.prayer.timezone;
  const today = dateInTz(now, tz);
  const until = program.recurrence_until ? String(program.recurrence_until).slice(0, 10) : null;

  // Check today and yesterday (a session may run past midnight).
  for (const offset of [0, -1]) {
    const dateStr = addDays(today, offset);
    if (until && dateStr > until) continue;
    if (!days.includes(weekdayOf(dateStr))) continue;

    const times = await resolveTimes(program, dateStr);
    if (!times) continue;
    const grace = Number(program.check_in_grace_minutes ?? 30);
    const closesAt = new Date(
      (times.end ? times.end.getTime() : times.start.getTime() + 180 * 60000) + grace * 60000,
    );
    if (now.getTime() >= times.start.getTime() && now.getTime() <= closesAt.getTime()) {
      return { date: dateStr, start: times.start, end: times.end, closesAt };
    }
  }
  return null;
}

/** Human-readable summary of a recurrence, e.g. "Every Mon, Tue, Wed". */
export function describeRecurrence(program) {
  const days = Array.isArray(program.recurrence_days) ? program.recurrence_days : [];
  if (!days.length) return null;
  const labels = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  const ordered = WEEKDAYS.filter((d) => days.includes(d)).map((d) => labels[d]);
  return `Every ${ordered.join(', ')}`;
}
