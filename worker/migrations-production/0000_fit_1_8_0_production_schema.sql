-- Production-only additive migration for the verified legacy D1 schema.
--
-- Apply only after the production D1 preflight confirms the legacy PIN/session
-- schema and that these invitation/audit tables do not already exist.
-- Existing PIN/session rows are preserved.

ALTER TABLE member_credentials ADD COLUMN pin_cipher TEXT;

CREATE INDEX IF NOT EXISTS member_credentials_phone_idx
  ON member_credentials(phone_e164);

CREATE TABLE IF NOT EXISTS member_pin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('PIN_ISSUED', 'PIN_RESET', 'PIN_REVEALED', 'PIN_REVOKED')),
  actor_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  credential_version INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS member_pin_audit_member_idx
  ON member_pin_audit_logs(member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS image_upload_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS image_upload_audit (
  audit_id TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  slot TEXT NOT NULL,
  path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  byte_count INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS image_upload_audit_created_idx
  ON image_upload_audit(created_at);

CREATE TABLE IF NOT EXISTS admin_invitations (
  invitation_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('COACH', 'MANAGER')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'APPLIED', 'REVOKED', 'EXPIRED', 'REJECTED')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by_uid TEXT NOT NULL,
  claimed_uid TEXT,
  claimed_at INTEGER,
  applied_uid TEXT,
  applied_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_invitations_email_idx
  ON admin_invitations(email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_invitations_status_idx
  ON admin_invitations(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS admin_invitations_live_email_idx
  ON admin_invitations(email)
  WHERE status IN ('PENDING', 'CLAIMED');

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  invitation_id TEXT,
  actor_uid TEXT,
  target_uid TEXT,
  email TEXT,
  role TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
  ON admin_audit_logs(created_at);
