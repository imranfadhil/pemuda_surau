import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export function generateOtp() {
  // 6-digit numeric code
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

export async function verifyOtp(code, hash) {
  return bcrypt.compare(code, hash);
}

export function otpExpiryDate() {
  return new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);
}

export function normalizePhone(phone) {
  return String(phone || '').replace(/[\s-]/g, '');
}
