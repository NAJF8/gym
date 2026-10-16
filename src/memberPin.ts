import { firebaseAuth } from './firebase'

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

const endpoint = String(import.meta.env.VITE_PIN_SERVICE_ENDPOINT || '').replace(/\/+$/, '')
export const pinServiceConfigured = /^https:\/\//i.test(endpoint) || /^http:\/\/localhost(?::\d+)?$/i.test(endpoint)

function requireEndpoint() {
  if (!pinServiceConfigured) throw new Error('خدمة PIN الموثوقة غير مهيأة')
  return endpoint
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

export async function issueMemberPin(memberId: string, phone: string) {
  if (!firebaseAuth?.currentUser) throw new Error('يجب تسجيل دخول مدير Google موثّق')
  if (!phone.trim()) throw new Error('أدخل رقم هاتف المشترك أولاً')
  const token = await firebaseAuth.currentUser.getIdToken()
  const result = await request<{ pin: string }>('/api/admin/members/pin', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ memberId, phone }),
  })
  if (!/^\d{4}$/.test(result.pin)) throw new Error('الخدمة أعادت PIN غير صالح')
  return result.pin
}

export async function loginMemberWithPin(phone: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN يجب أن يتكون من 4 أرقام')
  const result = await request<{ member: MemberPinProfile }>('/api/member/login', {
    method: 'POST',
    body: JSON.stringify({ phone, pin }),
  })
  if (!result.member || result.member.active === false) throw new Error('العضوية غير فعالة')
  return result.member
}
