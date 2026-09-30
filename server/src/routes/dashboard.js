import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import { prayerPoints, youthOnlySql } from '../utils/scoring.js';
import { config } from '../config.js';

const router = Router();

const PRAYERS = ['subuh', 'zuhur', 'asar', 'maghrib', 'isyak'];

// The programme is for youth, so stats and rankings only count members younger
// than this age. Adult accounts (teachers, AJK, parents) are excluded.
const YOUTH = youthOnlySql('u', config.dashboard.maxAge);

// Whitelisted leaderboard categories -> score column.
const CATEGORY_COLUMNS = {
  overall: 'overall',
  attendance: 'attendance',
  recitation: 'recitation',
  memorization: 'memorization',
  merits: 'merits',
};

// Whitelisted ranking periods.
const PERIODS = ['month', 'year', 'all'];

/**
 * Overall stats: totals, today's counts per prayer, and active member count.
 * Public: the dashboard is the app's landing page and is visible without login.
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const [members, total, todayRows, weekRows, meritRows, quranRows] = await Promise.all([
      query(`SELECT COUNT(*)::int AS count FROM users u WHERE u.is_active = TRUE AND ${YOUTH}`),
      query(
        `SELECT COUNT(*)::int AS count FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE ${YOUTH}`,
      ),
      query(
        `SELECT a.prayer, COUNT(*)::int AS count FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.attendance_date = $1 AND ${YOUTH}
         GROUP BY a.prayer`,
        [today],
      ),
      query(
        `SELECT a.attendance_date, COUNT(*)::int AS count FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.attendance_date >= $1::date - INTERVAL '6 days' AND ${YOUTH}
         GROUP BY a.attendance_date ORDER BY a.attendance_date`,
        [today],
      ),
      query(
        `SELECT COALESCE(SUM(m.points), 0)::int AS total FROM merits m
         JOIN users u ON u.id = m.user_id
         WHERE ${YOUTH}`,
      ),
      query(
        `SELECT q.kind, COUNT(*)::int AS count FROM quran_logs q
         JOIN users u ON u.id = q.user_id
         WHERE ${YOUTH}
         GROUP BY q.kind`,
      ),
    ]);

    const todayByPrayer = Object.fromEntries(PRAYERS.map((p) => [p, 0]));
    for (const row of todayRows.rows) todayByPrayer[row.prayer] = row.count;

    const quran = { recitation: 0, memorization: 0 };
    for (const row of quranRows.rows) quran[row.kind] = row.count;

    res.json({
      today,
      activeMembers: members.rows[0].count,
      totalCheckIns: total.rows[0].count,
      totalMerits: meritRows.rows[0].total,
      quran,
      todayByPrayer,
      last7Days: weekRows.rows,
    });
  }),
);

/**
 * Weekly activity breakdown: per-day totals for prayer attendance (split by
 * prayer), Quran recitation, Quran memorization, and merits over the last
 * 7 days. Public: shown on the kiosk wall display.
 */
