import test from 'node:test'
import assert from 'node:assert/strict'
import { createUi, headerLines } from '../lib/ui.js'
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

// The header as plain text: each line's segments joined, without styles.
function header(options, width = 60) {
  return headerLines(options, width).map(line =>
    line.map(([text]) => text).join(''),
  )
}

test('headerLines draws the name and workspace in a box', () => {
  assert.deepEqual(header({ workspace: '/projects' }, 40), [
    '  ╭─ ◆ dev-workspace ──────────────────╮',
    '  │  /projects                         │',
    '  ╰────────────────────────────────────╯',
  ])
})

test('headerLines shows the breadcrumb and the tag in the top border', () => {
  const [top] = header(
    { workspace: '/projects', crumbs: ['web-app'], tag: 'npm · default' },
    60,
  )

  assert.equal(
    top,
    '  ╭─ ◆ dev-workspace › web-app ──────────── npm · default ─╮',
  )
})

test('headerLines styles the parts of the box', () => {
  const [top] = headerLines({ workspace: '/p', crumbs: ['web'] }, 40)

  assert.deepEqual(top.slice(1, 6), [
    ['╭─ ', 'dim'],
    ['◆', 'cyan'],
    [' dev-workspace', 'bold'],
    [' › ', 'dim'],
    ['web'],
  ])
})

test('headerLines drops the tag, then cuts the breadcrumb, when short of room', () => {
  const options = {
    workspace: '/projects',
    crumbs: ['a-project-with-a-long-name'],
    tag: 'pnpm · pnpm-lock.yaml',
  }
  const [wide] = header(options, 70)
  const [narrow] = header(options, 40)

  assert.ok(wide.includes('a-project-with-a-long-name'), wide)
  assert.ok(!wide.includes('pnpm'), wide)
  assert.ok(narrow.includes('› a-project-wit…'), narrow)
})

test('headerLines keeps its border aligned around wide characters', () => {
  for (const width of [30, 60, 100]) {
    const lines = header(
      { workspace: '/projets/日本語/📦-app', crumbs: ['日本語'], tag: 'npm' },
      width,
    )

    assert.ok(lines[1].includes('日本語/📦-app') || width < 40, lines[1])

    for (const line of lines) assert.equal(textWidth(line), width, line)
  }
})

test('headerLines cuts a long workspace path to fit', () => {
  const lines = header({ workspace: `/${'very-long-folder/'.repeat(10)}` }, 50)

  assert.ok(lines[1].endsWith('… │'), lines[1])

  for (const line of lines) assert.equal(textWidth(line), 50, line)
})
