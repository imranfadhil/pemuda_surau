import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { isValidDescriptor, findBestMatch } from '../utils/face.js';
import { withinGeofence, isValidCoordinate, formatDistance } from '../utils/geo.js';
import { roleHasCapability } from '../utils/roles.js';
import { dateInTz } from '../utils/timezone.js';
import {
  WEEKDAYS,
  nextOccurrence,
  currentOccurrence,
  describeRecurrence,
} from '../utils/recurrence.js';

const router = Router();

/**
 * A program with no `ends_at` has no natural closing time, so we assume it runs
 * for this long. Without it, a program created with only a start time would
 * stay open for check-in forever.
 */
const DEFAULT_DURATION_MINUTES = 180;

/** Sentinel session date for one-off programs (see schema.sql). */
const ONE_OFF_SESSION = '0001-01-01';

const linkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(500),
});

const programSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(2000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  // A recurring program derives its times from the recurrence rule, so a single
  // `startsAt` is optional for it.
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  category: z.string().max(60).optional().nullable(),
  isPublished: z.boolean().optional(),
  // Optional per-program geofence. NULL means "use the surau's own location".
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  radiusMeters: z.number().int().min(10).max(50000).optional().nullable(),
  checkInGraceMinutes: z.number().int().min(0).max(1440).optional(),
  checkInEnabled: z.boolean().optional(),
  // Poster is a data URL (resized client-side) or an external image URL.
  posterUrl: z.string().max(1_500_000).optional().nullable(),
  links: z.array(linkSchema).max(10).optional(),
  // Weekly recurrence.
  recurrenceDays: z.array(z.enum(WEEKDAYS)).max(7).optional(),
  recurrenceUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  recurrenceStartMode: z.enum(['fixed', 'prayer']).optional(),
  recurrenceStartTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .optional()
    .nullable(),
  recurrenceStartPrayer: z.enum(['subuh', 'zuhur', 'asar', 'maghrib', 'isyak']).optional().nullable(),
  recurrenceStartOffsetMinutes: z.number().int().min(-720).max(720).optional(),
  recurrenceEndMode: z.enum(['fixed', 'prayer']).optional(),
  recurrenceEndTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .optional()
    .nullable(),
  recurrenceEndPrayer: z.enum(['subuh', 'zuhur', 'asar', 'maghrib', 'isyak']).optional().nullable(),
  recurrenceEndOffsetMinutes: z.number().int().min(-720).max(720).optional(),
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
  sessionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** True when the program repeats weekly. */
function isRecurring(program) {
  return Array.isArray(program.recurrence_days) && program.recurrence_days.length > 0;
}

/**
 * The window during which a one-off program accepts check-ins: from `starts_at`
 * until `ends_at` (or a default duration) plus the program's grace period.
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

/** Close time for an occurrence, applying the default duration + grace. */
function occurrenceClosesAt(program, occurrence) {
  const grace = Number(program.check_in_grace_minutes ?? 30);
  const end = occurrence.end
    ? occurrence.end
    : new Date(occurrence.start.getTime() + DEFAULT_DURATION_MINUTES * 60000);
  return new Date(end.getTime() + grace * 60000);
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

/**
 * Shape a program row for the client, including the caller's own state.
 *
 * For recurring programs the check-in window is derived from the current or
 * next occurrence, so the client never has to re-implement the recurrence.
 */
async function publicProgram(row, now = new Date()) {
  const recurring = isRecurring(row);
  let opensAt = null;
  let closesAt = null;
  let isOpen = false;
  let sessionDate = null;
  let nextStart = null;
  let nextEnd = null;

  if (recurring) {
    const current = await currentOccurrence(row, now);
    const next = await nextOccurrence(row, now);
    const shown = current || next;
    if (shown) {
      opensAt = shown.start;
      closesAt = occurrenceClosesAt(row, shown);
      sessionDate = shown.date;
      nextStart = shown.start;
      nextEnd = shown.end;
    }
    isOpen = Boolean(current);
  } else {
    const w = checkInWindow(row);
    opensAt = w.opensAt;
    closesAt = w.closesAt;
    isOpen = w.isOpen;
  }

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
    poster_url: row.poster_url ?? null,
    links: Array.isArray(row.links) ? row.links : [],
    created_by: row.created_by,
    created_by_name: row.created_by_name ?? null,
    created_at: row.created_at,
    join_count: Number(row.join_count ?? 0),
    checked_in_count: Number(row.checked_in_count ?? 0),
    // The caller's own relationship to this program.
    joined: Boolean(row.joined),
    checked_in_at: row.checked_in_at ?? null,
    // Recurrence.
    is_recurring: recurring,
    recurrence_days: Array.isArray(row.recurrence_days) ? row.recurrence_days : [],
    recurrence_until: row.recurrence_until ?? null,
    recurrence_start_mode: row.recurrence_start_mode ?? 'fixed',
    recurrence_start_time: row.recurrence_start_time ?? null,
    recurrence_start_prayer: row.recurrence_start_prayer ?? null,
    recurrence_start_offset_minutes: row.recurrence_start_offset_minutes ?? 0,
    recurrence_end_mode: row.recurrence_end_mode ?? 'fixed',
    recurrence_end_time: row.recurrence_end_time ?? null,
    recurrence_end_prayer: row.recurrence_end_prayer ?? null,
    recurrence_end_offset_minutes: row.recurrence_end_offset_minutes ?? 0,
    recurrence_summary: describeRecurrence(row),
    // Derived so the client never has to re-implement the window rules.
    check_in_opens_at: opensAt ? opensAt.toISOString() : null,
    check_in_closes_at: closesAt ? closesAt.toISOString() : null,
    session_date: sessionDate,
    next_start: nextStart ? nextStart.toISOString() : null,
    next_end: nextEnd ? nextEnd.toISOString() : null,
    is_open: isOpen,
  };
}

/** Map the API payload onto the recurrence DB columns. */
function recurrenceColumns(d) {
  return {
    recurrence_days: d.recurrenceDays ?? [],
    recurrence_until: d.recurrenceUntil ?? null,
    recurrence_start_mode: d.recurrenceStartMode ?? 'fixed',
    recurrence_start_time: d.recurrenceStartTime ?? null,
    recurrence_start_prayer: d.recurrenceStartPrayer ?? null,
    recurrence_start_offset_minutes: d.recurrenceStartOffsetMinutes ?? 0,
    recurrence_end_mode: d.recurrenceEndMode ?? 'fixed',
    recurrence_end_time: d.recurrenceEndTime ?? null,
    recurrence_end_prayer: d.recurrenceEndPrayer ?? null,
    recurrence_end_offset_minutes: d.recurrenceEndOffsetMinutes ?? 0,
  };
}

/**
 * List programs.
 *
 * Members see published programs only; staff with `managePrograms` also see
 * drafts (so the admin tab can show and publish them). `includePast` adds
 * programs that have already finished. Recurring programs stay listed while
 * their pattern is still active.
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
         ORDER BY pa.checked_in_at DESC NULLS LAST
         LIMIT 1
       ) mine ON TRUE
       WHERE ($2 OR p.is_published = TRUE)
         AND (
           $3
           OR (p.recurrence_days <> '{}' AND (p.recurrence_until IS NULL OR p.recurrence_until >= CURRENT_DATE))
           OR COALESCE(p.ends_at, p.starts_at + interval '3 hours') >= now()
         )
       ORDER BY p.starts_at ASC`,
      [req.user.sub, canManage, includePast],
    );
    res.json({ programs: await Promise.all(rows.map((r) => publicProgram(r))) });
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
         ORDER BY pa.checked_in_at DESC NULLS LAST
         LIMIT 1
       ) mine ON TRUE
       WHERE p.id = $1`,
      [req.params.id, req.user.sub],
    );
    const program = rows[0];
    if (!program) throw httpError(404, 'Program not found');
    if (!program.is_published && !canManage) throw httpError(404, 'Program not found');
    res.json({ program: await publicProgram(program) });
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

    const recurring = Array.isArray(d.recurrenceDays) && d.recurrenceDays.length > 0;
    if (!recurring && !d.startsAt) {
      throw httpError(400, 'A start time is required for a one-off program.');
    }

    // A recurring program still needs a `starts_at` anchor (NOT NULL column).
    // Use the first occurrence when we can resolve it, else the supplied time.
    let startsAt = d.startsAt ?? null;
    if (recurring && !startsAt) {
      const rec = recurrenceColumns(d);
      const first = await nextOccurrence({ ...rec, check_in_grace_minutes: d.checkInGraceMinutes });
      startsAt = (first?.start ?? new Date()).toISOString();
    }

    const rec = recurrenceColumns(d);
    const { rows } = await query(
      `INSERT INTO programs
         (title, description, location, starts_at, ends_at, category, is_published, created_by,
          latitude, longitude, radius_meters, check_in_grace_minutes, check_in_enabled,
          poster_url, links,
          recurrence_days, recurrence_until, recurrence_start_mode, recurrence_start_time,
          recurrence_start_prayer, recurrence_start_offset_minutes, recurrence_end_mode,
          recurrence_end_time, recurrence_end_prayer, recurrence_end_offset_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       RETURNING *`,
      [
        d.title,
        d.description ?? null,
        d.location ?? null,
        startsAt,
        d.endsAt ?? null,
        d.category ?? 'program',
        d.isPublished ?? true,
        req.user.sub,
        d.latitude ?? null,
        d.longitude ?? null,
        d.radiusMeters ?? null,
        d.checkInGraceMinutes ?? 30,
        d.checkInEnabled ?? true,
        d.posterUrl ?? null,
        JSON.stringify(d.links ?? []),
        rec.recurrence_days,
        rec.recurrence_until,
        rec.recurrence_start_mode,
        rec.recurrence_start_time,
        rec.recurrence_start_prayer,
        rec.recurrence_start_offset_minutes,
        rec.recurrence_end_mode,
        rec.recurrence_end_time,
        rec.recurrence_end_prayer,
        rec.recurrence_end_offset_minutes,
      ],
    );
    res.status(201).json({ program: await publicProgram(rows[0]) });
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
      posterUrl: 'poster_url',
    };

    const assignments = [];
    const values = [];
    for (const [field, column] of Object.entries(columns)) {
      if (!(field in d)) continue;
      // `starts_at` is NOT NULL and only acts as an anchor for recurring
      // programs, so a null (sent when switching to a recurrence) is ignored
      // rather than clearing it.
      if (field === 'startsAt' && d.startsAt == null) continue;
      values.push(d[field] ?? null);
      assignments.push(`${column} = $${values.length}`);
    }

    if ('links' in d) {
      values.push(JSON.stringify(d.links ?? []));
      assignments.push(`links = $${values.length}`);
    }

    const recMap = {
      recurrenceDays: 'recurrence_days',
      recurrenceUntil: 'recurrence_until',
      recurrenceStartMode: 'recurrence_start_mode',
      recurrenceStartTime: 'recurrence_start_time',
      recurrenceStartPrayer: 'recurrence_start_prayer',
      recurrenceStartOffsetMinutes: 'recurrence_start_offset_minutes',
      recurrenceEndMode: 'recurrence_end_mode',
      recurrenceEndTime: 'recurrence_end_time',
      recurrenceEndPrayer: 'recurrence_end_prayer',
      recurrenceEndOffsetMinutes: 'recurrence_end_offset_minutes',
    };
    for (const [field, column] of Object.entries(recMap)) {
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
    res.json({ program: await publicProgram(rows[0]) });
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
       ON CONFLICT (program_id, user_id, session_date) DO NOTHING
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

    // Resolve the session being checked into and whether it is open.
    let sessionDate = ONE_OFF_SESSION;
    if (isRecurring(program)) {
      const current = await currentOccurrence(program);
      if (!current) {
        const next = await nextOccurrence(program);
        if (next) {
          throw httpError(
            409,
            `Check-in is not open right now. The next session is ${next.start.toISOString()}.`,
          );
        }
        throw httpError(409, 'Check-in is closed for this program.');
      }
      sessionDate = current.date;
    } else {
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
         (program_id, user_id, session_date, checked_in_at, method, face_score, latitude, longitude)
       VALUES ($1, $2, $3, now(), 'face', $4, $5, $6)
       ON CONFLICT (program_id, user_id, session_date)
       DO UPDATE SET checked_in_at = now(), method = 'face', face_score = EXCLUDED.face_score,
                     latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
       RETURNING *`,
      [program.id, match.user.id, sessionDate, match.distance, latitude ?? null, longitude ?? null],
    );

    res.json({
      ok: true,
      attendance: rows[0],
      memberName: target.full_name,
      confidence: Number((1 - match.distance).toFixed(3)),
      distance: Number(match.distance.toFixed(3)),
      distanceFromVenue: distanceFromVenue ?? null,
      accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      sessionDate,
    });
  }),
);

/**
 * Admin: who signed up and who actually turned up.
 *
 * Returns every join row for the program, including members who joined but
 * never checked in — that gap is the whole point of tracking the two
 * separately. For recurring programs each row carries its `session_date`.
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
              pa.session_date,
              u.full_name, u.phone, u.guardian_id, g.full_name AS guardian_name,
              v.full_name AS verified_by_name
       FROM program_attendance pa
       JOIN users u ON u.id = pa.user_id
       LEFT JOIN users g ON g.id = u.guardian_id
       LEFT JOIN users v ON v.id = pa.verified_by
       WHERE pa.program_id = $1
       ORDER BY pa.session_date DESC, (pa.checked_in_at IS NULL), pa.checked_in_at DESC, u.full_name ASC`,
      [req.params.id],
    );

    const program = await publicProgram(programRows[0]);
    res.json({
      program,
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
        sessionDate: r.session_date === ONE_OFF_SESSION ? null : r.session_date,
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

    const { rows: programRows } = await query('SELECT * FROM programs WHERE id = $1', [
      req.params.id,
    ]);
    const program = programRows[0];
    if (!program) throw httpError(404, 'Program not found');

    const { rows: userRows } = await query('SELECT id FROM users WHERE id = $1', [
      parsed.data.userId,
    ]);
    if (!userRows[0]) throw httpError(404, 'Member not found');

    // Recurring programs need a session; default to the current/next occurrence
    // (or today) when the admin did not pick one.
    let sessionDate = ONE_OFF_SESSION;
    if (isRecurring(program)) {
      if (parsed.data.sessionDate) {
        sessionDate = parsed.data.sessionDate;
      } else {
        const current = await currentOccurrence(program);
        const next = current || (await nextOccurrence(program));
        sessionDate = next?.date ?? dateInTz(new Date(), config.prayer.timezone);
      }
    }

    const { rows } = await query(
      `INSERT INTO program_attendance
         (program_id, user_id, session_date, checked_in_at, method, verified_by)
       VALUES ($1, $2, $3, now(), 'manual', $4)
       ON CONFLICT (program_id, user_id, session_date)
       DO UPDATE SET checked_in_at = now(), method = 'manual', verified_by = EXCLUDED.verified_by
       RETURNING *`,
      [req.params.id, parsed.data.userId, sessionDate, req.user.sub],
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
    const sessionDate = req.query.sessionDate || ONE_OFF_SESSION;
    const { rowCount } = await query(
      `UPDATE program_attendance
       SET checked_in_at = NULL, face_score = NULL, latitude = NULL, longitude = NULL,
           verified_by = NULL, method = 'face'
       WHERE program_id = $1 AND user_id = $2 AND session_date = $3`,
      [req.params.id, req.params.userId, sessionDate],
    );
    if (!rowCount) throw httpError(404, 'Attendance record not found');
    res.json({ ok: true });
  }),
);

export default router;
