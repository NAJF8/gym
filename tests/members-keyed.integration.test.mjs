import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import { deleteMemberRecord, upsertMemberRecord } from "../src/memberStorage.ts";

const rules = await readFile(new URL("../database.rules.json", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "gym1-4f1bb-default-rtdb",
  database: { host: "127.0.0.1", port: Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 9000), rules },
});
const dbFor = uid => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true, firebase: { sign_in_provider: "google.com" } }).database();

before(async () => {
  await env.withSecurityRulesDisabled(async context => set(ref(context.database()), {
    admins: { super: { role: "SUPER_ADMIN", active: true, email: "super@example.test" }, manager: { role: "MANAGER", active: true, email: "manager@example.test" } },
    appData: { membersById: {}, deletedMemberIds: {} },
  }));
});
after(() => env.cleanup());

test("parallel creates and edits are keyed and do not replace unrelated members", async () => {
  const db = dbFor("manager");
  await Promise.all([
    upsertMemberRecord(db, { id: "parallel-a", name: "A" }, null),
    upsertMemberRecord(db, { id: "parallel-b", name: "B" }, null),
  ]);
  const a = await get(ref(db, "appData/membersById/parallel-a"));
  const b = await get(ref(db, "appData/membersById/parallel-b"));
  assert.equal(a.val().version, 1);
  assert.equal(b.val().version, 1);
  await Promise.all([
    upsertMemberRecord(db, { id: "parallel-a", name: "A2" }, a.val()),
    upsertMemberRecord(db, { id: "parallel-b", name: "B2" }, b.val()),
  ]);
  assert.equal((await get(ref(db, "appData/membersById/parallel-a"))).val().name, "A2");
  assert.equal((await get(ref(db, "appData/membersById/parallel-b"))).val().name, "B2");
});

test("same-member stale writes fail instead of losing the newer version", async () => {
  const db = dbFor("manager");
  await upsertMemberRecord(db, { id: "same-member", name: "before" }, null);
  const snapshot = (await get(ref(db, "appData/membersById/same-member"))).val();
  const results = await Promise.allSettled([
    upsertMemberRecord(db, { id: "same-member", name: "first" }, snapshot),
    upsertMemberRecord(db, { id: "same-member", name: "second" }, snapshot),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal((await get(ref(db, "appData/membersById/same-member"))).val().version, 2);
});

test("delete leaves a tombstone and rejects a stale resurrection", async () => {
  const db = dbFor("manager");
  await upsertMemberRecord(db, { id: "deleted-member", name: "to delete" }, null);
  const old = (await get(ref(db, "appData/membersById/deleted-member"))).val();
  await deleteMemberRecord(db, "deleted-member", old);
  await assertFails(set(ref(db, "appData/membersById/deleted-member"), { id: "deleted-member", name: "stale", version: 2 }));
  assert.equal((await get(ref(db, "appData/membersById/deleted-member"))).exists(), false);
  assert.equal((await get(ref(db, "appData/deletedMemberIds/deleted-member"))).exists(), true);
});
