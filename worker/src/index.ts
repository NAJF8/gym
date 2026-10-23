import { base64ToBytes, constantTimeEqual, decryptPin, derivePin, encryptPin, hashPin, isPin, normalizePhone, randomPin, PBKDF2_ITERATIONS } from "./crypto.ts";
import { applyInvitation, claimLatestInvitation, createInvitation, expireInvitation, normalizeInvitationEmail } from "./invitations.ts";

interface Env {
  PIN_DB: D1Database;
  FIREBASE_DATABASE_URL: string;
  FIREBASE_WEB_API_KEY: string;
  PIN_PEPPER?: string;
  PIN_ENCRYPTION_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  LOCAL_EMULATOR_ONLY?: string;
  FIREBASE_SERVICE_ACCESS_TOKEN?: string;
  FIREBASE_IDENTITY_TOOLKIT_URL?: string;
  FIREBASE_OAUTH_TOKEN_URL?: string;
  FIREBASE_DATABASE_NAMESPACE?: string;
  CORS_ORIGIN?: string;
  CORS_ORIGINS?: string;
  AUTH_DIAGNOSTICS?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  STAGING_IMAGE_BASE_URL?: string;
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

function localEmulator(env: Env) {
  return env.LOCAL_EMULATOR_ONLY === "true";
}

function identityToolkitLookupUrl(env: Env) {
  return localEmulator(env) && env.FIREBASE_IDENTITY_TOOLKIT_URL
    ? env.FIREBASE_IDENTITY_TOOLKIT_URL
    : "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
}

function firebaseUrl(env: Env, path: string, query = "") {
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + ".json";
  const localNamespace = localEmulator(env) && env.FIREBASE_DATABASE_NAMESPACE
    ? `ns=${encodeURIComponent(env.FIREBASE_DATABASE_NAMESPACE)}`
    : "";
  return base + (localNamespace || query ? `?${[localNamespace, query].filter(Boolean).join("&")}` : "");
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
  if (localEmulator(env) && env.FIREBASE_SERVICE_ACCESS_TOKEN) return env.FIREBASE_SERVICE_ACCESS_TOKEN;
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
  const response = await fetch(localEmulator(env) && env.FIREBASE_OAUTH_TOKEN_URL ? env.FIREBASE_OAUTH_TOKEN_URL : "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + header + "." + claim + "." + encodeBase64Url(signature) });
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

async function firebaseWrite(env: Env, path: string, value: unknown, accessToken: string, method: 'PUT' | 'PATCH' = 'PUT') {
  const url = firebaseUrl(env, path);
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error('Firebase write failed');
  return response.json();
}

async function firebaseGetWithIdToken(env: Env, path: string, idToken: string) {
  const url = firebaseUrl(env, path, "auth=" + encodeURIComponent(idToken));
  const response = await fetch(url);
  if (!response.ok) throw new Error("Firebase read failed");
  return response.json();
}

const imageSlots = {
  logo: { prefix: "gym-logo", setting: "logo" },
  coach: { prefix: "coach-photo", setting: "printCoachPhotoUrl" },
  hall: { prefix: "hall-background", setting: "printHallPhotoUrl" },
} as const;

function githubConfig(env: Env) {
  const appId = env.GITHUB_APP_ID?.trim();
  const installationId = env.GITHUB_INSTALLATION_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const owner = env.GITHUB_OWNER?.trim();
  const repo = env.GITHUB_REPO?.trim();
  const branch = env.GITHUB_BRANCH?.trim();
  if (!appId || !installationId || !privateKey || !owner || !repo || !branch)
    throw new Error("GITHUB_UPLOAD_NOT_CONFIGURED");
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(installationId) || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9_.\/-]+$/.test(branch))
    throw new Error("GITHUB_UPLOAD_NOT_CONFIGURED");
  return { appId, installationId, privateKey, owner, repo, branch };
}

async function githubInstallationToken(env: Env) {
  const config = githubConfig(env);
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encodeBase64Url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: config.appId }));
  let keyBytes: Uint8Array;
  try { keyBytes = pemToBytes(config.privateKey); } catch { throw new Error("GITHUB_PRIVATE_KEY_INVALID"); }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch { throw new Error("GITHUB_PRIVATE_KEY_INVALID"); }
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${encodeBase64Url(signature)}`;
  const response = await fetch(`https://api.github.com/app/installations/${config.installationId}/access_tokens`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${jwt}`, "user-agent": "alasas-fit-staging-worker", "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) throw new Error("GITHUB_AUTH_FAILED");
  const body = await response.json() as { token?: string };
  if (!body.token) throw new Error("GITHUB_AUTH_FAILED");
  return { token: body.token, config };
}

async function githubRequest(env: Env, path: string, init: RequestInit = {}) {
  const { token, config } = await githubInstallationToken(env);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "alasas-fit-staging-worker", "x-github-api-version": "2022-11-28", ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.log(JSON.stringify({ github_status: response.status, github_operation: path.split("?")[0] }));
    throw new Error(response.status === 422 ? "GITHUB_BRANCH_PROTECTED" : "GITHUB_API_FAILED");
  }
  return { body: body as Record<string, unknown>, config };
}

