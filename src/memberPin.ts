import { firebaseAuth } from './firebase'
import { normalizeIraqiPhone } from './phone'

export type MemberPinProfile = {
  id: string
  membershipId?: string
  name: string
  height: string
  weight: string
  createdAt: string
  photo?: string
  days: Array<Array<Record<string, unknown>>>
  active?: boolean
  phone?: string
}

// The endpoint is injected by the chosen environment. A missing value must
// fail closed; Staging must never fall back to a Production Worker.
const endpoint = String(import.meta.env.VITE_PIN_SERVICE_ENDPOINT || '').replace(/\/+$/, '')
export const pinServiceConfigured = /^https:\/\//i.test(endpoint) || /^http:\/\/localhost(?::\d+)?$/i.test(endpoint)

function requireEndpoint() {
  if (!pinServiceConfigured) throw new Error('خدمة PIN الموثوقة غير مهيأة')
  return endpoint
}

async function requireFreshAdminToken() {
  if (!firebaseAuth) throw new Error('Firebase غير مهيأ')
  await firebaseAuth.authStateReady()
  const user = firebaseAuth.currentUser
  if (!user) throw new Error('يجب تسجيل دخول مدير Google موثّق')
  const token = await user.getIdToken(true)
  if (!token) throw new Error('تعذر الحصول على توكن Firebase صالح')
  return token
}

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${requireEndpoint()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'تعذر الاتصال بخدمة PIN الموثوقة')
  return body as T
}

async function requireAdminJson<T>(path: string, body: unknown, idempotencyKey: string) {
  const token = await requireFreshAdminToken()
  return request<T>(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

function newIdempotencyKey() {
  return `member-${crypto.randomUUID()}`
}

export async function issueMemberPin(memberId: string, phone: string, membershipId = memberId, reset = true) {
  const normalizedPhone = normalizeIraqiPhone(phone)
  const token = await requireFreshAdminToken()
  const result = await request<{ pin: string }>('/v1/admin/member-pin', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ memberId, membershipId, phone: normalizedPhone, reset }),
  })
  if (!/^\d{4}$/.test(result.pin)) throw new Error('الخدمة أعادت PIN غير صالح')
  return result.pin
}

export async function saveMemberThroughWorker(member: Record<string, unknown>, operation: 'CREATE' | 'UPDATE') {
  const memberId = typeof member.id === 'string' ? member.id : ''
  if (!memberId) throw new Error('المشترك غير صالح')
  return requireAdminJson<{ ok: true; operation: string; memberId: string; state: string }>('/v1/admin/member', {
    operation,
    memberId,
    member,
  }, newIdempotencyKey())
}

export async function deleteMemberThroughWorker(memberId: string) {
  return requireAdminJson<{ ok: true; operation: string; memberId: string; state: string }>('/v1/admin/member', {
    operation: 'DELETE',
    memberId,
  }, newIdempotencyKey())
}

export async function loginMemberWithPin(phone: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN يجب أن يتكون من 4 أرقام')
  const result = await request<{ member?: MemberPinProfile; sessionToken?: string; customToken?: string }>('/v1/member/login', {
    method: 'POST',
    body: JSON.stringify({ phone: normalizeIraqiPhone(phone), pin }),
  })
  if (result.member?.active === false) throw new Error('العضوية غير فعالة')
  if (!result.sessionToken && !result.customToken) throw new Error('جلسة المشترك غير صالحة')
  return result
}

export async function revokeMemberSession(sessionToken: string) {
  if (!sessionToken) return
  await request('/v1/member/logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` },
  })
}
