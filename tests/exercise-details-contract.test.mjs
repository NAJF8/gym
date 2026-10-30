import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const sync = await readFile(new URL('../src/dataSync.ts', import.meta.url), 'utf8')

test('exercise detail is centrally gated by public barcode visibility', () => {
  assert.match(main, /watchPublicSettings/)
  assert.match(main, /const trustedVideo = settingsReady && showBarcodes &&/)
  assert.match(main, /الفيديو مخفي حسب إعدادات العرض/)
  assert.match(main, /showBarcodes && videoId && e\.videoReviewStatus === "verified"/)
})

test('exercise detail exposes only stored facts and explicit unavailable states', () => {
  for (const field of ['secondaryMuscles', 'equipment', 'steps', 'safetyNotes', 'commonMistakes', 'anatomyView']) {
    assert.match(main, new RegExp(field))
    assert.match(sync, new RegExp(field))
  }
  assert.match(main, /لا توجد بيانات موثوقة محفوظة لهذا التمرين/)
  assert.match(main, /function ExerciseAnatomy/)
})
