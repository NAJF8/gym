# AL ASAS FIT Staging Keyed Cutover Plan

This plan is prepared for `alasas-fit-staging` only. It is not authorization to
run a live migration, deploy Rules, or change Production.

## Preconditions

1. Preserve a fresh RTDB root backup outside Git. Validate JSON, SHA-256, root
   keys, member IDs, courses, and tombstones. Restore it into an isolated
   Database Emulator and require structural equality.
2. Confirm the target Firebase project is `alasas-fit-staging`, the RTDB host is
   `alasas-fit-staging-default-rtdb.firebaseio.com`, and the Worker endpoint is
   the Staging endpoint. Do not restore `member-stage-b`.
3. Confirm the release commit, Worker version, D1 schema, and Rules revision
   are the exact artifacts being promoted. Stop if any identity differs.
4. Confirm GitHub Environment `staging` has `CLOUDFLARE_API_TOKEN` without
   reading its value, and that the deploy identity can publish the Staging
   Worker, Rules, and Hosting.
5. Run the full Emulator suite, Worker typecheck/dry-run, build preflight,
   dependency audit, and the security Rules tests. A failed gate stops the
   cutover.

## Ordered execution

1. Deploy the reviewed Rules first. Rules must accept keyed versioned writes,
   reject Legacy Writes, reject tombstoned resurrection, enforce Google
   verified-admin identity, and enforce the tested field/type/length limits.
2. Apply only the reviewed non-destructive D1 migrations to the Staging D1
   binding. Record the schema readback before serving traffic.
3. Deploy the Worker with the Staging Firebase URL, D1 binding, CORS allowlist,
   and secrets. Read back the Worker version and verify unauthenticated routes
   reject access without exposing diagnostics or secrets.
4. Build and deploy Hosting with the same release SHA and Staging preflight.
   Verify `release.json` and the exact published asset metadata.
5. Disable Legacy Writes in the client/Worker path before Cutover. Keep the
   legacy array readable for audit and rollback, but do not delete or replace
   it.
6. Run a read-only migration preflight and compare every source record,
   stable ID, field, course link, and tombstone. Require zero duplicate IDs,
   zero missing records, and no `member-stage-b` mutation.
7. Migrate in resumable batches using stable IDs and version checks. After each
   batch, read back keyed records and record a deterministic comparison. Abort
   on any unexplained difference.
8. Perform the Cutover readback: keyed count/IDs/fields/courses/tombstones,
   Legacy Writes rejected, stale resurrection rejected, concurrent unrelated
   updates preserved, and the Worker reading only the keyed source.

## Forward Recovery

If a batch or Cutover fails, do not restore the old root over newer data. Leave
the legacy source and post-Cutover writes intact, record the failed stage and
backup SHA, and resume by reconciling only missing or stale keyed IDs with
version/ETag checks. Re-run the full comparison and critical E2E before any
retry. Restoring `member-stage-b` requires separate record-level approval.

## Post-cutover proof

Use synthetic Staging identities only. Exercise Super Admin and Manager role
boundaries, invitation acceptance/replay/expiry, member CRUD, course links,
PIN issue/login/isolation/revocation, tombstone behavior, QR destination,
desktop/mobile UI, and generated A4 output. Treat browser rendering, HTTP 200,
and `window.print` as insufficient without authenticated readback and a saved
render/print artifact.
