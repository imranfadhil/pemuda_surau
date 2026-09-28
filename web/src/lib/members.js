/**
 * Member name disambiguation.
 *
 * Names are deliberately NOT unique — two members can genuinely share a name,
 * and constraining `full_name` would block real people. Instead we tell them
 * apart at the point of display, using the last 4 digits of the phone number.
 *
 * The extra detail is only shown when it is actually needed (i.e. when two
 * members in the same list share a name), so the common case stays clean.
 */

/** Last 4 digits of a phone number, or null. */
export function phoneLast4(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Normalised key for comparing names (case/whitespace insensitive). */
export function nameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Given a list of members, return a Set of the name keys that appear more than
 * once. Pass the result to {@link disambiguatorFor}.
 */
export function duplicateNameKeys(members) {
  const counts = new Map();
  for (const m of members) {
    const key = nameKey(m.fullName ?? m.full_name);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * The short label to append to a member's name, or '' when no disambiguation is
 * needed. `duplicates` is the Set from {@link duplicateNameKeys}.
 *
 * Falls back to "child of X" for dependents (who have no phone), and to nothing
 * at all if there is no usable detail — better to show a bare name than a
 * meaningless suffix.
 */
export function disambiguatorFor(member, duplicates) {
  const name = member.fullName ?? member.full_name;
  if (!duplicates || !duplicates.has(nameKey(name))) return '';

  const last4 = member.phoneLast4 ?? phoneLast4(member.phone);
  if (last4) return last4;

  if (member.guardianName ?? member.guardian_name) {
    return `child of ${member.guardianName ?? member.guardian_name}`;
  }
  return '';
}
