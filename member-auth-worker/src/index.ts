import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'
import { constantTimeEqual, decodeBytes, derivePinHash, encodeBytes, generatePin, generateSalt, sha256, signFirebaseCustomToken } from './crypto'

interface Env {
  DB: D1Database
  DEPLOYMENT_ENV: 'staging'|'production'
  FIREBASE_PROJECT_ID: string
  FIREBASE_DATABASE_URL: string
  FIREBASE_SERVICE_ACCOUNT_JSON: string
  PIN_PEPPER: string
  PIN_HASH_ITERATIONS?: string
  CUSTOM_TOKEN_TTL_SECONDS?: string
  ALLOWED_ORIGINS?: string
  ALLOWED_ADMIN_PROVIDERS?: string
}

interface ServiceAccount { client_email: string; private_key: string; private_key_id: string; project_id: string }
interface Credential { credential_id: string; member_id: string; firebase_uid: string; membership_id: string; phone_e164: string; pin_hash: string; pin_salt: string; hash_iterations: number; status: 'ACTIVE'|'DISABLED'; failure_count: number; locked_until: number|null; credential_version: number; created_at: string }
interface MemberRecord { id?: string; authUid?: string; membershipId?: string; name?: string; active?: boolean; height?: string; weight?: string; createdAt?: string; photo?: string; days?: unknown[] }
interface AdminRecord { role?: string; active?: boolean }

const GENERIC_LOGIN_ERROR = 'تعذر تسجيل الدخول بالبيانات المدخلة'
const TARGETS = {
  staging: { projectId: 'alasas-fit-staging', databaseHost: 'alasas-fit-staging-default-rtdb.firebaseio.com' },
  production: { projectId: 'gym1-4f1bb', databaseHost: 'gym1-4f1bb-default-rtdb.firebaseio.com' },
} as const
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))
let serviceAccountCache: ServiceAccount | null = null
let googleAccessTokenCache: { token: string; expiresAt: number } | null = null

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
}

function serviceAccount(env: Env) {
  if (!serviceAccountCache) {
    const target = TARGETS[env.DEPLOYMENT_ENV]
    if (!target) throw new Error('invalid deployment environment')
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as Partial<ServiceAccount>
    if (!parsed.client_email || !parsed.private_key || !parsed.private_key_id || !parsed.project_id) throw new Error('invalid service account configuration')
    if (parsed.project_id !== env.FIREBASE_PROJECT_ID || parsed.project_id !== target.projectId || !parsed.client_email.endsWith(`@${target.projectId}.iam.gserviceaccount.com`)) throw new Error('service account project mismatch')
    serviceAccountCache = { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n'), private_key_id: parsed.private_key_id, project_id: parsed.project_id }
  }
  return serviceAccountCache
}

function assertTarget(env: Env) {
  const target = TARGETS[env.DEPLOYMENT_ENV]
  if (!target || env.FIREBASE_PROJECT_ID !== target.projectId) throw new Error('Firebase project mismatch')
  const databaseUrl = new URL(env.FIREBASE_DATABASE_URL)
  if (databaseUrl.protocol !== 'https:' || databaseUrl.hostname !== target.databaseHost || databaseUrl.pathname !== '/') throw new Error('Firebase database mismatch')
}

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  return origin && allowed.includes(origin) ? origin : ''
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = allowedOrigin(request, env)
  return { ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {}), 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS', vary: 'Origin' }
}

function assertAllowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin')
  if (origin && !allowedOrigin(request, env)) throw new Response('origin not allowed', { status: 403 })
}

function allowedAdminProviders(env: Env) {
  return (env.ALLOWED_ADMIN_PROVIDERS || 'google.com').split(',').map(value => value.trim()).filter(Boolean)
}

