/**
 * Scoring rules — the single source of truth for how points are earned.
 *
 * The leaderboard ranks members by POINTS, not by raw counts, so that a
 * harder-to-earn activity is worth more. The raw counts are still returned by
 * the API (e.g. "12 prayers", "3 recitations") so the UI can show both.
 *
 * These values are mirrored in `web/src/lib/constants.js` for display. Keep the
 * two in sync — the SQL in `routes/dashboard.js` hard-codes the same numbers
 * (they cannot be bound as parameters inside a CASE expression).
 */

/**
 * Points per prayer check-in.
 *
 * Subuh is worth the most because it is the hardest to attend (it is before
 * dawn), and Isyak is worth more than the daytime prayers for the same reason.
 */
export const PRAYER_POINTS = {
  subuh: 15,
  zuhur: 5,
  asar: 5,
  maghrib: 5,
  isyak: 10,
};

/** Points for each Quran activity (recitation or memorization). */
export const QURAN_POINTS = 5;

/** Allowed range for a single merit award. */
export const MERIT_MIN_POINTS = 1;
export const MERIT_MAX_POINTS = 10;

/** Points for one prayer, defaulting to the standard daytime value. */
export function prayerPoints(prayer) {
  return PRAYER_POINTS[prayer] ?? PRAYER_POINTS.zuhur;
}
