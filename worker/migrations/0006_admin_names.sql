-- Staging-only migration: preserve invitation names as server-owned data.
ALTER TABLE admin_invitations ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
