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

// The Worker contract is versioned and identical across environments.
// Local builds stay fail-closed unless an endpoint is explicitly supplied.
const endpoint = String(import.meta.env.VITE_PIN_SERVICE_ENDPOINT || (import.meta.env.PROD ? 'https://alasas-fit-member-auth.coffee101.workers.dev' : '')).replace(/\/+$/, '')
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
