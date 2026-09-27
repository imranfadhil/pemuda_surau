import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { isValidDescriptor, findBestMatch } from '../utils/face.js';

const router = Router();

const PRAYERS = ['subuh', 'zuhur', 'asar', 'maghrib', 'isyak'];

const checkInSchema = z.object({
  prayer: z.enum(PRAYERS),
  descriptor: z.array(z.number()).length(128),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
});

function todayInTimezone() {
  // Attendance day is based on the server's local date.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Face-verified check-in.
 * The client sends the live face descriptor; we match it against all enrolled
 * users and record attendance for the best match within the threshold.
 */
router.post(
  '/check-in',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = checkInSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid check-in payload');
    const { prayer, descriptor, latitude, longitude } = parsed.data;

    if (!isValidDescriptor(descriptor)) throw httpError(400, 'Invalid face descriptor');

    const { rows: candidates } = await query(
      `SELECT id, full_name, face_descriptor FROM users
       WHERE is_active = TRUE AND face_descriptor IS NOT NULL`,
    );

    const match = findBestMatch(descriptor, candidates, config.faceMatchThreshold);
    if (!match) {
      throw httpError(401, 'Face not recognized. Please try again or see an admin.');
    }

    // The verified face must belong to the logged-in user.
    if (match.user.id !== req.user.sub) {
      throw httpError(403, 'This face does not match your account.');
    }

    const date = todayInTimezone();
    const { rows } = await query(
      `INSERT INTO attendance (user_id, prayer, attendance_date, method, face_score, latitude, longitude)
       VALUES ($1, $2, $3, 'face', $4, $5, $6)
       ON CONFLICT (user_id, prayer, attendance_date)
       DO UPDATE SET checked_in_at = now(), face_score = EXCLUDED.face_score
       RETURNING *`,
      [match.user.id, prayer, date, match.distance, latitude ?? null, longitude ?? null],
    );

    res.json({
      ok: true,
      attendance: rows[0],
      confidence: Number((1 - match.distance).toFixed(3)),
      distance: Number(match.distance.toFixed(3)),
    });
  }),
);

/** Current user's attendance history. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 60), 365);
    const { rows } = await query(
      `SELECT * FROM attendance WHERE user_id = $1
       ORDER BY attendance_date DESC, checked_in_at DESC LIMIT $2`,
      [req.user.sub, limit],
    );
    res.json({ attendance: rows });
  }),
);

/** Today's attendance for the current user. */
router.get(
  '/me/today',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT prayer FROM attendance WHERE user_id = $1 AND attendance_date = $2`,
      [req.user.sub, todayInTimezone()],
    );
    res.json({ date: todayInTimezone(), prayers: rows.map((r) => r.prayer) });
  }),
);

/** Admin: manual check-in on behalf of a user. */
router.post(
  '/manual',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const userId = req.body?.userId;
    const prayer = req.body?.prayer;
    const date = req.body?.date || todayInTimezone();
    if (!userId || !PRAYERS.includes(prayer)) throw httpError(400, 'userId and valid prayer required');

    const { rows } = await query(
      `INSERT INTO attendance (user_id, prayer, attendance_date, method, verified_by)
       VALUES ($1, $2, $3, 'manual', $4)
       ON CONFLICT (user_id, prayer, attendance_date)
       DO UPDATE SET method = 'manual', verified_by = EXCLUDED.verified_by, checked_in_at = now()
       RETURNING *`,
      [userId, prayer, date, req.user.sub],
    );
    res.json({ ok: true, attendance: rows[0] });
  }),
);

/** Admin: attendance for a given date. */
router.get(
  '/date/:date',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT a.*, u.full_name, u.phone
       FROM attendance a JOIN users u ON u.id = a.user_id
       WHERE a.attendance_date = $1
       ORDER BY a.prayer, a.checked_in_at`,
      [req.params.date],
    );
    res.json({ date: req.params.date, attendance: rows });
  }),
);

export default router;
