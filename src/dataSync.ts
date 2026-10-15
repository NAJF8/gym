import { get, onValue, ref, update, type Unsubscribe } from 'firebase/database'
import { firebaseDatabase } from './firebase'
import { safeVideoUrl } from './videoUrl'

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

export async function readMemberProfile<T>(uid: string) {
  if (!firebaseDatabase) return null
  const snapshot = await get(ref(firebaseDatabase, `membersByUid/${uid}`))
  return snapshot.exists() ? snapshot.val() as T : null
}

export function watchMemberProfile<T>(uid: string, callback: (value: T | null) => void): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) return () => undefined
  return onValue(ref(firebaseDatabase, `membersByUid/${uid}`), snapshot => {
    callback(snapshot.exists() ? snapshot.val() as T : null)
  })
}

export async function writeAdminData<T>(payload: T) {
  if (!firebaseDatabase) throw new Error('Firebase RTDB غير مهيأ')
  const publicExercises = Array.isArray((payload as { exercises?: unknown }).exercises)
    ? Object.fromEntries((payload as { exercises: Array<Record<string, unknown>> }).exercises.map(exercise => {
      const video = safeVideoUrl(exercise.video)
      if (exercise.video !== undefined && exercise.video !== '' && !video) throw new Error('رابط فيديو غير آمن أو غير معتمد')
      return [exercise.id, {
      id: exercise.id,
      name: exercise.name,
      english: exercise.english || '',
      muscle: exercise.muscle,
      sets: exercise.sets,
      reps: exercise.reps,
      rest: exercise.rest,
      video: video || '',
    }] }))
    : undefined
  const members = Array.isArray((payload as { members?: unknown }).members)
    ? (payload as { members: Array<Record<string, unknown>> }).members
    : []
  const nextMemberProfiles = Object.fromEntries(members
    .filter(member => typeof member.authUid === 'string' && member.authUid.length >= 20)
    .map(member => [member.authUid as string, {
      id: member.id,
      membershipId: member.membershipId || member.id,
      name: member.name,
      height: member.height || '',
      weight: member.weight || '',
      createdAt: member.createdAt || '',
      photo: member.photo || '',
      days: member.days || [],
      active: member.active !== false,
    }]))
  const current = await get(ref(firebaseDatabase, 'appData'))
  const oldMembers = current.exists() && Array.isArray(current.val()?.members) ? current.val().members as Array<Record<string, unknown>> : []
  const removedProfiles = oldMembers
    .map(member => member.authUid)
    .filter((uid): uid is string => typeof uid === 'string' && !(uid in nextMemberProfiles))
  const memberUpdates = Object.fromEntries([
    ...Object.entries(nextMemberProfiles).map(([uid, profile]) => [`membersByUid/${uid}`, profile]),
    ...removedProfiles.map(uid => [`membersByUid/${uid}`, null]),
  ])
  const publicExerciseUpdates = publicExercises
    ? Object.fromEntries(Object.entries(publicExercises).flatMap(([exerciseId, exercise]) =>
      Object.entries(exercise as Record<string, unknown>).map(([field, value]) => [`publicExercises/${exerciseId}/${field}`, value])))
    : {}
  const appData = payload as { schemaVersion?: unknown; settings?: unknown; exercises?: unknown; members?: unknown; courses?: unknown; migratedAt?: unknown }
  await update(ref(firebaseDatabase), {
    'appData/schemaVersion': appData.schemaVersion,
    'appData/settings': appData.settings,
    'appData/exercises': appData.exercises,
    'appData/members': appData.members,
    'appData/courses': appData.courses,
    ...(appData.migratedAt ? { 'appData/migratedAt': appData.migratedAt } : {}),
    ...publicExerciseUpdates,
    ...memberUpdates,
  })
}

export function watchPublicExercise<T>(exerciseId: string, callback: (value: T | null) => void): Unsubscribe | (() => undefined) {
  if (!firebaseDatabase) {
    callback(null)
    return () => undefined
  }
  return onValue(ref(firebaseDatabase, `publicExercises/${exerciseId}`), snapshot => {
    callback(snapshot.exists() ? snapshot.val() as T : null)
  })
}

