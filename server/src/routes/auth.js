import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { generateOtp, hashOtp, verifyOtp, otpExpiryDate, normalizePhone } from '../utils/otp.js';
import { deliverOtp, canReachUser } from '../utils/otpDelivery.js';

const router = Router();

const phoneSchema = z.string().min(8).max(20);

/** Step 1: request an OTP for a phone number. */
router.post(
  '/request-otp',
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) throw httpError(400, 'A valid phone number is required');

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'login', $3)`,
      [phone, codeHash, otpExpiryDate()],
    );

    // Look up the user so we can prefer their linked Telegram chat.
    const { rows: userRows } = await query(
      'SELECT id, telegram_chat_id FROM users WHERE phone = $1',
      [phone],
    );
    const user = userRows[0] || null;

    const delivery = await deliverOtp({ user, phone, code });

    res.json({
      ok: true,
      channel: delivery.channel,
      // Tell the client whether an admin needs to read the code out.
      needsAdminHelp: !canReachUser(user),
      // In non-production we return the code to make local testing easy.
      devCode: config.env === 'production' ? undefined : code,
    });
  }),
);

/** Step 2: verify the OTP and issue a JWT. Creates the user if new. */
router.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    if (!phone || !code) throw httpError(400, 'Phone and code are required');

    const { rows } = await query(
      `SELECT * FROM otp_codes
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    const otp = rows[0];
    if (!otp) throw httpError(400, 'No valid code found. Please request a new one.');
    if (otp.attempts >= 5) throw httpError(429, 'Too many attempts. Please request a new code.');

    const valid = await verifyOtp(code, otp.code_hash);
    if (!valid) {
      await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      throw httpError(400, 'Incorrect code');
    }

    await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);

    let { rows: userRows } = await query('SELECT * FROM users WHERE phone = $1', [phone]);
    let user = userRows[0];
    let isNewUser = false;

    if (!user) {
      const role = config.adminPhones.includes(phone) ? 'admin' : 'youth';
      const inserted = await query(
        `INSERT INTO users (phone, full_name, role)
         VALUES ($1, $2, $3) RETURNING *`,
        [phone, 'New Member', role],
      );
      user = inserted.rows[0];
      isNewUser = true;
    }

    if (!user.is_active) throw httpError(403, 'This account has been deactivated');

    res.json({
      token: signToken(user),
      user: publicUser(user),
      isNewUser,
      needsProfile: isNewUser || user.full_name === 'New Member',
    });
  }),
);

/** Current user profile. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.sub]);
    if (!rows[0]) throw httpError(404, 'User not found');
    res.json({ user: publicUser(rows[0]) });
  }),
);

export function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    fullName: user.full_name,
    age: user.age,
    gender: user.gender,
    address: user.address,
    role: user.role,
    hasFace: Boolean(user.face_descriptor),
    avatarUrl: user.avatar_url,
    telegramLinked: Boolean(user.telegram_chat_id),
    telegramUsername: user.telegram_username || null,
    createdAt: user.created_at,
  };
}

export default router;
