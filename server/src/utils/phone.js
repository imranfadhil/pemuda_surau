/**
 * Phone number helpers.
 *
 * Kept in their own module (no config dependency) so both `config.js` and
 * `utils/otp.js` can use them without a circular import.
 *
 * Telegram shares a contact's number differently per client: the mobile app
 * omits the leading '+' (60123456789) while Desktop includes it
 * (+60123456789). Users may also type a local 0-prefixed form. These helpers
 * let one lookup match regardless of the source.
 *
 * Malaysian numbers (+60) are assumed for local (0-prefixed) forms. Numbers
 * that already carry a different country code are left alone.
 */

/** Strip spaces and dashes only (keeps a leading '+' if present). */
export function normalizePhone(phone) {
  return String(phone || '').replace(/[\s-]/g, '');
}

/** Every equivalent spelling of a phone number, for format-agnostic lookups. */
export function phoneVariants(phone) {
  const raw = normalizePhone(phone);
  if (!raw) return [];

  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];

  const variants = new Set([raw]);

  if (digits.startsWith('60')) {
    // 60XXXXXXXXX -> +60XXXXXXXXX / 0XXXXXXXXX
    variants.add(`+${digits}`);
    variants.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith('0')) {
    // 0XXXXXXXXX -> +60XXXXXXXXX / 60XXXXXXXXX
    variants.add(`+60${digits.slice(1)}`);
    variants.add(`60${digits.slice(1)}`);
  }

  variants.add(digits);
  return [...variants];
}

/**
 * Canonical storage form: E.164-ish with a leading '+'.
 *
 * Only Malaysian forms are rewritten (0XXXXXXXXX / 60XXXXXXXXX -> +60XXXXXXXXX);
 * anything already international is returned unchanged, so a non-Malaysian
 * number is never mangled.
 */
export function canonicalPhone(phone) {
  const raw = normalizePhone(phone);
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('60')) return `+${raw}`;
  if (raw.startsWith('0')) return `+60${raw.slice(1)}`;
  return raw;
}
