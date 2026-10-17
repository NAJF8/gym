-- Preserve old local/staging reservation rows while allowing a member to hold
-- the old and new phone during an in-flight phone change.
ALTER TABLE member_phone_reservations RENAME TO member_phone_reservations_old;
DROP INDEX IF EXISTS member_phone_active_unique;
DROP INDEX IF EXISTS member_phone_member_idx;

CREATE TABLE member_phone_reservations (
  reservation_id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  member_id TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('PENDING_SYNC', 'READY', 'RELEASED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO member_phone_reservations
  (reservation_id, phone_e164, member_id, operation_key, state, created_at, updated_at)
SELECT 'legacy-' || operation_key, phone_e164, member_id, operation_key, state, created_at, updated_at
FROM member_phone_reservations_old;

CREATE UNIQUE INDEX member_phone_active_unique
  ON member_phone_reservations(phone_e164)
  WHERE state IN ('PENDING_SYNC', 'READY');
CREATE INDEX member_phone_member_idx ON member_phone_reservations(member_id);
DROP TABLE member_phone_reservations_old;
