import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { dateInTz } from '../utils/timezone.js';
import { config } from '../config.js';
import { roleHasCapability } from '../utils/roles.js';
import { isValidDescriptor, findBestMatch } from '../utils/face.js';
import { withinGeofence, isValidCoordinate } from '../utils/geo.js';

const router = Router();

// Optional face + location, required when staff record for another member.
const verificationFields = {
  descriptor: z.array(z.number()).length(128).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
};

const meritSchema = z.object({
  userId: z.string().uuid(),
  points: z.number().int().min(1).max(100),
  reason: z.string().min(2).max(300),
  ...verificationFields,
});

const quranSchema = z.object({
  kind: z.enum(['recitation', 'memorization']),
  surah: z.string().max(120).optional().nullable(),
  juz: z.number().int().min(1).max(30).optional().nullable(),
  pages: z.number().int().min(1).max(1000).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  // Optional: log on behalf of a dependent (child) managed by the caller.
  forUserId: z.string().uuid().optional(),
  ...verificationFields,
});

function todayInTimezone() {
  return dateInTz(new Date(), config.prayer.timezone);
}

/**
 * Enforce the geofence when enabled. Throws 403 when the device is outside
 * the surau's radius.
 */
function assertWithinGeofence(latitude, longitude) {
  if (!config.geofence.enabled) return null;
  if (!isValidCoordinate(latitude, longitude)) {
    throw httpError(
      403,
      'Location is required to record activity. Please allow location access and try again.',
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
      `You must be at the surau to record activity (you are about ${distance} m away).`,
    );
  }
  return distance;
}

/**
 * Verify that a live face descriptor belongs to `targetUserId`.
 * Used when staff record activity on behalf of another member.
 */
async function assertFaceMatches(targetUserId, descriptor) {
  if (!isValidDescriptor(descriptor)) {
    throw httpError(400, 'A face scan is required to record activity for a member.');
  }
  const { rows } = await query(
    `SELECT id, full_name, face_descriptor FROM users
     WHERE is_active = TRUE AND face_descriptor IS NOT NULL`,
  );
  const match = findBestMatch(descriptor, rows, config.faceMatchThreshold);
  if (!match) {
    throw httpError(401, 'Face not recognized. Please try again or see an admin.');
  }
  if (match.user.id !== targetUserId) {
    throw httpError(403, `This face does not match the selected member (${match.user.full_name}).`);
  }
  return match;
}

/**
 * Resolve the target user for a Quran log.
 *
 * Allowed when the caller is acting on themselves, on a dependent they manage,
 * or (for teachers/admins) on any active member.
 */
async function resolveQuranTarget(caller, forUserId) {
  if (!forUserId || forUserId === caller.sub) return caller.sub;

  const { rows: depRows } = await query(
    `SELECT id FROM users WHERE id = $1 AND guardian_id = $2 AND is_active = TRUE`,
    [forUserId, caller.sub],
  );
  if (depRows[0]) return forUserId;

  if (roleHasCapability(caller.role, 'manageQuran')) {
    const { rows: userRows } = await query(
      `SELECT id FROM users WHERE id = $1 AND is_active = TRUE`,
      [forUserId],
    );
    if (userRows[0]) return forUserId;
    throw httpError(404, 'Member not found');
  }

  throw httpError(403, 'You can only log Quran activity for yourself or your dependents.');
}

/* ------------------------------- Merits -------------------------------- */

/** Current user's merits (awarded by teachers/admins). */
router.get(
  '/merits/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT m.*, a.full_name AS awarded_by_name
       FROM merits m
       LEFT JOIN users a ON a.id = m.awarded_by
       WHERE m.user_id = $1
       ORDER BY m.awarded_at DESC
       LIMIT 100`,
      [req.user.sub],
    );
    const total = rows.reduce((sum, r) => sum + r.points, 0);
    res.json({ total, merits: rows });
  }),
);

/** Staff: recent merit awards across all members. */
router.get(
  '/merits',
  requireAuth,
  requireCapability('manageMerits'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT m.*, u.full_name, a.full_name AS awarded_by_name
       FROM merits m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN users a ON a.id = m.awarded_by
       ORDER BY m.awarded_at DESC
       LIMIT 100`,
    );
    res.json({ merits: rows });
  }),
);