function bytesFromBase64(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("IMAGE_CONTENT_INVALID");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function detectedImageType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}

async function imageUploadRateLimit(env: Env, actorUid: string, request: Request) {
  const now = Date.now();
  const cutoff = now - 60_000;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const buckets = [`uid:${actorUid}`, `ip:${ip}`];
  for (const bucket of buckets) {
    await env.PIN_DB.prepare("INSERT INTO image_upload_rate_limits (bucket_key, window_started, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket_key) DO UPDATE SET request_count = CASE WHEN window_started < ? THEN 1 ELSE request_count + 1 END, window_started = CASE WHEN window_started < ? THEN ? ELSE window_started END").bind(bucket, now, cutoff, cutoff, now).run();
    const row = await env.PIN_DB.prepare("SELECT request_count FROM image_upload_rate_limits WHERE bucket_key = ?").bind(bucket).first() as { request_count?: number } | null;
    if (Number(row?.request_count || 0) > 10) throw new Error("IMAGE_UPLOAD_RATE_LIMITED");
  }
}

async function uploadPrintImage(env: Env, request: Request) {
  const actorUid = await verifyAdmin(env, request);
  await imageUploadRateLimit(env, actorUid, request);
  const body = await request.json() as { slot?: unknown; contentType?: unknown; content?: unknown };
  const slot = typeof body.slot === "string" && body.slot in imageSlots ? body.slot as keyof typeof imageSlots : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!slot || !["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new Error("IMAGE_TYPE_INVALID");
  if (content.length > 11_185_000) throw new Error("IMAGE_CONTENT_INVALID");
  const bytes = bytesFromBase64(content);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || detectedImageType(bytes) !== contentType) throw new Error("IMAGE_CONTENT_INVALID");
  const extension = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "webp";
  const config = githubConfig(env);
  const branchInfo = await githubRequest(env, `/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(config.branch)}`);
  if (branchInfo.body.protected === true) throw new Error("GITHUB_BRANCH_PROTECTED");
  const path = `public/uploads/print/${imageSlots[slot].prefix}-${crypto.randomUUID()}.${extension}`;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const upload = await githubRequest(env, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: `chore(staging): upload ${imageSlots[slot].prefix}`, content, branch: config.branch }),
  });
  const commit = typeof upload.body.commit === "object" && upload.body.commit ? upload.body.commit as { sha?: unknown } : {};
  const commitSha = typeof commit.sha === "string" ? commit.sha : "";
  if (!commitSha) throw new Error("GITHUB_COMMIT_MISSING");
  const stored = await githubRequest(env, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`);
  const storedContent = typeof stored.body.content === "string" ? stored.body.content.replace(/\s/g, "") : "";
  if (!storedContent || storedContent !== content) throw new Error("GITHUB_CONTENT_VERIFY_FAILED");
  await env.PIN_DB.prepare("INSERT INTO image_upload_audit (audit_id, actor_uid, slot, path, commit_sha, byte_count, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actorUid, slot, path, commitSha, bytes.length, contentType, Date.now()).run();
  return json({ path, commitSha, setting: imageSlots[slot].setting }, 202, cors(env, request.headers.get("origin") || ""));
}

async function imageDeploymentStatus(env: Env, request: Request) {
  await verifyAdmin(env, request);
  const body = await request.json() as { commitSha?: unknown; path?: unknown };
  const commitSha = typeof body.commitSha === "string" && /^[0-9a-f]{7,64}$/i.test(body.commitSha) ? body.commitSha : "";
  const path = typeof body.path === "string" && /^public\/uploads\/print\/[A-Za-z0-9_.-]+\.(png|jpg|webp)$/.test(body.path) ? body.path : "";
  if (!commitSha || !path) throw new Error("IMAGE_STATUS_INVALID");
  const { token, config } = await githubInstallationToken(env);
  const response = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=20`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "alasas-fit-staging-worker", "x-github-api-version": "2022-11-28" } });
  if (!response.ok) throw new Error("GITHUB_API_FAILED");
  const runs = await response.json() as { workflow_runs?: Array<{ status?: string; conclusion?: string }> };
  const run = runs.workflow_runs?.[0];
  if (!run) return json({ state: "queued" }, 200, cors(env, request.headers.get("origin") || ""));
  if (run.status !== "completed") return json({ state: "running" }, 200, cors(env, request.headers.get("origin") || ""));
  if (run.conclusion !== "success") return json({ state: "failed" }, 200, cors(env, request.headers.get("origin") || ""));
  const base = (env.STAGING_IMAGE_BASE_URL || "https://alasas-fit-staging.web.app").replace(/\/$/, "");
  return json({ state: "deployed", deployedUrl: `${base}/${path.slice("public/".length)}` }, 200, cors(env, request.headers.get("origin") || ""));
}

