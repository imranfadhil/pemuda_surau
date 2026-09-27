-- Surau Al-Abqori schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Phone is the login identity. It is NULL for dependents (children) who are
  -- managed by a guardian and have no phone of their own.
  phone         TEXT UNIQUE,
  full_name     TEXT NOT NULL,
  age           INT,
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
CREATE TABLE IF NOT EXISTS merits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points     INT NOT NULL DEFAULT 1 CHECK (points <> 0),
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
  logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quran_user ON quran_logs (user_id, logged_date DESC);
CREATE INDEX IF NOT EXISTS idx_quran_date ON quran_logs (logged_date DESC);

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

ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_created_by_fkey;
ALTER TABLE programs ADD CONSTRAINT programs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
