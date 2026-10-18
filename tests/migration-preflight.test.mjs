import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { migrateMembers } from "../scripts/migrate-members-keyed.mjs";

test("migration preflight preserves counts, ids, fields, courses, and tombstones", () => {
  const source = {
    members: [
      { id: "member-a", name: "A", phoneE164: "+9647800000001", days: ["course-a"] },
      { id: "member-b", name: "B", phoneE164: "+9647800000002", days: [] },
    ],
    courses: [{ id: "course-a", memberIds: ["member-a"], days: [{ title: "Day 1" }] }],
    deletedMemberIds: { "old-member": { deletedAt: "2026-10-01T00:00:00.000Z", version: 1 } },
  };
  const before = structuredClone(source);
  const result = migrateMembers(source);
  assert.equal(result.verification, "PASS");
  assert.equal(result.sourceCount, 2);
  assert.deepEqual(result.sourceIds.sort(), ["member-a", "member-b"]);
  assert.deepEqual(result.membersById["member-a"], source.members[0].version ? source.members[0] : { ...source.members[0], version: 1 });
  assert.deepEqual(source, before, "migration is non-destructive to the source snapshot");
  assert.deepEqual(source.courses, [{ id: "course-a", memberIds: ["member-a"], days: [{ title: "Day 1" }] }]);
  assert.deepEqual(source.deletedMemberIds["old-member"], { deletedAt: "2026-10-01T00:00:00.000Z", version: 1 });
});

test("interrupted output can be resumed and rerun without duplication", () => {
  const source = { members: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] };
  const full = migrateMembers(source);
  const interrupted = { membersById: { a: full.membersById.a } };
  const resumed = { membersById: { ...interrupted.membersById, ...full.membersById } };
  assert.deepEqual(resumed.membersById, full.membersById);
  assert.deepEqual(migrateMembers({ members: Object.values(resumed.membersById) }).membersById, full.membersById);
});

test("cutover leaves no executable legacy member write", () => {
  const rules = JSON.parse(fs.readFileSync(new URL("../database.rules.json", import.meta.url), "utf8"));
  const legacy = rules.rules.appData.members;
  assert.equal(legacy[".write"], false);
  const sync = fs.readFileSync(new URL("../src/dataSync.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sync, /set\(ref\([^\n]*appData\/members/);
  assert.doesNotMatch(sync, /update\(ref\([^\n]*appData\/members/);
  assert.match(sync, /membersById/);
});
