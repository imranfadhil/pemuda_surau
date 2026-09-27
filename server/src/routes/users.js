import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { isValidDescriptor } from '../utils/face.js';
import { generateOtp, hashOtp, otpExpiryDate } from '../utils/otp.js';
import { publicUser } from './auth.js';

const router = Router();

const profileSchema = z.object({
  fullName: z.string().min(2).max(120),
  age: z.number().int().min(1).max(120).optional().nullable(),
  gender: z.enum(['male', 'female']).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
});

const dependentSchema = z.object({
  fullName: z.string().min(2).max(120),
  age: z.number().int().min(1).max(120).optional().nullable(),
  gender: z.enum(['male', 'female']).optional().nullable(),
});

/** Update own profile. */
router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid profile data');
    const { fullName, age, gender, address } = parsed.data;

    const { rows } = await query(
      `UPDATE users
       SET full_name = $1, age = $2, gender = $3, address = $4, updated_at = now()
       WHERE id = $5 RETURNING *`,
      [fullName, age ?? null, gender ?? null, address ?? null, req.user.sub],
    );
    if (!rows[0]) throw httpError(404, 'User not found');
    res.json({ user: publicUser(rows[0]) });
  }),
);

/** Enroll (or re-enroll) a face descriptor for the current user. */
router.post(
  '/me/face',
  requireAuth,
  asyncHandler(async (req, res) => {
    const descriptor = req.body?.descriptor;
    if (!isValidDescriptor(descriptor)) {
      throw httpError(400, 'A valid 128-value face descriptor is required');
    }
    const { rows } = await query(
      `UPDATE users
       SET face_descriptor = $1, face_enrolled_at = now(), updated_at = now()
       WHERE id = $2 RETURNING *`,
      [JSON.stringify(descriptor), req.user.sub],
    );
    if (!rows[0]) throw httpError(404, 'User not found');
    res.json({ ok: true, user: publicUser(rows[0]) });
  }),
);

/**
 * Dependents (children) managed by the current user.
 * A dependent has no phone of their own and cannot log in; the guardian
 * enrolls their face and checks them in.
 */
router.get(
  '/me/dependents',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM users WHERE guardian_id = $1 ORDER BY created_at ASC`,
      [req.user.sub],
    );
    res.json({ dependents: rows.map(publicUser) });
  }),
);

/** Create a dependent under the current user. */
router.post(
  '/me/dependents',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = dependentSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid dependent data');
    const { fullName, age, gender } = parsed.data;

    const { rows } = await query(
      `INSERT INTO users (phone, full_name, age, gender, role, guardian_id)
       VALUES (NULL, $1, $2, $3, 'youth', $4) RETURNING *`,
      [fullName, age ?? null, gender ?? null, req.user.sub],
    );
    res.status(201).json({ dependent: publicUser(rows[0]) });
  }),
);

/** Update a dependent owned by the current user. */
router.put(
  '/me/dependents/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = dependentSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid dependent data');
    const { fullName, age, gender } = parsed.data;

    const { rows } = await query(
      `UPDATE users
       SET full_name = $1, age = $2, gender = $3, updated_at = now()
       WHERE id = $4 AND guardian_id = $5 RETURNING *`,
      [fullName, age ?? null, gender ?? null, req.params.id, req.user.sub],
    );
    if (!rows[0]) throw httpError(404, 'Dependent not found');
    res.json({ dependent: publicUser(rows[0]) });
  }),
);

/** Enroll (or re-enroll) a face descriptor for a dependent. */
router.post(
  '/me/dependents/:id/face',
  requireAuth,
  asyncHandler(async (req, res) => {
    const descriptor = req.body?.descriptor;
    if (!isValidDescriptor(descriptor)) {
      throw httpError(400, 'A valid 128-value face descriptor is required');
    }
    const { rows } = await query(
      `UPDATE users
       SET face_descriptor = $1, face_enrolled_at = now(), updated_at = now()
       WHERE id = $2 AND guardian_id = $3 RETURNING *`,
      [JSON.stringify(descriptor), req.params.id, req.user.sub],
    );
    if (!rows[0]) throw httpError(404, 'Dependent not found');
    res.json({ ok: true, dependent: publicUser(rows[0]) });
  }),
);

/** Remove a dependent (and their attendance, via ON DELETE CASCADE). */
router.delete(
  '/me/dependents/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(
      `DELETE FROM users WHERE id = $1 AND guardian_id = $2`,
      [req.params.id, req.user.sub],
    );
    if (!rowCount) throw httpError(404, 'Dependent not found');
    res.json({ ok: true });
  }),
);

/** Admin: list all users. */
router.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT u.*, g.full_name AS guardian_name
       FROM users u
       LEFT JOIN users g ON g.id = u.guardian_id
       ORDER BY u.created_at DESC`,
    );
    res.json({
      users: rows.map((row) => ({ ...publicUser(row), guardianName: row.guardian_name || null })),
    });
  }),
);

/** Admin: toggle active status. */
router.patch(
  '/:id/active',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const isActive = Boolean(req.body?.isActive);
    const { rows } = await query(
      `UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [isActive, req.params.id],
    );
    if (!rows[0]) throw httpError(404, 'User not found');
    res.json({ user: publicUser(rows[0]) });
  }),
);

/**
 * Admin-assisted login: generate a one-time code for a member who cannot
 * receive Telegram/SMS. The admin reads the code out to them in person.
 * The code is returned in the response (admins are trusted) and is valid
 * for the normal OTP window.
 */
router.post(
  '/:id/login-code',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const user = userRows[0];
    if (!user) throw httpError(404, 'User not found');
    if (!user.is_active) throw httpError(403, 'This account is deactivated');
    if (!user.phone) {
      throw httpError(400, 'This is a dependent account and has no phone number to log in with.');
    }

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'admin-assisted', $3)`,
      [user.phone, codeHash, otpExpiryDate()],
    );

    res.json({
      ok: true,
      code,
      phone: user.phone,
      fullName: user.full_name,
      expiresAt: otpExpiryDate(),
    });
  }),
);

export default router;
