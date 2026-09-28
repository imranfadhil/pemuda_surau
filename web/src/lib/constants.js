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
    'manageAttendance',
    'manageDependents',
    'viewMembers',
    'identifyMembers',
    'checkIn',
  ],
  parent: ['manageDependents', 'checkIn'],
  teacher: ['manageQuran', 'manageMerits', 'viewMembers', 'identifyMembers', 'checkIn'],
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
export const CATEGORIES = [
  { key: 'overall', label: 'Overall', icon: '⭐', unit: 'pts' },
  { key: 'attendance', label: 'Attendance', icon: '🕌', unit: 'prayers' },
  { key: 'recitation', label: 'Recitation', icon: '📖', unit: 'sessions' },
  { key: 'memorization', label: 'Memorization', icon: '🧠', unit: 'sessions' },
  { key: 'merits', label: 'Merits', icon: '🏅', unit: 'pts' },
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
