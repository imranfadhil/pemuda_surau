-- Surau Al-Abqori schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Phone is the login identity. It is NULL for dependents (children) who are
  -- managed by a guardian and have no phone of their own.
  phone         TEXT UNIQUE,
  full_name     TEXT NOT NULL,
  -- Age is derived from birth_date (see utils/age.js), never stored directly.
  birth_date    DATE,
  gender        TEXT CHECK (gender IN ('male', 'female')),
  address       TEXT,
  role          TEXT NOT NULL DEFAULT 'youth' CHECK (role IN ('youth', 'admin', 'parent', 'teacher', 'ajk')),
  -- When set, this account is a dependent (e.g. a child) managed by the
  -- guardian user. Dependents cannot log in on their own.
  guardian_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  face_descriptor JSONB,
  face_enrolled_at TIMESTAMPTZ,
  avatar_url    TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_linked_at TIMESTAMPTZ,
  -- Marks simulated/seeded accounts so they can be identified and removed
  -- before go-live (see scripts/simulate.mjs).
  is_dummy      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One Telegram account can only be linked to one user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat
  ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Short-lived tokens used to link a Telegram chat to a user account.
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_user ON telegram_link_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  attempts    INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prayer        TEXT NOT NULL CHECK (prayer IN ('subuh', 'zuhur', 'asar', 'maghrib', 'isyak')),
  attendance_date DATE NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method        TEXT NOT NULL DEFAULT 'face' CHECK (method IN ('face', 'manual')),
  face_score    REAL,
  verified_by   UUID REFERENCES users(id),
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  UNIQUE (user_id, prayer, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance (user_id, attendance_date DESC);

CREATE TABLE IF NOT EXISTS programs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  category    TEXT DEFAULT 'program',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_programs_starts ON programs (starts_at);

CREATE TABLE IF NOT EXISTS program_attendance (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (program_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Program check-in: a member registers interest ("join"), then proves they
-- actually turned up with a face scan inside the geofence. The two are
-- deliberately separate columns so an admin can see who signed up but never
-- arrived, and so a check-in is never implied by a join.
-- ---------------------------------------------------------------------------
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS face_score REAL;
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
-- Who recorded the check-in when it was not the member themselves (staff
-- scanning a youth's face, or an admin marking attendance manually).
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'face'
  CHECK (method IN ('face', 'manual'));

CREATE INDEX IF NOT EXISTS idx_program_attendance_program
  ON program_attendance (program_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_program_attendance_user
  ON program_attendance (user_id, joined_at DESC);

-- A program may be held somewhere other than the surau (a camp, a field trip),
-- so it can carry its own geofence. When these are NULL the surau's own
-- coordinates and radius are used.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS radius_meters INT;
-- How long after `ends_at` a check-in is still accepted. Programs often run
-- over, and a member arriving at the tail end should not be turned away.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS check_in_grace_minutes INT NOT NULL DEFAULT 30;
-- When false, members may only check in during the program window. Admins can
-- still record attendance manually.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS check_in_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- Program posters, links and recurrence.
--
-- A poster is stored inline as a data URL (resized in the browser before it is
-- sent) so no external file host is required. `links` is a JSON array of
-- { label, url } objects (e.g. a WhatsApp group and a registration form).
--
-- A program may repeat weekly on a set of weekdays. Each occurrence's start and
-- end is either a fixed wall-clock time or anchored to a prayer (e.g. Maghrib
-- to Isyak), resolved per date in the surau timezone.
-- ---------------------------------------------------------------------------
ALTER TABLE programs ADD COLUMN IF NOT EXISTS poster_url TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_days TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_until DATE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_start_mode TEXT NOT NULL DEFAULT 'fixed'
  CHECK (recurrence_start_mode IN ('fixed', 'prayer'));
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_start_time TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_start_prayer TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_start_offset_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_end_mode TEXT NOT NULL DEFAULT 'fixed'
  CHECK (recurrence_end_mode IN ('fixed', 'prayer'));
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_end_time TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_end_prayer TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS recurrence_end_offset_minutes INT NOT NULL DEFAULT 0;

-- A recurring program has many sessions, so attendance is keyed by the session
-- date (YYYY-MM-DD in the surau timezone). One-off programs use the sentinel
-- date 0001-01-01 so the uniqueness rule stays a plain column constraint.
ALTER TABLE program_attendance ADD COLUMN IF NOT EXISTS session_date DATE NOT NULL DEFAULT '0001-01-01';
ALTER TABLE program_attendance DROP CONSTRAINT IF EXISTS program_attendance_program_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_attendance_session
  ON program_attendance (program_id, user_id, session_date);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Gamification: merits (admin-awarded) and Quran activity (recitation /
-- memorization). These feed the dashboard leaderboard categories.
-- ---------------------------------------------------------------------------

-- Merits: points awarded by an admin for good behaviour / contributions.
-- A single award is worth 1-10 points (see server/src/utils/scoring.js).
CREATE TABLE IF NOT EXISTS merits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points     INT NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 10),
  reason     TEXT NOT NULL,
  awarded_by UUID REFERENCES users(id),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merits_user ON merits (user_id, awarded_at DESC);

-- Quran activity: recitation and memorization logs (self-logged or by a guardian).
CREATE TABLE IF NOT EXISTS quran_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('recitation', 'memorization')),
  surah       TEXT,
  juz         INT,
  pages       INT,
  note        TEXT,
  -- Who submitted the record. NULL means the member logged it themselves.
  logged_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quran_user ON quran_logs (user_id, logged_date DESC);
CREATE INDEX IF NOT EXISTS idx_quran_date ON quran_logs (logged_date DESC);

-- A Quran log can be corrected after the fact (a teacher fixing a typo in the
-- surah, juz or pages). Because the record feeds a child's score, every edit is
-- stamped with who made it and when, so a change is never silent.
ALTER TABLE quran_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE quran_logs ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Idempotent migrations for databases created before these columns existed.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;

-- Dependents (children) managed by a guardian. Phone becomes optional so a
-- dependent can exist without a phone number of their own.
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_no_self_guardian;
ALTER TABLE users ADD CONSTRAINT users_no_self_guardian CHECK (guardian_id IS NULL OR guardian_id <> id);

CREATE INDEX IF NOT EXISTS idx_users_guardian ON users (guardian_id) WHERE guardian_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat
  ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Roles: admin (full), parent (children + check-in), teacher (Quran + merits),
-- ajk (merits), youth (basic member). Widen the CHECK for existing databases.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('youth', 'admin', 'parent', 'teacher', 'ajk'));

-- Simulated accounts are tagged so they can be cleared before go-live.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_dummy ON users (is_dummy) WHERE is_dummy = TRUE;

-- Deleting a user must not be blocked by rows that merely reference them.
-- Attendance/merits/quran rows cascade with the user; the "who did it"
-- references are nulled so the history of others is preserved.
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_verified_by_fkey;
ALTER TABLE attendance ADD CONSTRAINT attendance_verified_by_fkey
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE merits DROP CONSTRAINT IF EXISTS merits_awarded_by_fkey;
ALTER TABLE merits ADD CONSTRAINT merits_awarded_by_fkey
  FOREIGN KEY (awarded_by) REFERENCES users(id) ON DELETE SET NULL;

-- A single merit award is worth 1-10 points (see utils/scoring.js). The original
-- constraint only rejected 0, so tighten it for existing databases. Any legacy
-- row outside the range is clamped first, otherwise ADD CONSTRAINT would fail.
UPDATE merits SET points = LEAST(GREATEST(points, 1), 10) WHERE points < 1 OR points > 10;
ALTER TABLE merits DROP CONSTRAINT IF EXISTS merits_points_check;
ALTER TABLE merits ADD CONSTRAINT merits_points_check CHECK (points BETWEEN 1 AND 10);

ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_created_by_fkey;
ALTER TABLE programs ADD CONSTRAINT programs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- Record who submitted each Quran log (NULL = the member logged it themselves).
ALTER TABLE quran_logs ADD COLUMN IF NOT EXISTS logged_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quran_logged_by ON quran_logs (logged_by) WHERE logged_by IS NOT NULL;

-- Age is now derived from birth_date instead of being stored directly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users DROP COLUMN IF EXISTS age;

-- A dependent may have a SECOND guardian, so both parents can check the child
-- in (they often arrive separately). The primary guardian is `guardian_id`;
-- this is the optional co-guardian. Both are treated as full guardians.
ALTER TABLE users ADD COLUMN IF NOT EXISTS co_guardian_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_co_guardian ON users (co_guardian_id) WHERE co_guardian_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Notifications: prayer reminders, program reminders, in-app feed, Web Push.
--
-- One `notifications` row per user per event (deduped by `dedupe_key`) serves
-- BOTH as the in-app notification feed AND as the delivery log: the scheduler
-- inserts the row first (ON CONFLICT DO NOTHING), then pushes it out over
-- Telegram and Web Push, tracking progress in sent_telegram / sent_push so a
-- failed send is retried on a later tick and a restart never double-sends.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('prayer', 'program')),
  title          TEXT NOT NULL,
  body           TEXT,
  link           TEXT,
  -- Stable per user+event, e.g. 'prayer:2026-10-11:zuhur' or
  -- 'program:<id>:2026-10-12'. The UNIQUE constraint IS the idempotency.
  dedupe_key     TEXT NOT NULL,
  -- Delivery handled = true (sent, or nothing to send to). Ageing out of the
  -- pending window also ends delivery; the row remains as the in-app feed.
  sent_telegram  BOOLEAN NOT NULL DEFAULT FALSE,
  sent_push      BOOLEAN NOT NULL DEFAULT FALSE,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications (user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);

-- Per-member delivery preferences. Absence of a row = all defaults (on).
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prayer_reminders  BOOLEAN NOT NULL DEFAULT TRUE,
  program_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Web Push subscriptions, one row per browser/device.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);
