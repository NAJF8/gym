import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeExerciseLibrary } from '../src/exerciseLibrary.ts'

const item = (id, english = id) => ({ id, name: `تمرين ${id}`, english, muscle: 'تمارين الصدر', sets: 3, reps: '10', rest: '60 ثانية' })
test('library merge is idempotent and preserves an existing course-linked exercise', () => {
  const saved = { ...item('bench-press'), name: 'اسم محفوظ للكورس', sets: 5 }
  const first = mergeExerciseLibrary([saved], [item('bench-press'), item('cable-fly')])
  const second = mergeExerciseLibrary(first.exercises, [item('bench-press'), item('cable-fly')])
  assert.equal(first.added, 1); assert.equal(first.exercises[0].name, 'اسم محفوظ للكورس')
  assert.equal(second.added, 0); assert.equal(second.exercises.length, 2)
})
test('library merge recognizes an older English-name record', () => {
  assert.equal(mergeExerciseLibrary([item('old-cable', 'Cable Fly')], [item('library-cable-fly', 'Cable Fly')]).added, 0)
})
