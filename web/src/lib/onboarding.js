/**
 * First-time onboarding tours, tailored to each role.
 *
 * A tour is an ordered list of steps. Each step either:
 *   - points at an element on the current page via `target` (a CSS selector,
 *     usually a `[data-tour="..."]` attribute), or
 *   - is a centred "welcome"/"done" card when `target` is omitted.
 *
 * `route` is the path the step lives on. The tour engine navigates there
 * automatically before showing the step, so a tour can span several pages.
 *
 * Steps are composed from small reusable blocks below so the role tours stay
 * short and easy to tune. Keep copy friendly and concrete — this is the first
 * thing a new member sees.
 */

// ---------------------------------------------------------------------------
// Reusable step blocks
// ---------------------------------------------------------------------------

const WELCOME = (roleLabel) => ({
  title: `Welcome to Surau Al-Abqori 👋`,
  body: `Assalamualaikum! This quick tour shows you how to use the app as a ${roleLabel}. It takes about a minute — you can skip it any time and replay it later from your Profile.`,
});

const DONE = {
  title: `You're all set! 🎉`,
  body: `That's everything. Earn points for prayers, Quran and good deeds — the leaderboard updates live. If you ever need this tour again, tap "Take a tour" on your Profile page.`,
};

const DASHBOARD_STEP = {
  route: '/',
  target: '[data-tour="dashboard-leaderboard"]',
  title: 'The leaderboard 🏆',
  body: 'Everyone earns points for prayers, Quran and merits. Switch between Overall, Attendance, Recitation, Memorization and Merits, and pick a period (month / year / all time).',
};

const HOME_STEP = {
  route: '/home',
  target: '[data-tour="home-stats"]',
  title: 'Your progress at a glance 🏠',
  body: 'Your Home page shows today\'s prayers, your check-ins, Quran activity and merit points — all in one place.',
};

const CHECKIN_STEP = {
  route: '/check-in',
  target: '[data-tour="checkin-window"]',
  title: 'Prayer check-in 🕌',
  body: 'The app detects the current prayer window automatically. When a prayer is open, open the camera and verify your face to check in. Subuh is worth the most points!',
};

const CHECKIN_FACE_STEP = {
  route: '/check-in',
  target: '[data-tour="checkin-camera"]',
  title: 'Face check-in 📷',
  body: 'Stand in good light, look straight at the camera and hold still. Your face is your proof of attendance — no need to pick a prayer.',
};

const QURAN_STEP = {
  route: '/quran',
  target: '[data-tour="quran-form"]',
  title: 'Log Quran activity 📖',
  body: 'Record a recitation or memorization — add the surah, juz, pages and a note. Each log earns points and counts toward your badges. You must be at the surau, and it\'s one log per hour.',
};

const QURAN_STAFF_STEP = {
  route: '/quran',
  target: '[data-tour="quran-form"]',
  title: 'Record Quran for members 📖',
  body: 'As staff you can record recitation or memorization for any member. Pick the member, then log their activity — you can do this from anywhere, and scanning a face is optional.',
};

const MERITS_STEP = {
  route: '/merits',
  target: '[data-tour="merits-form"]',
  title: 'Award merits 🏅',
  body: 'Give 1–10 points to a member for good behaviour or contributions — helping clean the surau, joining a program, and so on. Scan their face at the surau to confirm, then award.',
};

const MERITS_MEMBER_STEP = {
  route: '/merits',
  target: '[data-tour="merits-list"]',
  title: 'Your merit points 🏅',
  body: 'Every merit you receive shows up here with the reason and who awarded it. Merits add to your overall leaderboard score.',
};

const FAMILY_STEP = {
  route: '/family',
  target: '[data-tour="family-add"]',
  title: 'Add your children 👨‍👩‍👧',
  body: 'Add your children as dependents so you can check them in for prayers — they don\'t need their own phone. Enroll their face once, then check them in from the Check-in page.',
};

const PROFILE_STEP = {
  route: '/profile',
  target: '[data-tour="profile-card"]',
  title: 'Your profile 👤',
  body: 'Keep your details up to date, enroll your face, link Telegram for login codes, and see your badges and attendance history.',
};

const NAV_STEP = {
  target: '[data-tour="bottom-nav"]',
  title: 'Getting around 🧭',
  body: 'Use the bottom bar to move between Dashboard, Home, Check-in, Programs, Quran, Merits and Profile. The active tab is highlighted.',
};

// ---------------------------------------------------------------------------
// Role tours
// ---------------------------------------------------------------------------

const TOURS = {
  // Basic member: check in, log Quran, see merits.
  youth: [
    WELCOME('member'),
    DASHBOARD_STEP,
    HOME_STEP,
    CHECKIN_STEP,
    CHECKIN_FACE_STEP,
    QURAN_STEP,
    MERITS_MEMBER_STEP,
    PROFILE_STEP,
    NAV_STEP,
    DONE,
  ],

  // Parent: everything a member does, plus managing children.
  parent: [
    WELCOME('parent'),
    DASHBOARD_STEP,
    HOME_STEP,
    CHECKIN_STEP,
    CHECKIN_FACE_STEP,
    FAMILY_STEP,
    QURAN_STEP,
    MERITS_MEMBER_STEP,
    PROFILE_STEP,
    NAV_STEP,
    DONE,
  ],

  // Teacher: records Quran + merits for members.
  teacher: [
    WELCOME('teacher'),
    DASHBOARD_STEP,
    CHECKIN_STEP,
    QURAN_STAFF_STEP,
    MERITS_STEP,
    HOME_STEP,
    PROFILE_STEP,
    NAV_STEP,
    DONE,
  ],

  // AJK / committee: awards merits.
  ajk: [
    WELCOME('committee member'),
    DASHBOARD_STEP,
    CHECKIN_STEP,
    MERITS_STEP,
    HOME_STEP,
    PROFILE_STEP,
    NAV_STEP,
    DONE,
  ],

  // Admin: full access — a short orientation.
  admin: [
    WELCOME('admin'),
    DASHBOARD_STEP,
    CHECKIN_STEP,
    QURAN_STAFF_STEP,
    MERITS_STEP,
    PROFILE_STEP,
    NAV_STEP,
    DONE,
  ],
};

/** The ordered steps for a role (falls back to the member tour). */
export function tourForRole(role) {
  return TOURS[role] || TOURS.youth;
}

/** localStorage key marking that a user has completed/skipped the tour. */
export function onboardedKey(userId) {
  return `pemuda_surau_onboarded:${userId}`;
}
