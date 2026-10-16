# AL ASAS FIT PIN Worker

This Worker is the only PIN authority. It issues a cryptographically random
four-digit code, stores only a salted PBKDF2-SHA-256 derivation in D1, resets
failed attempts on success, and locks a phone after five failed attempts for
15 minutes. The raw PIN is returned only from the authenticated issuance
request and is never written to Firebase, D1, localStorage, or sessionStorage.

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
