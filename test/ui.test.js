import test from 'node:test'
import assert from 'node:assert/strict'
import { createUi } from '../lib/ui.js'
import { textWidth } from '../lib/width.js'

test('color returns plain text when colors are disabled', () => {
  const { color } = createUi({ useColors: false })

  assert.equal(color('Hello', 'cyan'), 'Hello')
})

test('color converts values to strings when colors are disabled', () => {
  const { color } = createUi({ useColors: false })

  assert.equal(color(123, 'green'), '123')
  assert.equal(color(null, 'red'), 'null')
})

test('color wraps text in ANSI codes when colors are enabled', () => {
  const { color } = createUi({ useColors: true })

  assert.equal(color('Hello', 'cyan'), '\x1b[36mHello\x1b[0m')
  assert.equal(color('Warning', 'yellow'), '\x1b[33mWarning\x1b[0m')
})

test('color returns plain text for an unknown shade', () => {
  const { color } = createUi({ useColors: true })

  assert.equal(color('Hello', 'purple'), 'Hello')
})

test('printHeader logs the default section and workspace', () => {
  const lines = []
  const { printHeader } = createUi({
    useColors: false,
    log: (...args) => lines.push(args.join(' ')),
  })

  printHeader('/projects')

  assert.ok(lines.some(line => line.includes('DEV WORKSPACE CLI')))
  assert.ok(lines.some(line => line.includes('DEVELOPER TOOLKIT')))
  assert.ok(lines.some(line => line.includes('WORKSPACE')))
  assert.ok(lines.some(line => line.includes('/projects')))
  assert.ok(lines.some(line => line.includes('PROJECT EXPLORER')))
})

test('printHeader supports a custom section', () => {
  const lines = []
  const { printHeader } = createUi({
    useColors: false,
    log: (...args) => lines.push(args.join(' ')),
  })

  printHeader('/projects', 'PROJECT SCRIPTS')

  assert.ok(lines.some(line => line.includes('PROJECT SCRIPTS')))
})

test('printHeader applies colors when enabled', () => {
  const lines = []
  const { printHeader } = createUi({
    useColors: true,
    log: (...args) => lines.push(args.join(' ')),
  })

  printHeader('/projects')

  assert.ok(lines.some(line => line.includes('\x1b[36m')))
  assert.ok(lines.some(line => line.includes('\x1b[0m')))
})

// The header lines, as printHeader draws them in a terminal `columns` wide.
function headerLines(workspace, columns) {
  const lines = []
  const { printHeader } = createUi({
    useColors: false,
    log: (...args) => lines.push(args.join(' ')),
    columns: () => columns,
  })

  printHeader(workspace)

  return lines.filter(Boolean)
}

test('printHeader fits the terminal, up to 72 columns', () => {
  for (const [columns, expected] of [
    [120, 2 + 72],
    [60, 60 - 1],
    // Narrower terminals are treated as 40 columns wide.
    [30, 40 - 1],
  ]) {
    for (const line of headerLines('/projects', columns)) {
      assert.equal(textWidth(line), expected, `${columns}: ${line}`)
    }
  }
})

test('printHeader keeps its border aligned around wide characters', () => {
  const lines = headerLines('/projets/日本語/📦-app', 60)

  assert.ok(lines.some(line => line.includes('日本語/📦-app')))

  for (const line of lines) {
    assert.equal(textWidth(line), 59, line)
  }
})

test('printHeader cuts a long workspace path to fit', () => {
  const lines = headerLines(`/${'very-long-folder/'.repeat(10)}`, 50)

  for (const line of lines) {
    assert.equal(textWidth(line), 49, line)
  }
})