function withCors(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

function parsePhone(input: unknown) {
  if (typeof input !== 'string') throw new Error('invalid phone')
  let value = input.trim().replace(/[\s()-]/g, '')
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (value.startsWith('+964')) value = value.slice(4)
  if (value.startsWith('964')) value = value.slice(3)
  if (value.startsWith('7')) value = `0${value}`
  if (!/^07\d{9}$/.test(value)) throw new Error('invalid phone')
  return `+964${value.slice(1)}`
}

function parsePin(input: unknown) {
  if (typeof input !== 'string' || !/^\d{4}$/.test(input)) throw new Error('invalid pin')
  return input
}

function nowIso() { return new Date().toISOString() }
function nowSeconds() { return Math.floor(Date.now() / 1000) }
function iterations(env: Env) { return Math.max(100_000, Math.min(300_000, Number(env.PIN_HASH_ITERATIONS || 120_000))) }
function tokenTtl(env: Env) { return Math.max(300, Math.min(900, Number(env.CUSTOM_TOKEN_TTL_SECONDS || 900))) }
function clientIp(request: Request) { return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown' }

async function googleAccessToken(env: Env) {
  if (googleAccessTokenCache && googleAccessTokenCache.expiresAt > Date.now() + 60_000) return googleAccessTokenCache.token
  const account = serviceAccount(env)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id })
    .setIssuer(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(await (await import('jose')).importPKCS8(account.private_key, 'RS256'))
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) })
  if (!response.ok) throw new Error('service account token exchange failed')
  const payload = await response.json() as { access_token?: string; expires_in?: number }
  if (!payload.access_token) throw new Error('service account token missing')
  googleAccessTokenCache = { token: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 }
  return payload.access_token
}

async function firebaseRead<T>(env: Env, path: string): Promise<T | null> {
  const token = await googleAccessToken(env)
  const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path}.json`, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error('firebase read failed')
  const value = await response.json() as T | null
  return value
}

async function firebasePatch(env: Env, path: string, value: unknown) {
  const token = await googleAccessToken(env)
  const response = await fetch(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path}.json`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(value) })
  if (!response.ok) throw new Error('firebase write failed')
}

