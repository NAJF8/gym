import { readFile } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { get, ref, runTransaction, set, update } from 'firebase/database'

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
      appData: { schemaVersion: 1, membersById: { memberA: { id: 'memberA', name: 'A', version: 1 } }, deletedMemberIds: {} },
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

test('active admins can record and read deletion tombstones; unauthenticated users cannot', async () => {
  const manager = verifiedContext('manager').database()
  await assertSucceeds(get(ref(manager, 'appData/deletedMemberIds')))
  await assertSucceeds(set(ref(manager, 'appData/deletedMemberIds/synthetic-delete-test'), { deletedAt: '2026-10-18T00:00:00.000Z', version: 1 }))
  const marker = await assertSucceeds(get(ref(manager, 'appData/deletedMemberIds/synthetic-delete-test')))
  assert.equal(marker.val().deletedAt, '2026-10-18T00:00:00.000Z')
  await assertFails(get(ref(env.unauthenticatedContext().database(), 'appData/deletedMemberIds/synthetic-delete-test')))
  await assertFails(set(ref(env.unauthenticatedContext().database(), 'appData/deletedMemberIds/unauthorized-test'), { deletedAt: 'now', version: 1 }))
  await assertFails(get(ref(env.unauthenticatedContext().database(), 'appData/deletedMemberIds')))
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
  await assertSucceeds(set(ref(adminSession, 'appData/membersById/sync-marker'), { id: 'sync-marker', name: 'emulator-sync-ok', version: 1 }))
  const snapshot = await assertSucceeds(get(ref(secondSession, 'appData/membersById/sync-marker')))
  assert.equal(snapshot.val().name, 'emulator-sync-ok')
})

test('MANAGER can write only scoped print identity fields', async () => {
  const manager = verifiedContext('manager').database()
  const allowed = {
    logo: '/assets/logo.webp',
    printCoachPhotoUrl: 'https://example.test/coach.webp',
    printHallPhotoUrl: '/assets/hall.webp',
    printFooterNote: 'نص ختامي اختباري',
    phone: '+9647800000000',
    instagram: '@alasas.fit',
  }
  await assertSucceeds(update(ref(manager, 'appData/settings'), allowed))
  const saved = await assertSucceeds(get(ref(manager, 'appData/settings')))
  for (const [key, value] of Object.entries(allowed)) assert.equal(saved.val()[key], value)
  await assertFails(set(ref(manager, 'appData/settings/gymName'), 'manager-must-not-change-this'))
  await assertFails(update(ref(manager, 'appData/settings'), { gymName: 'manager-must-not-change-this', logo: '/assets/allowed.webp' }))
  await assertFails(set(ref(manager, 'appData/settings/printFooterNote'), 'x'.repeat(501)))
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

  await assertSucceeds(set(ref(firstSession, 'appData/membersById/synthetic-member-001'), { ...member, version: 1 }))
  await assertSucceeds(set(ref(firstSession, 'appData/membersById/synthetic-member-001'), { ...member, days: [{ title: 'اليوم 1', exercises: [{ id: 'bench-press', sets: 3, reps: '12' }] }], version: 2 }))

  const synced = await assertSucceeds(get(ref(secondSession, 'appData/membersById/synthetic-member-001')))
  assert.deepEqual(synced.val(), {
    ...member,
    version: 2,
    days: [{ title: 'اليوم 1', exercises: [{ id: 'bench-press', sets: 3, reps: '12' }] }],
  })

  const unauthorizedSession = verifiedContext('memberA').database()
  await assertFails(get(ref(unauthorizedSession, 'appData/members/synthetic-member-001')))
})

test('active admins can atomically reserve member phone index while unauthorized users cannot', async () => {
  const manager = verifiedContext('manager').database()
  const phonePath = 'memberPhoneIndex/%2B96478000000888'
  const reservation = await assertSucceeds(runTransaction(ref(manager, phonePath), current => current === null ? 'synthetic-member-phone-001' : undefined))
  assert.equal(reservation.committed, true)
  assert.equal(reservation.snapshot.val(), 'synthetic-member-phone-001')

  const unauthenticated = env.unauthenticatedContext().database()
  await assertFails(runTransaction(ref(unauthenticated, 'memberPhoneIndex/%2B96478000000889'), current => current === null ? 'blocked' : undefined))
  const inactive = verifiedContext('inactive').database()
  await assertFails(runTransaction(ref(inactive, 'memberPhoneIndex/%2B96478000000890'), current => current === null ? 'blocked' : undefined))
})