async function verifyAdmin(env: Env, request: Request) {
  const authorization = request.headers.get("authorization");
  const idToken = authorization?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!idToken) {
    authDiagnostics(env, { authorizationPresent: Boolean(authorization), tokenAcquired: false, lookupHttpStatus: null, authFailureStage: authorization ? "bearer_missing" : "authorization_missing" });
    throw new Error("AUTH_REQUIRED:" + (authorization ? "bearer_missing" : "authorization_missing"));
  }
  const lookup = await fetch(identityToolkitLookupUrl(env) + "?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
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
  const record = await firebaseGetWithIdToken(env, "admins/" + encodeURIComponent(user.localId), idToken) as { role?: string; active?: boolean; invitationId?: unknown } | null;
  if (!record || record.active !== true || !["SUPER_ADMIN", "MANAGER"].includes(record.role || "")) {
    authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: "admin_record_missing_or_inactive_or_role" });
    throw new Error("ADMIN_REQUIRED");
  }
  // Invitation-created admins do not become effective until D1 has recorded
  // the same invitation as APPLIED.  Bootstrap admins have no invitationId.
  if (typeof record.invitationId === "string" && record.invitationId) {
    const applied = await env.PIN_DB.prepare("SELECT 1 FROM admin_invitations WHERE invitation_id = ? AND status = 'APPLIED' AND applied_uid = ?").bind(record.invitationId, user.localId).first();
    if (!applied) {
      authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: "invitation_not_applied" });
      throw new Error("ADMIN_REQUIRED");
    }
  }
  authDiagnostics(env, { authorizationPresent: true, tokenAcquired: true, lookupHttpStatus: lookup.status, authFailureStage: "success" });
  return user.localId;
}

