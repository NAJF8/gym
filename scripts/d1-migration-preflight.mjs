import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MIGRATION_ID = "0007";

function normalizeSql(sql) {
  return String(sql || "")
    .toLowerCase()
    .replace(/`|"|\[/g, "")
    .replace(/\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function rowValue(row, key) {
  return row?.[key] ?? row?.[key.toLowerCase()] ?? null;
}

function schemaObject(objects, name) {
  return objects.find((row) => String(rowValue(row, "name") || "") === name);
}

export function invitationDigest(rows) {
  const canonical = [...(rows || [])]
    .map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function evaluateD1Snapshot(snapshot, { expectedInvitationCount = 5, migrationId = DEFAULT_MIGRATION_ID } = {}) {
  const objects = snapshot.schema || [];
  const migrations = snapshot.migrations || [];
  const invitations = snapshot.invitations || [];
  const migrationRows = migrations.filter((row) => String(rowValue(row, "id") ?? "") === migrationId || normalizeSql(rowValue(row, "name")) === normalizeSql("0007_admin_invitations_coach.sql"));
  const table = schemaObject(objects, "admin_invitations");
  const audit = schemaObject(objects, "admin_audit_logs");
  const liveEmailIndex = schemaObject(objects, "admin_invitations_live_email_idx");
  const statusIndex = schemaObject(objects, "admin_invitations_status_idx");
  const emailIndex = schemaObject(objects, "admin_invitations_email_idx");
  const invalidRoles = invitations.filter((row) => !["COACH", "MANAGER"].includes(String(rowValue(row, "role") || "")));
  const duplicateLiveEmails = new Set();
  const liveEmails = new Set();
  for (const row of invitations) {
    const status = String(rowValue(row, "status") || "");
    const email = String(rowValue(row, "email") || "").trim().toLowerCase();
    if (["PENDING", "CLAIMED"].includes(status)) {
      if (liveEmails.has(email)) duplicateLiveEmails.add(email);
      liveEmails.add(email);
    }
  }
  const tableSql = normalizeSql(rowValue(table, "sql"));
  const auditSql = normalizeSql(rowValue(audit, "sql"));
  const indexSql = normalizeSql(rowValue(liveEmailIndex, "sql"));
  const schemaEquivalent = Boolean(
    table && audit && liveEmailIndex && emailIndex && statusIndex &&
    tableSql.includes("display_name text not null default") &&
    tableSql.includes("check (role in ('coach','manager'))") &&
    tableSql.includes("check (status in ('pending','claimed','applied','revoked','expired','rejected'))") &&
    auditSql.includes("action text not null") &&
    indexSql.includes("unique") && indexSql.includes("status in ('pending','claimed')") &&
    invalidRoles.length === 0 && duplicateLiveEmails.size === 0 &&
    invitations.length === expectedInvitationCount
  );
  const migrationRecorded = migrationRows.length > 0;
  if (schemaEquivalent) {
    return { decision: "skip", reason: migrationRecorded ? "migration-and-schema-already-present" : "equivalent-schema-present-under-any-migration-name", invitationCount: invitations.length, invitationDigest: invitationDigest(invitations) };
  }
  const safeToApply = Boolean(
    table && tableSql.includes("display_name text not null default") &&
    invalidRoles.length === 0 && duplicateLiveEmails.size === 0 &&
    invitations.length === expectedInvitationCount
  );
  if (safeToApply) {
    return { decision: "apply", reason: "schema-present-but-coach-constraint-or-index-is-missing", invitationCount: invitations.length, invitationDigest: invitationDigest(invitations) };
  }
  const blockers = [];
  if (!table) blockers.push("admin_invitations_missing");
  if (!audit) blockers.push("admin_audit_logs_missing");
  if (!liveEmailIndex) blockers.push("live_email_unique_index_missing");
  if (invalidRoles.length) blockers.push("unsupported_invitation_roles_present");
  if (duplicateLiveEmails.size) blockers.push("duplicate_live_invitation_emails_present");
  if (invitations.length !== expectedInvitationCount) blockers.push(`expected_${expectedInvitationCount}_invitations`);
  return { decision: "block", reason: "remote_schema_not_proven_equivalent", blockers, invitationCount: invitations.length, invitationDigest: invitationDigest(invitations) };
}

function parseWranglerJson(stdout) {
  const text = String(stdout || "").trim();
  const starts = [text.indexOf("["), text.indexOf("{")].filter((index) => index >= 0).sort((a, b) => a - b);
  if (!starts.length) throw new Error("D1_PREFLIGHT_EMPTY_RESPONSE");
  const value = JSON.parse(text.slice(starts[0]));
  const result = Array.isArray(value) ? value.find((item) => Array.isArray(item?.results)) : value;
  if (!Array.isArray(result?.results)) throw new Error("D1_PREFLIGHT_INVALID_RESPONSE");
  return result.results;
}

function runRemoteQuery(database, config, command) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, ["--yes", "wrangler@4.156.0", "d1", "execute", database, "--remote", "--config", config, "--command", command, "--json"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("D1_PREFLIGHT_REMOTE_QUERY_FAILED");
  return parseWranglerJson(result.stdout);
}

async function readSnapshot(args) {
  if (args.snapshot) return JSON.parse(await readFile(args.snapshot, "utf8"));
  const queries = {
    schema: "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name IN ('admin_invitations','admin_audit_logs','admin_invitations_email_idx','admin_invitations_status_idx','admin_invitations_live_email_idx') ORDER BY name",
    migrations: "SELECT id, name, applied_at FROM d1_migrations ORDER BY id",
    invitations: "SELECT invitation_id, email, role, status, expires_at, created_at, created_by_uid, claimed_uid, claimed_at, applied_uid, applied_at, updated_at FROM admin_invitations ORDER BY invitation_id",
  };
  return Object.fromEntries(Object.entries(queries).map(([key, query]) => [key, runRemoteQuery(args.database, args.config, query)]));
}

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (!value.startsWith("--")) return pairs;
  pairs.push([value.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1] ?? true]);
  return pairs;
}, []));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const snapshot = await readSnapshot(args);
    const result = evaluateD1Snapshot(snapshot, { expectedInvitationCount: Number(args["expected-invitations"] || 5) });
    if (process.env.GITHUB_OUTPUT) await import("node:fs/promises").then(({ appendFile }) => appendFile(process.env.GITHUB_OUTPUT, `decision=${result.decision === "skip" ? "skip" : result.decision}\n`));
    console.log(JSON.stringify({ decision: result.decision, reason: result.reason, blockers: result.blockers || [], invitationCount: result.invitationCount, invitationDigest: result.invitationDigest }));
    if (result.decision === "block") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "D1_PREFLIGHT_FAILED");
    process.exitCode = 1;
  }
}
