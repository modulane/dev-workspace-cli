import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { createList, parseKeys } from '../lib/list.js'
import { textWidth } from '../lib/width.js'

const KEYS = {
  up: '\x1b[A',
  down: '\x1b[B',
  pageDown: '\x1b[6~',
  home: '\x1b[H',
  end: '\x1b[F',
  enter: '\r',
  escape: '\x1b',
  backspace: '\x7f',
  ctrlC: '\x03',
}

// A fake terminal: input emits typed keys, output records what was drawn.
function createTerminal({ columns = 60, rows = 30 } = {}) {
  const input = new EventEmitter()
  const output = new EventEmitter()
  const exitEvents = new EventEmitter()
  const terminal = { input, output, exitEvents, written: '', rawModes: [] }

  Object.assign(input, {
    isRaw: false,
    setRawMode(mode) {
      input.isRaw = mode
      terminal.rawModes.push(mode)
    },
    resume() {
      terminal.resumed = true
    },
    pause() {
      terminal.paused = true
    },
  })

  Object.assign(output, {
    columns,
    rows,
    write(text) {
      terminal.written += text
    },
  })

  terminal.select = createList({
    input,
    output,
    exitEvents,
    useColors: false,
  })

  terminal.type = (...keys) => {
    for (const key of keys) input.emit('data', Buffer.from(key))
  }

  // The lines of the last full drawing.
  terminal.screen = () => {
    const drawings = terminal.written.split('\x1b[J')

    return drawings.at(-1).split('\n')
  }

  return terminal
}

const projects = ['api', 'billing-api', 'design-system', 'docs', 'web'].map(
  name => ({ label: name, value: name, icon: '📁' }),
)
const actions = [
  { label: 'Change workspace', value: 'change', action: true },
  { label: 'Exit', value: null, action: true },
]

test('parseKeys decodes arrows, editing keys and text', () => {
  assert.deepEqual(parseKeys('\x1b[A\x1bOB\x1b[5~\x1b[6~\x1b[1~\x1b[4~'), [
    { name: 'up' },
    { name: 'down' },
    { name: 'pageup' },
    { name: 'pagedown' },
    { name: 'home' },
    { name: 'end' },
  ])
  assert.deepEqual(parseKeys('ab\r\n\x7f\b\x03\x15\t'), [
    { name: 'char', text: 'a' },
    { name: 'char', text: 'b' },
    { name: 'enter' },
    { name: 'backspace' },
    { name: 'backspace' },
    { name: 'ctrl-c' },
    { name: 'ctrl-u' },
  ])
})

test('parseKeys tells Escape apart from escape sequences', () => {
  assert.deepEqual(parseKeys('\x1b'), [{ name: 'escape' }])
  assert.deepEqual(parseKeys('\x1b\x1b[A'), [
    { name: 'escape' },
    { name: 'up' },
  ])
  // Alt+x, Left, and a mouse report are recognised and ignored.
  assert.deepEqual(parseKeys('\x1bx\x1b[D\x1b[<0;10;5M'), [])
  assert.deepEqual(parseKeys('é😀'), [
    { name: 'char', text: 'é' },
    { name: 'char', text: '😀' },
  ])
})

test('select draws the list and returns the chosen value', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Select a project',
    items: [...projects, ...actions],
  })

  assert.deepEqual(terminal.screen(), [
    '  Select a project  type to search',
    '  ❯ 📁  api',
    '    📁  billing-api',
    '    📁  design-system',
    '    📁  docs',
    '    📁  web',
    '    Change workspace',
    '    Exit',
    '  ↑↓ move · Enter select',
  ])

  terminal.type(KEYS.down, KEYS.down, KEYS.enter)

  assert.equal(await result, 'design-system')
  // The list is replaced by a one-line summary of the answer.
  assert.ok(
    terminal.written.endsWith(
      '\x1b[8A\r\x1b[J  Select a project  design-system\n\x1b[?25h',
    ),
  )
})

