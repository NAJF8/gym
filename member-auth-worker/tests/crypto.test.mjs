import test from 'node:test'
import assert from 'node:assert/strict'
import { exportPKCS8, exportSPKI, generateKeyPair, jwtVerify } from 'jose'
import { constantTimeEqual, derivePinHash, generatePin, generateSalt, signFirebaseCustomToken } from '../src/crypto.ts'

test('generates exactly four digits including leading-zero values when produced', () => {
  for (let index = 0; index < 1000; index += 1) assert.match(generatePin(), /^\d{4}$/)
})

test('PBKDF2 hash is salted, peppered, and timing-safe compared', async () => {
  const salt = generateSalt()
  const first = await derivePinHash('0042', salt, 'pepper-a', 100_000)
  const same = await derivePinHash('0042', salt, 'pepper-a', 100_000)
  const wrong = await derivePinHash('0043', salt, 'pepper-a', 100_000)
  assert.equal(constantTimeEqual(first, same), true)
  assert.equal(constantTimeEqual(first, wrong), false)
  assert.equal(constantTimeEqual(first, await derivePinHash('0042', generateSalt(), 'pepper-a', 100_000)), false)
})

test('Firebase Custom Token is signed with the service identity and carries only member claims', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const token = await signFirebaseCustomToken({ uid: 'member:one', projectId: 'gym1-4f1bb', serviceAccountEmail: 'svc@gym1-4f1bb.iam.gserviceaccount.com', privateKeyId: 'test-key', privateKeyPem: await exportPKCS8(privateKey), ttlSeconds: 900, claims: { member: true, credentialVersion: 2 } })
  const verified = await jwtVerify(token, publicKey, { issuer: 'svc@gym1-4f1bb.iam.gserviceaccount.com', audience: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit' })
  assert.deepEqual(verified.payload.uid, 'member:one')
  assert.equal(verified.payload.member, true)
  assert.equal(verified.payload.admin, undefined)
  assert.equal(typeof await exportSPKI(publicKey), 'string')
})
