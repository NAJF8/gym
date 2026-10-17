import { readFile } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { get, ref, set, update } from 'firebase/database'

const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8')
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'gym1-4f1bb'
// The Web SDK obtains this namespace from VITE_FIREBASE_DATABASE_URL. Keep Rules
// tests and privileged fixture seeding in that same namespace rather than the
// Auth project-id namespace.
const databaseNamespace = process.env.FIREBASE_DATABASE_NAMESPACE || `${firebaseProjectId}-default-rtdb`
const emulatorPort = Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT || 9000)
const env = await initializeTestEnvironment({
  projectId: databaseNamespace,
  database: { host: '127.0.0.1', port: emulatorPort, rules },
})
const verifiedContext = uid => env.authenticatedContext(uid, {
  email: `${uid}@example.test`,
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
})
const nonGoogleContext = uid => env.authenticatedContext(uid, {
  email: `${uid}@example.test`,
  email_verified: true,
  firebase: { sign_in_provider: 'password' },
})

before(async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.database()
    await set(ref(db), {
      admins: {
        super: { role: 'SUPER_ADMIN', active: true, email: 'super@example.test' },
        super2: { role: 'SUPER_ADMIN', active: true, email: 'super2@example.test' },
        manager: { role: 'MANAGER', active: true, email: 'manager@example.test' },
        inactive: { role: 'MANAGER', active: false, email: 'inactive@example.test' },
      },
      appData: { schemaVersion: 1, members: { memberA: { name: 'A' } } },
      publicExercises: {
        'bench-press': { id: 'bench-press', name: 'بنش برس', muscle: 'تمارين الصدر', sets: 4, reps: '8–10', rest: '90 ثانية', video: 'https://www.youtube.com/watch?v=old' },
      },
      membersByUid: {
        memberA: { active: true, name: 'A' },
        memberB: { active: true, name: 'B' },
        inactiveMember: { active: false, name: 'X' },
      },
    })
  })
})

after(async () => env.cleanup())

test('unauthenticated users cannot read admin data', async () => {
  assert.rejects(() => get(ref(env.unauthenticatedContext().database(), 'appData')))
})

test('verified non-Google users cannot use admin data', async () => {
  await assertFails(get(ref(nonGoogleContext('manager').database(), 'appData')))
})

test('public exercise projection is readable without member data and writable only by active admins', async () => {
  await assertSucceeds(get(ref(env.unauthenticatedContext().database(), 'publicExercises/bench-press')))
  await assertFails(set(ref(env.unauthenticatedContext().database(), 'publicExercises/bench-press/video'), 'https://www.youtube.com/blocked'))
  await assertSucceeds(set(ref(verifiedContext('manager').database(), 'publicExercises/bench-press'), {
    id: 'bench-press', name: 'بنش برس', muscle: 'تمارين الصدر', sets: 4, reps: '8–10', rest: '90 ثانية', video: 'https://youtu.be/new',
  }))
})

test('public exercise video validation rejects unsafe, encoded, spaced, and unapproved URLs', async () => {
  const db = verifiedContext('manager').database()
  const base = { id: 'unsafe-video', name: 'اختبار', muscle: 'تمارين الصدر', sets: 3, reps: '10', rest: '60 ثانية' }
  for (const video of [
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/secret.txt',
    '//evil.example/video', ' https://www.youtube.com/watch?v=spaces', 'https://www.youtube.com/watch?v=spaces ',
    'https://www.youtube.com/%0Ajavascript:alert(1)', 'HTTPS://www.youtube.com/watch?v=upper',
    'https://youtube.com.evil.example/video', 'https://www.youtube.com:8443/watch?v=port',
  ]) await assertFails(set(ref(db, 'publicExercises/unsafe-video'), { ...base, video }))
  await assertSucceeds(set(ref(db, 'publicExercises/unsafe-video'), { ...base, video: '' }))
  await assertSucceeds(set(ref(db, 'publicExercises/unsafe-video'), { ...base, video: 'https://www.youtube.com/watch?v=safe' }))
})