/** Staff: award merits to a member (face + location verified). */
router.post(
  '/merits',
  requireAuth,
  requireCapability('manageMerits'),
  asyncHandler(async (req, res) => {
    const parsed = meritSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid merit data');
    const { userId, points, reason, descriptor, latitude, longitude } = parsed.data;

    const { rows: userRows } = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userRows[0]) throw httpError(404, 'User not found');

    // The member must be present at the surau, and the scanned face must be theirs.
    assertWithinGeofence(latitude, longitude);
    await assertFaceMatches(userId, descriptor);

    const { rows } = await query(
      `INSERT INTO merits (user_id, points, reason, awarded_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [userId, points, reason, req.user.sub],
    );
    res.status(201).json({ merit: rows[0] });
  }),
);

/** Staff: revoke a merit award. */
router.delete(
  '/merits/:id',
  requireAuth,
  requireCapability('manageMerits'),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM merits WHERE id = $1', [req.params.id]);
    if (!rowCount) throw httpError(404, 'Merit not found');
    res.json({ ok: true });
  }),
);

/* -------------------------------- Quran -------------------------------- */

/** Current user's Quran activity (recitation + memorization). */
router.get(
  '/quran/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM quran_logs WHERE user_id = $1
       ORDER BY logged_date DESC, logged_at DESC LIMIT 100`,
      [req.user.sub],
    );
    const recitation = rows.filter((r) => r.kind === 'recitation').length;
    const memorization = rows.filter((r) => r.kind === 'memorization').length;
    res.json({ recitation, memorization, logs: rows });
  }),
);

/** Staff: recent Quran logs across all members. */
router.get(
  '/quran',
  requireAuth,
  requireCapability('manageQuran'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT q.*, u.full_name
       FROM quran_logs q
       JOIN users u ON u.id = q.user_id
       ORDER BY q.logged_date DESC, q.logged_at DESC
       LIMIT 100`,
    );
    res.json({ logs: rows });
  }),
);

/**
 * Log a Quran activity.
 *
 * - Self-logging (or a guardian logging for their own dependent) needs no face.
 * - Staff recording for another member must be at the surau and scan that
 *   member's face, so activity can't be attributed to the wrong youth.
 */
router.post(
  '/quran',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = quranSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid Quran log data');
    const { kind, surah, juz, pages, note, forUserId, descriptor, latitude, longitude } =
      parsed.data;

    const targetUserId = await resolveQuranTarget(req.user, forUserId);

    // Recording for someone else (staff flow) requires presence + face match.
    if (targetUserId !== req.user.sub) {
      assertWithinGeofence(latitude, longitude);
      await assertFaceMatches(targetUserId, descriptor);
    }

    const { rows } = await query(
      `INSERT INTO quran_logs (user_id, kind, surah, juz, pages, note, logged_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [targetUserId, kind, surah ?? null, juz ?? null, pages ?? null, note ?? null, todayInTimezone()],
    );
    res.status(201).json({ log: rows[0] });
  }),
);

/** Delete a Quran log (own, a dependent's, or any member for teachers/admins). */
router.delete(
  '/quran/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const canManage = roleHasCapability(req.user.role, 'manageQuran');
    const { rowCount } = await query(
      `DELETE FROM quran_logs q
       USING users u
       WHERE q.id = $1 AND q.user_id = u.id
         AND ($2 = TRUE OR u.id = $3 OR u.guardian_id = $3)`,
      [req.params.id, canManage, req.user.sub],
    );
    if (!rowCount) throw httpError(404, 'Log not found');
    res.json({ ok: true });
  }),
);

export default router;
