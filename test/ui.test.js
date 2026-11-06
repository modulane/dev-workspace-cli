import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STYLES,
  colorsEnabled,
  createUi,
  folderName,
  headerLines,
  styleText,
} from '../lib/ui.js'
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

  assert.equal(color('Hello', 'cyan'), '\x1b[36mHello\x1b[39m')
  assert.equal(color('Warning', 'yellow'), '\x1b[33mWarning\x1b[39m')
})

test('color applies several styles, the last one outermost', () => {
  const { color } = createUi({ useColors: true })

  assert.equal(color('Hi', 'cyan', 'bold'), '\x1b[1m\x1b[36mHi\x1b[39m\x1b[22m')
})

test('styleText closes each style with its own code, so styles nest', () => {
  const inner = styleText('b', ['cyan'], true)

  assert.equal(
    styleText(`a${inner}c`, ['bold'], true),
    '\x1b[1ma\x1b[36mb\x1b[39mc\x1b[22m',
  )
  assert.equal(styleText('plain', ['cyan', 'bold'], false), 'plain')
  assert.ok(Object.values(STYLES).every(([open, close]) => open !== close))
})

test('colorsEnabled needs a terminal and no NO_COLOR', () => {
  const tty = { isTTY: true }

  assert.equal(colorsEnabled({ env: {}, stream: tty }), true)
  assert.equal(colorsEnabled({ env: {}, stream: {} }), false)
  assert.equal(colorsEnabled({ env: { NO_COLOR: '1' }, stream: tty }), false)
  // An empty NO_COLOR does not count, as the NO_COLOR convention says.
  assert.equal(colorsEnabled({ env: { NO_COLOR: '' }, stream: tty }), true)
})

test('colorsEnabled lets FORCE_COLOR override everything else', () => {
  for (const value of ['1', '2', '3', 'true', '']) {
    const env = { FORCE_COLOR: value, NO_COLOR: '1' }

    assert.equal(colorsEnabled({ env, stream: {} }), true, value)
  }

  for (const value of ['0', 'false']) {
    const env = { FORCE_COLOR: value }

    assert.equal(colorsEnabled({ env, stream: { isTTY: true } }), false, value)
  }
})

test('inquirerTheme styles Inquirer prompts through color()', () => {
  const plain = createUi({ useColors: false }).inquirerTheme()
  const colored = createUi({ useColors: true }).inquirerTheme()

  assert.deepEqual(plain.prefix, { idle: '?', done: '✔' })
  assert.equal(plain.style.error('Bad path'), '> Bad path')
  assert.equal(plain.style.defaultAnswer('Y/n'), '(Y/n)')
  assert.equal(plain.style.key('enter'), '<enter>')

  for (const style of Object.values(plain.style)) {
    assert.ok(!style('text').includes('\x1b['))
  }

  assert.equal(colored.prefix.idle, '\x1b[36m?\x1b[39m')
  assert.equal(colored.prefix.done, '\x1b[32m✔\x1b[39m')
  assert.equal(colored.style.answer('yes'), '\x1b[36myes\x1b[39m')
  assert.equal(colored.style.message('Path'), '\x1b[1mPath\x1b[22m')
  assert.equal(colored.style.error('Bad'), '\x1b[31m> Bad\x1b[39m')
  assert.equal(colored.style.help('hint'), '\x1b[2mhint\x1b[22m')
  assert.equal(colored.style.highlight('x'), '\x1b[36mx\x1b[39m')
  assert.equal(colored.style.confirmDefault('Y'), '\x1b[36mY\x1b[39m')
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

test('headerLines draws the workspace folder and path in a box', () => {
  assert.deepEqual(header({ workspace: '/projects' }, 40), [
    '  ╭─ ◆ projects ───────────────────────╮',
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
    '  ╭─ ◆ projects › web-app ───────────────── npm · default ─╮',
  )
})

test('headerLines styles the parts of the box', () => {
  const [top] = headerLines({ workspace: '/p', crumbs: ['web'] }, 40)

  assert.deepEqual(top.slice(1, 6), [
    ['╭─ ', 'dim'],
    ['◆', 'cyan'],
    [' p', 'bold'],
    [' › ', 'dim'],
    ['web', 'cyan'],
  ])
})

test('headerLines marks only the current screen in the breadcrumb', () => {
  const [top] = headerLines(
    { workspace: '/p', crumbs: ['web', 'build'], tag: 'npm' },
    60,
  )

  assert.deepEqual(top.slice(4, 8), [
    [' › ', 'dim'],
    ['web'],
    [' › ', 'dim'],
    ['build', 'cyan'],
  ])
  assert.ok(top.some(([text, style]) => text === ' npm ' && style === 'dim'))
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
  assert.ok(narrow.includes('› a-project-with-a-l…'), narrow)
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

test('headerLines shortens a long workspace path in the middle', () => {
  const workspace = `/${'very-long-folder/'.repeat(10)}web`
  const lines = header({ workspace }, 50)

  assert.ok(lines[1].includes('│  /…/very-long-folder/very-long-folder/web'))

  for (const line of lines) assert.equal(textWidth(line), 50, line)
})

test('headerLines puts the toolbar on the workspace line', () => {
  const toolbar = [
    [' ⚙ Workspace ', { target: 'toolbar:0' }],
    [' ✕ Exit ', { target: 'toolbar:1' }],
  ]
  const workspace = `/${'folder/'.repeat(8)}projects`
  const lines = header({ workspace, toolbar }, 60)

  assert.ok(lines[1].endsWith(' ⚙ Workspace  ✕ Exit │'), lines[1])
  // The path is shortened to fit next to the buttons.
  assert.ok(
    lines[1].includes('│  /…/folder/folder/folder/projects  ⚙'),
    lines[1],
  )

  for (const line of lines) assert.equal(textWidth(line), 60, line)

  // The buttons keep their targets.
  const [, path] = headerLines({ workspace, toolbar }, 60)

  assert.ok(path.includes(toolbar[1]))
})

test('headerLines leaves the toolbar out when the path would get too short', () => {
  const toolbar = [[' … Run with args ', { target: 'toolbar:0' }]]
  const [, path] = header({ workspace: '/projects', toolbar }, 26)

  assert.equal(path, '  │  /projects           │')
})

test('folderName gives the last folder of a Windows or POSIX path', () => {
  assert.equal(folderName('E:\\dev'), 'dev')
  assert.equal(folderName('/home/me/projects/'), 'projects')
  assert.equal(folderName('C:\\'), 'C:')
  assert.equal(folderName('/'), '/')
})

test('headerLines cuts a long folder name to fit the box', () => {
  const workspace = `/${'a-very-long-folder-name-'.repeat(4)}end`

  for (const width of [20, 40]) {
    const lines = header({ workspace, crumbs: ['web'] }, width)

    assert.ok(lines[0].includes('…'), lines[0])

    for (const line of lines) assert.equal(textWidth(line), width, line)
  }
})