test('authorized multi-location exercise write is readable back by id', async () => {
  const db = verifiedContext('manager').database()
  const id = 'staging-back-20261017-b'
  const exercise = {
    id,
    name: 'اختبار ظهر 20261017 B',
    muscle: 'تمارين الظهر',
    sets: 3,
    reps: '10–12',
    rest: '60 ثانية',
    video: '',
  }
  await assertSucceeds(update(ref(db), {
    [`appData/exercises/0`]: exercise,
    [`publicExercises/${id}`]: exercise,
  }))
  const appDataExercise = await assertSucceeds(get(ref(db, 'appData/exercises/0')))
  const publicExercise = await assertSucceeds(get(ref(db, `publicExercises/${id}`)))
  assert.equal(appDataExercise.val().id, id)
  assert.equal(publicExercise.val().id, id)
})

test('manager can use appData but cannot modify admin roles', async () => {
  const db = verifiedContext('manager').database()
  await assertSucceeds(get(ref(db, 'appData')))
  await assertFails(set(ref(db, 'admins/another'), { role: 'SUPER_ADMIN', active: true }))
  await assertFails(set(ref(db, 'admins/manager'), { role: 'SUPER_ADMIN', active: true }))
  await assertFails(set(ref(db, 'admins/new-manager'), { role: 'MANAGER', active: true, email: 'new@example.test' }))
})

test('super admin cannot change their own admin record', async () => {
  const db = verifiedContext('super').database()
  await assertFails(set(ref(db, 'admins/super'), { role: 'MANAGER', active: false }))
  await assertFails(set(ref(db, 'admins/another-super'), { role: 'SUPER_ADMIN', active: true }))
  await assertFails(set(ref(db, 'admins/super2'), { role: 'MANAGER', active: true }))
  await assertFails(set(ref(db, 'admins/manager'), { role: 'MANAGER', active: false, email: 'manager@example.test' }))
  await assertFails(set(ref(db, 'admins/manager'), { role: 'MANAGER', active: true, email: 'manager@example.test' }))
})

test('member records are isolated by uid and inactive members are denied', async () => {
  const memberA = verifiedContext('memberA').database()
  const memberB = verifiedContext('memberB').database()
  const inactive = verifiedContext('inactiveMember').database()
  await assertSucceeds(get(ref(memberA, 'membersByUid/memberA')))
  await assertFails(get(ref(memberA, 'membersByUid/memberB')))
  await assertFails(get(ref(inactive, 'membersByUid/inactiveMember')))
  await assertFails(set(ref(memberA, 'membersByUid/memberA/name'), 'changed'))
})

test('only SUPER_ADMIN can change settings while two authorized sessions share member data', async () => {
  const adminSession = verifiedContext('super').database()
  const secondSession = verifiedContext('manager').database()
  await assertSucceeds(set(ref(adminSession, 'appData/settings/gymName'), 'AL ASAS FIT'))
  await assertFails(set(ref(secondSession, 'appData/settings/gymName'), 'blocked'))
  await assertSucceeds(set(ref(adminSession, 'appData/members/syncMarker'), { name: 'emulator-sync-ok' }))
  const snapshot = await assertSucceeds(get(ref(secondSession, 'appData/members/syncMarker')))
  assert.equal(snapshot.val().name, 'emulator-sync-ok')
})

test('member creation and program update sync between two authorized sessions', async () => {
  const firstSession = verifiedContext('super').database()
  const secondSession = verifiedContext('manager').database()
  const member = {
    id: 'synthetic-member-001',
    name: 'مشترك اختباري',
    active: true,
    days: [{ title: 'اليوم 1', exercises: [{ id: 'bench-press', sets: 3, reps: '10' }] }],
  }

  await assertSucceeds(set(ref(firstSession, 'appData/members/synthetic-member-001'), member))
  await assertSucceeds(set(ref(firstSession, 'appData/members/synthetic-member-001/days/0/exercises/0/reps'), '12'))

  const synced = await assertSucceeds(get(ref(secondSession, 'appData/members/synthetic-member-001')))
  assert.deepEqual(synced.val(), {
    ...member,
    days: [{ title: 'اليوم 1', exercises: [{ id: 'bench-press', sets: 3, reps: '12' }] }],
  })

  const unauthorizedSession = verifiedContext('memberA').database()
  await assertFails(get(ref(unauthorizedSession, 'appData/members/synthetic-member-001')))
})

