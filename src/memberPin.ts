import { firebaseAuth } from './firebase'
import { normalizeIraqiPhone } from './phone'

export type MemberPinProfile = {
  id: string
  membershipId?: string
  name: string
  height: string
  weight: string
  createdAt: string
  expiresAt?: string
  courseName?: string
  notes?: string
  photo?: string
  days: Array<Array<Record<string, unknown>>>
  active?: boolean
  phone?: string
  phoneDisplay?: string
  phoneE164?: string
}

export type PinAuditLogEntry = {
  id: string
  action: string
  actorUid: string
  memberId: string
  credentialVersion: number | null
  createdAt: number
}

// The Worker contract is versioned and identical across environments.
// Local builds stay fail-closed unless an endpoint is explicitly supplied.
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
  const body = await response.json().catch(() => ({})) as { error?: unknown; reason?: unknown }
  if (!response.ok) {
    if (response.status === 429 && path === '/v1/member/login') {
      throw new Error('تم حظر المحاولات مؤقتاً لمدة 15 دقيقة بسبب تكرار المحاولات الخاطئة. يرجى الانتظار أو مراجعة الكابتن.')
    }
    if (response.status === 403 && (body?.reason === 'MEMBER_INACTIVE' || body?.reason === 'MEMBER_DELETED')) {
      if (body.reason === 'MEMBER_DELETED') throw new Error('تم حذف العضوية ولا يمكن استخدامها.')
      throw new Error('العضوية غير فعالة حالياً، يرجى مراجعة إدارة الجيم.')
    }
    throw new Error(typeof body.error === 'string' ? body.error : 'تعذر الاتصال بخدمة PIN الموثوقة')
  }
  return body as T
}

export async function revealMemberPin(memberId: string, candidatePin?: string) {
  const token = await requireFreshAdminToken()
  const result = await request<{ pin: string; credentialVersion?: number; source?: string }>('/v1/admin/member-pin-reveal', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ memberId, ...(candidatePin ? { candidatePin } : {}) }),
  })
  if (!/^\d{4}$/.test(result.pin)) throw new Error('الخدمة أعادت PIN غير صالح')
  return result.pin
}

export async function issueMemberPin(memberId: string, phone: string, membershipId = memberId, reset = false, customPin?: string) {
  const normalizedPhone = normalizeIraqiPhone(phone)
  const token = await requireFreshAdminToken()
  const result = await request<{ memberId?: string; membershipId?: string; phoneE164?: string; pin: string | null; existing?: boolean; hasCipher?: boolean; credentialVersion?: number }>('/v1/admin/member-pin', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ memberId, membershipId, phone: normalizedPhone, reset, ...(customPin ? { customPin } : {}) }),
  })
  if (result.memberId && result.memberId !== memberId) throw new Error('خدمة PIN أعادت هوية مشترك مختلفة؛ لم يتم اعتماد الرمز')
  if (result.phoneE164 && result.phoneE164 !== normalizedPhone) throw new Error('خدمة PIN أعادت رقماً مختلفاً؛ لم يتم اعتماد الرمز')
  if (result.existing || result.pin === null) {
    if (result.hasCipher) return await revealMemberPin(memberId)
    throw new Error('يوجد PIN ثابت لهذا المشترك. استخدم إعادة تعيين PIN لإصدار رمز جديد؛ لا يمكن كشف الرمز القديم لأنه محفوظ كـHash فقط.')
  }
  if (!/^\d{4}$/.test(result.pin)) throw new Error('الخدمة أعادت PIN غير صالح')
  return result.pin
}

export async function fetchPinAuditLogs() {
  const token = await requireFreshAdminToken()
  const result = await request<{ logs?: PinAuditLogEntry[] }>('/v1/admin/pin-audit-logs', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  })
  return Array.isArray(result.logs) ? result.logs : []
}

export async function revokeMemberAccess(memberId: string) {
  const token = await requireFreshAdminToken()
  await request<{ ok: true; access: 'revoked' }>('/v1/admin/member-revoke', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ memberId }),
  })
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

export async function fetchMemberSession(sessionToken: string) {
  if (!sessionToken) throw new Error('جلسة المشترك غير صالحة')
  const result = await request<{ member?: MemberPinProfile }>('/v1/member/me', {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({}),
  })
  if (!result.member || result.member.active === false) throw new Error('جلسة المشترك منتهية أو غير صالحة')
  return result.member
}

export async function revokeMemberSession(sessionToken: string) {
  if (!sessionToken) return
  await request('/v1/member/logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` },
  })
}
