import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.ts";

function invitationDb() {
  const invitations = [];
  const applied = new Set();
  const audit = [];
  const execute = (sql, args) => {
    if (sql.includes("SELECT * FROM admin_invitations WHERE email")) {
      const row = invitations.filter(item => item.email === args[0]).sort((a, b) => b.created_at - a.created_at)[0];
      return { results: row ? [row] : [] };
    }
    if (sql.startsWith("UPDATE admin_invitations SET status = 'REVOKED'")) {
      for (const row of invitations) if (row.email === args[1] && ["PENDING", "CLAIMED"].includes(row.status)) row.status = "REVOKED";
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO admin_invitations")) {
      const [invitationId, email, displayName, role, expiresAt, createdAt, createdByUid, updatedAt] = args;
      invitations.push({ invitation_id: invitationId, email, display_name: displayName, role, status: "PENDING", expires_at: expiresAt, created_at: createdAt, created_by_uid: createdByUid, claimed_uid: null, claimed_at: null, applied_uid: null, applied_at: null, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE admin_invitations SET status = 'CLAIMED'")) {
      const [uid, now, , email, expiresAfter] = args;
      const row = invitations.find(item => item.email === email && item.status === "PENDING" && item.expires_at > expiresAfter);
      if (!row) return { meta: { changes: 0 } };
      row.status = "CLAIMED"; row.claimed_uid = uid; row.claimed_at = now; row.updated_at = now;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE admin_invitations SET status = 'APPLIED'")) {
      const [uid, now, , invitationId, claimedUid] = args;
      const row = invitations.find(item => item.invitation_id === invitationId && item.status === "CLAIMED" && item.claimed_uid === claimedUid);
      if (!row) return { meta: { changes: 0 } };
      row.status = "APPLIED"; row.applied_uid = uid; row.applied_at = now; row.updated_at = now; applied.add(`${invitationId}:${uid}`);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE admin_invitations SET status = 'EXPIRED'")) return { meta: { changes: 0 } };
    if (sql.startsWith("INSERT INTO admin_audit_logs")) { audit.push(args); return { meta: { changes: 1 } }; }
    return { meta: { changes: 1 } };
  };
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => execute(sql, args),
    first: async () => {
      if (sql.includes("SELECT * FROM admin_invitations WHERE email")) return invitations.filter(item => item.email === args[0]).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
      if (sql.includes("SELECT 1 FROM admin_invitations WHERE invitation_id")) return applied.has(`${args[0]}:${args[1]}`) ? { 1: 1 } : null;
      return null;
    },
    all: async () => ({ results: [] }),
  });
  return { invitations, audit, prepare: sql => statement(sql), batch: async statements => Promise.all(statements.map(item => item.run())) };
}

function flowContext() {
  const db = invitationDb();
  const admins = new Map([["super-uid", { email: "mohameadalhaear100@gmail.com", role: "SUPER_ADMIN", active: true }]]);
  const identities = {
    "super-token": { localId: "super-uid", email: "mohameadalhaear100@gmail.com", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] },
    "manager-token": { localId: "manager-uid", email: "manager@example.test", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] },
    "intruder-token": { localId: "intruder-uid", email: "intruder@example.test", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] },
  };
  const env = { PIN_DB: db, FIREBASE_DATABASE_URL: "https://firebase.test", FIREBASE_WEB_API_KEY: "test-key", LOCAL_EMULATOR_ONLY: "true", FIREBASE_SERVICE_ACCESS_TOKEN: "service-token", FIREBASE_IDENTITY_TOOLKIT_URL: "https://identity.test/lookup", CORS_ORIGINS: "https://fit.alasas.tech,https://alasas-fit-staging.web.app" };
  const call = async (path, token, body = {}) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      if (target.startsWith("https://identity.test")) {
        const idToken = JSON.parse(String(init.body || "{}")).idToken;
        const user = identities[idToken];
        return new Response(JSON.stringify(user ? { users: [user] } : { error: { message: "INVALID_ID_TOKEN" } }), { status: user ? 200 : 400 });
      }
      const pathMatch = target.match(/\/admins\/([^/.]+)\.json/);
      if (pathMatch) {
        const uid = decodeURIComponent(pathMatch[1]);
        if (init.method === "PUT") { admins.set(uid, JSON.parse(String(init.body))); return new Response("null", { status: 200 }); }
        return new Response(JSON.stringify(admins.get(uid) ?? null), { status: 200 });
      }
      if (target.includes("/admins.json")) return new Response(JSON.stringify(Object.fromEntries(admins)), { status: 200 });
      return new Response("null", { status: 200 });
    };
    try {
      return await worker.fetch(new Request(`https://worker.test${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://fit.alasas.tech", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env);
    } finally { globalThis.fetch = originalFetch; }
  };
  return { db, admins, env, call };
}

test("invited Google manager is activated once, persists across a new session, and an uninvited account is denied", async () => {
  const ctx = flowContext();
  const invite = await ctx.call("/v1/admin/management/invite", "super-token", { displayName: "Manager Test", email: "manager@example.test", role: "MANAGER" });
  assert.equal(invite.status, 200);
  assert.equal(ctx.db.invitations.length, 1);
  assert.equal(ctx.db.invitations[0].status, "PENDING");

  const accepted = await ctx.call("/v1/admin/management/accept", "manager-token");
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).role, "MANAGER");
  assert.equal(ctx.db.invitations[0].status, "APPLIED");
  assert.deepEqual(ctx.admins.get("manager-uid").role, "MANAGER");

  const relogin = await ctx.call("/v1/admin/profile", "manager-token", {});
  assert.equal(relogin.status, 200);
  assert.equal((await relogin.json()).role, "MANAGER");

  const intruder = await ctx.call("/v1/admin/profile", "intruder-token", {});
  assert.equal(intruder.status, 403);
});

test("official-domain preflight is allowed only when explicitly configured", async () => {
  const ctx = flowContext();
  const response = await worker.fetch(new Request("https://worker.test/v1/admin/management/invite", { method: "OPTIONS", headers: { origin: "https://fit.alasas.tech" } }), ctx.env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://fit.alasas.tech");
});
