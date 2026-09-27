import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { roleHasCapability } from '../utils/roles.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, phone: user.phone },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
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
