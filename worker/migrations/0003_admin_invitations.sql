CREATE TABLE IF NOT EXISTS admin_invitations (
  invitation_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('MANAGER', 'SUPER_ADMIN')),
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

CREATE INDEX IF NOT EXISTS admin_invitations_email_idx ON admin_invitations(email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_invitations_status_idx ON admin_invitations(status, expires_at);

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

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at);
