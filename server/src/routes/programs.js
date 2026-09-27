import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';

const router = Router();

const programSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(2000).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  category: z.string().max(60).optional().nullable(),
  isPublished: z.boolean().optional(),
});

/** Public (authenticated) list of upcoming programs. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const includePast = req.query.includePast === 'true';
    const { rows } = await query(
      `SELECT p.*, u.full_name AS created_by_name,
              (SELECT COUNT(*)::int FROM program_attendance pa WHERE pa.program_id = p.id) AS join_count
       FROM programs p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.is_published = TRUE ${includePast ? '' : 'AND p.starts_at >= now()'}
       ORDER BY p.starts_at ASC`,
    );
    res.json({ programs: rows });
  }),
);

/** Admin: create a program. */
router.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = programSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid program data');
    const { title, description, location, startsAt, endsAt, category, isPublished } = parsed.data;

    const { rows } = await query(
      `INSERT INTO programs (title, description, location, starts_at, ends_at, category, is_published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, description ?? null, location ?? null, startsAt, endsAt ?? null, category ?? 'program', isPublished ?? true, req.user.sub],
    );
    res.status(201).json({ program: rows[0] });
  }),
);

/** Admin: update a program. */
router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = programSchema.partial().safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid program data');
    const d = parsed.data;

    const { rows } = await query(
      `UPDATE programs SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         location = COALESCE($3, location),
         starts_at = COALESCE($4, starts_at),
         ends_at = COALESCE($5, ends_at),
         category = COALESCE($6, category),
         is_published = COALESCE($7, is_published),
         updated_at = now()
       WHERE id = $8 RETURNING *`,
      [d.title ?? null, d.description ?? null, d.location ?? null, d.startsAt ?? null, d.endsAt ?? null, d.category ?? null, d.isPublished ?? null, req.params.id],
    );
    if (!rows[0]) throw httpError(404, 'Program not found');
    res.json({ program: rows[0] });
  }),
);

/** Admin: delete a program. */
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM programs WHERE id = $1', [req.params.id]);
    if (!rowCount) throw httpError(404, 'Program not found');
    res.json({ ok: true });
  }),
);

/** Join a program. */
router.post(
  '/:id/join',
  requireAuth,
  asyncHandler(async (req, res) => {
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

/** Leave a program. */
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

export default router;