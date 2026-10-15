import { get, onValue, ref, set, type Unsubscribe } from 'firebase/database'
import { firebaseDatabase } from './firebase'

export type SyncPayload<TSettings, TExercise, TMember, TCourse> = {
  schemaVersion: 1
  settings: TSettings
  exercises: TExercise[]
  members: TMember[]
  courses: TCourse[]
  migratedAt?: string
}

export function dedupeById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.map(item => [item.id, item])).values()]
}

export function backupLocalSnapshot<T>(payload: T) {
  const key = `alasas-local-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
  localStorage.setItem(key, JSON.stringify(payload))
  return key
}

export function watchAdminData<T>(callback: (value: T | null) => void): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) return () => undefined
  return onValue(ref(firebaseDatabase, 'appData'), snapshot => {
    callback(snapshot.exists() ? snapshot.val() as T : null)
  })
}

export async function readAdminData<T>() {
  if (!firebaseDatabase) return null
  const snapshot = await get(ref(firebaseDatabase, 'appData'))
  return snapshot.exists() ? snapshot.val() as T : null
}

export async function writeAdminData<T>(payload: T) {
  if (!firebaseDatabase) throw new Error('Firebase RTDB غير مهيأ')
  await set(ref(firebaseDatabase, 'appData'), payload)
}

