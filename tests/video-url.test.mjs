import test from 'node:test'
import assert from 'node:assert/strict'
import { isSafeVideoUrl, safeVideoUrl } from '../src/videoUrl.ts'

test('central video URL validation accepts only approved HTTPS hosts', () => {
  for (const value of [
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://vimeo.com/123',
  ]) assert.equal(isSafeVideoUrl(value), true)
  for (const value of [
    'javascript:alert(1)', 'data:text/html,x', 'file:///secret', 'blob:https://youtube.com/x',
    '//evil.example/x', ' https://www.youtube.com/x', 'https://www.youtube.com/x ',
    'https://www.youtube.com/%0Ajavascript:alert(1)', 'HTTPS://www.youtube.com/x',
    'https://youtube.com.evil.example/x', 'https://www.youtube.com:8443/x',
    'https://user:pass@www.youtube.com/x', 'https://www.youtube.com/ a',
  ]) assert.equal(isSafeVideoUrl(value), false, value)
  assert.equal(isSafeVideoUrl(''), true)
  assert.equal(safeVideoUrl('https://WWW.YouTube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc')
})
