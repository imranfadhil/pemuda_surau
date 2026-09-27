import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';

const router = Router();

const PRAYERS = ['subuh', 'zuhur', 'asar', 'maghrib', 'isyak'];

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
      query(`SELECT COUNT(*)::int AS count FROM users WHERE is_active = TRUE`),
      query(`SELECT COUNT(*)::int AS count FROM attendance`),
      query(
        `SELECT prayer, COUNT(*)::int AS count FROM attendance
         WHERE attendance_date = $1 GROUP BY prayer`,
        [today],
      ),
      query(
        `SELECT attendance_date, COUNT(*)::int AS count FROM attendance
         WHERE attendance_date >= $1::date - INTERVAL '6 days'
         GROUP BY attendance_date ORDER BY attendance_date`,
        [today],
      ),
      query(`SELECT COALESCE(SUM(points), 0)::int AS total FROM merits`),
      query(`SELECT kind, COUNT(*)::int AS count FROM quran_logs GROUP BY kind`),
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
         SELECT attendance_date AS day,
                COUNT(*) FILTER (WHERE prayer = 'subuh')::int   AS subuh,
                COUNT(*) FILTER (WHERE prayer = 'zuhur')::int   AS zuhur,
                COUNT(*) FILTER (WHERE prayer = 'asar')::int    AS asar,
                COUNT(*) FILTER (WHERE prayer = 'maghrib')::int AS maghrib,
                COUNT(*) FILTER (WHERE prayer = 'isyak')::int   AS isyak,
                COUNT(*)::int AS attendance
         FROM attendance
         WHERE attendance_date >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY attendance_date
       ),
       rec AS (
         SELECT logged_date AS day, COUNT(*)::int AS recitation
         FROM quran_logs
         WHERE kind = 'recitation' AND logged_date >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY logged_date
       ),
       mem AS (
         SELECT logged_date AS day, COUNT(*)::int AS memorization
         FROM quran_logs
         WHERE kind = 'memorization' AND logged_date >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY logged_date
       ),
       mer AS (
         SELECT awarded_at::date AS day, COALESCE(SUM(points), 0)::int AS merits
         FROM merits
         WHERE awarded_at >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY awarded_at::date
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
                COUNT(DISTINCT a.attendance_date)::int AS days_attended
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
              COALESCE(att.attendance, 0) AS attendance,
              COALESCE(att.days_attended, 0) AS days_attended,
              COALESCE(rec.recitation, 0) AS recitation,
              COALESCE(mem.memorization, 0) AS memorization,
              COALESCE(mer.merits, 0) AS merits,
              (COALESCE(att.attendance, 0) + COALESCE(rec.recitation, 0)
               + COALESCE(mem.memorization, 0) + COALESCE(mer.merits, 0)) AS overall
       FROM users u
       LEFT JOIN users g ON g.id = u.guardian_id
       LEFT JOIN att ON att.user_id = u.id
       LEFT JOIN rec ON rec.user_id = u.id
       LEFT JOIN mem ON mem.user_id = u.id
       LEFT JOIN mer ON mer.user_id = u.id
       WHERE u.is_active = TRUE
       ORDER BY ${orderColumn} DESC, attendance DESC, u.full_name ASC
       LIMIT 100`,
      [period],
    );

    const ranked = rows.map((row, index) => ({ rank: index + 1, ...row }));
    res.json({ period, category, leaderboard: ranked });
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
    res.json({ breakdown });
  }),
);

export default router;