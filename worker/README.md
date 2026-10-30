# AL ASAS FIT PIN Worker

This Worker is the only PIN authority. It issues a cryptographically random
four-digit code once per member, stores only a salted PBKDF2-SHA-256 derivation
of a Worker-held HMAC secret in D1, resets failed attempts on success, and locks a phone after five failed
attempts for 15 minutes. Repeated issuance requests are idempotent and do not
change an existing PIN. A new raw PIN is generated only for first issuance or
an explicit reset request; it is returned only from that authenticated request
and is never written to Firebase, D1, localStorage, or sessionStorage.

The existing credential is intentionally not revealable: D1 stores a hash only
and no approved server-side encryption-key service is configured for reversible
PIN storage. The admin UI therefore reports an existing PIN without exposing
it and requires an explicit reset to issue a new one.

Required Worker secrets/variables:

- `PIN_PEPPER` — a high-entropy, Staging-only Worker secret used by the
  versioned `PBKDF2-SHA256-HMAC` PIN hash. Existing legacy hashes can still
  authenticate and are upgraded after a successful login when this secret is
  configured. New issuance and reset fail closed if neither `PIN_PEPPER` nor
  the compatibility `PIN_ENCRYPTION_KEY` is present.
- FIREBASE_DATABASE_URL
- FIREBASE_WEB_API_KEY
- FIREBASE_SERVICE_ACCOUNT_EMAIL
- FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
- CORS_ORIGINS (comma-separated exact origins; `CORS_ORIGIN` remains the
  single-origin fallback). Never use `*`.
- IMAGE_BASE_URL (the public Hosting origin used after a print-image deploy;
  `STAGING_IMAGE_BASE_URL` is retained only as a legacy compatibility fallback).
- D1 binding PIN_DB using the existing `member_credentials` and
  `pin_attempt_buckets` tables documented in schema.sql. Do not run schema.sql
  against an existing database.

Image upload additionally requires a GitHub App installation with the minimum
`Contents: read/write` and `Actions: read` permissions, stored only as Worker
secrets/variables: `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and
`GITHUB_APP_PRIVATE_KEY`. The checked-in Worker fixes the repository, branch,
and `public/uploads/print/` path; clients cannot choose them. Protected
branches are rejected rather than bypassed. Apply migration `0004_image_uploads`
before enabling the endpoint. The Firebase settings URL is updated by the
client only after the corresponding Staging Actions run succeeds.

The checked-in Wrangler configuration targets the separately named Staging
Worker and Staging D1 only. No Worker deployment or production secret setup is
performed by this change. Before applying an invitation migration, the Staging
workflow runs a read-only D1 preflight that compares the actual schema,
constraints, indexes, invitation roles/statuses, duplicate live emails, count,
and digest; an equivalent schema is skipped even when its recorded migration
name differs. The `d1_migrations` table is never edited manually.
