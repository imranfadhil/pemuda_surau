import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireAdmin, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { isValidDescriptor, findBestMatch } from '../utils/face.js';
import { withinGeofence, isValidCoordinate } from '../utils/geo.js';
import { getCurrentWindow, getPrayerWindows, PRAYER_KEYS } from '../utils/prayerTimes.js';
import { dateInTz } from '../utils/timezone.js';

const router = Router();

const PRAYERS = PRAYER_KEYS;

const checkInSchema = z.object({
  // Optional: when omitted the server infers the prayer from the current window.
  prayer: z.enum(PRAYERS).optional(),
  descriptor: z.array(z.number()).length(128),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  // Optional: check in on behalf of a dependent (child) managed by the caller.
  forUserId: z.string().uuid().optional(),
});

const identifySchema = z.object({
  descriptor: z.array(z.number()).length(128),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
});

function todayInTimezone() {
  // Attendance day is based on the surau's timezone, not the server's.
  return dateInTz(new Date(), config.prayer.timezone);
}

/**
 * Enforce the geofence when enabled. Throws a 403 with a helpful message
 * when the device is outside the surau's radius.
 */
function assertWithinGeofence(latitude, longitude) {
  if (!config.geofence.enabled) return null;
  if (!isValidCoordinate(latitude, longitude)) {
    throw httpError(
      403,
      'Location is required to check in. Please allow location access and try again.',
    );
  }
  const { ok, distance } = withinGeofence(latitude, longitude, {
    latitude: config.prayer.latitude,
    longitude: config.prayer.longitude,
    radiusMeters: config.geofence.radiusMeters,
  });
  if (!ok) {
    throw httpError(
      403,
      `You must be at the surau to check in (you are about ${distance} m away).`,
    );
  }
  return distance;
}

function formatWindow(w) {
  if (!w) return null;
  return {
    prayer: w.prayer,
    adhan: w.adhan.toISOString(),
    start: w.start.toISOString(),
    end: w.end.toISOString(),
  };
}

/**
 * Which prayer is currently open for check-in, plus the next one.
 * Used by the client to auto-select the prayer and show a countdown.
 */
router.get(
  '/current',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { current, next, date } = await getCurrentWindow();
    res.json({
      date,
      enforceWindow: config.prayer.enforceWindow,
      windowBeforeMinutes: config.prayer.beforeMinutes,
      windowAfterMinutes: config.prayer.afterMinutes,
      current: formatWindow(current),
      next: formatWindow(next),
    });
  }),
);

/**
 * Staff: identify a member from a live face scan (1-to-many).
 *
 * Used by teachers/AJK to scan a youth's face at the surau and get a
 * *suggestion* of who it is. The client must confirm before recording
 * anything, so a false match can never silently mis-attribute activity.
 *
 * Returns the best match plus the runner-up (for confidence display).
 */
