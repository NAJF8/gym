import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const atomicFailureSql = "UPDATE member_credentials SET failure_count = failure_count + 1, locked_until = CASE WHEN failure_count + 1 >= 5 THEN ? ELSE locked_until END, updated_at = ? WHERE member_id = ? AND status = 'ACTIVE' AND (locked_until IS NULL OR locked_until <= ?)"

test('atomic PIN lockout caps concurrent failures at five for fifteen minutes', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE member_credentials (member_id TEXT PRIMARY KEY, status TEXT NOT NULL, failure_count INTEGER NOT NULL, locked_until INTEGER, updated_at TEXT NOT NULL); INSERT INTO member_credentials VALUES ('member-1', 'ACTIVE', 0, NULL, '')`)
  const now = Date.now()
  const update = db.prepare(atomicFailureSql)
  const read = db.prepare('SELECT failure_count, locked_until FROM member_credentials WHERE member_id = ?')
  const attempts = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    await Promise.resolve(index)
    const result = update.run(now + 15 * 60_000, new Date(now).toISOString(), 'member-1', now)
    return Number(result.changes)
  }))
  const row = read.get('member-1')
  assert.equal(row.failure_count, 5)
  assert.equal(row.locked_until, now + 15 * 60_000)
  assert.equal(attempts.filter(changes => changes === 1).length, 5)
  assert.equal(attempts.filter(changes => changes === 0).length, 15)

  const afterLock = now + 15 * 60_000
  const unlocked = update.run(afterLock + 15 * 60_000, new Date(afterLock).toISOString(), 'member-1', afterLock)
  assert.equal(Number(unlocked.changes), 1)
  assert.equal(read.get('member-1').failure_count, 6)
  db.close()
})
