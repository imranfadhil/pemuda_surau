/**
 * Age helpers.
 *
 * Age is derived from a stored birth date rather than being entered by hand,
 * so it never goes stale.
 */

/** Whole years between a birth date (YYYY-MM-DD) and now. Null if unknown. */
export function ageFromBirthDate(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;

  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < b.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/**
 * Normalise a DATE column to a plain YYYY-MM-DD string.
 * node-postgres returns DATE as a Date at local midnight, so we read the
 * local components to avoid a timezone shift.
 */
export function toDateString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
