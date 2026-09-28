import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, requireAdmin, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { isValidDescriptor } from '../utils/face.js';
import { generateOtp, hashOtp, otpExpiryDate, canonicalPhone, phoneVariants } from '../utils/otp.js';
import { ROLES } from '../utils/roles.js';
import { publicUser } from './auth.js';

const router = Router();

const profileSchema = z.object({
  fullName: z.string().min(2).max(120),
  // Required: the surau needs each member's date of birth (age is derived) and
  // gender, plus a contact address.
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['male', 'female']),
  address: z.string().trim().min(5).max(300),
});

const dependentSchema = z.object({
  fullName: z.string().min(2).max(120),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['male', 'female']),
});

// Give an existing dependent their own phone number so they can log in and
// check themselves in. The account keeps its id (history + enrolled face) and
// stays linked to the guardian.
const promoteSchema = z.object({
  phone: z.string().min(8).max(20),
});

/** Update own profile. */
router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid profile data');
    const { fullName, birthDate, gender, address } = parsed.data;

    const { rows } = await query(
      `UPDATE users
       SET full_name = $1, birth_date = $2, gender = $3, address = $4, updated_at = now()
       WHERE id = $5 RETURNING *`,
      [fullName, birthDate ?? null, gender ?? null, address ?? null, req.user.sub],
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
      `SELECT * FROM users
       WHERE guardian_id = $1 OR co_guardian_id = $1
       ORDER BY created_at ASC`,
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
    const { fullName, birthDate, gender } = parsed.data;

    const { rows } = await query(
      `INSERT INTO users (phone, full_name, birth_date, gender, role, guardian_id)
       VALUES (NULL, $1, $2, $3, 'youth', $4) RETURNING *`,
      [fullName, birthDate ?? null, gender ?? null, req.user.sub],
    );
    res.status(201).json({ dependent: publicUser(rows[0]) });
  }),
);

/**
 * Give a dependent their own phone number so they can log in.
 *
 * The row is UPDATED, not recreated: attendance, Quran logs, merits and the
 * enrolled face descriptor all carry over, and `guardian_id` is kept so the
 * guardian still sees the child in the family view. Either the guardian
 * themselves or an admin may do this.
 */
router.post(
  '/me/dependents/:id/phone',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'A valid phone number is required');
    const phone = canonicalPhone(parsed.data.phone);

    const isAdmin = req.user.role === 'admin';
    const { rows: depRows } = await query(
      isAdmin
        ? `SELECT * FROM users WHERE id = $1 AND guardian_id IS NOT NULL`
        : `SELECT * FROM users
           WHERE id = $1 AND (guardian_id = $2 OR co_guardian_id = $2)`,
      isAdmin ? [req.params.id] : [req.params.id, req.user.sub],
    );
    const dependent = depRows[0];
    if (!dependent) throw httpError(404, 'Dependent not found');

    // Reject a number already used by another account (match any spelling).
    const { rows: existing } = await query(
      `SELECT id FROM users WHERE phone = ANY($1::text[]) AND id <> $2`,
      [phoneVariants(phone), dependent.id],
    );
    if (existing[0]) throw httpError(409, 'That phone number is already registered to another account.');

    const { rows } = await query(
      `UPDATE users SET phone = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [phone, dependent.id],
    );
    res.json({ dependent: publicUser(rows[0]) });
  }),
);

/**
 * Set (or clear) a dependent's SECOND guardian.
 *
 * Both parents often bring the same child to the surau separately, so either
 * guardian must be able to check the child in. The primary guardian adds the
 * other parent by phone number; that parent must already have an account.
 *
 * Body: { phone } to set, or { phone: null } to clear.
 */
router.post(
  '/me/dependents/:id/co-guardian',
  requireAuth,
  asyncHandler(async (req, res) => {
    const raw = req.body?.phone;
    const isAdmin = req.user.role === 'admin';

    // Only the primary guardian (or an admin) may change this.
    const { rows: depRows } = await query(
      isAdmin
        ? `SELECT * FROM users WHERE id = $1 AND guardian_id IS NOT NULL`
        : `SELECT * FROM users WHERE id = $1 AND guardian_id = $2`,
      isAdmin ? [req.params.id] : [req.params.id, req.user.sub],
    );
    const dependent = depRows[0];
    if (!dependent) throw httpError(404, 'Dependent not found');

    // Clearing the co-guardian.
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      const { rows } = await query(
        `UPDATE users SET co_guardian_id = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
        [dependent.id],
      );
      return res.json({ dependent: publicUser(rows[0]) });
    }

    const phone = canonicalPhone(String(raw));
    const { rows: guardianRows } = await query(
      `SELECT id, full_name FROM users
       WHERE phone = ANY($1::text[]) AND is_active = TRUE AND guardian_id IS NULL`,
      [phoneVariants(phone)],
    );
    const coGuardian = guardianRows[0];
    if (!coGuardian) {
      throw httpError(
        404,
        'No active member found with that phone number. They need to register first.',
      );
    }
    if (coGuardian.id === dependent.guardian_id) {
      throw httpError(400, 'That is already the primary guardian.');
    }

    const { rows } = await query(
      `UPDATE users SET co_guardian_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [coGuardian.id, dependent.id],
    );
    res.json({ dependent: publicUser(rows[0]) });
  }),
);

/** Update a dependent owned by the current user. */
router.put(
  '/me/dependents/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = dependentSchema.safeParse(req.body);
    if (!parsed.success) throw httpError(400, 'Invalid dependent data');
    const { fullName, birthDate, gender } = parsed.data;

    const { rows } = await query(
      `UPDATE users
       SET full_name = $1, birth_date = $2, gender = $3, updated_at = now()
       WHERE id = $4 AND (guardian_id = $5 OR co_guardian_id = $5) RETURNING *`,
      [fullName, birthDate ?? null, gender ?? null, req.params.id, req.user.sub],
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
       WHERE id = $2 AND (guardian_id = $3 OR co_guardian_id = $3) RETURNING *`,
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
      `DELETE FROM users WHERE id = $1 AND (guardian_id = $2 OR co_guardian_id = $2)`,
      [req.params.id, req.user.sub],
    );
    if (!rowCount) throw httpError(404, 'Dependent not found');
    res.json({ ok: true });
  }),
);

/** Staff: list all users (teachers/AJK need this to pick a member). */
router.get(
  '/',
  requireAuth,
  requireCapability('viewMembers'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT u.*, g.full_name AS guardian_name, cg.full_name AS co_guardian_name
       FROM users u
       LEFT JOIN users g ON g.id = u.guardian_id
       LEFT JOIN users cg ON cg.id = u.co_guardian_id
       ORDER BY u.created_at DESC`,
    );
    res.json({
      users: rows.map((row) => ({
        ...publicUser(row),
        guardianName: row.guardian_name || null,
        coGuardianName: row.co_guardian_name || null,
      })),
    });
  }),
);

/** Admin: change a member's role. */
router.patch(
  '/:id/role',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const role = req.body?.role;
    if (!ROLES.includes(role)) throw httpError(400, 'Invalid role');

    const { rows: targetRows } = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const target = targetRows[0];
    if (!target) throw httpError(404, 'User not found');
    if (target.guardian_id) throw httpError(400, 'Dependents inherit their guardian\'s role');

    // Never let an admin demote themselves and lock everyone out.
    if (target.id === req.user.sub && role !== 'admin') {
      throw httpError(400, 'You cannot change your own admin role');
    }

    const { rows } = await query(
      `UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [role, req.params.id],
    );
    res.json({ user: publicUser(rows[0]) });
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
