import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker/src/index.ts", import.meta.url), "utf8");
const invitations = await readFile(new URL("../worker/src/invitations.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../worker/migrations/0006_admin_names.sql", import.meta.url), "utf8");
const rules = await readFile(new URL("../database.rules.json", import.meta.url), "utf8");

test("invitation names are stored server-side and only COACH/MANAGER can be invited", () => {
  assert.match(migration, /display_name TEXT NOT NULL DEFAULT/);
  assert.match(invitations, /value === "COACH" \|\| value === "MANAGER"/);
  assert.match(worker, /displayName = normalizeDisplayName\(body\.displayName\)/);
  assert.match(worker, /displayName: invite\.display_name/);
  assert.doesNotMatch(worker, /displayName: user\.displayName \|\| ''/);
});

test("profile updates are bound to the verified actor and cannot change role/email", () => {
  assert.match(worker, /async function adminProfile/);
  assert.match(worker, /admins\/\$\{encodeURIComponent\(actorUid\)\}/);
  assert.match(worker, /ADMIN_DISPLAY_NAME_UPDATED/);
  assert.match(worker, /if \(body\.action === 'update'\)/);
  assert.match(rules, /newData\.child\('role'\)\.val\(\) === 'COACH'/);
});
