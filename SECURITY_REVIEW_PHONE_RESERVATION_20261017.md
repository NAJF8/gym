# AL ASAS FIT PHONE_RESERVATION independent security review

Date: 2026-10-17
Scope: local Worker, local D1, Firebase RTDB Emulator, and the staging-targeted source tree. Production was not accessed or modified.

## Threat model

- The client, a normal authenticated Firebase user, and two concurrently acting managers are untrusted with respect to canonical member writes.
- `appData/members` is the canonical RTDB member record set for this flow; D1 is the authoritative phone reservation, idempotency, and outbox state store.
- RTDB and D1 are separate systems. A successful D1 reservation is therefore not treated as proof that RTDB is synchronized.
- A phone reservation remains `PENDING_SYNC` until the RTDB ETag write succeeds. A previous `READY` reservation is retained during a phone change and is released only after the new RTDB record is confirmed.

## Controls reviewed

- D1 partial unique index on active (`PENDING_SYNC`, `READY`) phone reservations.
- Server-side admin verification, Google-provider/verified-email checks in the production path, and local-only emulator credentials gated by `LOCAL_TEST_MODE`.
- Idempotency binds operation key to actor and request hash; reuse with a different actor or payload is rejected.
- RTDB member writes use ETags; conflicts remain recoverable through the outbox reconciliation endpoint.
- PIN issuance requires the member to exist in RTDB and its phone reservation to be `READY`; raw PIN values are returned only in the issuance response and are not persisted.
- Client RTDB rules reject direct writes to `appData/members` and `memberPhoneIndex`; administrator role records are not client-writable.
- `membersByUid` remains a legacy read/isolation projection. It is not the canonical member-save path and the client PIN flow does not write it.

## Negative and recovery tests

The local evidence run covered two and twenty concurrent creates, two different manager identities, duplicate idempotency replay and key reuse, ETag conflict, RTDB write failure, lost write acknowledgement, Worker restart, repeated reconciliation, failed delete, phone change failure, delete/reuse, pending-PIN rejection, PIN lock concurrency, unauthenticated/ordinary-user rejection, CORS rejection, and direct RTDB write rejection.

Observed invariants:

- One successful creator per phone; D1 and RTDB each contained one active record for the tested race phones.
- Replaying a completed idempotency key returned the original result; changing its payload or actor was rejected.
- Failed RTDB writes left an outbox failure and a pending reservation; reconciliation moved the operation to `SYNCED`/`READY` without creating a duplicate.
- Lost acknowledgement was reconciled against the already-written RTDB record rather than duplicated.
- A failed delete retained the RTDB record and active reservation until reconciliation succeeded.
- A failed phone change retained the old `READY` reservation while the new reservation was pending; after reconciliation the new phone became `READY` and the old one was released.
- PIN issuance was rejected while synchronization was pending and succeeded only after reconciliation; twenty-five concurrent wrong PIN attempts produced one `401` followed by `429` responses.

## Independent conclusion

The local security gates for the changed flow passed. The original Codex Security scan `081ad739-512c-4e66-ac3e-86ec63b2577f` is not a PASS: its authoritative context remained in `preflight` with zero completed coverage, no threat model, and no report. The original scan target also points at the original checkout rather than this staging worktree. This document is the required independent review and does not replace a completed original audit.

Staging deployment was intentionally not performed. An authenticated Google manager E2E, staging resource verification, backup/readback proof, and the staging deploy gate remain separate release prerequisites.
