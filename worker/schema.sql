-- Reference schema for the existing AL ASAS FIT PIN D1 database.
-- This documents the verified shape; it is not an automatic migration.
CREATE TABLE member_credentials (
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

CREATE TABLE pin_attempt_buckets (
  bucket_key TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at TEXT NOT NULL
);