test('select restores the terminal when it closes', async () => {
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  assert.equal(terminal.input.isRaw, true)
  assert.equal(terminal.input.listenerCount('data'), 1)
  assert.equal(terminal.exitEvents.listenerCount('exit'), 1)

  terminal.type(KEYS.enter)
  await result

  assert.equal(terminal.input.isRaw, false)
  assert.equal(terminal.paused, true)
  assert.equal(terminal.input.listenerCount('data'), 0)
  assert.equal(terminal.output.listenerCount('resize'), 0)
  assert.equal(terminal.exitEvents.listenerCount('exit'), 0)
  assert.ok(terminal.written.startsWith('\x1b[?25l'))
  assert.ok(terminal.written.endsWith('\x1b[?25h'))
})

test('select shows the cursor again if the process exits while open', () => {
  const terminal = createTerminal()

  terminal.select({ message: 'Pick', items: projects })
  terminal.exitEvents.emit('exit')

  assert.equal(terminal.input.isRaw, false)
  assert.ok(terminal.written.endsWith('\x1b[?25h'))
})

test('select rejects with an ExitPromptError on Ctrl+C', async () => {
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type(KEYS.ctrlC)

  await assert.rejects(result, { name: 'ExitPromptError' })
  assert.equal(terminal.input.isRaw, false)
})

test('typing filters the list, best match first, and hides actions', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Select a project',
    items: [...projects, ...actions],
  })

  terminal.type('a', 'p', 'i')

  assert.deepEqual(terminal.screen(), [
    '  Select a project  api',
    '  ❯ 📁  api',
    '    📁  billing-api',
    '  ↑↓ move · Enter select · Esc clear search',
  ])

  terminal.type(KEYS.down, KEYS.enter)

  assert.equal(await result, 'billing-api')
})

test('Backspace edits the search and Escape clears it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: [...projects, ...actions],
  })

  terminal.type('d', 's', 'x')
  assert.ok(terminal.screen().some(line => line.includes('No matches')))

  terminal.type(KEYS.backspace)
  assert.deepEqual(terminal.screen().slice(1, 3), [
    '  ❯ 📁  design-system',
    '    📁  docs',
  ])

  // Enter does nothing while nothing matches.
  terminal.type('x', KEYS.enter, KEYS.escape)
  t.mock.timers.tick(50)

  // The full list is back, actions included, with the cursor kept.
  assert.equal(terminal.screen().length, 9)

  terminal.type(KEYS.escape, KEYS.up, KEYS.enter)

  assert.equal(await result, 'api')
})

test('Escape keeps the selected item when clearing the search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type('w', 'e', KEYS.escape)
  t.mock.timers.tick(50)
  assert.ok(terminal.screen().includes('  ❯ 📁  web'))

  terminal.type(KEYS.enter)
  assert.equal(await result, 'web')
})

test('an arrow key split over two chunks is not read as Escape', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type('a', '\x1b')
  t.mock.timers.tick(49)
  terminal.type('[B')

  // The search is kept, and Down moved to the second match.
  assert.ok(terminal.screen()[0].includes('Pick  a'))
  assert.ok(terminal.screen().includes('  ❯ 📁  billing-api'))

  terminal.type(KEYS.enter)
  assert.equal(await result, 'billing-api')
})

test('a lone Escape is read once no sequence follows it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type('a', '\x1b')
  assert.ok(terminal.screen()[0].includes('Pick  a'))

  t.mock.timers.tick(50)
  assert.ok(terminal.screen()[0].includes('type to search'))

  terminal.type(KEYS.enter)
  assert.equal(await result, 'api')
})

test('select skips disabled items and separators', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: [
      { separator: 'Recent' },
      { label: 'web', value: 'web' },
      { separator: 'Projects' },
      { label: 'notes', value: 'notes', disabled: '(no package.json)' },
      { label: 'api', value: 'api' },
    ],
  })

  assert.deepEqual(terminal.screen().slice(0, 6), [
    '  Pick  type to search',
    '  Recent',
    '  ❯ web',
    '  Projects',
    '    notes (no package.json)',
    '    api',
  ])

  terminal.type(KEYS.down, KEYS.enter)

  assert.equal(await result, 'api')
})

test('select starts on the default value and shows its description', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Select a script',
    items: [
      { label: 'dev', value: 'dev', description: 'vite' },
      {
        label: 'build',
        value: 'build',
        description: 'vite build',
        hint: '(last run)',
      },
    ],
    default: 'build',
  })

  assert.deepEqual(terminal.screen(), [
    '  Select a script  type to search',
    '    dev',
    '  ❯ build (last run)',
    '  vite build',
    '  ↑↓ move · Enter select',
  ])

  terminal.type(KEYS.enter)
  assert.equal(await result, 'build')
})

