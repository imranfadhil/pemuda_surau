import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { dateInTz } from '../utils/timezone.js';
import { config } from '../config.js';
import { roleHasCapability } from '../utils/roles.js';
import { isValidDescriptor, findBestMatch } from '../utils/face.js';
import { withinGeofence, isValidCoordinate, formatDistance } from '../utils/geo.js';

const router = Router();

// Optional face + location, required when staff record for another member.
const verificationFields = {
  descriptor: z.array(z.number()).length(128).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  // Reported GPS accuracy in metres (used only to explain a failed geofence).
  accuracy: z.number().optional().nullable(),
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
 *
 * `accuracy` (metres, from the browser) only affects the failure message: a fix
 * coarser than the measured distance cannot prove the member is far away.
 */
function assertWithinGeofence(latitude, longitude, accuracy = null) {
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
    const acc = Number(accuracy);
    if (Number.isFinite(acc) && acc > 0 && acc >= distance) {
      throw httpError(
        403,
        `We could not confirm your location accurately enough (GPS accuracy about ` +
          `${formatDistance(acc)}). Move outdoors or near a window and try again.`,
      );
    }
    throw httpError(
      403,
      `You must be at the surau to record activity (you are about ${formatDistance(distance)} away).`,
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
    `SELECT id FROM users
     WHERE id = $1 AND (guardian_id = $2 OR co_guardian_id = $2) AND is_active = TRUE`,
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
    const { userId, points, reason, descriptor, latitude, longitude, accuracy } = parsed.data;

    const { rows: userRows } = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userRows[0]) throw httpError(404, 'User not found');

    // The member must be present at the surau, and the scanned face must be theirs.
    assertWithinGeofence(latitude, longitude, accuracy);
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
      `SELECT q.*, l.full_name AS logged_by_name
       FROM quran_logs q
       LEFT JOIN users l ON l.id = q.logged_by
       WHERE q.user_id = $1
       ORDER BY q.logged_date DESC, q.logged_at DESC LIMIT 100`,
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
      `SELECT q.*, u.full_name, l.full_name AS logged_by_name
       FROM quran_logs q
       JOIN users u ON u.id = q.user_id
       LEFT JOIN users l ON l.id = q.logged_by
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
 * - Staff recording for another member must be at the surau (geofence), but the
 *   face scan is OPTIONAL: teachers often record a whole class in one sitting,
 *   so they can select the member manually to move swiftly. When a scan is
 *   supplied it is still verified, so a mismatch is caught.
 */
router.post(
  '/quran',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = quranSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid Quran log data');
    const { kind, surah, juz, pages, note, forUserId, descriptor, latitude, longitude, accuracy } =
      parsed.data;

    const targetUserId = await resolveQuranTarget(req.user, forUserId);

    // Every Quran log must happen at the surau - whether a teacher is recording
    // for a member or a member is logging their own recitation.
    assertWithinGeofence(latitude, longitude, accuracy);

    // Rate limit: at most one log per member per cooldown window, so a member
    // can't inflate their score with rapid repeat submissions.
    const cooldown = config.quran.cooldownMinutes;
    if (cooldown > 0) {
      const { rows: recent } = await query(
        `SELECT logged_at FROM quran_logs
         WHERE user_id = $1 AND logged_at > now() - ($2 || ' minutes')::interval
         ORDER BY logged_at DESC LIMIT 1`,
        [targetUserId, String(cooldown)],
      );
      if (recent[0]) {
        const elapsedMin = Math.floor((Date.now() - new Date(recent[0].logged_at).getTime()) / 60000);
        const waitMin = Math.max(1, cooldown - elapsedMin);
        const err = httpError(
          429,
          `Already logged in the last ${cooldown} minutes. Please try again in about ${waitMin} minute(s).`,
        );
        err.code = 'QURAN_COOLDOWN';
        err.retryAfterMinutes = waitMin;
        throw err;
      }
    }

    // Recording for another member: verify the face when one was provided.
    if (targetUserId !== req.user.sub && descriptor) {
      await assertFaceMatches(targetUserId, descriptor);
    }

    const { rows } = await query(
      `INSERT INTO quran_logs (user_id, kind, surah, juz, pages, note, logged_by, logged_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        targetUserId,
        kind,
        surah ?? null,
        juz ?? null,
        pages ?? null,
        note ?? null,
        // NULL when the member logged it themselves.
        targetUserId === req.user.sub ? null : req.user.sub,
        todayInTimezone(),
      ],
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
         AND ($2 = TRUE OR u.id = $3 OR u.guardian_id = $3 OR u.co_guardian_id = $3)`,
      [req.params.id, canManage, req.user.sub],
    );
    if (!rowCount) throw httpError(404, 'Log not found');
    res.json({ ok: true });
  }),
);

export default router;
