/**
 * Minimal timezone helpers built on Intl (no external dependencies).
 *
 * We need to reason about "wall clock" time in the surau's timezone
 * (e.g. Asia/Kuala_Lumpur) regardless of where the server runs.
 */

/**
 * Offset of `timeZone` from UTC, in milliseconds, at the given instant.
 * e.g. for Asia/Kuala_Lumpur this returns 8 * 3600 * 1000.
 */
export function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  // Intl can emit hour "24" for midnight; normalise to 0.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to a real UTC Date.
 * `dateStr` = 'YYYY-MM-DD', `timeStr` = 'HH:MM'.
 */
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  // First pass with the offset at the guessed instant, then refine once so
  // DST transitions resolve correctly.
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  ts = guess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Calendar date (YYYY-MM-DD) in `timeZone` for the given instant. */
export function dateInTz(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(date); // en-CA yields YYYY-MM-DD
}

/** Minutes since midnight (wall clock) in `timeZone` for the given instant. */
export function minutesInTz(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [hh, mm] = dtf.format(date).split(':').map(Number);
  return (hh === 24 ? 0 : hh) * 60 + mm;
}
