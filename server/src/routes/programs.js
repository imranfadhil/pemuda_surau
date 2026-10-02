import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { isValidDescriptor, findBestMatch } from '../utils/face.js';
import { withinGeofence, isValidCoordinate, formatDistance } from '../utils/geo.js';
import { roleHasCapability } from '../utils/roles.js';

const router = Router();

/**
 * A program with no `ends_at` has no natural closing time, so we assume it runs
 * for this long. Without it, a program created with only a start time would
 * stay open for check-in forever.
 */
const DEFAULT_DURATION_MINUTES = 180;

const programSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(2000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  category: z.string().max(60).optional().nullable(),
  isPublished: z.boolean().optional(),
  // Optional per-program geofence. NULL means "use the surau's own location".
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  radiusMeters: z.number().int().min(10).max(50000).optional().nullable(),
  checkInGraceMinutes: z.number().int().min(0).max(1440).optional(),
  checkInEnabled: z.boolean().optional(),
});

const checkInSchema = z.object({
  descriptor: z.array(z.number()).length(128),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  accuracy: z.number().optional().nullable(),
  // Optional: check in on behalf of a dependent, or (for staff) any member.
  forUserId: z.string().uuid().optional(),
});

const manualSchema = z.object({
  userId: z.string().uuid(),
});

/**
 * The window during which a program accepts check-ins: from `starts_at` until
 * `ends_at` (or a default duration) plus the program's grace period.
 */
function checkInWindow(program) {
  const opensAt = new Date(program.starts_at);
  const endsAt = program.ends_at
    ? new Date(program.ends_at)
    : new Date(opensAt.getTime() + DEFAULT_DURATION_MINUTES * 60000);
  const grace = Number(program.check_in_grace_minutes ?? 30);
  const closesAt = new Date(endsAt.getTime() + grace * 60000);
  const now = Date.now();
  return {
    opensAt,
    closesAt,
    isOpen: now >= opensAt.getTime() && now <= closesAt.getTime(),
  };
}

/**
 * Enforce the program's geofence.
 *
 * A program may carry its own coordinates (a camp, a field trip); when it does
 * not, the surau's configured location and radius are used. `accuracy` is only
 * used to make a failure message honest — a fix coarser than the measured
 * distance cannot actually tell us whether the member is inside the fence.
 */
function assertWithinProgramGeofence(program, latitude, longitude, accuracy = null) {
  if (!config.geofence.enabled) return null;

  const hasOwnLocation = isValidCoordinate(program.latitude, program.longitude);
  const fence = hasOwnLocation
    ? {
        latitude: program.latitude,
        longitude: program.longitude,
        radiusMeters: Number(program.radius_meters) || config.geofence.radiusMeters,
      }
    : {
        latitude: config.prayer.latitude,
        longitude: config.prayer.longitude,
        radiusMeters: config.geofence.radiusMeters,
      };

  if (!isValidCoordinate(latitude, longitude)) {
    throw httpError(
      403,
      'Location is required to check in. Please allow location access and try again.',
    );
  }

  const { ok, distance } = withinGeofence(latitude, longitude, fence);
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
      `You must be at ${hasOwnLocation ? 'the program venue' : 'the surau'} to check in ` +
        `(you are about ${formatDistance(distance)} away).`,
    );
  }
  return distance;
}

/** Shape a program row for the client, including the caller's own state. */
function publicProgram(row) {
  const { opensAt, closesAt, isOpen } = checkInWindow(row);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    category: row.category,
    is_published: row.is_published,
    latitude: row.latitude,
    longitude: row.longitude,
    radius_meters: row.radius_meters,
    check_in_grace_minutes: row.check_in_grace_minutes,
    check_in_enabled: row.check_in_enabled,
    created_by: row.created_by,
    created_by_name: row.created_by_name ?? null,
    created_at: row.created_at,
    join_count: Number(row.join_count ?? 0),
    checked_in_count: Number(row.checked_in_count ?? 0),
    // The caller's own relationship to this program.
    joined: Boolean(row.joined),
    checked_in_at: row.checked_in_at ?? null,
    // Derived so the client never has to re-implement the window rules.
    check_in_opens_at: opensAt.toISOString(),
    check_in_closes_at: closesAt.toISOString(),
    is_open: isOpen,
  };
}