async function verifyAdmin(request: Request, env: Env) {
  const header = request.headers.get('Authorization') || ''
  if (!header.startsWith('Bearer ')) throw new Response('unauthorized', { status: 401 })
  const token = header.slice(7)
  let verified
  try {
    verified = await jwtVerify(token, jwks, { audience: env.FIREBASE_PROJECT_ID, issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` })
  } catch {
    throw new Response('unauthorized', { status: 401 })
  }
  const payload = verified.payload
  const firebaseClaims = payload.firebase as { sign_in_provider?: unknown } | undefined
  if (payload.email_verified !== true || !allowedAdminProviders(env).includes(String(firebaseClaims?.sign_in_provider || '')) || typeof payload.sub !== 'string') throw new Response('unauthorized', { status: 401 })
  const record = await firebaseRead<AdminRecord>(env, `admins/${encodeURIComponent(payload.sub)}`)
  if (!record?.active || (record.role !== 'SUPER_ADMIN' && record.role !== 'MANAGER')) throw new Response('forbidden', { status: 403 })
  return { uid: payload.sub, role: record.role }
}

async function readBody(request: Request) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > 20_000) throw new Response('payload too large', { status: 413 })
  return await request.json() as Record<string, unknown>
}

async function bucketKey(env: Env, scope: 'phone'|'ip', value: string) { return encodeBytes(await sha256(`${scope}|${value}|${env.PIN_PEPPER}`)) }

async function recordAttempt(env: Env, key: string) {
  const timestamp = nowSeconds()
  const row = await env.DB.prepare(`
    INSERT INTO pin_attempt_buckets(bucket_key,failure_count,locked_until,updated_at)
    VALUES(?,1,NULL,?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      failure_count = CASE
        WHEN pin_attempt_buckets.locked_until IS NOT NULL AND pin_attempt_buckets.locked_until <= excluded.updated_at THEN 1
        ELSE pin_attempt_buckets.failure_count + 1
      END,
      locked_until = CASE
        WHEN (CASE
          WHEN pin_attempt_buckets.locked_until IS NOT NULL AND pin_attempt_buckets.locked_until <= excluded.updated_at THEN 1
          ELSE pin_attempt_buckets.failure_count + 1
        END) >= 5 THEN excluded.updated_at + 900
        ELSE NULL
      END,
      updated_at = excluded.updated_at
    RETURNING failure_count, locked_until
  `).bind(key, timestamp).first<{ failure_count: number; locked_until: number|null }>()
  return { count: Number(row?.failure_count || 0), locked: Boolean(row?.locked_until && row.locked_until > timestamp) }
}

async function clearAttempts(env: Env, key: string) { await env.DB.prepare('DELETE FROM pin_attempt_buckets WHERE bucket_key = ?').bind(key).run() }

async function findCredential(env: Env, phone: string) { return await env.DB.prepare('SELECT * FROM member_credentials WHERE phone_e164 = ?').bind(phone).first<Credential>() }

async function memberUidAndProfile(env: Env, memberId: string) {
  const appData = await firebaseRead<{ members?: MemberRecord[]|Record<string, MemberRecord> }>(env, 'appData')
  const rawMembers = appData?.members
  const member = Array.isArray(rawMembers)
    ? rawMembers.find(item => item.id === memberId)
    : rawMembers && typeof rawMembers === 'object'
      ? rawMembers[memberId]
      : null
  if (!member) throw new Response('member not found', { status: 404 })
  const uid = typeof member.authUid === 'string' && member.authUid ? member.authUid : `member:${memberId}`
  return { uid, member }
}

async function issuePin(env: Env, body: Record<string, unknown>, reset: boolean, request: Request) {
  const memberId = typeof body.memberId === 'string' ? body.memberId : ''
  const membershipId = typeof body.membershipId === 'string' ? body.membershipId.trim() : ''
  const phone = parsePhone(body.phone)
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(memberId) || !membershipId) throw new Response('invalid member', { status: 400 })
  const { uid, member } = await memberUidAndProfile(env, memberId)
  const existing = await env.DB.prepare('SELECT * FROM member_credentials WHERE member_id = ?').bind(memberId).first<Credential>()
  if (existing && !reset) throw new Response('pin already issued; reset explicitly to replace it', { status: 409 })
  const phoneOwner = await findCredential(env, phone)
  if (phoneOwner && phoneOwner.member_id !== memberId) throw new Response('phone already assigned', { status: 409 })
  if (member.membershipId !== membershipId) throw new Response('membership mismatch', { status: 409 })
  let pin = generatePin()
  if (existing) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const oldHash = await derivePinHash(pin, decodeBytes(existing.pin_salt), env.PIN_PEPPER, existing.hash_iterations)
      if (!constantTimeEqual(oldHash, decodeBytes(existing.pin_hash))) break
      pin = generatePin()
    }
  }
  const salt = generateSalt()
  const count = iterations(env)
  const hash = await derivePinHash(pin, salt, env.PIN_PEPPER, count)
  const timestamp = nowIso()
  const credentialId = existing?.credential_id || crypto.randomUUID()
  await env.DB.prepare('INSERT INTO member_credentials(credential_id,member_id,firebase_uid,membership_id,phone_e164,pin_hash,pin_salt,hash_algorithm,hash_iterations,status,failure_count,locked_until,credential_version,created_at,updated_at,last_pin_changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET firebase_uid=excluded.firebase_uid,membership_id=excluded.membership_id,phone_e164=excluded.phone_e164,pin_hash=excluded.pin_hash,pin_salt=excluded.pin_salt,hash_algorithm=excluded.hash_algorithm,hash_iterations=excluded.hash_iterations,status=\'ACTIVE\',failure_count=0,locked_until=NULL,credential_version=member_credentials.credential_version+1,updated_at=excluded.updated_at,last_pin_changed_at=excluded.last_pin_changed_at').bind(credentialId, memberId, uid, membershipId, phone, encodeBytes(hash), encodeBytes(salt), 'PBKDF2-SHA256', count, 'ACTIVE', 0, null, existing?.credential_version || 1, existing?.created_at || timestamp, timestamp, timestamp).run()
  await firebasePatch(env, `membersByUid/${encodeURIComponent(uid)}`, { id: member.id || memberId, membershipId, name: member.name || '', phone, height: member.height || '', weight: member.weight || '', createdAt: member.createdAt || '', photo: member.photo || '', days: member.days || [], active: member.active !== false })
  await clearAttempts(env, await bucketKey(env, 'phone', phone))
  await clearAttempts(env, await bucketKey(env, 'ip', clientIp(request)))
  return { pin, uid }
}

async function login(request: Request, env: Env) {
  const body = await readBody(request)
  let phone: string
  try { phone = parsePhone(body.phone) } catch { return json({ error: GENERIC_LOGIN_ERROR }, 401) }
  const phoneKey = await bucketKey(env, 'phone', phone)
  const ipKey = await bucketKey(env, 'ip', clientIp(request))
  const phoneAttempt = await recordAttempt(env, phoneKey)
  const ipAttempt = await recordAttempt(env, ipKey)
  if (phoneAttempt.locked || ipAttempt.locked) return json({ error: GENERIC_LOGIN_ERROR }, 429)
  const credential = await findCredential(env, phone)
  let valid = false
  if (credential?.status === 'ACTIVE' && (!credential.locked_until || credential.locked_until <= nowSeconds())) {
    try { valid = constantTimeEqual(await derivePinHash(parsePin(body.pin), decodeBytes(credential.pin_salt), env.PIN_PEPPER, credential.hash_iterations), decodeBytes(credential.pin_hash)) } catch { valid = false }
  }
  if (credential && valid) {
    try {
      const profile = await memberUidAndProfile(env, credential.member_id)
      valid = profile.uid === credential.firebase_uid && profile.member.active !== false
    } catch {
      valid = false
    }
  }
  if (!credential || !valid) return json({ error: GENERIC_LOGIN_ERROR }, 401)
  await clearAttempts(env, phoneKey); await clearAttempts(env, ipKey)
  await env.DB.prepare('UPDATE member_credentials SET failure_count=0,locked_until=NULL,last_login_at=?,updated_at=? WHERE credential_id=?').bind(nowIso(), nowIso(), credential.credential_id).run()
  const account = serviceAccount(env)
  const customToken = await signFirebaseCustomToken({ uid: credential.firebase_uid, projectId: env.FIREBASE_PROJECT_ID, serviceAccountEmail: account.client_email, privateKeyId: account.private_key_id, privateKeyPem: account.private_key, ttlSeconds: tokenTtl(env), claims: { uid: credential.firebase_uid, member: true, credentialVersion: credential.credential_version } })
  return json({ customToken })
}

async function disableMember(env: Env, body: Record<string, unknown>) {
  const memberId = typeof body.memberId === 'string' ? body.memberId : ''
  if (!memberId) throw new Response('invalid member', { status: 400 })
  const credential = await env.DB.prepare('SELECT * FROM member_credentials WHERE member_id=?').bind(memberId).first<Credential>()
  if (!credential) throw new Response('not found', { status: 404 })
  const enabled = body.enabled === true
  await env.DB.prepare('UPDATE member_credentials SET status=?,credential_version=credential_version+1,updated_at=? WHERE member_id=?').bind(enabled ? 'ACTIVE' : 'DISABLED', nowIso(), memberId).run()
  const { uid } = await memberUidAndProfile(env, memberId)
  await firebasePatch(env, `membersByUid/${encodeURIComponent(uid)}`, { active: enabled })
  return json({ ok: true, sessionRevocation: 'future-custom-tokens-and-RTDB-active-flag' })
}

async function revokeMemberSessions(env: Env, body: Record<string, unknown>) {
  const memberId = typeof body.memberId === 'string' ? body.memberId : ''
  if (!memberId) throw new Response('invalid member', { status: 400 })
  const result = await env.DB.prepare('UPDATE member_credentials SET credential_version=credential_version+1,updated_at=? WHERE member_id=?').bind(nowIso(), memberId).run()
  if (!result.meta.changes) throw new Response('not found', { status: 404 })
  return json({ ok: true, sessionRevocation: 'future-custom-tokens; existing-firebase-id-tokens-expire-normally' })
}

export default { async fetch(request: Request, env: Env) {
  try {
    assertTarget(env)
    assertAllowedOrigin(request, env)
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env)
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/v1/member/login') return withCors(await login(request, env), request, env)
    if (request.method !== 'POST') return withCors(json({ error: 'not found' }, 404), request, env)
    const admin = await verifyAdmin(request, env)
    const body = await readBody(request)
    if (url.pathname === '/v1/admin/member-pin') return withCors(json(await issuePin(env, body, body.reset === true, request)), request, env)
    if (url.pathname === '/v1/admin/member-disable') return withCors(await disableMember(env, body), request, env)
    if (url.pathname === '/v1/admin/member-revoke-sessions') {
      if (admin.role !== 'SUPER_ADMIN' && admin.role !== 'MANAGER') throw new Response('forbidden', { status: 403 })
      return withCors(await revokeMemberSessions(env, body), request, env)
    }
    return withCors(json({ error: 'not found' }, 404), request, env)
  } catch (error) {
    if (error instanceof Response) return withCors(error, request, env)
    return withCors(json({ error: 'internal error' }, 500), request, env)
  }
} }
