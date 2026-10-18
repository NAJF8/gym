import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const migration = await readFile(new URL("../worker/migrations/0003_admin_invitations.sql", import.meta.url), "utf8");
const helper = await readFile(new URL("../worker/src/invitations.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/src/index.ts", import.meta.url), "utf8");

test("invitation storage has a single-use state machine and audit table", () => {
  for (const status of ["PENDING", "CLAIMED", "APPLIED", "REVOKED", "EXPIRED", "REJECTED"]) assert.match(migration, new RegExp(status));
  assert.match(migration, /admin_audit_logs/);
  assert.match(helper, /status = 'CLAIMED'.*status = 'PENDING'/s);
  assert.match(helper, /status = 'APPLIED'.*claimed_uid/s);
});

test("Worker acceptance uses verified identity and keyed member storage", () => {
  assert.match(worker, /verifiedGoogleUser\(env, request\)/);
  assert.match(worker, /appData\/deletedMemberIds/);
  assert.match(worker, /membersById/);
  assert.match(worker, /EXISTING_ADMIN_PROTECTED/);
});
