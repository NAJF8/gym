-- The encrypted PIN column is part of the updated initial schema so fresh
-- databases and existing Staging databases converge on the same shape.
-- This migration records the audit table/index without replaying an ALTER
-- against databases that already received the column through 0000.
CREATE TABLE IF NOT EXISTS member_pin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('PIN_ISSUED', 'PIN_RESET', 'PIN_REVEALED', 'PIN_REVOKED')),
  actor_uid TEXT NOT NULL,
  member_id TEXT NOT NULL,
  credential_version INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS member_pin_audit_member_idx ON member_pin_audit_logs(member_id, created_at DESC);
