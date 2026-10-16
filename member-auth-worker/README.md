# Trusted member Phone + PIN service

This folder contains the Worker implementation plus isolated staging and Production configurations. The frontend remains fail-closed until `VITE_MEMBER_PIN_API_URL` points to a reviewed deployment.

The service must keep `pin_salt`, `pin_hash`, the pepper, Firebase service-account key, and rate-limit state server-side. It must expose only:

- `POST /v1/member/login`: normalize phone, verify a PBKDF2/Argon2 PIN, apply per-phone and per-IP throttles, and return a short-lived Firebase Custom Token with `{ member: true }` and the exact member UID.
- `POST /v1/admin/member-pin`: accept a verified Firebase Admin ID token, authorize the existing `SUPER_ADMIN`/`MANAGER` record server-side through `admins/{uid}` read using a service-account access token, issue or reset a PIN, and return the plaintext PIN once.
- `POST /v1/admin/member-disable`: disable or re-enable the phone credential and synchronize the RTDB member `active` flag.
- `POST /v1/admin/member-revoke-sessions`: increment the credential version. This stops future custom-token issuance; already-issued Firebase ID tokens remain valid until their normal expiry because RTDB Rules cannot query D1.

Do not activate the Production frontend until Firebase ID-token verification, admin-record authorization, custom-token signing, D1 migrations, CORS, and authenticated E2E tests are implemented and reviewed. A Worker session without a Firebase Custom Token is not sufficient for RTDB access.

The endpoint must return the same generic login error for an unknown phone, disabled account, and wrong PIN. Never log or return a PIN, hash, salt, member list, or whether a phone exists.

## Token distinction

The Worker signs a short-lived Firebase Custom Token with the service-account private key. The browser exchanges that token with Firebase Auth using `signInWithCustomToken`; Firebase then returns the Firebase ID Token used by the RTDB SDK. The Custom Token is never sent to RTDB and is not itself a long-lived session. The ID Token contains only `member=true`, `uid`, and `credentialVersion` custom claims. It does not contain an admin role.

## Required secrets

Set only in the matching authorized Worker:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: service-account JSON for the same project named by the Worker config, never committed.
- `PIN_PEPPER`: high-entropy secret unique to that Worker, never committed.

`FIREBASE_DATABASE_URL`, `FIREBASE_PROJECT_ID`, `DEPLOYMENT_ENV`, D1 binding, and allowed origins are environment configuration. Run the matching migration before testing. The Worker rejects a mismatched Firebase project or RTDB host at request time.
