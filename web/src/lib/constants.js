export const SURAU = {
  name: 'Surau Al-Abqori',
  address: 'Jalan Cerdik, Taman Universiti, 43000 Kajang, Selangor, Malaysia',
  latitude: 2.93276,
  longitude: 101.8047,
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=2.93276,101.8047',
};

// Community channel for program updates and announcements (not technical
// support). Shown in the top bar, on Home and on the kiosk/mobile display.
export const COMMUNITY = {
  label: 'WhatsApp group',
  name: 'Pemuda Surau Al-Abqori',
  description: 'Program updates, announcements and photos from the surau youth programme.',
  whatsappUrl: 'https://chat.whatsapp.com/IuGhkTOQ1q9DjxJV4cnFKr',
};

export const PRAYERS = [
  { key: 'subuh', label: 'Subuh' },
  { key: 'zuhur', label: 'Zuhur' },
  { key: 'asar', label: 'Asar' },
  { key: 'maghrib', label: 'Maghrib' },
  { key: 'isyak', label: 'Isyak' },
];

export const PRAYER_LABELS = Object.fromEntries(PRAYERS.map((p) => [p.key, p.label]));

// ---------------------------------------------------------------------------
// Scoring rules. Mirrors server/src/utils/scoring.js — keep the two in sync.
// The leaderboard ranks by POINTS, so a harder activity is worth more.
// ---------------------------------------------------------------------------

/** Points per prayer check-in. Subuh is hardest, so it is worth the most. */
export const PRAYER_POINTS = {
  subuh: 15,
  zuhur: 5,
  asar: 5,
  maghrib: 5,
  isyak: 10,
};

/** Points for each Quran activity (recitation or memorization). */
export const QURAN_POINTS = 5;

/** Allowed range for a single merit award. */
export const MERIT_MIN_POINTS = 1;
export const MERIT_MAX_POINTS = 10;

// Roles and their capabilities. Mirrors server/src/utils/roles.js.
export const ROLES = [
  { key: 'admin', label: 'Admin', description: 'Full access' },
  { key: 'parent', label: 'Parent', description: 'Manage children + check-in' },
  { key: 'teacher', label: 'Teacher', description: 'Quran + merits' },
  { key: 'ajk', label: 'AJK / Committee', description: 'Merits only' },
  { key: 'youth', label: 'Member', description: 'Basic member' },
];

export const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export const ROLE_CAPABILITIES = {
  admin: [
    'manageUsers',
    'managePrograms',
    'manageMerits',
    'manageQuran',
    'logQuranOffsite',
    'manageAttendance',
    'manageDependents',
    'viewMembers',
    'identifyMembers',
    'checkIn',
  ],
  parent: ['manageDependents', 'checkIn'],
  teacher: [
    'manageQuran',
    'logQuranOffsite',
    'manageMerits',
    'viewMembers',
    'identifyMembers',
    'checkIn',
  ],
  ajk: ['manageMerits', 'viewMembers', 'identifyMembers', 'checkIn'],
  // Every member may manage their OWN dependents (children) — see roles.js.
  youth: ['manageDependents', 'checkIn'],
};

/** True when the user (or role) holds a capability. */
export function can(user, capability) {
  const caps = user?.capabilities || ROLE_CAPABILITIES[user?.role] || [];
  return caps.includes(capability);
}

// Leaderboard categories. `key` maps to the score column returned by the API.
// `unit` is the label shown under the score; `points` marks categories whose
// score is already in points (so the UI can say "pts" rather than a raw count).
export const CATEGORIES = [
  { key: 'overall', label: 'Overall', icon: '⭐', unit: 'pts', points: true },
  { key: 'attendance', label: 'Attendance', icon: '🕌', unit: 'pts', points: true },
  { key: 'recitation', label: 'Recitation', icon: '📖', unit: 'sessions' },
  { key: 'memorization', label: 'Memorization', icon: '🧠', unit: 'sessions' },
  { key: 'merits', label: 'Merits', icon: '🏅', unit: 'pts', points: true },
];

export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

// Ranking periods.
export const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

// Badge tiers, awarded per category based on the score in the selected period.
// Thresholds are intentionally simple and easy to tune.
export const BADGE_TIERS = [
  { min: 100, label: 'Platinum', icon: '💎' },
  { min: 50, label: 'Gold', icon: '🥇' },
  { min: 25, label: 'Silver', icon: '🥈' },
  { min: 10, label: 'Bronze', icon: '🥉' },
];

export function badgeFor(score) {
  return BADGE_TIERS.find((t) => score >= t.min) || null;
}

export function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
