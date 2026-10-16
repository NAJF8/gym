import test from 'node:test'
import assert from 'node:assert/strict'

function normalizeIraqiPhone(input) {
  let value = input.trim().replace(/[\s()-]/g, '')
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (value.startsWith('+964')) value = value.slice(4)
  if (value.startsWith('964')) value = value.slice(3)
  if (value.startsWith('7')) value = `0${value}`
  if (!/^07\d{9}$/.test(value)) throw new Error('invalid phone')
  return `+964${value.slice(1)}`
}

test('normalizes common Iraqi phone forms without losing zero semantics', () => {
  const expected = '+9647701234567'
  assert.equal(normalizeIraqiPhone('07701234567'), expected)
  assert.equal(normalizeIraqiPhone('+9647701234567'), expected)
  assert.equal(normalizeIraqiPhone('00964 770 123 4567'), expected)
  assert.equal(normalizeIraqiPhone('9647701234567'), expected)
})

test('rejects non-Iraqi or malformed numbers', () => {
  assert.throws(() => normalizeIraqiPhone('0770123456'))
  assert.throws(() => normalizeIraqiPhone('06123456789'))
})
