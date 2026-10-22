-- Reversible AES-256-GCM encrypted PIN envelope (keyed by PIN_PEPPER secret)
-- and audit logging for authorized admin PIN reveals.
ALTER TABLE member_credentials ADD COLUMN pin_cipher TEXT;

CREATE TABLE IF NOT EXISTS member_pin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('PIN_ISSUED', 'PIN_RESET', 'PIN_REVEALED', 'PIN_REVOKED')),
  actor_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  credential_version INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS member_pin_audit_member_idx ON member_pin_audit_logs(member_id, created_at DESC);
