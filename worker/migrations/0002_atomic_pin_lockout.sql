-- Atomic conditional lockout counter. Safe to apply to Staging first.
-- The Worker performs the increment and five-attempt lock in one SQL UPDATE.
CREATE INDEX IF NOT EXISTS member_credentials_phone_idx ON member_credentials(phone_e164);
