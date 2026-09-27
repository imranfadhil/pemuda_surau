/**
 * Age helpers (mirrors server/src/utils/age.js).
 * Age is derived from a stored birth date so it never goes stale.
 */

/** Whole years between a birth date (YYYY-MM-DD) and now. Null if unknown. */
export function ageFromBirthDate(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;

  let age = now.getFullYear() - b.getFullYear();
  const monthDiff = now.getMonth() - b.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < b.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/** "12 years" / "Age not set" label for a birth date. */
export function ageLabel(birthDate) {
  const age = ageFromBirthDate(birthDate);
  return age === null ? 'Age not set' : `${age} years`;
}
