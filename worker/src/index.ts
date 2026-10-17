import { base64ToBytes, constantTimeEqual, derivePin, hashPin, isPin, normalizePhone, randomPin, PBKDF2_ITERATIONS } from "./crypto";

interface Env {
  PIN_DB: D1Database;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  CORS_ORIGIN?: string;
  CORS_ORIGINS?: string;
  AUTH_DIAGNOSTICS?: string;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function allowedOrigins(env: Env) {
  return (env.CORS_ORIGINS || env.CORS_ORIGIN || "").split(",").map(origin => origin.trim()).filter(Boolean);
}

function firebaseProject(env: Env) {
  try {
    const host = new URL(env.FIREBASE_DATABASE_URL).hostname;
    return host.replace(/-default-rtdb\.firebaseio\.com$/i, "").replace(/\.firebaseio\.com$/i, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function authDiagnostics(env: Env, values: { authorizationPresent: boolean; tokenAcquired: boolean; lookupHttpStatus: number | null; authFailureStage: string }) {
  console.log(JSON.stringify({
    authorization_present: values.authorizationPresent,
    token_acquired: values.tokenAcquired,
    firebase_project: firebaseProject(env),
    lookup_http_status: values.lookupHttpStatus,
    auth_failure_stage: values.authFailureStage,
  }));
}

function cors(env: Env, requestOrigin = "") {
  const origins = allowedOrigins(env);
  const allowOrigin = requestOrigin && origins.includes(requestOrigin) ? requestOrigin : (origins[0] || "");
  return { "access-control-allow-origin": allowOrigin, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" };
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
  const now = Math.floor(Date.now() / 1000);
  let serviceAccount: { client_email?: string; private_key?: string } = {};
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as typeof serviceAccount; } catch { throw new Error("Firebase service authentication failed"); }
  }
  const serviceEmail = serviceAccount.client_email || env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = serviceAccount.private_key || env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!serviceEmail || !privateKey) throw new Error("Firebase service authentication failed");
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encodeBase64Url(JSON.stringify({ iss: serviceEmail, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claim));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + header + "." + claim + "." + encodeBase64Url(signature) });
  if (!response.ok) throw new Error("Firebase service authentication failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Firebase service token missing");
  return body.access_token;
}

async function firebaseGet(env: Env, path: string, accessToken: string) {
  const url = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json";
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Firebase read failed");
  return response.json();
}

async function firebaseGetWithIdToken(env: Env, path: string, idToken: string) {
  const url = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json?auth=" + encodeURIComponent(idToken);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Firebase read failed");
  return response.json();
}

