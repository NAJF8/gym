import { browserLocalPersistence, onAuthStateChanged, setPersistence, signInWithCustomToken, signInWithPopup, signOut, type User } from 'firebase/auth'
import { get, onValue, ref } from 'firebase/database'
import { firebaseAuth, firebaseConfigured, firebaseDatabase, googleProvider } from './firebase'
import { memberPinApiUrl, normalizeIraqiPhone, validateMemberPin } from './memberAuth'

export type AdminRole = 'SUPER_ADMIN' | 'MANAGER'
export type AdminRecord = { role: AdminRole; active: boolean; email?: string; displayName?: string }
export type SafeAuthDiagnostics = {
  uid: string | null
  providerId: string | null
  emailVerified: boolean | null
  signInProvider: string | null
}
function parseAdminRecord(value: unknown): AdminRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if ((record.role !== 'SUPER_ADMIN' && record.role !== 'MANAGER') || typeof record.active !== 'boolean') return null
  return { role: record.role, active: record.active, email: typeof record.email === 'string' ? record.email : undefined, displayName: typeof record.displayName === 'string' ? record.displayName : undefined }
}

export function watchAuth(callback: (user: User | null) => void) {
  if (!firebaseAuth) return () => undefined
  return onAuthStateChanged(firebaseAuth, callback)
}

export async function signInAdmin() {
  if (!firebaseAuth) throw new Error('Firebase غير مهيأ. أضف متغيرات VITE_FIREBASE_* قبل تسجيل الدخول.')
  return signInWithPopup(firebaseAuth, googleProvider)
}

export async function signInMemberWithPin(phone: string, pin: string) {
  if (!firebaseAuth) throw new Error('Firebase غير مهيأ. أضف إعدادات VITE_FIREBASE_* قبل تسجيل الدخول.')
  if (!memberPinApiUrl) throw new Error('تسجيل الهاتف + PIN غير مفعّل: لم يتم ضبط خدمة التحقق الموثوقة.')
  const normalizedPhone = normalizeIraqiPhone(phone)
  if (!validateMemberPin(pin)) throw new Error('رمز الدخول يجب أن يتكون من 4 أرقام')
  const response = await fetch(`${memberPinApiUrl}/v1/member/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: normalizedPhone, pin }),
  })
  if (!response.ok) throw new Error(response.status === 429 ? 'محاولات كثيرة. حاول لاحقاً.' : 'تعذر تسجيل الدخول بالبيانات المدخلة')
  const payload = await response.json() as { customToken?: unknown }
  if (typeof payload.customToken !== 'string' || !payload.customToken) throw new Error('استجابة خدمة الدخول غير صالحة')
  await setPersistence(firebaseAuth, browserLocalPersistence)
  return signInWithCustomToken(firebaseAuth, payload.customToken)
}

export async function issueMemberPin(input: { phone: string; membershipId: string; memberId: string; reset?: boolean }) {
  if (!memberPinApiUrl) throw new Error('إصدار PIN غير مفعّل: لم يتم ضبط خدمة التحقق الموثوقة.')
  if (!firebaseAuth?.currentUser) throw new Error('يجب تسجيل دخول المدير أولاً')
  const token = await firebaseAuth.currentUser.getIdToken()
  const response = await fetch(`${memberPinApiUrl}/v1/admin/member-pin`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, phone: normalizeIraqiPhone(input.phone) }),
  })
  if (!response.ok) throw new Error('تعذر إصدار PIN من الخدمة الموثوقة')
  const payload = await response.json() as { pin?: unknown }
  if (typeof payload.pin !== 'string' || !validateMemberPin(payload.pin)) throw new Error('استجابة إصدار PIN غير صالحة')
  return payload.pin
}

export async function setMemberLoginEnabled(memberId: string, enabled: boolean) {
  if (!memberPinApiUrl) throw new Error('إدارة دخول الهاتف غير مفعّلة: لم يتم ضبط خدمة التحقق الموثوقة.')
  if (!firebaseAuth?.currentUser) throw new Error('يجب تسجيل دخول المدير أولاً')
  const token = await firebaseAuth.currentUser.getIdToken()
  const response = await fetch(`${memberPinApiUrl}/v1/admin/member-disable`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ memberId, enabled }),
  })
  if (!response.ok) throw new Error('تعذر تغيير حالة دخول المشترك')
}

export async function signOutUser() {
  if (firebaseAuth) await signOut(firebaseAuth)
}

export async function readAdminRecord(uid: string): Promise<AdminRecord | null> {
  if (!firebaseDatabase) return null
  const snapshot = await get(ref(firebaseDatabase, `admins/${uid}`))
  return snapshot.exists() ? parseAdminRecord(snapshot.val()) : null
}

/** Returns claims needed to diagnose Rules decisions without exposing an ID token. */
export async function getSafeAuthDiagnostics(user: User | null): Promise<SafeAuthDiagnostics> {
  if (!user) return { uid: null, providerId: null, emailVerified: null, signInProvider: null }
  const tokenResult = await user.getIdTokenResult()
  return {
    uid: user.uid,
    providerId: user.providerData.find(provider => provider.providerId === 'google.com')?.providerId ?? user.providerData[0]?.providerId ?? null,
    emailVerified: user.emailVerified,
    signInProvider: typeof tokenResult.claims.firebase === 'object' && tokenResult.claims.firebase
      ? String((tokenResult.claims.firebase as { sign_in_provider?: unknown }).sign_in_provider ?? '') || null
      : null,
  }
}

export function watchAdminRecord(uid: string, callback: (record: AdminRecord | null) => void) {
  if (!firebaseDatabase) return () => undefined
  return onValue(ref(firebaseDatabase, `admins/${uid}`), snapshot => {
    callback(snapshot.exists() ? parseAdminRecord(snapshot.val()) : null)
  }, () => callback(null))
}

export function authStatusLabel() {
  return firebaseConfigured ? 'Firebase متصل — بانتظار التحقق' : 'Firebase غير مهيأ محلياً'
}

