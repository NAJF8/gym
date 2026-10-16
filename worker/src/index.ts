import { base64ToBytes, constantTimeEqual, derivePin, hashPin, isPin, normalizePhone, randomPin, PBKDF2_ITERATIONS } from "./crypto";

interface Env {
  PIN_DB: D1Database;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  CORS_ORIGIN: string;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function cors(env: Env) {
  return { "access-control-allow-origin": env.CORS_ORIGIN, "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" };
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
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encodeBase64Url(JSON.stringify({ iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/firebase.database", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + claim));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + header + "." + claim + "." + encodeBase64Url(signature) });
  if (!response.ok) throw new Error("Firebase service authentication failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Firebase service token missing");
  return body.access_token;
}

async function firebaseGet(env: Env, path: string, accessToken: string) {
  const url = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json?access_token=" + encodeURIComponent(accessToken);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Firebase read failed");
  return response.json();
}

async function verifyAdmin(env: Env, request: Request) {
  const idToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!idToken) throw new Error("AUTH_REQUIRED");
  const lookup = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  if (!lookup.ok) throw new Error("AUTH_REQUIRED");
  const account = await lookup.json() as { users?: Array<{ localId?: string; emailVerified?: boolean; providerUserInfo?: Array<{ providerId?: string }> }> };
  const user = account.users?.[0];
  if (!user?.localId || user.emailVerified !== true || !user.providerUserInfo?.some(item => item.providerId === "google.com")) throw new Error("ADMIN_REQUIRED");
  const record = await firebaseGet(env, "admins/" + encodeURIComponent(user.localId), idToken) as { role?: string; active?: boolean } | null;
  if (!record || record.active !== true || !["SUPER_ADMIN", "MANAGER"].includes(record.role || "")) throw new Error("ADMIN_REQUIRED");
  return user.localId;
}

async function readMember(env: Env, memberId: string) {
  const token = await serviceAccessToken(env);
  const appData = await firebaseGet(env, "appData", token) as { members?: Array<Record<string, unknown>> } | null;
  const member = appData?.members?.find(item => item.id === memberId);
  if (!member) throw new Error("MEMBER_NOT_FOUND");
  return { member, token };
}

function publicMember(member: Record<string, unknown>) {
  const safe = { ...member };
  delete safe.authUid;
  return safe;
}

function storedBytes(value: unknown) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return base64ToBytes(value);
  throw new Error("CREDENTIAL_INVALID");
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
  return json({ pin }, 200, cors(env));
}

async function memberLogin(env: Env, request: Request) {
  const body = await request.json() as { phone?: unknown; pin?: unknown };
  if (!isPin(body.pin)) return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env));
  let phone: string;
  try { phone = normalizePhone(body.phone); } catch { return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env)); }
  const row = await env.PIN_DB.prepare("SELECT * FROM member_credentials WHERE phone_e164 = ?").bind(phone).first<{ member_id: string; pin_salt: unknown; pin_hash: unknown; failure_count: number; locked_until: number | null; status: string }>();
  const now = Date.now();
  if (!row || row.status !== "ACTIVE" || (row.locked_until ?? 0) > now) return json({ error: "بيانات الدخول غير صحيحة" }, row?.locked_until ? 429 : 401, cors(env));
  const actual = await derivePin(body.pin, storedBytes(row.pin_salt));
  if (!constantTimeEqual(actual, storedBytes(row.pin_hash))) {
    const attempts = row.failure_count + 1;
    await env.PIN_DB.prepare("UPDATE member_credentials SET failure_count = ?, locked_until = ?, updated_at = ? WHERE member_id = ?").bind(attempts, attempts >= 5 ? now + 15 * 60_000 : null, new Date(now).toISOString(), row.member_id).run();
    return json({ error: "بيانات الدخول غير صحيحة" }, attempts >= 5 ? 429 : 401, cors(env));
  }
  const { member } = await readMember(env, row.member_id);
  if (member.active === false) return json({ error: "العضوية غير فعالة" }, 403, cors(env));
  await env.PIN_DB.prepare("UPDATE member_credentials SET failure_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE member_id = ?").bind(new Date(now).toISOString(), new Date(now).toISOString(), row.member_id).run();
  return json({ member: publicMember(member) }, 200, cors(env));
}

export default {
  async fetch(request: Request, env: Env) {
    const headers = cors(env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const url = new URL(request.url);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
      if (url.pathname === "/api/admin/members/pin") return issuePin(env, request);
      if (url.pathname === "/api/member/login") return memberLogin(env, request);
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      const code = error instanceof Error ? error.message : "REQUEST_FAILED";
      const status = code === "AUTH_REQUIRED" ? 401 : code.endsWith("REQUIRED") || code === "ADMIN_REQUIRED" ? 403 : code === "MEMBER_NOT_FOUND" ? 404 : 400;
      return json({ error: code === "ADMIN_REQUIRED" ? "صلاحية المدير مطلوبة" : code === "AUTH_REQUIRED" ? "تسجيل الدخول مطلوب" : "تعذر تنفيذ الطلب" }, status, headers);
    }
  },
};
