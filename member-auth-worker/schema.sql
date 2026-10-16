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
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credentials_phone ON member_credentials(phone_e164);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_credentials_membership ON member_credentials(membership_id);
CREATE TABLE IF NOT EXISTS pin_attempt_buckets (
  bucket_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pin_attempt_buckets_lock ON pin_attempt_buckets(locked_until);
