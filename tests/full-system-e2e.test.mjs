import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.ts";
import { encryptPin, hashPin, PBKDF2_ITERATIONS } from "../worker/src/crypto.ts";

function createTestEnv(initialMembers = {}, initialDeleted = {}) {
  const credentials = new Map();
  const buckets = new Map();
  const sessions = new Map();
  const audits = [];
  const membersById = new Map(Object.entries(initialMembers));
  const deletedMemberIds = new Map(Object.entries(initialDeleted));
  let now = 1_760_000_000_000;

  const RealDateNow = Date.now;
  const withMockNow = async (fn) => {
    Date.now = () => now;
    try {
      return await fn();
    } finally {
      Date.now = RealDateNow;
    }
  };

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM pin_attempt_buckets WHERE bucket_key = ?")) {
                return buckets.get(args[0]) ?? null;
              }
              if (sql.includes("SELECT member_id FROM member_credentials WHERE phone_e164 = ? AND member_id <> ?")) {
                const [phone, memberId] = args;
                for (const row of credentials.values()) {
                  if (row.phone_e164 === phone && row.member_id !== memberId) {
                    return { member_id: row.member_id };
                  }
                }
                return null;
              }
              if (sql.includes("FROM member_credentials WHERE member_id = ?")) {
                return credentials.get(args[0]) ?? null;
              }
              if (sql.includes("SELECT * FROM member_credentials WHERE phone_e164 = ?")) {
                const [phone] = args;
                for (const row of credentials.values()) {
                  if (row.phone_e164 === phone) return { ...row };
                }
                return null;
              }
              if (sql.includes("SELECT failure_count, locked_until FROM member_credentials WHERE member_id = ?")) {
                const row = credentials.get(args[0]);
                return row ? { failure_count: row.failure_count, locked_until: row.locked_until } : null;
              }
              if (sql.includes("FROM member_sessions WHERE token_hash = ?")) {
                return sessions.get(args[0]) ?? null;
              }
              return null;
            },
            async all() {
              if (sql.includes("FROM member_pin_audit_logs")) {
                return { results: [...audits].reverse() };
              }
              return { results: [] };
            },
            async run() {
              if (sql.startsWith("INSERT INTO member_pin_audit_logs")) {
                const [id, action, actorUid, memberId, credentialVersion, createdAt] = args;
                audits.push({ id, action, actorUid, memberId, credentialVersion, createdAt });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO member_credentials") && sql.includes("DO NOTHING")) {
                const [credentialId, memberId, firebaseUid, membershipId, phone, hash, salt, pinCipher, iterations, createdAt, updatedAt, changedAt] = args;
                if (credentials.has(memberId)) return { meta: { changes: 0 } };
                credentials.set(memberId, {
                  credential_id: credentialId,
                  member_id: memberId,
                  firebase_uid: firebaseUid,
                  membership_id: membershipId,
                  phone_e164: phone,
                  pin_hash: hash,
                  pin_salt: salt,
                  pin_cipher: pinCipher,
                  hash_algorithm: "PBKDF2-SHA256",
                  hash_iterations: iterations,
                  status: "ACTIVE",
                  failure_count: 0,
                  locked_until: null,
                  credential_version: 1,
                  created_at: createdAt,
                  updated_at: updatedAt,
                  last_pin_changed_at: changedAt,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO member_credentials") && sql.includes("DO UPDATE SET")) {
                const [credentialId, memberId, firebaseUid, membershipId, phone, hash, salt, pinCipher, iterations, createdAt, updatedAt, changedAt] = args;
                const prev = credentials.get(memberId);
                credentials.set(memberId, {
                  credential_id: prev?.credential_id || credentialId,
                  member_id: memberId,
                  firebase_uid: firebaseUid,
                  membership_id: membershipId,
                  phone_e164: phone,
                  pin_hash: hash,
                  pin_salt: salt,
                  pin_cipher: pinCipher,
                  hash_algorithm: "PBKDF2-SHA256",
                  hash_iterations: iterations,
                  status: "ACTIVE",
                  failure_count: 0,
                  locked_until: null,
                  credential_version: (prev?.credential_version || 0) + 1,
                  created_at: prev?.created_at || createdAt,
                  updated_at: updatedAt,
                  last_pin_changed_at: changedAt,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_credentials SET pin_hash = ?, pin_salt = ?, pin_cipher = ?")) {
                const [hash, salt, pinCipher, iterations, nextVersion, updatedAt, changedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.pin_hash = hash;
                  row.pin_salt = salt;
                  row.pin_cipher = pinCipher;
                  row.hash_iterations = iterations;
                  row.failure_count = 0;
                  row.locked_until = null;
                  row.credential_version = nextVersion;
                  row.updated_at = updatedAt;
                  row.last_pin_changed_at = changedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_credentials SET pin_cipher = ?")) {
                const [pinCipher, updatedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.pin_cipher = pinCipher;
                  row.updated_at = updatedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_credentials SET phone_e164 = ?")) {
                const [phone, updatedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.phone_e164 = phone;
                  row.updated_at = updatedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE member_credentials SET failure_count = CASE")) {
                const [nowExpired, nowLockCheck, lockUntil, updatedAt, memberId, activeNow] = args;
                const row = credentials.get(memberId);
                if (!row || (row.locked_until !== null && row.locked_until > activeNow)) {
                  return { meta: { changes: 0 } };
                }
                const baseFailures = row.locked_until !== null && row.locked_until <= nowExpired ? 0 : row.failure_count;
                row.failure_count = baseFailures + 1;
                row.locked_until = baseFailures + 1 >= 5 ? lockUntil : (row.locked_until !== null && row.locked_until <= nowLockCheck ? null : row.locked_until);
                row.updated_at = updatedAt;
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_credentials SET failure_count = 0, locked_until = NULL")) {
                const [loginAt, updatedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.failure_count = 0;
                  row.locked_until = null;
                  row.last_login_at = loginAt;
                  row.updated_at = updatedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_credentials SET status = 'DISABLED'")) {
                const [updatedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.status = "DISABLED";
                  row.credential_version += 1;
                  row.updated_at = updatedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO pin_attempt_buckets")) {
                const [key, updatedAt, exp1, exp2, threshold, lockUntil] = args;
                const existing = buckets.get(key);
                if (!existing) {
                  buckets.set(key, { failure_count: 1, locked_until: null, updated_at: updatedAt });
                } else {
                  const expired = existing.locked_until !== null && existing.locked_until <= exp1;
                  const nextCount = expired ? 1 : existing.failure_count + 1;
                  const nextLock = expired ? null : (existing.failure_count + 1 >= threshold ? lockUntil : existing.locked_until);
                  buckets.set(key, { failure_count: nextCount, locked_until: nextLock, updated_at: updatedAt });
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE FROM pin_attempt_buckets WHERE bucket_key IN (?, ?)")) {
                buckets.delete(args[0]);
                buckets.delete(args[1]);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("DELETE FROM pin_attempt_buckets WHERE bucket_key = ?")) {
                buckets.delete(args[0]);
                const cutoff = args[1];
                for (const [k, v] of buckets.entries()) {
                  if (v.locked_until !== null && v.locked_until <= cutoff) buckets.delete(k);
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("INSERT INTO member_sessions")) {
                const [sessionId, memberId, tokenHashVal, expiresAt, createdAt, lastSeenAt] = args;
                sessions.set(tokenHashVal, {
                  session_id: sessionId,
                  member_id: memberId,
                  token_hash: tokenHashVal,
                  expires_at: expiresAt,
                  revoked_at: null,
                  created_at: createdAt,
                  last_seen_at: lastSeenAt,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_sessions SET last_seen_at = ?")) {
                const [seenAt, sessionId] = args;
                for (const s of sessions.values()) {
                  if (s.session_id === sessionId) s.last_seen_at = seenAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_sessions SET revoked_at = ? WHERE member_id = ?")) {
                const [revokedAt, memberId] = args;
                for (const s of sessions.values()) {
                  if (s.member_id === memberId && s.revoked_at === null) s.revoked_at = revokedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_sessions SET revoked_at = ? WHERE token_hash = ?")) {
                const [revokedAt, hashVal] = args;
                const s = sessions.get(hashVal);
                if (s) s.revoked_at = revokedAt;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
        async all() {
          if (sql.includes("FROM member_pin_audit_logs")) {
            return { results: [...audits].reverse() };
          }
          return { results: [] };
        },
      };
    },
  };

  const env = {
    PIN_DB: db,
    FIREBASE_DATABASE_URL: "https://alasas-fit-staging-default-rtdb.firebaseio.com",
    FIREBASE_WEB_API_KEY: "test-web-api-key",
    PIN_PEPPER: "staging-test-secret-pepper-2026",
    LOCAL_EMULATOR_ONLY: "true",
    FIREBASE_SERVICE_ACCESS_TOKEN: "test-service-token",
    FIREBASE_IDENTITY_TOOLKIT_URL: "https://identitytoolkit.test/v1/accounts:lookup",
    CORS_ORIGINS: "https://alasas-fit-staging.web.app,http://localhost:4173",
  };

  const callWorker = async (path, body, token = "") => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (target.startsWith("https://identitytoolkit.test")) {
        if (token === "valid-captain-token") {
          return new Response(JSON.stringify({
            users: [{ localId: "captain-uid-1", email: "mohameadalhaear100@gmail.com", emailVerified: true, providerUserInfo: [{ providerId: "google.com" }] }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "INVALID_ID_TOKEN" } }), { status: 400 });
      }
      if (target.includes("/admins/captain-uid-1.json")) {
        return new Response(JSON.stringify({ role: "SUPER_ADMIN", active: true }), { status: 200 });
      }
      if (target.includes("/appData.json")) {
        return new Response(JSON.stringify({
          membersById: Object.fromEntries(membersById.entries()),
          deletedMemberIds: Object.fromEntries(deletedMemberIds.entries()),
        }), { status: 200 });
      }
      if (target.includes("/deletedMemberIds.json")) {
        return new Response(JSON.stringify(Object.fromEntries(deletedMemberIds.entries())), { status: 200 });
      }
      return new Response("null", { status: 200 });
    };
    try {
      return await withMockNow(() =>
        worker.fetch(
          new Request(`https://worker.test${path}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://alasas-fit-staging.web.app",
              "cf-connecting-ip": "198.51.100.25",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          }),
          env,
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  return {
    env,
    credentials,
    buckets,
    sessions,
    audits,
    membersById,
    deletedMemberIds,
    advanceTime(ms) {
      now += ms;
    },
    callWorker,
  };
}

test("Full E2E: Captain PIN Eye reveal, Copy, Reset, Audit Log, and Member Login / Session / Lockout / Isolation", async () => {
  const ctx = createTestEnv({
    "m-001": {
      id: "m-001",
      membershipId: "M-1001",
      name: "أحمد علي",
      phoneE164: "+9647701234567",
      phoneDisplay: "07701234567",
      height: "178",
      weight: "76",
      createdAt: "2026-10-22",
      expiresAt: "2026-11-22",
      courseName: "كورس تضخيم شامل",
      notes: "الالتزام بالإحماء",
      active: true,
      days: [[{ id: "bench-press", name: "بنش برس", muscle: "تمارين الصدر", sets: 4, reps: "10", rest: "90 ثانية", weight: "60 كغم", notes: "تحكم كامل" }]],
    },
    "m-002": {
      id: "m-002",
      membershipId: "M-1002",
      name: "حسين كريم",
      phoneE164: "+9647809876543",
      phoneDisplay: "07809876543",
      height: "182",
      weight: "84",
      createdAt: "2026-10-22",
      active: true,
      days: [[{ id: "squat", name: "سكوات", muscle: "تمارين الأرجل", sets: 4, reps: "8", rest: "120 ثانية" }]],
    },
  });

  // 1. Unauthorized user cannot reveal PIN
  const unauthReveal = await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" });
  assert.equal(unauthReveal.status, 401);

  // 2. Authorized Captain reveals PIN for m-001 (auto-issues on first reveal if not yet issued)
  const firstRevealRes = await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" }, "valid-captain-token");
  assert.equal(firstRevealRes.status, 200);
  const firstRevealBody = await firstRevealRes.json();
  assert.match(firstRevealBody.pin, /^\d{4}$/);
  const pinA = firstRevealBody.pin;

  // 3. Subsequent Captain Eye click reveals the EXACT same 4-digit PIN (decrypted from AES-256-GCM pin_cipher)
  const secondRevealRes = await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" }, "valid-captain-token");
  assert.equal(secondRevealRes.status, 200);
  const secondRevealBody = await secondRevealRes.json();
  assert.equal(secondRevealBody.pin, pinA);
  assert.equal(secondRevealBody.source, "revealed");

  // 4. Member A logs in using local Iraqi format (07701234567), international (+9647701234567), and bidi-wrapped format
  for (const phoneInput of ["07701234567", "+9647701234567", "\u200e0770 123 4567\u202c"]) {
    const loginRes = await ctx.callWorker("/v1/member/login", { phone: phoneInput, pin: pinA });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.member.id, "m-001");
    assert.equal(loginBody.member.name, "أحمد علي");
    assert.equal(loginBody.member.courseName, "كورس تضخيم شامل");
    assert.equal(loginBody.member.expiresAt, "2026-11-22");
    assert.equal(loginBody.member.notes, "الالتزام بالإحماء");
    assert.ok(loginBody.sessionToken);

    // Verify /v1/member/me session persistence
    const meRes = await ctx.callWorker("/v1/member/me", {}, loginBody.sessionToken);
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.member.id, "m-001");
  }

  // 5. Issue PIN for Member B and verify strict isolation between Member A and Member B sessions
  const issueBRes = await ctx.callWorker("/v1/admin/member-pin", { memberId: "m-002", phone: "07809876543", reset: false, customPin: "4826" }, "valid-captain-token");
  assert.equal(issueBRes.status, 200);
  const issueBBody = await issueBRes.json();
  assert.equal(issueBBody.pin, "4826");

  const loginARes = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  const { sessionToken: tokenA } = await loginARes.json();
  const loginBRes = await ctx.callWorker("/v1/member/login", { phone: "07809876543", pin: "4826" });
  const { sessionToken: tokenB } = await loginBRes.json();

  const meA = await (await ctx.callWorker("/v1/member/me", {}, tokenA)).json();
  const meB = await (await ctx.callWorker("/v1/member/me", {}, tokenB)).json();
  assert.equal(meA.member.id, "m-001");
  assert.equal(meB.member.id, "m-002");
  assert.notEqual(meA.member.id, meB.member.id);

  // 6. Logout revokes session token
  const logoutARes = await ctx.callWorker("/v1/member/logout", {}, tokenA);
  assert.equal(logoutARes.status, 200);
  const meAfterLogout = await ctx.callWorker("/v1/member/me", {}, tokenA);
  assert.equal(meAfterLogout.status, 401);

  // 7. Wrong PIN and unregistered phone return identical generic 401 message
  const wrongPinVal = pinA === "9999" ? "0000" : "9999";
  const wrongPinRes = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: wrongPinVal });
  const unknownPhoneRes = await ctx.callWorker("/v1/member/login", { phone: "07901112233", pin: "1234" });
  assert.equal(wrongPinRes.status, 401);
  assert.equal(unknownPhoneRes.status, 401);
  assert.deepEqual(await wrongPinRes.json(), await unknownPhoneRes.json());

  // 8. Five wrong attempts lock the account (429), and after 15m lock expiry, the bucket resets properly!
  for (let i = 0; i < 4; i += 1) {
    await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: wrongPinVal });
  }
  const lockedAttempt = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  assert.equal(lockedAttempt.status, 429);

  // Advance 16 minutes past lock expiry
  ctx.advanceTime(16 * 60_000);
  // One wrong attempt after expiry should NOT re-lock the account; valid PIN should succeed immediately after!
  const singleWrongAfterExpiry = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: wrongPinVal });
  assert.equal(singleWrongAfterExpiry.status, 401);
  const validAfterExpiry = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  assert.equal(validAfterExpiry.status, 200);

  // 9. Inactive member cannot log in (403 MEMBER_INACTIVE)
  ctx.membersById.set("m-001", { ...ctx.membersById.get("m-001"), active: false });
  const inactiveLogin = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: pinA });
  assert.equal(inactiveLogin.status, 403);
  ctx.membersById.set("m-001", { ...ctx.membersById.get("m-001"), active: true });

  // 10. Captain resets PIN -> old PIN stops working, new PIN works & is revealed by Eye endpoint
  const resetRes = await ctx.callWorker("/v1/admin/member-pin", { memberId: "m-001", phone: "07701234567", reset: true, customPin: "7391" }, "valid-captain-token");
  assert.equal(resetRes.status, 200);
  const resetBody = await resetRes.json();
  assert.equal(resetBody.pin, "7391");

  const revealAfterReset = await (await ctx.callWorker("/v1/admin/member-pin-reveal", { memberId: "m-001" }, "valid-captain-token")).json();
  assert.equal(revealAfterReset.pin, "7391");

  const loginWithNewPin = await ctx.callWorker("/v1/member/login", { phone: "07701234567", pin: "7391" });
  assert.equal(loginWithNewPin.status, 200);

  // 11. Deleted member (revoked + tombstoned) cannot log in
  const revokeRes = await ctx.callWorker("/v1/admin/member-revoke", { memberId: "m-002" }, "valid-captain-token");
  assert.equal(revokeRes.status, 200);
  ctx.deletedMemberIds.set("m-002", { deletedAt: "2026-10-22T14:00:00Z", version: 1 });
  ctx.membersById.delete("m-002");

  const deletedLogin = await ctx.callWorker("/v1/member/login", { phone: "07809876543", pin: "4826" });
  assert.equal(deletedLogin.status, 401);

  // 12. Audit logs recorded PIN_ISSUED, PIN_REVEALED, PIN_RESET, PIN_REVOKED
  const auditRes = await ctx.callWorker("/v1/admin/pin-audit-logs", {}, "valid-captain-token");
  assert.equal(auditRes.status, 200);
  const auditBody = await auditRes.json();
  const actions = new Set(auditBody.logs.map((l) => l.action));
  assert.ok(actions.has("PIN_ISSUED"));
  assert.ok(actions.has("PIN_REVEALED"));
  assert.ok(actions.has("PIN_RESET"));
  assert.ok(actions.has("PIN_REVOKED"));
});
