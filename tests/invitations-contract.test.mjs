import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const migration = await readFile(new URL("../worker/migrations/0003_admin_invitations.sql", import.meta.url), "utf8");
const productionMigration = await readFile(new URL("../worker/migrations/0007_admin_invitations_coach.sql", import.meta.url), "utf8");
const helper = await readFile(new URL("../worker/src/invitations.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/src/index.ts", import.meta.url), "utf8");

test("invitation storage has a single-use state machine and audit table", () => {
  for (const status of ["PENDING", "CLAIMED", "APPLIED", "REVOKED", "EXPIRED", "REJECTED"]) assert.match(migration, new RegExp(status));
  assert.match(migration, /admin_audit_logs/);
  assert.match(helper, /status = 'CLAIMED'.*status = 'PENDING'/s);
  assert.match(helper, /status = 'APPLIED'.*claimed_uid/s);
});

test("staging invitation migration reconciliation is non-destructive", () => {
  assert.match(productionMigration, /historical migration names/);
  assert.match(productionMigration, /SELECT 1;/);
  assert.doesNotMatch(productionMigration, /INSERT INTO admin_invitations_v2/);
  assert.doesNotMatch(productionMigration, /DROP TABLE admin_invitations/);
});

test("Worker acceptance uses verified identity and keyed member storage", () => {
  assert.match(worker, /verifiedGoogleUser\(env, request\)/);
  assert.match(worker, /appData\/deletedMemberIds/);
  assert.match(worker, /membersById/);
  assert.match(worker, /EXISTING_ADMIN_PROTECTED/);
});

test("recovered Firebase admin is not reported as accepted until D1 applies the claimed invitation", () => {
  assert.match(worker, /if \(!await applyInvitation\(env\.PIN_DB, invite, user\.localId!, now\)\)\s*throw new Error\('INVITATION_APPLY_RETRYABLE'\);/);
});

test("invitation-created Firebase admins require the matching applied D1 invitation before authorization", () => {
  assert.match(worker, /invitationId: invite\.invitation_id/);
  assert.match(worker, /WHERE invitation_id = \? AND status = 'APPLIED' AND applied_uid = \?/);
  assert.match(worker, /if \(!applied\)[\s\S]*throw new Error\("ADMIN_REQUIRED"\)/);
});

test("legacy SUPER_ADMIN invitation rows cannot enter the acceptance state machine", () => {
  assert.match(helper, /role IN \('COACH', 'MANAGER'\)/g);
  assert.match(helper, /validInvitationRole\(row\.role\)/);
});
