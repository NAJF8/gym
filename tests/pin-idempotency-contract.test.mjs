import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8')
const client = await readFile(new URL('../src/memberPin.ts', import.meta.url), 'utf8')

test('first PIN issuance is insert-only and repeated issuance is idempotent', () => {
  assert.match(source, /ON CONFLICT\(member_id\) DO NOTHING/)
  assert.match(source, /existing\?\.status === "ACTIVE" && !reset/)
  assert.match(source, /body\.reset === true/)
  assert.match(source, /PHONE_ALREADY_BOUND/)
})

test('client defaults to stable issuance and makes reset explicit', () => {
  assert.match(client, /membershipId = memberId, reset = false/)
  assert.match(client, /إعادة تعيين PIN لإصدار رمز جديد/)
})

test('raw PIN is not persisted by the Worker contract', () => {
  assert.doesNotMatch(source, /INSERT INTO member_credentials[^\n]*pin\s*[,)]/i)
  assert.match(source, /return json\(\{ memberId: identity\.memberId, membershipId: identity\.membershipId, phoneE164: identity\.phoneE164, pin/)
})
