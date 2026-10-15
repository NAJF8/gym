import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { get, onValue, ref } from 'firebase/database'
import { firebaseAuth, firebaseConfigured, firebaseDatabase, googleProvider } from './firebase'

export type AdminRole = 'SUPER_ADMIN' | 'MANAGER'
export type AdminRecord = { role: AdminRole; active: boolean; email?: string; displayName?: string }
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

export async function signOutUser() {
  if (firebaseAuth) await signOut(firebaseAuth)
}

export async function readAdminRecord(uid: string): Promise<AdminRecord | null> {
  if (!firebaseDatabase) return null
  const snapshot = await get(ref(firebaseDatabase, `admins/${uid}`))
  return snapshot.exists() ? parseAdminRecord(snapshot.val()) : null
}

export function watchAdminRecord(uid: string, callback: (record: AdminRecord | null) => void) {
  if (!firebaseDatabase) return () => undefined
  return onValue(ref(firebaseDatabase, `admins/${uid}`), snapshot => {
    callback(snapshot.exists() ? parseAdminRecord(snapshot.val()) : null)
  })
}

export function authStatusLabel() {
  return firebaseConfigured ? 'Firebase متصل — بانتظار التحقق' : 'Firebase غير مهيأ محلياً'
}

