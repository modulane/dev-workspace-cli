import test from 'node:test'
import assert from 'node:assert/strict'

import { parseJson } from '../lib/json.js'

test('parseJson ignores a leading byte order mark', () => {
  assert.deepEqual(parseJson('\uFEFF{"name":"app"}'), { name: 'app' })
  assert.deepEqual(parseJson('{"name":"app"}'), { name: 'app' })
})

test('parseJson keeps a byte order mark inside a value', () => {
  assert.deepEqual(parseJson('{"name":"\uFEFFapp"}'), { name: '\uFEFFapp' })
})

test('parseJson still rejects invalid JSON', () => {
  assert.throws(() => parseJson('\uFEFF{ invalid json'), SyntaxError)
  assert.throws(() => parseJson('\uFEFF\uFEFF{}'), SyntaxError)
})
