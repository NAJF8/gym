-- Staging-only additive migration. It creates the canonical phone reservation,
-- idempotency, and RTDB outbox state. It does not touch existing members.
CREATE TABLE IF NOT EXISTS member_phone_reservations (
  phone_e164 TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE,
  operation_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING_SYNC', 'READY', 'RELEASED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_outbox (
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

CREATE TABLE IF NOT EXISTS member_idempotency (
  operation_key TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  response_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