test('a list that is not searchable ignores typing', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'What next?',
    items: [
      { label: 'Run again', value: true },
      { label: 'Back', value: false },
    ],
    searchable: false,
  })

  terminal.type('b', 'a', 'c', 'k')

  assert.equal(terminal.screen()[0], '  What next?')

  terminal.type(KEYS.enter)
  assert.equal(await result, true)
})

test('a long list scrolls to keep the cursor visible', async () => {
  const terminal = createTerminal({ rows: 10 })
  const items = Array.from({ length: 40 }, (_, index) => ({
    label: `project-${index + 1}`,
    value: index + 1,
  }))
  const result = terminal.select({ message: 'Pick', items })

  // 10 rows leave room for 6 items, the message and the help line.
  assert.equal(terminal.screen().length, 8)
  assert.match(terminal.screen().at(-1), /1\/40$/)

  terminal.type(KEYS.pageDown)
  assert.ok(terminal.screen().includes('  ❯ project-6'))
  assert.match(terminal.screen().at(-1), /6\/40$/)

  terminal.type(KEYS.end)
  assert.equal(terminal.screen().at(-2), '  ❯ project-40')

  terminal.type(KEYS.home)
  assert.equal(terminal.screen()[1], '  ❯ project-1')

  terminal.type(KEYS.up, KEYS.enter)
  assert.equal(await result, 1)
})

test('select redraws in place, and never wider than the terminal', async () => {
  const terminal = createTerminal({ columns: 20 })
  const result = terminal.select({
    message: 'Pick',
    items: [{ label: 'a-very-long-project-name', value: 1, icon: '📁' }],
  })

  for (const line of terminal.screen()) {
    assert.ok(textWidth(line) <= 19, line)
  }

  terminal.written = ''
  terminal.type('a')

  // Back up two lines (three were drawn), then clear and draw again.
  assert.ok(terminal.written.startsWith('\x1b[2A\r\x1b[J'))

  terminal.output.columns = 40
  terminal.output.emit('resize')
  assert.ok(terminal.screen()[1].endsWith('a-very-long-project-name'))

  terminal.type(KEYS.enter)
  await result
})

test('select redraws from its first line after the terminal gets narrower', async () => {
  const terminal = createTerminal({ columns: 40 })
  const result = terminal.select({
    message: 'Pick',
    items: [{ label: 'a-very-long-project-name', value: 1, icon: '📁' }],
  })

  // The three lines are 22, 32 and 24 columns wide. At 20 columns the
  // terminal rewraps each of them onto two rows: six rows, so back up five.
  terminal.written = ''
  terminal.output.columns = 20
  terminal.output.emit('resize')

  assert.ok(terminal.written.startsWith('\x1b[5A\r\x1b[J'))

  // The new drawing fits, so the next one backs up its own lines only.
  terminal.written = ''
  terminal.type('a')

  assert.ok(terminal.written.startsWith('\x1b[2A\r\x1b[J'))

  terminal.type(KEYS.enter)
  await result
})

test('select draws the whole screen again on resize when given redraw', async () => {
  const terminal = createTerminal({ columns: 40 })
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    redraw: () => terminal.output.write('[header]\n'),
  })

  terminal.written = ''
  terminal.output.columns = 20
  terminal.output.emit('resize')

  // The screen above is drawn first, then the list below it, without moving
  // the cursor back over lines that are gone.
  assert.ok(terminal.written.startsWith('[header]\n\x1b[J  Pick'))

  terminal.type(KEYS.enter)
  await result
})

test('select highlights matched characters when colours are on', async () => {
  const terminal = createTerminal()
  const select = createList({
    input: terminal.input,
    output: terminal.output,
    exitEvents: terminal.exitEvents,
    useColors: true,
  })
  const result = select({ message: 'Pick', items: projects })

  terminal.type('d', 'c')

  const line = terminal.screen()[1]

  assert.ok(line.includes('\x1b[36m❯ \x1b[39m'), JSON.stringify(line))
  assert.ok(line.includes('\x1b[4m\x1b[1m\x1b[36md'), JSON.stringify(line))

  terminal.type(KEYS.enter)
  assert.equal(await result, 'docs')
})