router.get(
  '/weekly',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `WITH days AS (
         SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day')::date AS day
       ),
       att AS (
         SELECT a.attendance_date AS day,
                COUNT(*) FILTER (WHERE a.prayer = 'subuh')::int   AS subuh,
                COUNT(*) FILTER (WHERE a.prayer = 'zuhur')::int   AS zuhur,
                COUNT(*) FILTER (WHERE a.prayer = 'asar')::int    AS asar,
                COUNT(*) FILTER (WHERE a.prayer = 'maghrib')::int AS maghrib,
                COUNT(*) FILTER (WHERE a.prayer = 'isyak')::int   AS isyak,
                COUNT(*)::int AS attendance
         FROM attendance a
         JOIN users u ON u.id = a.user_id
         WHERE a.attendance_date >= CURRENT_DATE - INTERVAL '6 days' AND ${YOUTH}
         GROUP BY a.attendance_date
       ),
       rec AS (
         SELECT q.logged_date AS day, COUNT(*)::int AS recitation
         FROM quran_logs q
         JOIN users u ON u.id = q.user_id
         WHERE q.kind = 'recitation' AND q.logged_date >= CURRENT_DATE - INTERVAL '6 days'
           AND ${YOUTH}
         GROUP BY q.logged_date
       ),
       mem AS (
         SELECT q.logged_date AS day, COUNT(*)::int AS memorization
         FROM quran_logs q
         JOIN users u ON u.id = q.user_id
         WHERE q.kind = 'memorization' AND q.logged_date >= CURRENT_DATE - INTERVAL '6 days'
           AND ${YOUTH}
         GROUP BY q.logged_date
       ),
       mer AS (
         SELECT m.awarded_at::date AS day, COALESCE(SUM(m.points), 0)::int AS merits
         FROM merits m
         JOIN users u ON u.id = m.user_id
         WHERE m.awarded_at >= CURRENT_DATE - INTERVAL '6 days' AND ${YOUTH}
         GROUP BY m.awarded_at::date
       )
       SELECT d.day,
              COALESCE(att.subuh, 0)        AS subuh,
              COALESCE(att.zuhur, 0)        AS zuhur,
              COALESCE(att.asar, 0)         AS asar,
              COALESCE(att.maghrib, 0)      AS maghrib,
              COALESCE(att.isyak, 0)        AS isyak,
              COALESCE(att.attendance, 0)   AS attendance,
              COALESCE(rec.recitation, 0)   AS recitation,
              COALESCE(mem.memorization, 0) AS memorization,
              COALESCE(mer.merits, 0)       AS merits
       FROM days d
       LEFT JOIN att ON att.day = d.day
       LEFT JOIN rec ON rec.day = d.day
       LEFT JOIN mem ON mem.day = d.day
       LEFT JOIN mer ON mer.day = d.day
       ORDER BY d.day`,
    );

    res.json({
      days: rows.map((row) => ({
        date: row.day,
        attendance: row.attendance,
        prayers: {
          subuh: row.subuh,
          zuhur: row.zuhur,
          asar: row.asar,
          maghrib: row.maghrib,
          isyak: row.isyak,
        },
        recitation: row.recitation,
        memorization: row.memorization,
        merits: row.merits,
      })),
    });
  }),
);

/**
 * Leaderboard / ranking across categories.
 *
 * Query params:
 *   period   = month | year | all   (default: all)
 *   category = overall | attendance | recitation | memorization | merits
 *              (default: overall)
 *
 * Public: shown on the landing dashboard without login.
 */
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const period = PERIODS.includes(req.query.period) ? req.query.period : 'all';
    const category = CATEGORY_COLUMNS[req.query.category] ? req.query.category : 'overall';
    const orderColumn = CATEGORY_COLUMNS[category];

    const { rows } = await query(
      `WITH period AS (
         SELECT CASE
           WHEN $1 = 'month' THEN date_trunc('month', CURRENT_DATE)::date
           WHEN $1 = 'year'  THEN date_trunc('year', CURRENT_DATE)::date
           ELSE NULL
         END AS start_date
       ),
       att AS (
         SELECT a.user_id,
                COUNT(*)::int AS attendance,
                COUNT(DISTINCT a.attendance_date)::int AS days_attended,
                -- Points, not raw counts: Subuh 10, the rest 5.
                -- These numbers mirror server/src/utils/scoring.js and cannot be
                -- bound as parameters inside a CASE expression.
                COALESCE(SUM(CASE a.prayer
                  WHEN 'subuh'   THEN 10
                  ELSE 5
                END), 0)::int AS attendance_points
         FROM attendance a, period p
         WHERE p.start_date IS NULL OR a.attendance_date >= p.start_date
         GROUP BY a.user_id
       ),
       rec AS (
         SELECT q.user_id, COUNT(*)::int AS recitation
         FROM quran_logs q, period p
         WHERE q.kind = 'recitation'
           AND (p.start_date IS NULL OR q.logged_date >= p.start_date)
         GROUP BY q.user_id
       ),
       mem AS (
         SELECT q.user_id, COUNT(*)::int AS memorization
         FROM quran_logs q, period p
         WHERE q.kind = 'memorization'
           AND (p.start_date IS NULL OR q.logged_date >= p.start_date)
         GROUP BY q.user_id
       ),
       mer AS (
         SELECT m.user_id, COALESCE(SUM(m.points), 0)::int AS merits
         FROM merits m, period p
         WHERE p.start_date IS NULL OR m.awarded_at >= p.start_date
         GROUP BY m.user_id
       )
       SELECT u.id, u.full_name, u.avatar_url, u.guardian_id,
              g.full_name AS guardian_name,
              -- Last 4 digits, so same-named members are distinguishable.
              CASE WHEN u.phone IS NOT NULL THEN RIGHT(u.phone, 4) END AS phone_last4,
              COALESCE(att.attendance, 0) AS attendance,
              COALESCE(att.days_attended, 0) AS days_attended,
              COALESCE(att.attendance_points, 0) AS attendance_points,
              COALESCE(rec.recitation, 0) AS recitation,
              COALESCE(mem.memorization, 0) AS memorization,
              COALESCE(mer.merits, 0) AS merits,
              -- Each Quran activity is worth 5 points.
              (COALESCE(rec.recitation, 0) + COALESCE(mem.memorization, 0)) * 5 AS quran_points,
              -- Overall is the sum of POINTS across every category.
              (COALESCE(att.attendance_points, 0)
               + (COALESCE(rec.recitation, 0) + COALESCE(mem.memorization, 0)) * 5
               + COALESCE(mer.merits, 0)) AS overall
       FROM users u
       LEFT JOIN users g ON g.id = u.guardian_id
       LEFT JOIN att ON att.user_id = u.id
       LEFT JOIN rec ON rec.user_id = u.id
       LEFT JOIN mem ON mem.user_id = u.id
       LEFT JOIN mer ON mer.user_id = u.id
       WHERE u.is_active = TRUE AND ${YOUTH}
       ORDER BY ${orderColumn} DESC, attendance DESC, u.full_name ASC
       LIMIT 100`,
      [period],
    );

    const ranked = rows.map((row, index) => ({ rank: index + 1, ...row }));
    res.json({ period, category, leaderboard: ranked });
  }),
);

