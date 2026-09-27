-- Pemuda Surau schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  age           INT,
  gender        TEXT CHECK (gender IN ('male', 'female')),
  address       TEXT,
  role          TEXT NOT NULL DEFAULT 'youth' CHECK (role IN ('youth', 'admin')),
  face_descriptor JSONB,
  face_enrolled_at TIMESTAMPTZ,
  avatar_url    TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_linked_at TIMESTAMPTZ,
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
-- Idempotent migrations for databases created before these columns existed.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat
  ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
