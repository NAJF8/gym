import { base64ToBytes, constantTimeEqual, derivePin, hashPin, isPin, normalizePhone, randomPin, PBKDF2_ITERATIONS } from "./crypto";

interface Env {
  PIN_DB: D1Database;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  CORS_ORIGIN?: string;
  CORS_ORIGINS?: string;
  LOCAL_TEST_MODE?: string;
  LOCAL_TEST_DIAGNOSTICS?: string;
  LOCAL_TEST_ADMIN_UID?: string;
  LOCAL_TEST_ADMIN_UIDS?: string;
  LOCAL_TEST_DATABASE_NAMESPACE?: string;
  LOCAL_TEST_SYNC_DELAY_MS?: string;
  LOCAL_TEST_FAIL_RTDB_WRITE?: string;
  LOCAL_TEST_DROP_AFTER_RTDB_WRITE?: string;
}

type MemberRecord = Record<string, unknown>;
type MemberOperation = "CREATE" | "UPDATE" | "DELETE";

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function allowedOrigins(env: Env) {
  return (env.CORS_ORIGINS || env.CORS_ORIGIN || "").split(",").map(origin => origin.trim()).filter(Boolean);
}

function cors(env: Env, requestOrigin = "") {
  const origins = allowedOrigins(env);
  const allowOrigin = requestOrigin && origins.includes(requestOrigin) ? requestOrigin : (origins[0] || "");
  return { "access-control-allow-origin": allowOrigin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" };
}

function firebaseUrl(env: Env, path: string) {
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json";
  if (env.LOCAL_TEST_MODE !== "true") return base;
  const uid = env.LOCAL_TEST_ADMIN_UID || (env.LOCAL_TEST_ADMIN_UIDS || "").split(",").map(value => value.trim()).filter(Boolean)[0] || "local-admin";
  const override = { uid, token: { email_verified: true, firebase: { sign_in_provider: "google.com" } } };
  const namespace = env.LOCAL_TEST_DATABASE_NAMESPACE ? `&ns=${encodeURIComponent(env.LOCAL_TEST_DATABASE_NAMESPACE)}` : "";
  return `${base}?auth_variable_override=${encodeURIComponent(JSON.stringify(override))}${namespace}`;
}

function firebaseOwnerUrl(env: Env, path: string) {
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json";
  return env.LOCAL_TEST_MODE === "true" && env.LOCAL_TEST_DATABASE_NAMESPACE
    ? `${base}?ns=${encodeURIComponent(env.LOCAL_TEST_DATABASE_NAMESPACE)}`
    : base;
}

function encodeBase64Url(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToBytes(pem: string) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(clean), char => char.charCodeAt(0));
}

async function serviceAccessToken(env: Env) {
  if (env.LOCAL_TEST_MODE === "true") return "local-test";
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encodeBase64Url(JSON.stringify({ iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claim));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + header + "." + claim + "." + encodeBase64Url(signature) });
  if (!response.ok) throw new Error("Firebase service authentication failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Firebase service token missing");
  return body.access_token;
}

async function firebaseGet(env: Env, path: string, accessToken: string) {
  const url = firebaseUrl(env, path);
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Firebase read failed");
  return response.json();
}

async function firebaseGetWithEtag(env: Env, path: string, accessToken: string) {
  const url = firebaseUrl(env, path);
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, "X-Firebase-ETag": "true" } });
  if (!response.ok) throw new Error("Firebase read failed");
  return { value: await response.json(), etag: response.headers.get("ETag") || "null_etag" };
}

