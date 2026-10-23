import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

test('member login uses one generic failure path for unknown and credential failures', async () => {
  const source = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8')
  const login = source.slice(source.indexOf('async function memberLogin'), source.indexOf('async function memberMe'))
  assert.match(login, /const salt = row \? storedBytes\(row\.pin_salt\) : crypto\.getRandomValues\(/)
  assert.match(login, /const actual = await derivePin\(body\.pin, salt\)/)
  assert.match(login, /row\?\.member_id \? `account:\$\{row\.member_id\}` : "unknown:global"/)
  assert.match(login, /if \(limited\) \{\s*return json\(\{ error: "بيانات الدخول غير صحيحة" \}/)
  assert.match(login, /await recordRateFailure\(env, keys, now\)/)
  assert.match(source, /const threshold = key\.startsWith\("account:"\) \? 5 : 20/)
  assert.match(source, /DELETE FROM pin_attempt_buckets WHERE bucket_key IN \(\?, \?\)/)
  assert.doesNotMatch(login, /UPDATE member_credentials SET failure_count = failure_count \+ 1/)
  assert.equal((login.match(/بيانات الدخول غير صحيحة/g) || []).length, 5)
  assert.doesNotMatch(login, /if \(!row\)\s*\{[\s\S]*?return json\(\{ error: "بيانات الدخول غير صحيحة" \}/)
})