async function verifyAdmin(env: Env, request: Request) {
  const authorization = request.headers.get("authorization");
  const idToken = authorization?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!idToken) {
    authDiagnostics(env, { authorizationPresent: Boolean(authorization), tokenAcquired: false, lookupHttpStatus: null, authFailureStage: authorization ? "bearer_missing" : "authorization_missing" });
    throw new Error("AUTH_REQUIRED:" + (authorization ? "bearer_missing" : "authorization_missing"));
  }
  const lookup = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  if (!lookup.ok) {
    let failureStage = "identity_lookup_failed";
    try {
      const errorBody = await lookup.clone().json() as { error?: { message?: string; status?: string } };
      const marker = `${errorBody.error?.status || ""}:${errorBody.error?.message || ""}`.toUpperCase();
      if (marker.includes("INVALID_ID_TOKEN")) failureStage = "token_invalid";
      else if (marker.includes("API_KEY_INVALID") || marker.includes("API_KEY_NOT_VALID")) failureStage = "api_key_mismatch";
      else if (marker.includes("SERVICE_DISABLED") || marker.includes("PERMISSION_DENIED")) failureStage = "identity_toolkit_disabled_or_permission";
    } catch { /* Keep the generic stage without logging provider response data. */ }
    authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: failureStage });
    throw new Error("AUTH_REQUIRED:" + failureStage);
  }
  const account = await lookup.json() as { users?: Array<{ localId?: string; emailVerified?: boolean; providerUserInfo?: Array<{ providerId?: string }> }> };
  const user = account.users?.[0];
  if (!user?.localId || user.emailVerified !== true || !user.providerUserInfo?.some(item => item.providerId === "google.com")) {
    authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: "identity_claims_not_admin_eligible" });
    throw new Error("ADMIN_REQUIRED");
  }
  const record = await firebaseGetWithIdToken(env, "admins/" + encodeURIComponent(user.localId), idToken) as { role?: string; active?: boolean } | null;
  if (!record || record.active !== true || !["SUPER_ADMIN", "MANAGER"].includes(record.role || "")) {
    authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: "admin_record_missing_or_inactive_or_role" });
    throw new Error("ADMIN_REQUIRED");
  }
  authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: "success" });
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
  if (member.active === false) throw new Error("MEMBER_INACTIVE");
  const pin = randomPin();
  const credential = await hashPin(pin);
  const now = Date.now();
  const firebaseUid = typeof member.authUid === "string" && member.authUid.trim() ? member.authUid : `member:${body.memberId}`;
  const membershipId = typeof member.membershipId === "string" && member.membershipId.trim() ? member.membershipId : body.memberId;
  await env.PIN_DB.prepare("INSERT INTO member_credentials (credential_id, member_id, firebase_uid, membership_id, phone_e164, pin_hash, pin_salt, hash_algorithm, hash_iterations, status, failure_count, locked_until, credential_version, created_at, updated_at, last_pin_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PBKDF2-SHA256', ?, 'ACTIVE', 0, NULL, 1, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET phone_e164=excluded.phone_e164, pin_hash=excluded.pin_hash, pin_salt=excluded.pin_salt, hash_algorithm=excluded.hash_algorithm, hash_iterations=excluded.hash_iterations, status='ACTIVE', failure_count=0, locked_until=NULL, credential_version=member_credentials.credential_version + 1, updated_at=excluded.updated_at, last_pin_changed_at=excluded.last_pin_changed_at").bind(crypto.randomUUID(), body.memberId, firebaseUid, membershipId, phone, credential.hash, credential.salt, PBKDF2_ITERATIONS, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString()).run();
  return json({ pin }, 200, cors(env, request.headers.get("origin") || ""));
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
    const attempts = row.failure_count + 1;
    await env.PIN_DB.prepare("UPDATE member_credentials SET failure_count = ?, locked_until = ?, updated_at = ? WHERE member_id = ?").bind(attempts, attempts >= 5 ? now + 15 * 60_000 : null, new Date(now).toISOString(), row.member_id).run();
    await recordRateFailure(env, keys, now);
    return json({ error: "بيانات الدخول غير صحيحة" }, attempts >= 5 ? 429 : 401, cors(env, request.headers.get("origin") || ""));
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
      if (url.pathname === "/v1/member/login") return await memberLogin(env, request);
      if (url.pathname === "/v1/member/me") return await memberMe(env, request);
      if (url.pathname === "/v1/member/logout") return await memberLogout(env, request);
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      const code = error instanceof Error ? error.message : "REQUEST_FAILED";
      const authStage = code.startsWith("AUTH_REQUIRED:") ? code.slice("AUTH_REQUIRED:".length) : "";
      const authRequired = code === "AUTH_REQUIRED" || Boolean(authStage);
      const status = authRequired || code === "SESSION_INVALID" ? 401 : code.endsWith("REQUIRED") || code === "ADMIN_REQUIRED" ? 403 : code === "MEMBER_NOT_FOUND" ? 404 : 400;
      const body: Record<string, unknown> = { error: code === "ADMIN_REQUIRED" ? "صلاحية المدير مطلوبة" : authRequired ? "تسجيل الدخول مطلوب" : "تعذر تنفيذ الطلب" };
      if (env.AUTH_DIAGNOSTICS === "true" && authStage) body.auth_failure_stage = authStage;
      return json(body, status, headers);
    }
  },
};