async function firebasePutWithEtag(env: Env, path: string, value: unknown, accessToken: string, etag: string) {
  if (env.LOCAL_TEST_MODE === "true" && env.LOCAL_TEST_FAIL_RTDB_WRITE === "true") throw new Error("INJECTED_RTDB_FAILURE");
  const url = env.LOCAL_TEST_MODE === "true" ? firebaseOwnerUrl(env, path) : firebaseUrl(env, path);
  const response = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${env.LOCAL_TEST_MODE === "true" ? "owner" : accessToken}`, "If-Match": etag, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (response.status === 412) throw new Error("RTDB_CONFLICT");
  if (!response.ok) throw new Error("Firebase write failed");
  if (env.LOCAL_TEST_MODE === "true" && env.LOCAL_TEST_DROP_AFTER_RTDB_WRITE === "true") throw new Error("INJECTED_ACK_LOSS");
}

async function firebaseGetWithIdToken(env: Env, path: string, idToken: string) {
  const url = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json?auth=" + encodeURIComponent(idToken);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Firebase read failed");
  return response.json();
}

async function verifyAdmin(env: Env, request: Request) {
  const idToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!idToken) throw new Error("AUTH_REQUIRED");
  if (env.LOCAL_TEST_MODE === "true") {
    const allowed = env.LOCAL_TEST_ADMIN_UID ? [env.LOCAL_TEST_ADMIN_UID] : (env.LOCAL_TEST_ADMIN_UIDS || "").split(",").map(value => value.trim()).filter(Boolean);
    const uid = idToken.startsWith("local-admin:") ? idToken.slice("local-admin:".length) : "";
    if (!uid || !allowed.includes(uid)) throw new Error("ADMIN_REQUIRED");
    const record = await firebaseGet(env, "admins/" + encodeURIComponent(uid), "local-test") as { role?: string; active?: boolean } | null;
    if (!record || record.active !== true || !["SUPER_ADMIN", "MANAGER"].includes(record.role || "")) throw new Error("ADMIN_REQUIRED");
    return uid;
  }
  const lookup = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  if (!lookup.ok) throw new Error("AUTH_REQUIRED");
  const account = await lookup.json() as { users?: Array<{ localId?: string; emailVerified?: boolean; providerUserInfo?: Array<{ providerId?: string }> }> };
  const user = account.users?.[0];
  if (!user?.localId || user.emailVerified !== true || !user.providerUserInfo?.some(item => item.providerId === "google.com")) throw new Error("ADMIN_REQUIRED");
  const record = await firebaseGetWithIdToken(env, "admins/" + encodeURIComponent(user.localId), idToken) as { role?: string; active?: boolean } | null;
  if (!record || record.active !== true || !["SUPER_ADMIN", "MANAGER"].includes(record.role || "")) throw new Error("ADMIN_REQUIRED");
  return user.localId;
}

async function readMember(env: Env, memberId: string) {
  const token = await serviceAccessToken(env);
  const appData = await firebaseGet(env, "appData", token) as { members?: Array<Record<string, unknown>>; courses?: Array<Record<string, unknown>>; exercises?: Array<Record<string, unknown>> } | null;
  const member = appData?.members?.find(item => item.id === memberId);
  if (!member) throw new Error("MEMBER_NOT_FOUND");
  return { member, appData, token };
}

function publicMember(member: Record<string, unknown>, appData?: { courses?: Array<Record<string, unknown>>; exercises?: Array<Record<string, unknown>> }) {
  const safe = { ...member };
  delete safe.authUid;
  const rawDays = safe.days;
  if (Array.isArray(rawDays) && appData && rawDays.every(day => typeof day === "string")) {
    const courses = Array.isArray(appData.courses) ? appData.courses : [];
    const exercises = Array.isArray(appData.exercises) ? appData.exercises : [];
    safe.days = rawDays.flatMap(courseId => {
      const course = courses.find(item => item.id === courseId && Array.isArray(item.memberIds) && item.memberIds.includes(member.id));
      if (!course) return [];
      if (Array.isArray(course.days)) return course.days;
      if (!Array.isArray(course.exercises)) return [];
      return [course.exercises.map(exerciseId => exercises.find(item => item.id === exerciseId)).filter(Boolean)];
    });
  }
  return safe;
}

function storedBytes(value: unknown) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return base64ToBytes(value);
  throw new Error("CREDENTIAL_INVALID");
}

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
}

function requestSource(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function sessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodeBase64Url(bytes);
}

async function tokenHash(token: string) {
  return encodeBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

async function rateLimited(env: Env, keys: string[], now: number) {
  const rows = await Promise.all(keys.map(key => env.PIN_DB.prepare("SELECT locked_until FROM pin_attempt_buckets WHERE bucket_key = ?").bind(key).first<{ locked_until: number | null }>()));
  return rows.some(row => (row?.locked_until ?? 0) > now);
}

async function recordRateFailure(env: Env, keys: string[], now: number) {
  for (const key of keys) {
    await env.PIN_DB.prepare("INSERT INTO pin_attempt_buckets (bucket_key, failure_count, locked_until, updated_at) VALUES (?, 1, NULL, ?) ON CONFLICT(bucket_key) DO UPDATE SET failure_count = pin_attempt_buckets.failure_count + 1, locked_until = CASE WHEN pin_attempt_buckets.failure_count + 1 >= 20 THEN ? ELSE pin_attempt_buckets.locked_until END, updated_at = excluded.updated_at").bind(key, new Date(now).toISOString(), now + 15 * 60_000).run();
  }
}

async function clearAccountRateFailure(env: Env, memberId: string, now: number) {
  await env.PIN_DB.prepare("DELETE FROM pin_attempt_buckets WHERE bucket_key = ?").bind(`account:${memberId}`).run();
}

async function createSession(env: Env, memberId: string, now: number) {
  const token = sessionToken();
  const hash = await tokenHash(token);
  await env.PIN_DB.prepare("INSERT INTO member_sessions (session_id, member_id, token_hash, expires_at, revoked_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, NULL, ?, ?)").bind(crypto.randomUUID(), memberId, hash, now + 30 * 60_000, now, now).run();
  return token;
}

async function sessionMember(env: Env, request: Request) {
  const token = bearerToken(request);
  if (!token) throw new Error("AUTH_REQUIRED");
  const row = await env.PIN_DB.prepare("SELECT session_id, member_id, expires_at, revoked_at FROM member_sessions WHERE token_hash = ?").bind(await tokenHash(token)).first<{ session_id: string; member_id: string; expires_at: number; revoked_at: number | null }>();
  const now = Date.now();
  if (!row || row.revoked_at !== null || row.expires_at <= now) throw new Error("SESSION_INVALID");
  await env.PIN_DB.prepare("UPDATE member_sessions SET last_seen_at = ? WHERE session_id = ?").bind(now, row.session_id).run();
  const { member, appData } = await readMember(env, row.member_id);
  if (member.active === false) throw new Error("MEMBER_INACTIVE");
  return { member, appData, sessionId: row.session_id };
}

async function issuePin(env: Env, request: Request) {
  await verifyAdmin(env, request);
  const body = await request.json() as { memberId?: unknown; phone?: unknown };
  if (typeof body.memberId !== "string" || !body.memberId) throw new Error("MEMBER_REQUIRED");
  const { member } = await readMember(env, body.memberId);
  const phone = normalizePhone(body.phone ?? member.phone);
  const memberPhone = normalizePhone(member.phone);
  if (phone !== memberPhone) throw new Error("PHONE_MEMBER_MISMATCH");
  if (member.active === false) throw new Error("MEMBER_INACTIVE");
  const pin = randomPin();
  const credential = await hashPin(pin);
  const now = Date.now();
  const firebaseUid = typeof member.authUid === "string" && member.authUid.trim() ? member.authUid : `member:${body.memberId}`;
  const membershipId = typeof member.membershipId === "string" && member.membershipId.trim() ? member.membershipId : body.memberId;
  await env.PIN_DB.prepare("INSERT OR IGNORE INTO member_phone_reservations (reservation_id, phone_e164, member_id, operation_key, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'READY', ?, ?)").bind(crypto.randomUUID(), phone, body.memberId, `legacy-pin-${body.memberId}-${phone}`, Date.now(), Date.now()).run();
  const reservation = await env.PIN_DB.prepare("SELECT member_id, state FROM member_phone_reservations WHERE phone_e164 = ?").bind(phone).first<{ member_id: string; state: string }>();
  if (!reservation || reservation.member_id !== body.memberId || reservation.state !== "READY") throw new Error("MEMBER_SYNC_PENDING");
  const owner = await env.PIN_DB.prepare("SELECT member_id FROM member_credentials WHERE phone_e164 = ?").bind(phone).first<{ member_id: string }>();
  if (owner && owner.member_id !== body.memberId) throw new Error("PHONE_CONFLICT");
  await env.PIN_DB.prepare("INSERT INTO member_credentials (credential_id, member_id, firebase_uid, membership_id, phone_e164, pin_hash, pin_salt, hash_algorithm, hash_iterations, status, failure_count, locked_until, credential_version, created_at, updated_at, last_pin_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PBKDF2-SHA256', ?, 'ACTIVE', 0, NULL, 1, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET phone_e164=excluded.phone_e164, pin_hash=excluded.pin_hash, pin_salt=excluded.pin_salt, hash_algorithm=excluded.hash_algorithm, hash_iterations=excluded.hash_iterations, status='ACTIVE', failure_count=0, locked_until=NULL, credential_version=member_credentials.credential_version + 1, updated_at=excluded.updated_at, last_pin_changed_at=excluded.last_pin_changed_at").bind(crypto.randomUUID(), body.memberId, firebaseUid, membershipId, phone, credential.hash, credential.salt, PBKDF2_ITERATIONS, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString()).run();
  return json({ pin }, 200, cors(env, request.headers.get("origin") || ""));
}

function operationKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(key)) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

async function sha256Text(value: string) {
  return encodeBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function memberIdFrom(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,96}$/.test(value.trim())) throw new Error("MEMBER_ID_INVALID");
  return value.trim();
}

function operationFrom(value: unknown): MemberOperation {
  if (value === "CREATE" || value === "UPDATE" || value === "DELETE") return value;
  throw new Error("MEMBER_OPERATION_INVALID");
}

function memberPayload(value: unknown, memberId: string, operation: MemberOperation): MemberRecord | null {
  if (operation === "DELETE") return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MEMBER_PAYLOAD_INVALID");
  const raw = value as MemberRecord;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 160) throw new Error("MEMBER_NAME_INVALID");
  const phone = raw.phone == null || raw.phone === "" ? undefined : normalizePhone(raw.phone);
  return { ...raw, id: memberId, name, ...(phone ? { phone } : {}), active: raw.active !== false };
}

function sameJson(left: unknown, right: unknown) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.length ? value.map(canonical) : undefined;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0))
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function findIdempotency(env: Env, key: string, actor: string, requestHash: string) {
  const row = await env.PIN_DB.prepare("SELECT actor_uid, request_hash, status, response_json FROM member_idempotency WHERE operation_key = ?").bind(key).first<{ actor_uid: string; request_hash: string; status: string; response_json: string | null }>();
  if (!row) return null;
  if (row.actor_uid !== actor || row.request_hash !== requestHash) throw new Error("IDEMPOTENCY_KEY_REUSE");
  if (row.status === "COMPLETED" && row.response_json) return JSON.parse(row.response_json) as Record<string, unknown>;
  return { pending: true };
}

async function syncMemberOutbox(env: Env, operationKeyValue: string, memberId: string, operation: MemberOperation, payload: MemberRecord | null) {
  const token = await serviceAccessToken(env);
  const current = await firebaseGetWithEtag(env, "appData/members", token);
  const delay = Number(env.LOCAL_TEST_SYNC_DELAY_MS || 0);
  if (env.LOCAL_TEST_MODE === "true" && delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000)));
  const members = Array.isArray(current.value) ? [...current.value] as MemberRecord[] : [];
  const index = members.findIndex(item => item && item.id === memberId);
  if (operation === "CREATE" && index >= 0) {
    if (sameJson(members[index], payload)) {
      await env.PIN_DB.prepare("UPDATE member_outbox SET state = 'SYNCED', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
      await env.PIN_DB.prepare("UPDATE member_phone_reservations SET state = 'READY', updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
      return;
    }
    throw new Error("MEMBER_ALREADY_EXISTS");
  }
  if (operation === "UPDATE" && index < 0) throw new Error("MEMBER_NOT_FOUND");
  if (operation === "UPDATE" && sameJson(members[index], payload)) {
    await env.PIN_DB.prepare("UPDATE member_outbox SET state = 'SYNCED', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
    await env.PIN_DB.prepare("UPDATE member_phone_reservations SET state = 'READY', updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
    return;
  }
  if (operation === "DELETE" && index < 0) {
    await env.PIN_DB.prepare("UPDATE member_outbox SET state = 'SYNCED', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
    await env.PIN_DB.prepare("UPDATE member_phone_reservations SET state = 'RELEASED', updated_at = ? WHERE member_id = ? AND state != 'RELEASED'").bind(Date.now(), memberId).run();
    return;
  }
  if (operation === "DELETE") members.splice(index, 1);
  else if (index < 0) members.push(payload as MemberRecord);
  else members[index] = payload as MemberRecord;
  await firebasePutWithEtag(env, "appData/members", members, token, current.etag);
  await env.PIN_DB.prepare("UPDATE member_outbox SET state = 'SYNCED', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
  if (operation === "DELETE") {
    await env.PIN_DB.prepare("UPDATE member_phone_reservations SET state = 'RELEASED', updated_at = ? WHERE member_id = ? AND state != 'RELEASED'").bind(Date.now(), memberId).run();
  } else {
    await env.PIN_DB.prepare("UPDATE member_phone_reservations SET state = 'READY', updated_at = ? WHERE operation_key = ?").bind(Date.now(), operationKeyValue).run();
    await env.PIN_DB.prepare("UPDATE member_phone_reservations SET state = 'RELEASED', updated_at = ? WHERE member_id = ? AND state = 'READY' AND operation_key != ? AND phone_e164 != COALESCE((SELECT phone_e164 FROM member_phone_reservations WHERE operation_key = ?), '')").bind(Date.now(), memberId, operationKeyValue, operationKeyValue).run();
  }
}

async function memberOperation(env: Env, request: Request) {
  const actor = await verifyAdmin(env, request);
  const key = operationKey(request);
  const body = await request.json() as { operation?: unknown; memberId?: unknown; member?: unknown };
  const operation = operationFrom(body.operation);
  const memberId = memberIdFrom(body.memberId);
  let requestedMember = body.member;
  if (operation === "UPDATE" && requestedMember && typeof requestedMember === "object" && !Array.isArray(requestedMember) && (requestedMember as MemberRecord).phone == null) {
    const current = await readMember(env, memberId);
    requestedMember = { ...current.member, ...(requestedMember as MemberRecord) };
  }
  const payload = memberPayload(requestedMember, memberId, operation);
  const requestHash = await sha256Text(JSON.stringify({ operation, memberId, member: payload }));
  const replay = await findIdempotency(env, key, actor, requestHash);
  if (replay && !replay.pending) return json(replay, 200, cors(env, request.headers.get("origin") || ""));

  const now = Date.now();
  const phone = payload?.phone as string | undefined;
  const existing = operation === "UPDATE" ? await env.PIN_DB.prepare("SELECT phone_e164 FROM member_phone_reservations WHERE member_id = ? AND state != 'RELEASED' ORDER BY updated_at DESC LIMIT 1").bind(memberId).first<{ phone_e164: string }>() : null;
  const reservationPhone = phone || existing?.phone_e164;
  if (operation === "CREATE" && !reservationPhone) throw new Error("PHONE_REQUIRED");
  const reservationOwner = reservationPhone ? await env.PIN_DB.prepare("SELECT member_id FROM member_phone_reservations WHERE phone_e164 = ? AND state != 'RELEASED'").bind(reservationPhone).first<{ member_id: string }>() : null;
  if (operation === "CREATE" && reservationOwner) throw new Error("PHONE_CONFLICT");
  if (reservationOwner && reservationOwner.member_id !== memberId) throw new Error("PHONE_CONFLICT");
  if (reservationPhone) {
    // An update that keeps the same phone reuses the existing reservation.
  }
  if (!replay) {
    await env.PIN_DB.prepare("INSERT OR IGNORE INTO member_idempotency (operation_key, actor_uid, request_hash, member_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?)").bind(key, actor, requestHash, memberId, now, now).run();
    const claimed = await findIdempotency(env, key, actor, requestHash);
    if (claimed && !claimed.pending) return json(claimed, 200, cors(env, request.headers.get("origin") || ""));
    const reservationInsert = operation === "DELETE" || !reservationPhone || reservationOwner ? null : env.PIN_DB.prepare("INSERT OR IGNORE INTO member_phone_reservations (reservation_id, phone_e164, member_id, operation_key, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING_SYNC', ?, ?)").bind(crypto.randomUUID(), reservationPhone, memberId, key, now, now);
    const outbox = env.PIN_DB.prepare("INSERT OR IGNORE INTO member_outbox (outbox_id, operation_key, member_id, operation, payload_json, state, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)").bind(crypto.randomUUID(), key, memberId, operation, JSON.stringify(payload), now, now);
    try {
      await env.PIN_DB.batch([...(reservationInsert ? [reservationInsert] : []), outbox]);
      if (reservationInsert) {
        const claimedReservation = await env.PIN_DB.prepare("SELECT member_id, phone_e164, state FROM member_phone_reservations WHERE operation_key = ?").bind(key).first<{ member_id: string; phone_e164: string; state: string }>();
        if (!claimedReservation || claimedReservation.member_id !== memberId || claimedReservation.phone_e164 !== reservationPhone || claimedReservation.state !== "PENDING_SYNC") throw new Error("PHONE_CONFLICT");
      }
    } catch (error) {
      await env.PIN_DB.prepare("DELETE FROM member_outbox WHERE operation_key = ? AND state = 'PENDING'").bind(key).run();
      await env.PIN_DB.prepare("DELETE FROM member_idempotency WHERE operation_key = ? AND status = 'PENDING'").bind(key).run();
      throw error;
    }
  }
  try {
    if (operation === "DELETE") {
      await syncMemberOutbox(env, key, memberId, operation, null);
    } else {
      await syncMemberOutbox(env, key, memberId, operation, payload);
    }
    const result = { ok: true, operation, memberId, state: "READY" };
    await env.PIN_DB.prepare("UPDATE member_idempotency SET status = 'COMPLETED', response_json = ?, updated_at = ? WHERE operation_key = ?").bind(JSON.stringify(result), Date.now(), key).run();
    return json(result, 200, cors(env, request.headers.get("origin") || ""));
  } catch (error) {
    await env.PIN_DB.prepare("UPDATE member_outbox SET state = 'FAILED', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE operation_key = ?").bind(error instanceof Error ? error.message : "SYNC_FAILED", Date.now(), key).run();
    throw error;
  }
}

async function reconcileMemberOutbox(env: Env, request: Request) {
  await verifyAdmin(env, request);
  const requestedKey = new URL(request.url).searchParams.get("operationKey")?.trim() || "";
  const rows = requestedKey
    ? await env.PIN_DB.prepare("SELECT operation_key, member_id, operation, payload_json FROM member_outbox WHERE operation_key = ? AND state IN ('PENDING', 'FAILED')").bind(requestedKey).all<{ operation_key: string; member_id: string; operation: MemberOperation; payload_json: string }>()
    : await env.PIN_DB.prepare("SELECT operation_key, member_id, operation, payload_json FROM member_outbox WHERE state IN ('PENDING', 'FAILED') ORDER BY updated_at ASC LIMIT 50").all<{ operation_key: string; member_id: string; operation: MemberOperation; payload_json: string }>();
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows.results || []) {
    try {
      const payload = JSON.parse(row.payload_json) as MemberRecord | null;
      await syncMemberOutbox(env, row.operation_key, row.member_id, row.operation, payload);
      const result = { ok: true, operation: row.operation, memberId: row.member_id, state: "READY", operationKey: row.operation_key };
      await env.PIN_DB.prepare("UPDATE member_idempotency SET status = 'COMPLETED', response_json = ?, updated_at = ? WHERE operation_key = ?").bind(JSON.stringify(result), Date.now(), row.operation_key).run();
      results.push(result);
    } catch (error) {
      await env.PIN_DB.prepare("UPDATE member_outbox SET state = 'FAILED', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE operation_key = ?").bind(error instanceof Error ? error.message : "RECONCILE_FAILED", Date.now(), row.operation_key).run();
      results.push({ ok: false, operationKey: row.operation_key, error: error instanceof Error ? error.message : "RECONCILE_FAILED" });
    }
  }
  return json({ ok: true, processed: results.length, results }, 200, cors(env, request.headers.get("origin") || ""));
}

async function memberLogin(env: Env, request: Request) {
  const body = await request.json() as { phone?: unknown; pin?: unknown };
  if (!isPin(body.pin)) return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env, request.headers.get("origin") || ""));
  let phone: string;
  try { phone = normalizePhone(body.phone); } catch { return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env, request.headers.get("origin") || "")); }
  const row = await env.PIN_DB.prepare("SELECT * FROM member_credentials WHERE phone_e164 = ?").bind(phone).first<{ member_id: string; pin_salt: unknown; pin_hash: unknown; failure_count: number; locked_until: number | null; status: string }>();
  const now = Date.now();
  const keys = [`account:${row?.member_id || `phone:${phone}`}`, `source:${requestSource(request)}`];
  if (await rateLimited(env, keys, now)) return json({ error: "بيانات الدخول غير صحيحة" }, 429, cors(env, request.headers.get("origin") || ""));
  if (!row) {
    await recordRateFailure(env, [`source:${requestSource(request)}`], now);
    return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env, request.headers.get("origin") || ""));
  }
  if (row.status !== "ACTIVE" || (row.locked_until ?? 0) > now) return json({ error: "بيانات الدخول غير صحيحة" }, 429, cors(env, request.headers.get("origin") || ""));
  const actual = await derivePin(body.pin, storedBytes(row.pin_salt));
  if (!constantTimeEqual(actual, storedBytes(row.pin_hash))) {
    const update = await env.PIN_DB.prepare("UPDATE member_credentials SET failure_count = failure_count + 1, locked_until = CASE WHEN failure_count + 1 >= 5 THEN ? ELSE locked_until END, updated_at = ? WHERE member_id = ? AND status = 'ACTIVE' AND (locked_until IS NULL OR locked_until <= ?)").bind(now + 15 * 60_000, new Date(now).toISOString(), row.member_id, now).run();
    const current = await env.PIN_DB.prepare("SELECT failure_count, locked_until FROM member_credentials WHERE member_id = ?").bind(row.member_id).first<{ failure_count: number; locked_until: number | null }>();
    const changes = Number(update.meta?.changes || 0);
    const locked = (current?.locked_until ?? 0) > now || (current?.failure_count ?? 0) >= 5;
    await recordRateFailure(env, keys, now);
    return json({ error: "بيانات الدخول غير صحيحة" }, changes === 0 || locked ? 429 : 401, cors(env, request.headers.get("origin") || ""));
  }
  const { member, appData } = await readMember(env, row.member_id);
  if (member.active === false) return json({ error: "العضوية غير فعالة" }, 403, cors(env, request.headers.get("origin") || ""));
  await env.PIN_DB.prepare("UPDATE member_credentials SET failure_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE member_id = ?").bind(new Date(now).toISOString(), new Date(now).toISOString(), row.member_id).run();
  await clearAccountRateFailure(env, row.member_id, now);
  return json({ member: publicMember(member, appData), sessionToken: await createSession(env, row.member_id, now) }, 200, cors(env, request.headers.get("origin") || ""));
}

async function memberMe(env: Env, request: Request) {
  const { member, appData } = await sessionMember(env, request);
  return json({ member: publicMember(member, appData) }, 200, cors(env, request.headers.get("origin") || ""));
}

async function memberLogout(env: Env, request: Request) {
  const token = bearerToken(request);
  if (token) await env.PIN_DB.prepare("UPDATE member_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(Date.now(), await tokenHash(token)).run();
  return json({ ok: true }, 200, cors(env, request.headers.get("origin") || ""));
}

export default {
  async fetch(request: Request, env: Env) {
    const origin = request.headers.get("origin") || "";
    const headers = cors(env, origin);
    if (origin && !allowedOrigins(env).includes(origin)) return json({ error: "CORS_ORIGIN_DENIED" }, 403, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const url = new URL(request.url);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
      if (url.pathname === "/v1/admin/member-pin") return await issuePin(env, request);
      if (url.pathname === "/v1/admin/member") return await memberOperation(env, request);
      if (url.pathname === "/v1/admin/member/reconcile") return await reconcileMemberOutbox(env, request);
      if (url.pathname === "/v1/member/login") return await memberLogin(env, request);
      if (url.pathname === "/v1/member/me") return await memberMe(env, request);
      if (url.pathname === "/v1/member/logout") return await memberLogout(env, request);
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      const code = error instanceof Error ? error.message : "REQUEST_FAILED";
      const status = code === "AUTH_REQUIRED" || code === "SESSION_INVALID" ? 401 : code.endsWith("REQUIRED") || code === "ADMIN_REQUIRED" ? 403 : code === "MEMBER_NOT_FOUND" ? 404 : 400;
      const body: Record<string, unknown> = { error: code === "ADMIN_REQUIRED" ? "صلاحية المدير مطلوبة" : code === "AUTH_REQUIRED" ? "تسجيل الدخول مطلوب" : "تعذر تنفيذ الطلب" };
      if (env.LOCAL_TEST_MODE === "true" && env.LOCAL_TEST_DIAGNOSTICS === "true") body.code = code;
      return json(body, status, headers);
    }
  },
};
