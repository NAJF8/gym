import test from "node:test";
import assert from "node:assert/strict";
import { migrateMembers } from "../scripts/migrate-members-keyed.mjs";

test("migration preserves ids and fields and is idempotent", () => {
  const source = { members: [{ id: "member-001", name: "A" }, { id: "member-002", name: "B", version: 3 }] };
  const first = migrateMembers(source);
  assert.equal(first.verification, "PASS");
  assert.deepEqual(first.membersById["member-001"], { id: "member-001", name: "A", version: 1 });
  assert.deepEqual(migrateMembers({ members: Object.values(first.membersById) }).membersById, first.membersById);
});

test("migration fails explicitly for missing, invalid, and duplicate ids", () => {
  const result = migrateMembers({ members: [{ name: "missing" }, { id: "same", name: "A" }, { id: "same", name: "B" }, { id: "a/b" }] });
  assert.equal(result.verification, "FAIL");
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(error => error.code), ["MEMBER_ID_REQUIRED_OR_INVALID", "MEMBER_ID_DUPLICATE", "MEMBER_ID_REQUIRED_OR_INVALID"]);
});