/**
 * List programs.
 *
 * Members see published programs only; staff with `managePrograms` also see
 * drafts (so the admin tab can show and publish them). `includePast` adds
 * programs that have already finished.
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const includePast = req.query.includePast === 'true';
    const canManage = roleHasCapability(req.user.role, 'managePrograms');

    const { rows } = await query(
      `SELECT p.*, u.full_name AS created_by_name,
              (SELECT COUNT(*)::int FROM program_attendance pa WHERE pa.program_id = p.id) AS join_count,
              (SELECT COUNT(*)::int FROM program_attendance pa
                WHERE pa.program_id = p.id AND pa.checked_in_at IS NOT NULL) AS checked_in_count,
              mine.joined, mine.checked_in_at
       FROM programs p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN LATERAL (
         SELECT TRUE AS joined, pa.checked_in_at
         FROM program_attendance pa
         WHERE pa.program_id = p.id AND pa.user_id = $1
       ) mine ON TRUE
       WHERE ($2 OR p.is_published = TRUE)
         AND ($3 OR COALESCE(p.ends_at, p.starts_at + interval '3 hours') >= now())
       ORDER BY p.starts_at ASC`,
      [req.user.sub, canManage, includePast],
    );
    res.json({ programs: rows.map(publicProgram) });
  }),
);

/** A single program, with the caller's own join/check-in state. */
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const canManage = roleHasCapability(req.user.role, 'managePrograms');
    const { rows } = await query(
      `SELECT p.*, u.full_name AS created_by_name,
              (SELECT COUNT(*)::int FROM program_attendance pa WHERE pa.program_id = p.id) AS join_count,
              (SELECT COUNT(*)::int FROM program_attendance pa
                WHERE pa.program_id = p.id AND pa.checked_in_at IS NOT NULL) AS checked_in_count,
              mine.joined, mine.checked_in_at
       FROM programs p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN LATERAL (
         SELECT TRUE AS joined, pa.checked_in_at
         FROM program_attendance pa
         WHERE pa.program_id = p.id AND pa.user_id = $2
       ) mine ON TRUE
       WHERE p.id = $1`,
      [req.params.id, req.user.sub],
    );
    const program = rows[0];
    if (!program) throw httpError(404, 'Program not found');
    if (!program.is_published && !canManage) throw httpError(404, 'Program not found');
    res.json({ program: publicProgram(program) });
  }),
);

/** Admin: create a program. */
router.post(
  '/',
  requireAuth,
  requireCapability('managePrograms'),
  asyncHandler(async (req, res) => {
    const parsed = programSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid program data');
    const d = parsed.data;

    const { rows } = await query(
      `INSERT INTO programs
         (title, description, location, starts_at, ends_at, category, is_published, created_by,
          latitude, longitude, radius_meters, check_in_grace_minutes, check_in_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        d.title,
        d.description ?? null,
        d.location ?? null,
        d.startsAt,
        d.endsAt ?? null,
        d.category ?? 'program',
        d.isPublished ?? true,
        req.user.sub,
        d.latitude ?? null,
        d.longitude ?? null,
        d.radiusMeters ?? null,
        d.checkInGraceMinutes ?? 30,
        d.checkInEnabled ?? true,
      ],
    );
    res.status(201).json({ program: publicProgram(rows[0]) });
  }),
);

/** Admin: update a program. */
router.put(
  '/:id',
  requireAuth,
  requireCapability('managePrograms'),
  asyncHandler(async (req, res) => {
    const parsed = programSchema.partial().safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid program data');
    const d = parsed.data;

    // Only touch the columns the caller actually sent. A plain COALESCE would
    // treat an explicit null as "leave unchanged", which makes it impossible to
    // clear a nullable field — e.g. removing a program's own venue coordinates
    // so it falls back to the surau geofence.
    const columns = {
      title: 'title',
      description: 'description',
      location: 'location',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
      category: 'category',
      isPublished: 'is_published',
      latitude: 'latitude',
      longitude: 'longitude',
      radiusMeters: 'radius_meters',
      checkInGraceMinutes: 'check_in_grace_minutes',
      checkInEnabled: 'check_in_enabled',
    };

    const assignments = [];
    const values = [];
    for (const [field, column] of Object.entries(columns)) {
      if (!(field in d)) continue;
      values.push(d[field] ?? null);
      assignments.push(`${column} = $${values.length}`);
    }

    if (!assignments.length) throw httpError(400, 'No program fields to update');

    values.push(req.params.id);
    const { rows } = await query(
      `UPDATE programs SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (!rows[0]) throw httpError(404, 'Program not found');
    res.json({ program: publicProgram(rows[0]) });
  }),
);

/** Admin: delete a program. */
router.delete(
  '/:id',
  requireAuth,
  requireCapability('managePrograms'),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM programs WHERE id = $1', [req.params.id]);
    if (!rowCount) throw httpError(404, 'Program not found');
    res.json({ ok: true });
  }),
);

