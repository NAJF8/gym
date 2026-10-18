import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth'
import { get, onValue, ref } from 'firebase/database'
import { authPersistenceReady, firebaseAuth, firebaseConfigured, firebaseDatabase, googleProvider } from './firebase'

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
  await authPersistenceReady
  try {
    return await signInWithPopup(firebaseAuth, googleProvider)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/popup-blocked') {
      return signInWithRedirect(firebaseAuth, googleProvider)
    }
    throw error
  }
}

/** Google authentication is shared; authorization remains route-specific in RTDB rules. */
export async function signInMember() {
  if (!firebaseAuth) throw new Error('Firebase غير مهيأ. أضف متغيرات VITE_FIREBASE_* قبل تسجيل الدخول.')
  await authPersistenceReady
  return signInWithPopup(firebaseAuth, googleProvider)
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

export function watchAdminRecord(uid: string, callback: (record: AdminRecord | null) => void, onError?: (error: Error) => void) {
  if (!firebaseDatabase) return () => undefined
  return onValue(ref(firebaseDatabase, `admins/${uid}`), snapshot => {
    callback(snapshot.exists() ? parseAdminRecord(snapshot.val()) : null)
  }, error => onError?.(error instanceof Error ? error : new Error('تعذر التحقق من صلاحيات المدير')))
}

export function authStatusLabel() {
  return firebaseConfigured ? 'Firebase متصل — بانتظار التحقق' : 'Firebase غير مهيأ محلياً'
}
