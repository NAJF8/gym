import assert from 'node:assert/strict'
import test from 'node:test'
import { safeImageUrl } from '../src/imageUrl.ts'

test('print image URLs reject markup and unsafe schemes', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), null)
  assert.equal(safeImageUrl('https://example.com/coach.png'), 'https://example.com/coach.png')
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(safeImageUrl('data:text/html;base64,AAAA'), null)
})