/** Register interest in a program. */
router.post(
  '/:id/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: programRows } = await query(
      'SELECT id, is_published FROM programs WHERE id = $1',
      [req.params.id],
    );
    const program = programRows[0];
    if (!program || !program.is_published) throw httpError(404, 'Program not found');

    const { rows } = await query(
      `INSERT INTO program_attendance (program_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (program_id, user_id) DO NOTHING
       RETURNING *`,
      [req.params.id, req.user.sub],
    );
    res.json({ ok: true, joined: rows[0] || null });
  }),
);

/** Withdraw interest in a program. */
router.delete(
  '/:id/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query('DELETE FROM program_attendance WHERE program_id = $1 AND user_id = $2', [
      req.params.id,
      req.user.sub,
    ]);
    res.json({ ok: true });
  }),
);

/**
 * Face-verified, geofenced program check-in.
 *
 * Mirrors the prayer check-in: the client sends a live face descriptor and its
 * position; the server matches the face against enrolled members, confirms the
 * device is inside the program's geofence, and only then records attendance.
 *
 * A member may check themselves in, a guardian may check in a dependent, and
 * staff with `identifyMembers` may check in any member (they scan the youth's
 * face at the venue, so the verified face is the proof of identity).
 */
router.post(
  '/:id/check-in',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = checkInSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid check-in payload');
    const { descriptor, latitude, longitude, accuracy, forUserId } = parsed.data;

    if (!isValidDescriptor(descriptor)) throw httpError(400, 'Invalid face descriptor');

    const { rows: programRows } = await query('SELECT * FROM programs WHERE id = $1', [
      req.params.id,
    ]);
    const program = programRows[0];
    if (!program || !program.is_published) throw httpError(404, 'Program not found');

    if (!program.check_in_enabled) {
      throw httpError(409, 'Check-in is closed for this program.');
    }

    const { opensAt, closesAt, isOpen } = checkInWindow(program);
    if (!isOpen) {
      if (Date.now() < opensAt.getTime()) {
        throw httpError(409, 'Check-in has not opened yet for this program.');
      }
      throw httpError(
        409,
        `Check-in for this program closed at ${closesAt.toISOString()}. Please see an admin.`,
      );
    }

    const distanceFromVenue = assertWithinProgramGeofence(program, latitude, longitude, accuracy);

    // Resolve who is being checked in.
    let targetUserId = req.user.sub;
    if (forUserId && forUserId !== req.user.sub) {
      const isStaff = roleHasCapability(req.user.role, 'identifyMembers');
      const { rows: targetRows } = await query(
        isStaff
          ? `SELECT id FROM users WHERE id = $1 AND is_active = TRUE`
          : `SELECT id FROM users
             WHERE id = $1 AND (guardian_id = $2 OR co_guardian_id = $2) AND is_active = TRUE`,
        isStaff ? [forUserId] : [forUserId, req.user.sub],
      );
      if (!targetRows[0]) {
        throw httpError(
          403,
          isStaff ? 'Member not found.' : 'You can only check in for your own dependents.',
        );
      }
      targetUserId = forUserId;
    }

    const { rows: targetRows } = await query(
      `SELECT id, full_name, face_descriptor IS NOT NULL AS has_face
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [targetUserId],
    );
    const target = targetRows[0];
    if (!target) throw httpError(404, 'Member not found');
    if (!target.has_face) {
      throw httpError(
        409,
        targetUserId === req.user.sub
          ? 'You need to register your face before you can check in. Open the Profile tab to enroll it.'
          : `${target.full_name} has no face enrolled yet. Ask their guardian to enroll it first.`,
      );
    }

    const { rows: candidates } = await query(
      `SELECT id, full_name, face_descriptor FROM users
       WHERE is_active = TRUE AND face_descriptor IS NOT NULL`,
    );

    const match = findBestMatch(descriptor, candidates, config.faceMatchThreshold);
    if (!match) {
      throw httpError(401, 'Face not recognized. Please try again or see an admin.');
    }
    if (match.user.id !== targetUserId) {
      throw httpError(403, 'This face does not match the selected member.');
    }

    // A check-in implies attendance, so create the join row if it is missing.
    const { rows } = await query(
      `INSERT INTO program_attendance
         (program_id, user_id, checked_in_at, method, face_score, latitude, longitude)
       VALUES ($1, $2, now(), 'face', $3, $4, $5)
       ON CONFLICT (program_id, user_id)
       DO UPDATE SET checked_in_at = now(), method = 'face', face_score = EXCLUDED.face_score,
                     latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
       RETURNING *`,
      [program.id, match.user.id, match.distance, latitude ?? null, longitude ?? null],
    );

    res.json({
      ok: true,
      attendance: rows[0],
      memberName: target.full_name,
      confidence: Number((1 - match.distance).toFixed(3)),
      distance: Number(match.distance.toFixed(3)),
      distanceFromVenue: distanceFromVenue ?? null,
      accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    });
  }),
);

/**
 * Admin: who signed up and who actually turned up.
 *
 * Returns every join row for the program, including members who joined but
 * never checked in — that gap is the whole point of tracking the two
 * separately.
 */
router.get(
  '/:id/attendance',
  requireAuth,
  requireCapability('managePrograms'),
  asyncHandler(async (req, res) => {
    const { rows: programRows } = await query('SELECT * FROM programs WHERE id = $1', [
      req.params.id,
    ]);
    if (!programRows[0]) throw httpError(404, 'Program not found');

    const { rows } = await query(
      `SELECT pa.id, pa.user_id, pa.joined_at, pa.checked_in_at, pa.method, pa.face_score,
              u.full_name, u.phone, u.guardian_id, g.full_name AS guardian_name,
              v.full_name AS verified_by_name
       FROM program_attendance pa
       JOIN users u ON u.id = pa.user_id
       LEFT JOIN users g ON g.id = u.guardian_id
       LEFT JOIN users v ON v.id = pa.verified_by
       WHERE pa.program_id = $1
       ORDER BY (pa.checked_in_at IS NULL), pa.checked_in_at DESC, u.full_name ASC`,
      [req.params.id],
    );

    res.json({
      program: publicProgram(programRows[0]),
      attendance: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        fullName: r.full_name,
        phone: r.phone,
        isDependent: Boolean(r.guardian_id),
        guardianName: r.guardian_name,
        joinedAt: r.joined_at,
        checkedInAt: r.checked_in_at,
        method: r.method,
        faceScore: r.face_score,
        verifiedByName: r.verified_by_name,
      })),
    });
  }),
);

/** Admin: record attendance manually (e.g. face verification failed). */
router.post(
  '/:id/attendance/manual',
  requireAuth,
  requireCapability('managePrograms'),
  asyncHandler(async (req, res) => {
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'A valid userId is required');

    const { rows: programRows } = await query('SELECT id FROM programs WHERE id = $1', [
      req.params.id,
    ]);
    if (!programRows[0]) throw httpError(404, 'Program not found');

    const { rows: userRows } = await query('SELECT id FROM users WHERE id = $1', [
      parsed.data.userId,
    ]);
    if (!userRows[0]) throw httpError(404, 'Member not found');

    const { rows } = await query(
      `INSERT INTO program_attendance (program_id, user_id, checked_in_at, method, verified_by)
       VALUES ($1, $2, now(), 'manual', $3)
       ON CONFLICT (program_id, user_id)
       DO UPDATE SET checked_in_at = now(), method = 'manual', verified_by = EXCLUDED.verified_by
       RETURNING *`,
      [req.params.id, parsed.data.userId, req.user.sub],
    );
    res.json({ ok: true, attendance: rows[0] });
  }),
);

/** Admin: undo a check-in (keeps the join row, clears the attendance). */
router.delete(
  '/:id/attendance/:userId',
  requireAuth,
  requireCapability('managePrograms'),
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      `UPDATE program_attendance
       SET checked_in_at = NULL, face_score = NULL, latitude = NULL, longitude = NULL,
           verified_by = NULL, method = 'face'
       WHERE program_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId],
    );
    if (!rowCount) throw httpError(404, 'Attendance record not found');
    res.json({ ok: true });
  }),
);

export default router;
