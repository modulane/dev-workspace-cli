import test from 'node:test'
import assert from 'node:assert/strict'

import { fitText, textWidth, truncateText, wrapText } from '../lib/width.js'

test('textWidth counts emoji and wide characters as two columns', () => {
  assert.equal(textWidth('web'), 3)
  assert.equal(textWidth('📁 web'), 6)
  assert.equal(textWidth('日本'), 4)
  assert.equal(textWidth('é'), 1)
  // A family emoji is one character drawn two columns wide.
  assert.equal(textWidth('👨‍👩‍👧'), 2)
})

test('textWidth counts the symbols terminals draw narrow as one column', () => {
  assert.equal(textWidth('⚙'), 1)
  assert.equal(textWidth('⚙️'), 2)
})

test('textWidth ignores ANSI escape codes', () => {
  assert.equal(textWidth('\x1b[36mweb\x1b[0m'), 3)
})

test('fitText keeps the start that fits, without splitting a character', () => {
  assert.equal(fitText('web-app', 3), 'web')
  assert.equal(fitText('web', 10), 'web')
  // 日 takes two columns, so a third column cannot hold half of 本.
  assert.equal(fitText('日本', 3), '日')
  assert.equal(fitText('a👨‍👩‍👧b', 3), 'a👨‍👩‍👧')
  assert.equal(fitText('a👨‍👩‍👧b', 2), 'a')
})

test('wrapText breaks between words and cuts words wider than a line', () => {
  assert.deepEqual(wrapText('the quick brown fox', 9), [
    'the quick',
    'brown fox',
  ])
  assert.deepEqual(wrapText('  spaced   out  ', 20), ['spaced out'])
  assert.deepEqual(wrapText('abcdefgh ij', 3), ['abc', 'def', 'gh', 'ij'])
  // A wide character never splits, even in a single column.
  assert.deepEqual(wrapText('日本', 1), ['日', '本'])
  assert.deepEqual(wrapText('', 10), [])
})

test('truncateText ends a shortened text with an ellipsis', () => {
  assert.equal(truncateText('vite build', 20), 'vite build')
  assert.equal(truncateText('vite build', 6), 'vite …')
  // Each 日 takes two columns, so only two fit before the ellipsis.
  assert.equal(truncateText('日本語です', 6), '日本…')
  assert.equal(truncateText('vite', 0), '')
})
