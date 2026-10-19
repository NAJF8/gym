# AL ASAS FIT PIN Worker

This Worker is the only PIN authority. It issues a cryptographically random
four-digit code once per member, stores only a salted PBKDF2-SHA-256 derivation
in D1, resets failed attempts on success, and locks a phone after five failed
attempts for 15 minutes. Repeated issuance requests are idempotent and do not
change an existing PIN. A new raw PIN is generated only for first issuance or
an explicit reset request; it is returned only from that authenticated request
and is never written to Firebase, D1, localStorage, or sessionStorage.

The existing credential is intentionally not revealable: D1 stores a hash only
and no approved server-side encryption-key service is configured for reversible
PIN storage. The admin UI therefore reports an existing PIN without exposing
it and requires an explicit reset to issue a new one.

Required Worker secrets/variables:

- FIREBASE_DATABASE_URL
- FIREBASE_WEB_API_KEY
- FIREBASE_SERVICE_ACCOUNT_EMAIL
- FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
- CORS_ORIGINS (comma-separated exact origins; `CORS_ORIGIN` remains the
  single-origin fallback). Never use `*`.
- D1 binding PIN_DB using the existing `member_credentials` and
  `pin_attempt_buckets` tables documented in schema.sql. Do not run schema.sql
  against an existing database.

The checked-in Wrangler configuration targets the separately named Staging
Worker and Staging D1 only. No Worker deployment or production secret setup is
performed by this change.