async function verifiedGoogleUser(env: Env, request: Request) {
  const idToken = bearerToken(request);
  if (!idToken) throw new Error('AUTH_REQUIRED');
  const lookup = await fetch(identityToolkitLookupUrl(env) + '?key=' + encodeURIComponent(env.FIREBASE_WEB_API_KEY), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
  if (!lookup.ok) throw new Error('AUTH_REQUIRED');
  const account = await lookup.json() as { users?: Array<{ localId?: string; email?: string; displayName?: string; emailVerified?: boolean; providerUserInfo?: Array<{ providerId?: string }> }> };
  const user = account.users?.[0];
  if (!user?.localId || !user.email || user.emailVerified !== true || !user.providerUserInfo?.some(item => item.providerId === 'google.com')) throw new Error('ADMIN_REQUIRED');
  return { ...user, idToken };
}

async function adminManagement(env: Env, request: Request, action: string) {
  if (action === 'accept') {
    const user = await verifiedGoogleUser(env, request);
    const now = Date.now();
    const email = normalizeInvitationEmail(user.email);
    const invite = await claimLatestInvitation(env.PIN_DB, email, user.localId!, now);
    if (!invite) throw new Error('INVITATION_NOT_FOUND');
    if (invite.expires_at <= now) {
      await expireInvitation(env.PIN_DB, invite, now);
      throw new Error('INVITATION_EXPIRED');
    }
    const token = await serviceAccessToken(env);
    const current = await firebaseGet(env, `admins/${encodeURIComponent(user.localId!)}`, token) as { email?: string; role?: string; active?: boolean } | null;
    if (current) {
      if (current.email === email && current.role === invite.role && current.active === true) {
        // A prior attempt may have completed the Firebase write but failed
        // before D1 recorded APPLIED.  Do not report recovery as successful
        // until the claimed invitation is durably transitioned too.
        if (!await applyInvitation(env.PIN_DB, invite, user.localId!, now))
          throw new Error('INVITATION_APPLY_RETRYABLE');
        return json({ role: invite.role, linked: true, idempotent: true }, 200, cors(env, request.headers.get('origin') || ''));
      }
      await expireInvitation(env.PIN_DB, invite, now);
      throw new Error('EXISTING_ADMIN_PROTECTED');
    }
    await firebaseWrite(env, `admins/${encodeURIComponent(user.localId!)}`, { email, displayName: user.displayName || '', role: invite.role, active: true, invitationId: invite.invitation_id, createdAt: new Date(now).toISOString(), lastLoginAt: new Date(now).toISOString() }, token);
    if (!await applyInvitation(env.PIN_DB, invite, user.localId!, now)) throw new Error('INVITATION_APPLY_RETRYABLE');
    return json({ role: invite.role, linked: true }, 200, cors(env, request.headers.get('origin') || ''));
  }
  const actorUid = await verifyAdmin(env, request);
  const actor = await firebaseGet(env, `admins/${encodeURIComponent(actorUid)}`, await serviceAccessToken(env)) as { role?: string; email?: string } | null;
  if (actor?.role !== 'SUPER_ADMIN') throw new Error('SUPER_ADMIN_REQUIRED');
  const token = await serviceAccessToken(env);
  if (action === 'list') {
    const admins = await firebaseGet(env, 'admins', token) as Record<string, Record<string, unknown>> | null;
    const rows: Array<Record<string, unknown>> = Object.entries(admins || {}).map(([uid, value]) => ({ uid, email: String(value.email || ''), displayName: typeof value.displayName === 'string' ? value.displayName : '', role: value.role, active: value.active === true, status: value.active === true ? 'ACTIVE' : 'DISABLED', createdAt: value.createdAt, lastLoginAt: value.lastLoginAt })).filter(row => row.role === 'MANAGER' || row.role === 'SUPER_ADMIN');
    const invites = await env.PIN_DB.prepare("SELECT email, role, status, created_at AS createdAt FROM admin_invitations WHERE status IN ('PENDING', 'CLAIMED') AND expires_at > ? ORDER BY created_at DESC").bind(Date.now()).all() as { results?: Array<Record<string, unknown>> };
    for (const invite of invites.results || []) rows.push({ email: String(invite.email || ''), displayName: '', role: invite.role, active: false, status: 'PENDING', createdAt: invite.createdAt });
    return json({ admins: rows }, 200, cors(env, request.headers.get('origin') || ''));
  }
  if (action === 'invite') {
    const body = await request.json() as { email?: unknown; role?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role === 'MANAGER' || body.role === 'SUPER_ADMIN' ? body.role : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) throw new Error('INVITATION_INVALID');
    if (email === normalizeInvitationEmail(actor?.email)) throw new Error('SELF_INVITE_FORBIDDEN');
    const existingAdmins = await firebaseGet(env, 'admins', token) as Record<string, { email?: string }> | null;
    if (Object.values(existingAdmins || {}).some(item => normalizeInvitationEmail(item.email) === email)) throw new Error('EXISTING_ADMIN_PROTECTED');
    const invitationId = crypto.randomUUID(); const now = Date.now();
    await createInvitation(env.PIN_DB, { invitationId, email, role, actorUid, now, expiresAt: now + 7 * 24 * 60 * 60 * 1000 });
    return json({ invitationId }, 200, cors(env, request.headers.get('origin') || ''));
  }
  const body = await request.json() as { uid?: unknown; action?: unknown; role?: unknown; active?: unknown };
  if (typeof body.uid !== 'string' || !['role', 'active', 'remove'].includes(String(body.action))) throw new Error('ADMIN_UPDATE_INVALID');
  if (body.uid === actorUid) throw new Error('SELF_CHANGE_FORBIDDEN');
  const target = await firebaseGet(env, `admins/${encodeURIComponent(body.uid)}`, token) as { role?: string; active?: boolean; email?: string } | null;
  if (!target) throw new Error('ADMIN_NOT_FOUND');
  if (target.role === 'SUPER_ADMIN' && (body.action === 'remove' || body.active === false)) {
    const admins = await firebaseGet(env, 'admins', token) as Record<string, { role?: string; active?: boolean }> | null;
    if (Object.values(admins || {}).filter(item => item.role === 'SUPER_ADMIN' && item.active === true).length <= 1) throw new Error('LAST_SUPER_ADMIN');
  }
  const value = body.action === 'remove' ? null : { ...target, ...(body.action === 'role' && (body.role === 'MANAGER' || body.role === 'SUPER_ADMIN') ? { role: body.role } : {}), ...(body.action === 'active' && typeof body.active === 'boolean' ? { active: body.active } : {}) };
  await firebaseWrite(env, `admins/${encodeURIComponent(body.uid)}`, value, token);
  await env.PIN_DB.prepare("INSERT INTO admin_audit_logs (audit_id, action, invitation_id, actor_uid, target_uid, email, role, details, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?)").bind(crypto.randomUUID(), `ADMIN_${String(body.action).toUpperCase()}`, actorUid, body.uid, target.email || null, typeof value?.role === 'string' ? value.role : target.role || null, Date.now()).run();
  return json({ ok: true }, 200, cors(env, request.headers.get('origin') || ''));
}

async function readMember(env: Env, memberId: string) {
  const token = await serviceAccessToken(env);
  const tombstone = await firebaseGet(env, `appData/deletedMemberIds/${encodeURIComponent(memberId)}`, token);
  if (tombstone) throw new Error("MEMBER_DELETED");
  const appData = await firebaseGet(env, "appData", token) as { membersById?: unknown; members?: unknown; courses?: unknown; exercises?: unknown } | null;
  const members = appData?.membersById && typeof appData.membersById === "object"
    ? Object.values(appData.membersById as Record<string, Record<string, unknown>>)
    : Array.isArray(appData?.members)
    ? appData.members
    : appData?.members && typeof appData.members === "object"
      ? Object.values(appData.members as Record<string, Record<string, unknown>>)
      : [];
  const member = members.find(item => item && typeof item === "object" && item.id === memberId) as Record<string, unknown> | undefined;
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

function pinCipherSecret(env: Env) {
  const secret = (env.PIN_ENCRYPTION_KEY || env.PIN_PEPPER || "").trim();
  if (secret) return secret;
  if (localEmulator(env)) return "local-emulator-pin-cipher-secret-v1";
  throw new Error("PIN_CIPHER_KEY_MISSING");
}

async function recordPinAudit(env: Env, action: string, actorUid: string, memberId: string, credentialVersion: number | null) {
  try {
    await env.PIN_DB.prepare(
      "INSERT INTO member_pin_audit_logs (audit_id, action, actor_uid, member_id, credential_version, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), action, actorUid, memberId, credentialVersion, Date.now()).run();
  } catch {
    // Keep backwards compatibility if an in-memory test DB omitted the audit table.
  }
}

async function rateLimited(env: Env, keys: string[], now: number) {
  const rows = await Promise.all(keys.map(key => env.PIN_DB.prepare("SELECT locked_until FROM pin_attempt_buckets WHERE bucket_key = ?").bind(key).first<{ locked_until: number | null }>()));
  return rows.some(row => (row?.locked_until ?? 0) > now);
}

async function recordRateFailure(env: Env, keys: string[], now: number) {
  for (const key of keys) {
    const threshold = key.startsWith("account:") ? 5 : 20;
    await env.PIN_DB.prepare("INSERT INTO pin_attempt_buckets (bucket_key, failure_count, locked_until, updated_at) VALUES (?, 1, NULL, ?) ON CONFLICT(bucket_key) DO UPDATE SET failure_count = CASE WHEN pin_attempt_buckets.locked_until IS NOT NULL AND pin_attempt_buckets.locked_until <= ? THEN 1 ELSE pin_attempt_buckets.failure_count + 1 END, locked_until = CASE WHEN pin_attempt_buckets.locked_until IS NOT NULL AND pin_attempt_buckets.locked_until <= ? THEN NULL WHEN pin_attempt_buckets.failure_count + 1 >= ? THEN ? ELSE pin_attempt_buckets.locked_until END, updated_at = excluded.updated_at").bind(key, new Date(now).toISOString(), now, now, threshold, now + 15 * 60_000).run();
  }
}

async function clearAccountRateFailure(env: Env, memberId: string, now: number) {
  await env.PIN_DB.prepare("DELETE FROM pin_attempt_buckets WHERE bucket_key = ? OR (locked_until IS NOT NULL AND locked_until <= ?)").bind(`account:${memberId}`, now).run();
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
  const actorUid = await verifyAdmin(env, request);
  const body = await request.json() as { memberId?: unknown; phone?: unknown; reset?: unknown; customPin?: unknown };
  if (typeof body.memberId !== "string" || !body.memberId) throw new Error("MEMBER_REQUIRED");
  const { member } = await readMember(env, body.memberId);
  const storedPhone = normalizePhone(member.phoneE164 ?? member.phoneDisplay ?? member.phone);
  const phone = normalizePhone(body.phone ?? storedPhone);
  if (phone !== storedPhone) throw new Error("MEMBER_PHONE_MISMATCH");
  if (member.active === false) throw new Error("MEMBER_INACTIVE");
  const pin = isPin(body.customPin) ? body.customPin : randomPin();
  const credential = await hashPin(pin);
  const pinCipher = await encryptPin(pin, pinCipherSecret(env), body.memberId);
  const now = Date.now();
  const firebaseUid = typeof member.authUid === "string" && member.authUid.trim() ? member.authUid : `member:${body.memberId}`;
  const membershipId = typeof member.membershipId === "string" && member.membershipId.trim() ? member.membershipId : body.memberId;
  const phoneOwner = await env.PIN_DB.prepare("SELECT member_id FROM member_credentials WHERE phone_e164 = ? AND member_id <> ?").bind(phone, body.memberId).first<{ member_id: string }>();
  if (phoneOwner) throw new Error("PHONE_ALREADY_BOUND");
  const reset = body.reset === true;
  const existing = await env.PIN_DB.prepare("SELECT status, credential_version, pin_cipher, phone_e164 FROM member_credentials WHERE member_id = ?").bind(body.memberId).first<{ status: string; credential_version: number; pin_cipher?: string | null; phone_e164?: string }>();
  if (existing?.status === "ACTIVE" && !reset) {
    if (existing.phone_e164 && existing.phone_e164 !== phone) {
      await env.PIN_DB.prepare("UPDATE member_credentials SET phone_e164 = ?, updated_at = ? WHERE member_id = ?").bind(phone, new Date(now).toISOString(), body.memberId).run();
    }
    return json({ pin: null, existing: true, hasCipher: Boolean(existing.pin_cipher), credentialVersion: existing.credential_version }, 200, cors(env, request.headers.get("origin") || ""));
  }
  const statement = "INSERT INTO member_credentials (credential_id, member_id, firebase_uid, membership_id, phone_e164, pin_hash, pin_salt, pin_cipher, hash_algorithm, hash_iterations, status, failure_count, locked_until, credential_version, created_at, updated_at, last_pin_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PBKDF2-SHA256', ?, 'ACTIVE', 0, NULL, 1, ?, ?, ?)";
  const values = [crypto.randomUUID(), body.memberId, firebaseUid, membershipId, phone, credential.hash, credential.salt, pinCipher, PBKDF2_ITERATIONS, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString()] as const;
  if (reset) {
    await env.PIN_DB.prepare(`${statement} ON CONFLICT(member_id) DO UPDATE SET phone_e164=excluded.phone_e164, membership_id=excluded.membership_id, pin_hash=excluded.pin_hash, pin_salt=excluded.pin_salt, pin_cipher=excluded.pin_cipher, hash_algorithm=excluded.hash_algorithm, hash_iterations=excluded.hash_iterations, status='ACTIVE', failure_count=0, locked_until=NULL, credential_version=member_credentials.credential_version + 1, updated_at=excluded.updated_at, last_pin_changed_at=excluded.last_pin_changed_at`).bind(...values).run();
    await env.PIN_DB.prepare("UPDATE member_sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL").bind(now, body.memberId).run();
    await recordPinAudit(env, "PIN_RESET", actorUid, body.memberId, (existing?.credential_version ?? 0) + 1);
  } else {
    const inserted = await env.PIN_DB.prepare(`${statement} ON CONFLICT(member_id) DO NOTHING`).bind(...values).run();
    if (!inserted.meta?.changes) {
      const raced = await env.PIN_DB.prepare("SELECT credential_version, pin_cipher FROM member_credentials WHERE member_id = ? AND status = 'ACTIVE'").bind(body.memberId).first<{ credential_version: number; pin_cipher?: string | null }>();
      return json({ pin: null, existing: true, hasCipher: Boolean(raced?.pin_cipher), credentialVersion: raced?.credential_version ?? 1 }, 200, cors(env, request.headers.get("origin") || ""));
    }
    await recordPinAudit(env, "PIN_ISSUED", actorUid, body.memberId, 1);
  }
  await env.PIN_DB.prepare("DELETE FROM pin_attempt_buckets WHERE bucket_key IN (?, ?)").bind(`account:${body.memberId}`, `phone:${phone}`).run();
  await env.PIN_DB.prepare("DELETE FROM pin_attempt_buckets WHERE bucket_key = ? OR (locked_until IS NOT NULL AND locked_until <= ?)").bind(`source:${requestSource(request)}`, now).run();
  return json({ pin }, 200, cors(env, request.headers.get("origin") || ""));
}

async function revealPin(env: Env, request: Request) {
  const actorUid = await verifyAdmin(env, request);
  const body = await request.json() as { memberId?: unknown; candidatePin?: unknown };
  if (typeof body.memberId !== "string" || !body.memberId) throw new Error("MEMBER_REQUIRED");
  const { member } = await readMember(env, body.memberId);
  if (member.active === false) throw new Error("MEMBER_INACTIVE");
  const storedPhone = normalizePhone(member.phoneE164 ?? member.phoneDisplay ?? member.phone);
  const now = Date.now();
  const row = await env.PIN_DB.prepare("SELECT status, pin_cipher, pin_hash, pin_salt, credential_version, phone_e164 FROM member_credentials WHERE member_id = ?").bind(body.memberId).first<{ status: string; pin_cipher: string | null; pin_hash: unknown; pin_salt: unknown; credential_version: number; phone_e164: string }>();
  if (!row) {
    const phoneOwner = await env.PIN_DB.prepare("SELECT member_id FROM member_credentials WHERE phone_e164 = ? AND member_id <> ?").bind(storedPhone, body.memberId).first<{ member_id: string }>();
    if (phoneOwner) throw new Error("PHONE_ALREADY_BOUND");
    const pin = randomPin();
    const credential = await hashPin(pin);
    const pinCipher = await encryptPin(pin, pinCipherSecret(env), body.memberId);
    const firebaseUid = typeof member.authUid === "string" && member.authUid.trim() ? member.authUid : `member:${body.memberId}`;
    const membershipId = typeof member.membershipId === "string" && member.membershipId.trim() ? member.membershipId : body.memberId;
    await env.PIN_DB.prepare("INSERT INTO member_credentials (credential_id, member_id, firebase_uid, membership_id, phone_e164, pin_hash, pin_salt, pin_cipher, hash_algorithm, hash_iterations, status, failure_count, locked_until, credential_version, created_at, updated_at, last_pin_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PBKDF2-SHA256', ?, 'ACTIVE', 0, NULL, 1, ?, ?, ?) ON CONFLICT(member_id) DO NOTHING").bind(crypto.randomUUID(), body.memberId, firebaseUid, membershipId, storedPhone, credential.hash, credential.salt, pinCipher, PBKDF2_ITERATIONS, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now).toISOString()).run();
    await recordPinAudit(env, "PIN_ISSUED", actorUid, body.memberId, 1);
    await recordPinAudit(env, "PIN_REVEALED", actorUid, body.memberId, 1);
    return json({ pin, credentialVersion: 1, source: "issued" }, 200, cors(env, request.headers.get("origin") || ""));
  }
  if (row.phone_e164 !== storedPhone) {
    const phoneOwner = await env.PIN_DB.prepare("SELECT member_id FROM member_credentials WHERE phone_e164 = ? AND member_id <> ?").bind(storedPhone, body.memberId).first<{ member_id: string }>();
    if (!phoneOwner) {
      await env.PIN_DB.prepare("UPDATE member_credentials SET phone_e164 = ?, updated_at = ? WHERE member_id = ?").bind(storedPhone, new Date(now).toISOString(), body.memberId).run();
    }
  }
  if (row.status !== "ACTIVE") throw new Error("PIN_NOT_ACTIVE");
  if (!row.pin_cipher) {
    if (isPin(body.candidatePin)) {
      const verified = constantTimeEqual(await derivePin(body.candidatePin, storedBytes(row.pin_salt)), storedBytes(row.pin_hash));
      if (verified) {
        const pinCipher = await encryptPin(body.candidatePin, pinCipherSecret(env), body.memberId);
        await env.PIN_DB.prepare("UPDATE member_credentials SET pin_cipher = ?, updated_at = ? WHERE member_id = ?").bind(pinCipher, new Date(now).toISOString(), body.memberId).run();
        await recordPinAudit(env, "PIN_REVEALED", actorUid, body.memberId, row.credential_version);
        return json({ pin: body.candidatePin, credentialVersion: row.credential_version, source: "migrated" }, 200, cors(env, request.headers.get("origin") || ""));
      }
    }
    const newPin = randomPin();
    const credential = await hashPin(newPin);
    const pinCipher = await encryptPin(newPin, pinCipherSecret(env), body.memberId);
    const nextVersion = (row.credential_version ?? 1) + 1;
    await env.PIN_DB.prepare("UPDATE member_credentials SET pin_hash = ?, pin_salt = ?, pin_cipher = ?, hash_algorithm = 'PBKDF2-SHA256', hash_iterations = ?, failure_count = 0, locked_until = NULL, credential_version = ?, updated_at = ?, last_pin_changed_at = ? WHERE member_id = ?").bind(credential.hash, credential.salt, pinCipher, PBKDF2_ITERATIONS, nextVersion, new Date(now).toISOString(), new Date(now).toISOString(), body.memberId).run();
    await recordPinAudit(env, "PIN_RESET", actorUid, body.memberId, nextVersion);
    await recordPinAudit(env, "PIN_REVEALED", actorUid, body.memberId, nextVersion);
    return json({ pin: newPin, credentialVersion: nextVersion, source: "rotated_legacy" }, 200, cors(env, request.headers.get("origin") || ""));
  }
  const pin = await decryptPin(row.pin_cipher, pinCipherSecret(env), body.memberId);
  await recordPinAudit(env, "PIN_REVEALED", actorUid, body.memberId, row.credential_version);
  return json({ pin, credentialVersion: row.credential_version, source: "revealed" }, 200, cors(env, request.headers.get("origin") || ""));
}

async function pinAuditLogs(env: Env, request: Request) {
  await verifyAdmin(env, request);
  try {
    const rows = await env.PIN_DB.prepare("SELECT audit_id AS id, action, actor_uid AS actorUid, member_id AS memberId, credential_version AS credentialVersion, created_at AS createdAt FROM member_pin_audit_logs ORDER BY created_at DESC LIMIT 50").all<{ id: string; action: string; actorUid: string; memberId: string; credentialVersion: number | null; createdAt: number }>();
    return json({ logs: rows.results || [] }, 200, cors(env, request.headers.get("origin") || ""));
  } catch {
    return json({ logs: [] }, 200, cors(env, request.headers.get("origin") || ""));
  }
}

async function memberLogin(env: Env, request: Request) {
  const body = await request.json() as { phone?: unknown; pin?: unknown };
  if (!isPin(body.pin)) return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env, request.headers.get("origin") || ""));
  let phone: string;
  try { phone = normalizePhone(body.phone); } catch { return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env, request.headers.get("origin") || "")); }
  const row = await env.PIN_DB.prepare("SELECT * FROM member_credentials WHERE phone_e164 = ?").bind(phone).first<{ member_id: string; pin_salt: unknown; pin_hash: unknown; failure_count: number; locked_until: number | null; status: string }>();
  const now = Date.now();
  // Known accounts get a five-attempt bucket. Unknown phones share one
  // bounded bucket so arbitrary probes cannot create unbounded D1 rows.
  const keys = [row?.member_id ? `account:${row.member_id}` : "unknown:global", `source:${requestSource(request)}`];
  const limited = await rateLimited(env, keys, now);
  const salt = row ? storedBytes(row.pin_salt) : crypto.getRandomValues(new Uint8Array(16));
  const actual = await derivePin(body.pin, salt);
  const matches = Boolean(row && row.status === "ACTIVE" && (row.locked_until ?? 0) <= now && constantTimeEqual(actual, storedBytes(row.pin_hash)));
  if (limited) {
    return json({ error: "بيانات الدخول غير صحيحة" }, 429, cors(env, request.headers.get("origin") || ""));
  }
  if (!row || !matches) {
    // Keep all failed attempts on the same D1 rate-limit path. The account
    // bucket locks after five failures and the source bucket after twenty;
    // this avoids a member-row write that would be measurably different for
    // known phones while preserving both lockout boundaries.
    await recordRateFailure(env, keys, now);
    return json({ error: "بيانات الدخول غير صحيحة" }, 401, cors(env, request.headers.get("origin") || ""));
  }
  const { member, appData } = await readMember(env, row.member_id);
  if (member.active === false) return json({ error: "بيانات الدخول غير صحيحة", reason: "MEMBER_INACTIVE" }, 403, cors(env, request.headers.get("origin") || ""));
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

