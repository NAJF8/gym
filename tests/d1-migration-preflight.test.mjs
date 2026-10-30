import test from "node:test";
import assert from "node:assert/strict";
import { evaluateD1Snapshot } from "../scripts/d1-migration-preflight.mjs";

const schema = [
  { name: "admin_invitations", sql: "CREATE TABLE admin_invitations (display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK (role IN ('COACH', 'MANAGER')), status TEXT NOT NULL CHECK (status IN ('PENDING','CLAIMED','APPLIED','REVOKED','EXPIRED','REJECTED')))" },
  { name: "admin_audit_logs", sql: "CREATE TABLE admin_audit_logs (action TEXT NOT NULL, created_at INTEGER NOT NULL)" },
  { name: "admin_invitations_email_idx", sql: "CREATE INDEX admin_invitations_email_idx ON admin_invitations(email, created_at DESC)" },
  { name: "admin_invitations_status_idx", sql: "CREATE INDEX admin_invitations_status_idx ON admin_invitations(status, expires_at)" },
  { name: "admin_invitations_live_email_idx", sql: "CREATE UNIQUE INDEX admin_invitations_live_email_idx ON admin_invitations(email) WHERE status IN ('PENDING','CLAIMED')" },
];
const invitations = Array.from({ length: 5 }, (_, index) => ({ invitation_id: `invite-${index}`, email: `coach-${index}@example.test`, role: "COACH", status: "PENDING" }));

test("migration preflight skips an equivalent schema even when migration name differs", () => {
  const result = evaluateD1Snapshot({ schema, migrations: [{ id: "0008", name: "renamed_admin_invitations_coach.sql" }], invitations });
  assert.equal(result.decision, "skip");
  assert.equal(result.reason, "equivalent-schema-present-under-any-migration-name");
  assert.equal(result.invitationCount, 5);
});

test("migration preflight blocks unsupported roles and duplicate live emails", () => {
  const result = evaluateD1Snapshot({ schema, migrations: [], invitations: [...invitations.slice(0, 4), { ...invitations[4], role: "SUPER_ADMIN", email: invitations[0].email }] });
  assert.equal(result.decision, "block");
  assert.deepEqual(result.blockers.sort(), ["duplicate_live_invitation_emails_present", "unsupported_invitation_roles_present"]);
});

test("migration preflight permits the reviewed rebuild only when rows are preservable", () => {
  const legacySchema = schema.filter((item) => item.name !== "admin_invitations_live_email_idx").map((item) => item.name === "admin_invitations" ? { ...item, sql: item.sql.replace("'COACH', ", "") } : item);
  const result = evaluateD1Snapshot({ schema: legacySchema, migrations: [], invitations: invitations.map((row) => ({ ...row, role: "MANAGER" })) });
  assert.equal(result.decision, "apply");
});