test('manager can write the same parent array path used by the admin sync bridge', async () => {
  const manager = verifiedContext('manager').database()
  await assertSucceeds(update(ref(manager), {
    'appData/membersById/synthetic-parent-001': { id: 'synthetic-parent-001', name: 'مشترك اختباري', active: true, days: [], version: 1 },
    'publicExercises/bench-press/id': 'bench-press',
    'publicExercises/bench-press/name': 'بنش برس',
    'publicExercises/bench-press/muscle': 'تمارين الصدر',
    'publicExercises/bench-press/sets': 4,
    'publicExercises/bench-press/reps': '8–10',
    'publicExercises/bench-press/rest': '90 ثانية',
    'publicExercises/bench-press/video': '',
  }))
})

test('tombstoned member child writes are rejected while unrelated member writes remain allowed', async () => {
  const manager = verifiedContext('manager').database()
  await assertSucceeds(set(ref(manager, 'appData/membersById/race-target'), { id: 'race-target', name: 'Race target', version: 1 }))
  await assertSucceeds(set(ref(manager, 'appData/membersById/race-other'), { id: 'race-other', name: 'Race other', version: 1 }))
  await assertSucceeds(set(ref(manager, 'appData/deletedMemberIds/race-target'), { deletedAt: '2026-10-18T00:00:00.000Z', version: 1 }))
  await assertFails(set(ref(manager, 'appData/membersById/race-target'), { id: 'race-target', name: 'stale target', version: 2 }))
  await assertSucceeds(set(ref(manager, 'appData/membersById/race-other'), { id: 'race-other', name: 'updated other', version: 2 }))
})

test('concurrent member deletions preserve unrelated members and a concurrent create', async () => {
  const first = verifiedContext('manager').database()
  const second = verifiedContext('super').database()
  await assertSucceeds(update(ref(first), {
    'appData/membersById/race-a': { id: 'race-a', name: 'A', version: 1 },
    'appData/membersById/race-b': { id: 'race-b', name: 'B', version: 1 },
    'appData/membersById/race-c': { id: 'race-c', name: 'C', version: 1 },
  }))
  await Promise.all([
    assertSucceeds(set(ref(first, 'appData/deletedMemberIds/race-a'), { deletedAt: '2026-10-18T00:00:01.000Z', version: 1 })),
    assertSucceeds(set(ref(second, 'appData/deletedMemberIds/race-b'), { deletedAt: '2026-10-18T00:00:02.000Z', version: 1 })),
    assertSucceeds(set(ref(first, 'appData/membersById/race-new'), { id: 'race-new', name: 'new', version: 1 })),
  ])
  const before0 = await assertSucceeds(get(ref(first, 'appData/membersById/race-a')))
  const before1 = await assertSucceeds(get(ref(second, 'appData/membersById/race-b')))
  assert.equal(before0.val().id, 'race-a')
  assert.equal(before1.val().id, 'race-b')
  const removals = await Promise.all([
    assertSucceeds(runTransaction(ref(first, 'appData/membersById/race-a'), current => current == null || current?.id === 'race-a' ? null : undefined)),
    assertSucceeds(runTransaction(ref(second, 'appData/membersById/race-b'), current => current == null || current?.id === 'race-b' ? null : undefined)),
  ])
  assert.equal(removals[0].committed, true)
  assert.equal(removals[1].committed, true)
  const final = await assertSucceeds(get(ref(first, 'appData/membersById')))
  const ids = Object.values(final.val() || {}).filter(item => item && ['race-a', 'race-b', 'race-c', 'race-new'].includes(item.id)).map(item => item.id).sort()
  assert.deepEqual(ids, ['race-c', 'race-new'])
})

test('active admin writes enforce bounded member, course, exercise, and tombstone payloads', async () => {
  const db = verifiedContext('manager').database()
  await assertFails(set(ref(db, 'appData/membersById/oversized-member'), {
    id: 'oversized-member', version: 1, name: 'x'.repeat(201),
  }))
  await assertFails(set(ref(db, 'appData/deletedMemberIds/oversized-tombstone'), {
    deletedAt: 'x'.repeat(65), version: 1,
  }))
  await assertFails(set(ref(db, 'appData/exercises/oversized-exercise'), {
    id: 'oversized-exercise', name: 'x'.repeat(201), muscle: 'صدر', sets: 3, reps: '10', rest: '60', video: '',
  }))
  await assertFails(set(ref(db, 'publicExercises/oversized-exercise'), {
    id: 'oversized-exercise', name: 'x'.repeat(201), muscle: 'صدر', sets: 3, reps: '10', rest: '60', video: '',
  }))
})

