import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { roleHasCapability } from '../utils/roles.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, phone: user.phone },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

/**
 * Authenticate the request.
 *
 * The JWT carries the role it was ISSUED with, but a member's role can change
 * (an admin promotes a youth to teacher). Tokens last 30 days, so a stale token
 * would keep the OLD role and silently deny the new permissions — the member
 * sees "You do not have permission to do this" until they log out and back in.
 *
 * So we re-read the role from the database on every request and use THAT for
 * capability checks. The token proves identity; the database decides what that
 * identity may do. This also means a deactivated account loses access
 * immediately instead of at token expiry.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const { rows } = await query('SELECT role, is_active FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account has been deactivated.' });
    }
    // The database role wins over the role baked into the token.
    req.user = { ...payload, role: user.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

/**
 * Require a specific capability (see utils/roles.js). Admins implicitly hold
 * every capability, so `requireCapability('manageMerits')` also admits admins.
 */
export function requireCapability(capability) {
  return (req, res, next) => {
    if (!roleHasCapability(req.user?.role, capability)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    return next();
  };
}
