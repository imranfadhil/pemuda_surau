import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/errors.js';
import { generateOtp, hashOtp, verifyOtp, otpExpiryDate, canonicalPhone, phoneVariants } from '../utils/otp.js';
import { deliverOtp, canReachUser } from '../utils/otpDelivery.js';
import { isTelegramConfigured, buildBotUrl } from '../utils/telegram.js';
import { capabilitiesFor } from '../utils/roles.js';
import { ageFromBirthDate, toDateString } from '../utils/age.js';

const router = Router();

const phoneSchema = z.string().min(8).max(20);

/**
 * Public: how a user can sign in.
 *
 * Telegram is the primary channel. When it is configured we point the client at
 * the bot so the user can link their account and receive a code there. The
 * admin-assisted path is only a last resort.
 */
router.get(
  '/login-options',
  asyncHandler(async (req, res) => {
    res.json({
      telegram: {
        available: isTelegramConfigured(),
        botUrl: buildBotUrl(),
        botUsername: config.telegram.botUsername || null,
      },
      sms: { available: config.sms.provider !== 'console' },
      adminAssisted: true,
    });
  }),
);

/** Step 1: request an OTP for a phone number. */
router.post(
  '/request-otp',
  asyncHandler(async (req, res) => {
    const phone = canonicalPhone(req.body?.phone);
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) throw httpError(400, 'A valid phone number is required');

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await query(
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
       VALUES ($1, $2, 'login', $3)`,
      [phone, codeHash, otpExpiryDate()],
    );

    // Look up the user so we can prefer their linked Telegram chat. Match any
    // equivalent spelling so rows stored in local format still resolve.
    const { rows: userRows } = await query(
      'SELECT id, telegram_chat_id FROM users WHERE phone = ANY($1::text[])',
      [phoneVariants(phone)],
    );
    const user = userRows[0] || null;

    const delivery = await deliverOtp({ user, phone, code });

    res.json({
      ok: true,
      channel: delivery.channel,
      // Tell the client whether an admin needs to read the code out.
      needsAdminHelp: !canReachUser(user),
      // Telegram-first: if the user hasn't linked yet, offer the bot so they
      // can link and get their code there instead of relying on an admin.
      telegramAvailable: isTelegramConfigured(),
      telegramLinked: Boolean(user?.telegram_chat_id),
      botUrl: buildBotUrl(),
      // In non-production we return the code to make local testing easy.
      devCode: config.env === 'production' ? undefined : code,
    });
  }),
);

/** Step 2: verify the OTP and issue a JWT. Creates the user if new. */
router.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
    const phone = canonicalPhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    if (!phone || !code) throw httpError(400, 'Phone and code are required');

    const { rows } = await query(
      `SELECT * FROM otp_codes
       WHERE phone = ANY($1::text[]) AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [phoneVariants(phone)],
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

    let { rows: userRows } = await query(
      'SELECT * FROM users WHERE phone = ANY($1::text[])',
      [phoneVariants(phone)],
    );
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
    if (user.guardian_id) {
      throw httpError(403, 'This is a dependent account. Please ask your guardian to check in for you.');
    }

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
    birthDate: user.birth_date ? toDateString(user.birth_date) : null,
    age: ageFromBirthDate(user.birth_date),
    gender: user.gender,
    address: user.address,
    role: user.role,
    capabilities: capabilitiesFor(user.role),
    hasFace: Boolean(user.face_descriptor),
    avatarUrl: user.avatar_url,
    telegramLinked: Boolean(user.telegram_chat_id),
    telegramUsername: user.telegram_username || null,
    guardianId: user.guardian_id || null,
    isDependent: Boolean(user.guardian_id),
    createdAt: user.created_at,
  };
}

export default router;
