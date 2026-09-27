import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';

const router = Router();

const PRAYERS = ['subuh', 'zuhur', 'asar', 'maghrib', 'isyak'];

/**
 * Overall stats: totals, today's counts per prayer, and active member count.
 */
router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const [members, total, todayRows, weekRows] = await Promise.all([
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
    ]);

    const todayByPrayer = Object.fromEntries(PRAYERS.map((p) => [p, 0]));
    for (const row of todayRows.rows) todayByPrayer[row.prayer] = row.count;

    res.json({
      today,
      activeMembers: members.rows[0].count,
      totalCheckIns: total.rows[0].count,
      todayByPrayer,
      last7Days: weekRows.rows,
    });
  }),
);

/**
 * Leaderboard / ranking. Ranks members by total check-ins, with a
 * configurable window (all-time by default).
 */
router.get(
  '/leaderboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days || 0);
    const params = [];
    let dateFilter = '';
    if (days > 0) {
      params.push(days);
      dateFilter = `AND a.attendance_date >= CURRENT_DATE - ($1::int - 1)`;
    }

    const { rows } = await query(
      `SELECT u.id, u.full_name, u.avatar_url,
              COUNT(a.id)::int AS total,
              COUNT(DISTINCT a.attendance_date)::int AS days_attended
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id ${dateFilter}
       WHERE u.is_active = TRUE
       GROUP BY u.id
       ORDER BY total DESC, days_attended DESC, u.full_name ASC
       LIMIT 100`,
      params,
    );

    const ranked = rows.map((row, index) => ({ rank: index + 1, ...row }));
    res.json({ days, leaderboard: ranked });
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