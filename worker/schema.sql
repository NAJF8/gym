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

CREATE TABLE member_sessions (
  session_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  token_hash BLOB NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX member_sessions_member_idx ON member_sessions(member_id);
CREATE INDEX member_sessions_expiry_idx ON member_sessions(expires_at);

CREATE TABLE member_phone_reservations (
  phone_e164 TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  operation_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING_SYNC', 'READY', 'RELEASED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE member_outbox (
  outbox_id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'SYNCED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE member_idempotency (
  operation_key TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  response_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
