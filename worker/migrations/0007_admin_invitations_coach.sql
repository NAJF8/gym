-- Production-preparation migration. Apply only after the D1 preflight confirms
-- the pending migration sequence includes 0003 and 0006, or the equivalent
-- existing schema with display_name.
--
-- This rebuild is required because SQLite cannot alter a CHECK constraint in
-- place. It preserves every invitation row and recreates the known indexes.

CREATE TABLE admin_invitations_v2 (
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

INSERT INTO admin_invitations_v2 (
  invitation_id, email, display_name, role, status, expires_at, created_at,
  created_by_uid, claimed_uid, claimed_at, applied_uid, applied_at, updated_at
)
SELECT
  invitation_id, email, display_name, role, status, expires_at, created_at,
  created_by_uid, claimed_uid, claimed_at, applied_uid, applied_at, updated_at
FROM admin_invitations;

DROP TABLE admin_invitations;
ALTER TABLE admin_invitations_v2 RENAME TO admin_invitations;

CREATE INDEX IF NOT EXISTS admin_invitations_email_idx
  ON admin_invitations(email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_invitations_status_idx
  ON admin_invitations(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS admin_invitations_live_email_idx
  ON admin_invitations(email)
  WHERE status IN ('PENDING', 'CLAIMED');

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  action TEXT,
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