router.post(
  '/identify',
  requireAuth,
  requireCapability('identifyMembers'),
  asyncHandler(async (req, res) => {
    const parsed = identifySchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid identify payload');
    const { descriptor, latitude, longitude } = parsed.data;

    if (!isValidDescriptor(descriptor)) throw httpError(400, 'Invalid face descriptor');

    // Staff must also be at the surau when scanning.
    const distanceFromSurau = assertWithinGeofence(latitude, longitude);

    const { rows: candidates } = await query(
      `SELECT id, full_name, guardian_id, face_descriptor FROM users
       WHERE is_active = TRUE AND face_descriptor IS NOT NULL`,
    );

    // Rank all candidates by distance so we can show a confidence margin.
    const ranked = candidates
      .map((c) => {
        const match = findBestMatch(descriptor, [c], config.faceMatchThreshold);
        return match ? { id: c.id, fullName: c.full_name, isDependent: Boolean(c.guardian_id), distance: match.distance } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    const best = ranked[0] || null;
    if (!best) {
      throw httpError(404, 'No matching member found. They may not have enrolled their face yet.');
    }

    const runnerUp = ranked[1] || null;
    res.json({
      match: {
        id: best.id,
        fullName: best.fullName,
        isDependent: best.isDependent,
        confidence: Number((1 - best.distance).toFixed(3)),
      },
      runnerUp: runnerUp
        ? {
            id: runnerUp.id,
            fullName: runnerUp.fullName,
            confidence: Number((1 - runnerUp.distance).toFixed(3)),
          }
        : null,
      distanceFromSurau,
    });
  }),
);

/**
 * Face-verified check-in.
 * The client sends the live face descriptor; we match it against all enrolled
 * users and record attendance for the best match within the threshold.
 *
 * The prayer is inferred from the current prayer-time window unless the client
 * explicitly sends one (and window enforcement is disabled).
 */
router.post(
  '/check-in',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = checkInSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid check-in payload');
    const { descriptor, latitude, longitude, forUserId } = parsed.data;

    if (!isValidDescriptor(descriptor)) throw httpError(400, 'Invalid face descriptor');

    // The device must be at the surau.
    assertWithinGeofence(latitude, longitude);

    // A guardian may check in on behalf of a dependent (child) they manage.
    // The verified face must belong to that dependent.
    let targetUserId = req.user.sub;
    if (forUserId && forUserId !== req.user.sub) {
      const { rows: depRows } = await query(
        `SELECT id FROM users WHERE id = $1 AND guardian_id = $2 AND is_active = TRUE`,
        [forUserId, req.user.sub],
      );
      if (!depRows[0]) throw httpError(403, 'You can only check in for your own dependents.');
      targetUserId = forUserId;
    }

    // Resolve which prayer this check-in is for.
    const { current } = await getCurrentWindow();
    let prayer = parsed.data.prayer;

    if (config.prayer.enforceWindow) {
      if (!current) {
        throw httpError(
          409,
          'No prayer is open for check-in right now. Please try again during the prayer window.',
        );
      }
      prayer = current.prayer;
    } else if (!prayer) {
      if (!current) throw httpError(409, 'No prayer is open for check-in right now.');
      prayer = current.prayer;
    }

    const { rows: candidates } = await query(
      `SELECT id, full_name, face_descriptor FROM users
       WHERE is_active = TRUE AND face_descriptor IS NOT NULL`,
    );

    const match = findBestMatch(descriptor, candidates, config.faceMatchThreshold);
    if (!match) {
      throw httpError(401, 'Face not recognized. Please try again or see an admin.');
    }

    // The verified face must belong to the logged-in user (or their dependent).
    if (match.user.id !== targetUserId) {
      throw httpError(403, 'This face does not match the selected member.');
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

/**
 * Today's attendance for the current user and all their dependents.
 * Used by the check-in page so a guardian can see who still needs checking in.
 */
router.get(
  '/family/today',
  requireAuth,
  asyncHandler(async (req, res) => {
    const date = todayInTimezone();
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.guardian_id, u.face_descriptor IS NOT NULL AS has_face,
              COALESCE(array_agg(a.prayer) FILTER (WHERE a.prayer IS NOT NULL), '{}') AS prayers
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.attendance_date = $2
       WHERE u.id = $1 OR u.guardian_id = $1
       GROUP BY u.id
       ORDER BY (u.guardian_id IS NOT NULL), u.created_at ASC`,
      [req.user.sub, date],
    );
    res.json({
      date,
      members: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        isDependent: Boolean(r.guardian_id),
        hasFace: r.has_face,
        prayers: r.prayers,
      })),
    });
  }),
);

/** Attendance history for the current user and all their dependents. */
router.get(
  '/family',
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 60), 365);
    const { rows } = await query(
      `SELECT a.*, u.full_name, u.guardian_id
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.id = $1 OR u.guardian_id = $1
       ORDER BY a.attendance_date DESC, a.checked_in_at DESC
       LIMIT $2`,
      [req.user.sub, limit],
    );
    res.json({ attendance: rows });
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
      `SELECT a.*, u.full_name, u.phone, u.guardian_id, g.full_name AS guardian_name
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users g ON g.id = u.guardian_id
       WHERE a.attendance_date = $1
       ORDER BY a.prayer, a.checked_in_at`,
      [req.params.date],
    );
    res.json({ date: req.params.date, attendance: rows });
  }),
);

export default router;
