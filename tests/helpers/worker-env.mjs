import worker from "../../worker/src/index.ts";

export function createTestEnv(initialMembers = {}, initialDeleted = {}) {
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
              if (sql.includes("SELECT member_id FROM member_credentials WHERE (firebase_uid = ? OR membership_id = ?)")) {
                const [firebaseUid, membershipId, memberId] = args;
                for (const row of credentials.values()) {
                  if (row.member_id !== memberId && (row.firebase_uid === firebaseUid || row.membership_id === membershipId)) return { member_id: row.member_id };
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
                const [credentialId, memberId, firebaseUid, membershipId, phone, hash, salt, pinCipher, hashAlgorithm, iterations, createdAt, updatedAt, changedAt] = args;
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
                  hash_algorithm: hashAlgorithm,
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
                const [credentialId, memberId, firebaseUid, membershipId, phone, hash, salt, pinCipher, hashAlgorithm, iterations, createdAt, updatedAt, changedAt] = args;
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
                  hash_algorithm: hashAlgorithm,
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
                const [hash, salt, pinCipher, hashAlgorithm, iterations, nextVersion, updatedAt, changedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.pin_hash = hash;
                  row.pin_salt = salt;
                  row.pin_cipher = pinCipher;
                  row.hash_algorithm = hashAlgorithm;
                  row.hash_iterations = iterations;
                  row.failure_count = 0;
                  row.locked_until = null;
                  row.credential_version = nextVersion;
                  row.updated_at = updatedAt;
                  row.last_pin_changed_at = changedAt;
                }
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE member_credentials SET pin_hash = ?, pin_salt = ?, hash_algorithm = ?")) {
                const [hash, salt, hashAlgorithm, iterations, updatedAt, memberId, oldHash] = args;
                const row = credentials.get(memberId);
                if (!row || row.pin_hash !== oldHash) return { meta: { changes: 0 } };
                Object.assign(row, { pin_hash: hash, pin_salt: salt, hash_algorithm: hashAlgorithm, hash_iterations: iterations, updated_at: updatedAt });
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
              if (sql.startsWith("UPDATE member_credentials SET firebase_uid = ?, membership_id = ?, phone_e164 = ?, updated_at = ?")) {
                const [firebaseUid, membershipId, phone, updatedAt, memberId] = args;
                const row = credentials.get(memberId);
                if (row) {
                  row.firebase_uid = firebaseUid;
                  row.membership_id = membershipId;
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
              if (sql.startsWith("DELETE FROM member_credentials WHERE member_id = ?")) {
                credentials.delete(args[0]);
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

  const callWorker = async (path, body, token = "", extraHeaders = {}) => {
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
              ...extraHeaders,
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
