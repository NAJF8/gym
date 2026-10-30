import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import { deleteMemberRecord, upsertMemberRecord } from "../src/memberStorage.ts";
import { migrateMembers } from "../scripts/migrate-members-keyed.mjs";

const rules = await readFile(new URL("../database.rules.json", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "gym-migration-rollback",
  database: { host: "127.0.0.1", port: Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 9000), rules },
});
const dbFor = uid => env.authenticatedContext(uid, {
  email: `${uid}@example.test`, email_verified: true, firebase: { sign_in_provider: "google.com" },
}).database();
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = value => createHash("sha256").update(stable(value)).digest("hex");
const now = "2026-10-18T22:00:00.000Z";

const initial = {
  admins: {
    "rollback-super": { role: "SUPER_ADMIN", active: true, email: "super@example.test" },
    "rollback-a": { role: "MANAGER", active: true, email: "a@example.test" },
    "rollback-b": { role: "MANAGER", active: true, email: "b@example.test" },
  },
  appData: {
    schemaVersion: 1,
    settings: { gymName: "Synthetic Rollback Gym", accent: "#b7ff2a" },
    exercises: [],
    courses: [{ id: "course-rollback", name: "Course preserved", memberIds: ["member-a", "member-b"] }],
    members: [
      { id: "member-a", name: "A original", membershipId: "A-001", active: true },
      { id: "member-b", name: "B original", membershipId: "B-001", active: true },
      { id: "delete-target", name: "Delete after cutover", membershipId: "D-001", active: true },
    ],
    deletedMemberIds: { "old-tombstone": { deletedAt: "2026-10-01T00:00:00.000Z", version: 1 } },
  },
};

before(async () => {
  await env.withSecurityRulesDisabled(async context => set(ref(context.database()), initial));
});
after(() => env.cleanup());

test("backup hash, failed cutover, and forward recovery preserve post-migration updates", async () => {
  const backupDir = new URL("../tmp/migration-rollback-evidence/", import.meta.url);
  await mkdir(backupDir, { recursive: true });
  const backupPath = new URL("backup.json", backupDir);
  const hashPath = new URL("backup.sha256", backupDir);
  const backupHash = sha256(initial);
  await writeFile(backupPath, `${JSON.stringify(initial)}\n`, "utf8");
  await writeFile(hashPath, `${backupHash}\n`, "utf8");
  assert.equal(sha256(JSON.parse(await readFile(backupPath, "utf8"))), (await readFile(hashPath, "utf8")).trim());

  const migration = migrateMembers({ members: initial.appData.members });
  assert.equal(migration.verification, "PASS");
  await env.withSecurityRulesDisabled(async context => {
    const database = context.database();
    await set(ref(database, "appData/membersById"), migration.membersById);
    await set(ref(database, "appData/migratedAt"), now);
  });
  const originalAfterMigration = (await get(ref(dbFor("rollback-a"), "appData/members"))).val();
  assert.deepEqual(originalAfterMigration, initial.appData.members);

  const adminA = dbFor("rollback-a");
  const adminB = dbFor("rollback-b");
  await upsertMemberRecord(adminA, { id: "post-member", name: "Created after cutover", membershipId: "P-001", days: [], active: true }, null);
  const aBefore = (await get(ref(adminA, "appData/membersById/member-a"))).val();
  await upsertMemberRecord(adminB, { ...aBefore, name: "A updated after cutover" }, aBefore);
  const deleteBefore = await upsertMemberRecord(adminA, { id: "delete-after-cutover", name: "Will be deleted", days: [], active: true }, null);
  await deleteMemberRecord(adminB, "delete-after-cutover", deleteBefore);

  await upsertMemberRecord(adminA, { id: "concurrent-a", name: "Concurrent A", days: [], active: true }, null);
  await upsertMemberRecord(adminB, { id: "concurrent-b", name: "Concurrent B", days: [], active: true }, null);
  const concurrent = await upsertMemberRecord(adminA, { id: "same-concurrent", name: "Before race", days: [], active: true }, null);
  const race = await Promise.allSettled([
    upsertMemberRecord(adminA, { id: "same-concurrent", name: "Race A", days: [], active: true }, concurrent),
    upsertMemberRecord(adminB, { id: "same-concurrent", name: "Race B", days: [], active: true }, concurrent),
  ]);
  assert.equal(race.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(race.filter(item => item.status === "rejected").length, 1);

  // Simulate a cutover failure after the first target write. The legacy source
  // and backup remain untouched; the canonical keyed state is not overwritten.
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), "appData/migrationRecovery/failedCutover"), { stage: "membersById-partial", failedAt: now });
  });
  assert.deepEqual((await get(ref(adminA, "appData/members"))).val(), initial.appData.members);

  const current = (await get(ref(adminA, "appData"))).val();
  const tombstones = current.deletedMemberIds || {};
  const keyed = current.membersById || {};
  const recoveredMembers = Object.values(keyed).filter(member => !tombstones[member.id]);
  const recovery = {
    sourceBackupSha256: backupHash,
    members: recoveredMembers,
    courses: current.courses,
    settings: current.settings,
    deletedMemberIds: tombstones,
    strategy: "FORWARD_RECOVERY_FROM_KEYED_CANONICAL_STATE",
  };
  await env.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), "appData/migrationRecovery/forwardRecovery"), recovery);
  });
  const recovered = (await get(ref(adminA, "appData/migrationRecovery/forwardRecovery"))).val();
  const recoveredById = Object.fromEntries(recovered.members.map(member => [member.id, member]));
  assert.equal(recovered.sourceBackupSha256, backupHash);
  assert.equal(recovered.strategy, "FORWARD_RECOVERY_FROM_KEYED_CANONICAL_STATE");
  assert.equal(recoveredById["member-a"].name, "A updated after cutover");
  assert.ok(recoveredById["post-member"]);
  assert.ok(recoveredById["concurrent-a"]);
  assert.ok(recoveredById["concurrent-b"]);
  assert.ok(recoveredById["same-concurrent"]);
  assert.equal(recoveredById["delete-after-cutover"], undefined);
  assert.ok(recovered.deletedMemberIds["old-tombstone"]);
  assert.ok(recovered.deletedMemberIds["delete-after-cutover"]);
  assert.deepEqual(recovered.courses, initial.appData.courses);
  assert.deepEqual(recovered.settings, initial.appData.settings);

  // A direct backup overwrite would lose all post-cutover IDs; that is why the
  // test rejects array rollback and records the forward-recovery proof instead.
  const backupIds = new Set(initial.appData.members.map(member => member.id));
  assert.equal(backupIds.has("post-member"), false);
  assert.equal(backupIds.has("concurrent-a"), false);
});
