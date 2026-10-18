import test from 'node:test'
import assert from 'node:assert/strict'
import { deletedMemberInPayload, filterDeletedMembers } from '../src/memberTombstones.ts'

test('a removed member stays hidden when stale RTDB data returns', () => {
  const rows = [{ id: 'keep-1', name: 'Keep' }, { id: 'deleted-1', name: 'Old' }]
  assert.deepEqual(filterDeletedMembers(rows, { 'deleted-1': { deletedAt: 'now' } }), [{ id: 'keep-1', name: 'Keep' }])
})

test('admin sync rejects a tombstoned member ID but allows a new membership ID', () => {
  const tombstones = { 'deleted-1': { deletedAt: 'now' } }
  assert.equal(deletedMemberInPayload([{ id: 'deleted-1' }], tombstones)?.id, 'deleted-1')
  assert.equal(deletedMemberInPayload([{ id: 'new-2' }], tombstones), undefined)
})