/**
 * The current user's OWN scores, in the same shape as a leaderboard row.
 *
 * The leaderboard is youth-only, so an adult member (teacher, AJK, parent)
 * would not appear in it — and would therefore lose their own badges. This
 * endpoint returns their personal scores regardless of age, so the profile page
 * always works.
 */
router.get(
  '/me/scores',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `WITH att AS (
         SELECT COUNT(*)::int AS attendance,
                COUNT(DISTINCT attendance_date)::int AS days_attended,
                COALESCE(SUM(CASE prayer
                  WHEN 'subuh' THEN 10
                  ELSE 5
                END), 0)::int AS attendance_points
         FROM attendance WHERE user_id = $1
       ),
       rec AS (
         SELECT COUNT(*)::int AS recitation FROM quran_logs
         WHERE user_id = $1 AND kind = 'recitation'
       ),
       mem AS (
         SELECT COUNT(*)::int AS memorization FROM quran_logs
         WHERE user_id = $1 AND kind = 'memorization'
       ),
       mer AS (
         SELECT COALESCE(SUM(points), 0)::int AS merits FROM merits WHERE user_id = $1
       )
       SELECT att.attendance, att.days_attended, att.attendance_points,
              rec.recitation, mem.memorization, mer.merits,
              (att.attendance_points
               + (rec.recitation + mem.memorization) * 5
               + mer.merits) AS overall
       FROM att, rec, mem, mer`,
      [req.user.sub],
    );
    res.json({ scores: rows[0] });
  }),
);

/**
 * Per-prayer breakdown for the current user (used on the profile page).
 */
router.get(
  '/me/breakdown',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT prayer, COUNT(*)::int AS count FROM attendance
       WHERE user_id = $1 GROUP BY prayer`,
      [req.user.sub],
    );
    const breakdown = Object.fromEntries(PRAYERS.map((p) => [p, 0]));
    for (const row of rows) breakdown[row.prayer] = row.count;
    // Points per prayer, so the profile can show what each check-in is worth.
    const points = Object.fromEntries(PRAYERS.map((p) => [p, prayerPoints(p)]));
    const totalPoints = PRAYERS.reduce((sum, p) => sum + breakdown[p] * points[p], 0);
    res.json({ breakdown, points, totalPoints });
  }),
);

export default router;