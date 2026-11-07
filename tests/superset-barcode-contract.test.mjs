import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const sync = await readFile(new URL('../src/dataSync.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('superset presentation renders one table row in print and cards elsewhere', () => {
  assert.match(main, /className="superset-editor-items"/)
  assert.match(main, /className="member-superset-items"/)
  assert.match(main, /className="member-superset-items">\{block\.items\.map\(\(exercise, index\) => renderExercise\(exercise, index\)\)\}/)
  assert.doesNotMatch(main, /className="member-superset-item"/)
  assert.match(main, /class="ss-item" style="grid-template-columns:\$\{columns\}"/)
  assert.match(main, /class="print-superset-grid"/)
  assert.match(main, /class="superset-row"><td class="ss-cell"/)
  assert.doesNotMatch(main, /superset-label/)
  assert.match(main, /dayBlocks\(day\)/)
  assert.match(styles, /\.superset-editor-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(styles, /\.member-superset-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(styles, /\.course-editor-modal \.exercise-library-list\{flex:1;min-height:0;overflow-y:auto\}/)
})

test('barcode display is gated by the public projection and a concrete YouTube URL', () => {
  assert.match(main, /youtubeQrTarget/)
  assert.match(main, /لا يوجد رابط فيديو لهذا التمرين/)
  assert.match(main, /watchPublicSettings/)
  assert.match(sync, /updates\["publicSettings\/showBarcodes"\] = nextSettings\.showBarcodes/)
})