async function revokeMember(env: Env, request: Request) {
  const actorUid = await verifyAdmin(env, request);
  const body = await request.json() as { memberId?: unknown };
  if (typeof body.memberId !== "string" || !body.memberId) throw new Error("MEMBER_REQUIRED");
  // Permit retry after RTDB deletion: the tombstone proves this ID belonged to a deleted member.
  const token = await serviceAccessToken(env);
  const tombstone = await firebaseGet(env, `appData/deletedMemberIds/${encodeURIComponent(body.memberId)}`, token);
  if (!tombstone) await readMember(env, body.memberId);
  const now = Date.now();
  await env.PIN_DB.prepare("UPDATE member_credentials SET status = 'DISABLED', credential_version = credential_version + 1, updated_at = ? WHERE member_id = ?").bind(new Date(now).toISOString(), body.memberId).run();
  await env.PIN_DB.prepare("UPDATE member_sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL").bind(now, body.memberId).run();
  await recordPinAudit(env, "PIN_REVOKED", actorUid, body.memberId, null);
  return json({ ok: true, access: "revoked" }, 200, cors(env, request.headers.get("origin") || ""));
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
      if (url.pathname === "/v1/admin/image-upload") return await uploadPrintImage(env, request);
      if (url.pathname === "/v1/admin/image-status") return await imageDeploymentStatus(env, request);
      if (url.pathname === "/v1/admin/member-pin") return await issuePin(env, request);
      if (url.pathname === "/v1/admin/member-pin-reveal") return await revealPin(env, request);
      if (url.pathname === "/v1/admin/pin-audit-logs") return await pinAuditLogs(env, request);
      if (url.pathname === "/v1/admin/member-revoke") return await revokeMember(env, request);
      if (url.pathname.startsWith('/v1/admin/management/')) return await adminManagement(env, request, url.pathname.split('/').pop() || '');
      if (url.pathname === "/v1/member/login") return await memberLogin(env, request);
      if (url.pathname === "/v1/member/me") return await memberMe(env, request);
      if (url.pathname === "/v1/member/logout") return await memberLogout(env, request);
      return json({ error: "Not found" }, 404, headers);
    } catch (error) {
      const code = error instanceof Error ? error.message : "REQUEST_FAILED";
      const authStage = code.startsWith("AUTH_REQUIRED:") ? code.slice("AUTH_REQUIRED:".length) : "";
      const authRequired = code === "AUTH_REQUIRED" || Boolean(authStage);
      const status = authRequired || code === "SESSION_INVALID" ? 401 : code === "IMAGE_UPLOAD_RATE_LIMITED" ? 429 : code === "INVITATION_EXPIRED" ? 410 : code === "EXISTING_ADMIN_PROTECTED" || code === "SELF_INVITE_FORBIDDEN" || code === "PHONE_ALREADY_BOUND" || code === "GITHUB_BRANCH_PROTECTED" || code === "PIN_LEGACY_HASH_ONLY" || code === "PIN_NOT_ACTIVE" ? 409 : code === "INVITATION_APPLY_RETRYABLE" ? 503 : code.endsWith("REQUIRED") || code === "ADMIN_REQUIRED" || code === "MEMBER_DELETED" || code === "MEMBER_INACTIVE" ? 403 : code === "MEMBER_NOT_FOUND" ? 404 : 400;
      const safeClientErrors = new Set(["GITHUB_UPLOAD_NOT_CONFIGURED", "GITHUB_BRANCH_PROTECTED", "IMAGE_TYPE_INVALID", "IMAGE_CONTENT_INVALID", "IMAGE_UPLOAD_RATE_LIMITED", "GITHUB_CONTENT_VERIFY_FAILED", "PIN_LEGACY_HASH_ONLY", "PIN_NOT_ACTIVE", "PHONE_ALREADY_BOUND", "MEMBER_INACTIVE", "MEMBER_DELETED"]);
      const body: Record<string, unknown> = { error: code === "ADMIN_REQUIRED" ? "صلاحية المدير مطلوبة" : authRequired ? "تسجيل الدخول مطلوب" : code === "PIN_LEGACY_HASH_ONLY" ? "الرمز القديم محفوظ كـHash فقط قبل تفعيل التشفير؛ اضغط إعادة تعيين PIN لإصدار رمز جديد" : code === "PIN_NOT_ACTIVE" ? "رمز الدخول غير فعال لهذا المشترك؛ اضغط إعادة تعيين PIN" : code === "PHONE_ALREADY_BOUND" ? "رقم الهاتف مرتبط بمشترك آخر" : safeClientErrors.has(code) ? code : "تعذر تنفيذ الطلب", code };
      if (env.AUTH_DIAGNOSTICS === "true" && authStage) body.auth_failure_stage = authStage;
      return json(body, status, headers);
    }
  },
};
