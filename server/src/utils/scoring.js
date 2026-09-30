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
 * dawn). The other prayers, including Isyak, are worth the standard value.
 */
export const PRAYER_POINTS = {
  subuh: 10,
  zuhur: 5,
  asar: 5,
  maghrib: 5,
  isyak: 5,
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

/**
 * SQL predicate that keeps only YOUTH members (younger than `maxAge`).
 *
 * The programme is for youth, so dashboard stats and the leaderboard must not
 * be skewed by adult accounts (teachers, AJK, parents). Age is derived from
 * `birth_date`; a member with no birth date is EXCLUDED, because we cannot
 * prove they are a youth.
 *
 * `alias` is the users-table alias in the surrounding query (e.g. `u`).
 * `maxAge` is interpolated as a validated integer — it comes from config, never
 * from user input, so this is not an injection risk.
 */
export function youthOnlySql(alias = 'u', maxAge = 19) {
  const age = Number.isFinite(Number(maxAge)) ? Math.trunc(Number(maxAge)) : 19;
  return `${alias}.birth_date IS NOT NULL AND ${alias}.birth_date > CURRENT_DATE - INTERVAL '${age} years'`;
}
