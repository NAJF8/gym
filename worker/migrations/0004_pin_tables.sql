-- Additive compatibility migration for local and empty Staging D1 databases.
-- Existing populated tables are preserved by IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS member_credentials (
  credential_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  firebase_uid TEXT NOT NULL UNIQUE,
  membership_id TEXT NOT NULL UNIQUE,
  phone_e164 TEXT NOT NULL UNIQUE,
  pin_hash BLOB NOT NULL,
  pin_salt BLOB NOT NULL,
  hash_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  hash_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  credential_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_pin_changed_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS pin_attempt_buckets (
  bucket_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at TEXT NOT NULL
);
