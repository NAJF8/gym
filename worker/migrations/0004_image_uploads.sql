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

CREATE INDEX IF NOT EXISTS image_upload_audit_created_idx ON image_upload_audit(created_at);
