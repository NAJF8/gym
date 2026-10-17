-- Non-destructive Staging migration. Do not run against Production without a separate approval.
CREATE TABLE IF NOT EXISTS member_sessions (
  session_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  token_hash BLOB NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS member_sessions_member_idx ON member_sessions(member_id);
CREATE INDEX IF NOT EXISTS member_sessions_expiry_idx ON member_sessions(expires_at);
