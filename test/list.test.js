import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'

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
function createTerminal({ columns = 60, rows = 30, now } = {}) {
  const input = new EventEmitter()
  const output = new EventEmitter()
  const exitEvents = new EventEmitter()
  const terminal = {
    input,
    output,
    exitEvents,
    written: '',
    rawModes: [],
    killed: [],
  }

  Object.assign(exitEvents, {
    pid: 42,
    kill(pid, signal) {
      terminal.killed.push([pid, signal])
    },
  })

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
    now,
  })

  terminal.type = (...keys) => {
    for (const key of keys) input.emit('data', Buffer.from(key))
  }

  // Answer the last position request: the list's last line is on `row`.
  terminal.reply = row => terminal.type(`\x1b[${row};1R`)
  terminal.click = row => terminal.type(`\x1b[<0;8;${row}M\x1b[<0;8;${row}m`)
  terminal.hover = row => terminal.type(`\x1b[<35;8;${row}M`)

  // The lines of the last full drawing, without the position request.
  terminal.screen = () => {
    const drawings = terminal.written.split('\x1b[J')

    return drawings.at(-1).replaceAll('\x1b[6n', '').split('\n')
  }

  return terminal
}

// A line with `right` aligned to the list's right edge: a 60-column terminal
// leaves 59 columns, as the last one stays free.
function aligned(left, right, width = 59) {
  return left + ' '.repeat(width - textWidth(left) - textWidth(right)) + right
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
  // Alt+x and Left are recognised and ignored.
  assert.deepEqual(parseKeys('\x1bx\x1b[D'), [])
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
    aligned('  Select a project', 'type to search'),
    '',
    '  ❯ 📁 api',
    '    📁 billing-api',
    '    📁 design-system',
    '    📁 docs',
    '    📁 web',
    `  ${'─'.repeat(57)}`,
    '    Change workspace',
    '    Exit',
    '',
    '  ↑↓ move · Enter select',
  ])

  terminal.type(KEYS.down, KEYS.down, KEYS.enter)

  assert.equal(await result, 'design-system')
  // The list is replaced by a one-line summary of the answer.
  assert.ok(
    terminal.written.endsWith(
      '\x1b[11A\r\x1b[J  Select a project  design-system\n\x1b[?25h',
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

test('a signal restores the terminal, then ends the process as it would have', () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const terminal = createTerminal()

    terminal.select({ message: 'Pick', items: projects, mouse: true })
    terminal.exitEvents.emit(signal, signal)

    assert.equal(terminal.input.isRaw, false)
    assert.ok(
      terminal.written.endsWith('\x1b[?1006l\x1b[?1003l\x1b[?1000l\x1b[?25h'),
    )
    // Sent again with no listener left, so the default action ends the process.
    assert.equal(terminal.exitEvents.listenerCount(signal), 0)
    assert.deepEqual(terminal.killed, [[42, signal]])
  }
})

// Windows ends a process killed from outside at once, without any handler.
test(
  'a real process killed with a signal leaves mouse mode first',
  { skip: process.platform === 'win32' && 'signals cannot be caught' },
  async () => {
    const listUrl = new URL('../lib/list.js', import.meta.url).href
    const code = `
      import { select } from ${JSON.stringify(listUrl)}
      select({ message: 'Pick', items: [{ label: 'a', value: 1 }], mouse: true })
      setTimeout(() => process.stdout.write('READY'), 100)
    `

    for (const signal of ['SIGTERM', 'SIGHUP']) {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code])
      let written = ''

      child.stdout.on('data', data => {
        written += data
        if (written.endsWith('READY')) child.kill(signal)
      })

      const [, exitSignal] = await once(child, 'exit')

      assert.equal(exitSignal, signal)
      assert.ok(
        written.includes('\x1b[?1006l\x1b[?1003l\x1b[?1000l\x1b[?25h'),
        JSON.stringify(written),
      )
    }
  },
)

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
    '',
    '  ❯ 📁 api',
    '    📁 billing-api',
    '',
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
  assert.deepEqual(terminal.screen().slice(2, 4), [
    '  ❯ 📁 design-system',
    '    📁 docs',
  ])

  // Enter does nothing while nothing matches.
  terminal.type('x', KEYS.enter, KEYS.escape)
  t.mock.timers.tick(50)

  // The full list is back, actions included, with the cursor kept.
  assert.equal(terminal.screen().length, 12)

  terminal.type(KEYS.escape, KEYS.up, KEYS.enter)

  assert.equal(await result, 'api')
})

test('Escape keeps the selected item when clearing the search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type('w', 'e', KEYS.escape)
  t.mock.timers.tick(50)
  assert.ok(terminal.screen().includes('  ❯ 📁 web'))

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
  assert.ok(terminal.screen().includes('  ❯ 📁 billing-api'))

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

  assert.deepEqual(terminal.screen().slice(0, 8), [
    aligned('  Pick', 'type to search'),
    '',
    '  RECENT',
    '  ❯ web',
    '',
    '  PROJECTS',
    aligned('    notes', '(no package.json)'),
    '    api',
  ])

  terminal.type(KEYS.down, KEYS.enter)

  assert.equal(await result, 'api')
})

test('select starts on the default value and lines up the details', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Select a script',
    items: [
      { label: 'dev', value: 'dev', detail: 'vite' },
      {
        label: 'build',
        value: 'build',
        detail: 'vite build',
        hint: 'last run',
      },
      { label: 'Back', value: null, action: true },
    ],
    default: 'build',
  })

  assert.deepEqual(terminal.screen(), [
    aligned('  Select a script', 'type to search'),
    '',
    '    dev    vite',
    aligned('  ❯ build  vite build', 'last run'),
    `  ${'─'.repeat(57)}`,
    '    Back',
    '',
    '  ↑↓ move · Enter select',
  ])

  terminal.type(KEYS.enter)
  assert.equal(await result, 'build')
})

test('a detail is cut to fit, keeping its end whole', async () => {
  const terminal = createTerminal({ columns: 40 })
  const result = terminal.select({
    message: 'Pick',
    items: [
      {
        label: 'build',
        value: 1,
        detail: `node ${'x'.repeat(100)}.js`,
        detailEnd: '  (+ prebuild)',
        hint: 'last run',
      },
      // Each 日 takes two columns.
      { label: 'echo', value: 2, detail: `echo ${'日'.repeat(40)}` },
    ],
  })

  const [build, echo] = terminal.screen().slice(2, 4)

  assert.equal(build, '  ❯ build  nod…  (+ prebuild)  last run')
  assert.ok(echo.endsWith('…'), echo)
  assert.ok(textWidth(echo) <= 39, echo)

  terminal.type(KEYS.enter)
  await result
})

test('a tag follows the label when the line has no room to align it', async () => {
  const terminal = createTerminal({ columns: 20 })
  const result = terminal.select({
    message: 'Pick',
    items: [
      { label: 'a-long-name', value: 1, detail: 'vite', hint: 'last run' },
    ],
  })

  // 19 columns: no room for the detail, and the tag is cut at the edge.
  assert.equal(terminal.screen()[2], '  ❯ a-long-name  la')

  terminal.type(KEYS.enter)
  await result
})

test('a header and a body are drawn above the message, and the header stays', async () => {
  const terminal = createTerminal({ rows: 14 })
  const widths = []
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    header: width => {
      widths.push(width)
      return [[['  '], ['[box]', 'dim']]]
    },
    body: [['Could not read package.json', 'red'], ['Fix it.']],
    mouse: true,
  })

  assert.deepEqual(terminal.screen().slice(0, 7), [
    '  [box]',
    '',
    '  Could not read package.json',
    '  Fix it.',
    '',
    aligned('  Pick', 'type to search'),
    '',
  ])
  assert.equal(widths.at(-1), 59)

  // 14 rows: the header, body, message, help and blank lines take 9, and one
  // row stays free, which leaves room for 4 items.
  assert.match(terminal.screen().at(-1), /1\/5$/)

  // 13 lines ending on row 20: api is on row 15.
  terminal.reply(20)
  terminal.click(16)
  terminal.reply(20)
  terminal.click(16)

  assert.equal(await result, 'billing-api')
  // The summary replaces the list, under the header.
  assert.ok(terminal.written.includes('\x1b[J  [box]\n\n  Pick  billing-api\n'))
})

test('hover gives the whole row a grey background when colours are on', async () => {
  const terminal = createTerminal()
  const select = createList({
    input: terminal.input,
    output: terminal.output,
    exitEvents: terminal.exitEvents,
    useColors: true,
  })
  const result = select({ message: 'Pick', items: projects, mouse: true })

  // 9 lines ending on row 10: billing-api is on row 5.
  terminal.reply(10)
  terminal.hover(5)

  const line = terminal.screen()[3]

  assert.ok(line.startsWith('\x1b[100m  \x1b[49m'), JSON.stringify(line))
  assert.equal(textWidth(line), 59)
  assert.ok(line.endsWith(`\x1b[100m${' '.repeat(41)}\x1b[49m`), line)
  assert.ok(!terminal.screen()[2].includes('\x1b[100m'))

  terminal.type(KEYS.enter)
  await result
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

  // 10 rows leave room for 5 items next to the message, the help line and
  // the blank lines between them.
  assert.equal(terminal.screen().length, 9)
  assert.match(terminal.screen().at(-1), /1\/40$/)

  terminal.type(KEYS.pageDown)
  assert.ok(terminal.screen().includes('  ❯ project-5'))
  assert.match(terminal.screen().at(-1), /5\/40$/)

  terminal.type(KEYS.end)
  assert.equal(terminal.screen().at(-3), '  ❯ project-40')

  terminal.type(KEYS.home)
  assert.equal(terminal.screen()[2], '  ❯ project-1')

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

  // Back up four lines (five were drawn), then clear and draw again.
  assert.ok(terminal.written.startsWith('\x1b[4A\r\x1b[J'))

  terminal.output.columns = 40
  terminal.output.emit('resize')
  assert.ok(terminal.screen()[2].endsWith('a-very-long-project-name'))

  terminal.type(KEYS.enter)
  await result
})

test('select redraws from its first line after the terminal gets narrower', async () => {
  const terminal = createTerminal({ columns: 40 })
  const result = terminal.select({
    message: 'Pick',
    items: [{ label: 'a-very-long-project-name', value: 1, icon: '📁' }],
  })

  // The message, item and help lines are 39, 31 and 24 columns wide, with a
  // blank line after the first two. At 20 columns the terminal rewraps each
  // of the three onto two rows: eight rows, so back up seven.
  terminal.written = ''
  terminal.output.columns = 20
  terminal.output.emit('resize')

  assert.ok(terminal.written.startsWith('\x1b[7A\r\x1b[J'))

  // The new drawing fits, so the next one backs up its own lines only.
  terminal.written = ''
  terminal.type('a')

  assert.ok(terminal.written.startsWith('\x1b[4A\r\x1b[J'))

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

  const line = terminal.screen()[2]

  assert.ok(line.includes('\x1b[36m❯ \x1b[39m'), JSON.stringify(line))
  assert.ok(line.includes('\x1b[4m\x1b[1m\x1b[36md'), JSON.stringify(line))

  terminal.type(KEYS.enter)
  assert.equal(await result, 'docs')
})

test('parseKeys decodes mouse reports and cursor position replies', () => {
  assert.deepEqual(
    parseKeys(
      '\x1b[<0;10;5M\x1b[<0;10;5m\x1b[<35;3;7M\x1b[<64;1;1M\x1b[<65;1;1M',
    ),
    [
      { name: 'mouse', type: 'left', column: 10, row: 5, released: false },
      { name: 'mouse', type: 'left', column: 10, row: 5, released: true },
      { name: 'mouse', type: 'move', column: 3, row: 7, released: false },
      { name: 'mouse', type: 'wheel-up', column: 1, row: 1, released: false },
      { name: 'mouse', type: 'wheel-down', column: 1, row: 1, released: false },
    ],
  )
  assert.deepEqual(parseKeys('\x1b[12;1R'), [
    { name: 'position', row: 12, column: 1 },
  ])
})

test('without the mouse, mouse reports are ignored and nothing is asked', async () => {
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.click(2)
  terminal.reply(10)
  terminal.type(KEYS.enter)

  assert.equal(await result, 'api')
  assert.ok(!terminal.written.includes('\x1b[?1000h'))
  assert.ok(!terminal.written.includes('\x1b[6n'))
})

test('the mouse is on while the list is open, and off on every way out', async () => {
  const closings = [
    terminal => terminal.type(KEYS.enter),
    terminal => terminal.type(KEYS.ctrlC),
    terminal => terminal.exitEvents.emit('exit'),
  ]

  for (const close of closings) {
    const terminal = createTerminal()

    terminal
      .select({ message: 'Pick', items: projects, mouse: true })
      .catch(() => {})

    assert.ok(
      terminal.written.startsWith('\x1b[?25l\x1b[?1000h\x1b[?1003h\x1b[?1006h'),
    )

    terminal.reply(10)
    close(terminal)

    assert.ok(
      terminal.written.endsWith('\x1b[?1006l\x1b[?1003l\x1b[?1000l\x1b[?25h'),
    )
  }
})

test('a closing list waits for its last position reply, but not for long', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })

  let time = 0
  const terminal = createTerminal({ now: () => time })
  const first = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })
  let opened = false

  first.then(() => (opened = true))

  // Enter arrives before the reply: the list keeps reading until it comes,
  // ignoring any other input, so it never reaches the next reader.
  terminal.type(KEYS.enter, KEYS.down)
  await Promise.resolve()

  assert.equal(opened, false)
  assert.equal(terminal.input.listenerCount('data'), 1)
  assert.equal(terminal.screen()[0], '  Pick  api')

  terminal.reply(10)

  assert.equal(await first, 'api')
  assert.equal(terminal.input.listenerCount('data'), 0)

  // In the same chunk as the click that opens the item.
  const second = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  // 9 lines ending on row 10: api is on row 4.
  time += 300
  terminal.reply(10)
  terminal.hover(6)
  terminal.type('\x1b[<0;8;4M\x1b[10;1R\x1b[10;1R')

  assert.equal(await second, 'api')
  assert.equal(terminal.input.listenerCount('data'), 0)

  // A terminal that never replies.
  const third = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  terminal.type(KEYS.ctrlC)
  t.mock.timers.tick(100)

  await assert.rejects(third, { name: 'ExitPromptError' })
  assert.equal(terminal.input.isRaw, false)
})

test('a click selects an item and a second click opens it', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: [...projects, ...actions],
    mouse: true,
  })

  // 12 lines (message, 5 items, rule, 2 actions, help and the blank lines)
  // ending on row 20: api is on row 11, the rule on row 16.
  terminal.reply(20)
  terminal.click(13)

  assert.equal(terminal.screen()[4], '  ❯ 📁 design-system')

  // The help line, the rule, blank lines and rows outside the list do nothing.
  terminal.reply(20)
  terminal.click(20)
  terminal.click(16)
  terminal.click(10)
  terminal.click(8)

  assert.equal(terminal.screen()[4], '  ❯ 📁 design-system')

  terminal.click(13)

  assert.equal(await result, 'design-system')
})

test('Back and Exit entries can be clicked', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: [...projects, ...actions],
    mouse: true,
  })

  terminal.reply(20)
  terminal.click(18)
  terminal.reply(20)
  terminal.click(18)

  assert.equal(await result, null)
})

test('clicks are ignored briefly after an item opens', async () => {
  let time = 1000
  const terminal = createTerminal({ now: () => time })
  const first = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  // The first press of a double-click opens api, which is selected: 9 lines
  // ending on row 10 put it on row 4.
  terminal.reply(10)
  terminal.click(4)
  assert.equal(await first, 'api')

  const second = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  // The second press lands on the next list and is ignored.
  terminal.reply(10)
  terminal.click(5)
  assert.equal(terminal.screen()[2], '  ❯ 📁 api')

  time += 300
  terminal.click(5)
  terminal.reply(10)
  terminal.click(5)

  assert.equal(await second, 'billing-api')
})

test('clicks skip separators and disabled items', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: [
      { separator: 'Recent' },
      { label: 'web', value: 'web' },
      { label: 'old', value: 'old', disabled: '(no package.json)' },
      { label: 'api', value: 'api' },
    ],
    mouse: true,
  })

  // 8 lines ending on row 8: the separator is on row 3, old on row 5.
  terminal.reply(8)
  terminal.click(3)
  terminal.click(5)
  terminal.reply(8)

  assert.equal(terminal.screen()[3], '  ❯ web')

  terminal.click(6)
  terminal.reply(8)
  terminal.click(6)

  assert.equal(await result, 'api')
})

test('hover marks the item under the pointer, and the wheel moves the cursor', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  // 9 lines ending on row 10: design-system is on row 6.
  terminal.reply(10)
  terminal.hover(6)

  assert.deepEqual(terminal.screen().slice(2, 5), [
    '  ❯ 📁 api',
    '    📁 billing-api',
    '  › 📁 design-system',
  ])

  // Moving within the same item neither redraws nor asks again.
  terminal.reply(10)

  const before = terminal.written

  terminal.hover(6)
  assert.equal(terminal.written, before)

  terminal.type('\x1b[<65;8;6M', '\x1b[<65;8;6M')

  assert.deepEqual(terminal.screen().slice(2, 5), [
    '    📁 api',
    '    📁 billing-api',
    '  ❯ 📁 design-system',
  ])

  terminal.type('\x1b[<64;8;6M', KEYS.enter)

  assert.equal(await result, 'billing-api')
})

test('pressing the wheel opens the selected item, wherever the pointer is', async () => {
  let time = 0
  const terminal = createTerminal({ now: () => time })
  const first = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  assert.equal(
    terminal.screen()[8],
    '  ↑↓ move · Enter select · Middle-click select',
  )

  terminal.reply(10)
  // Scroll twice, then press the wheel over the help line.
  terminal.type('\x1b[<65;8;7M', '\x1b[<65;8;7M')
  terminal.reply(10)
  terminal.type('\x1b[<1;8;10M')

  assert.equal(await first, 'design-system')

  // Like a click, it is ignored right after an item opens.
  const second = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  terminal.reply(10)
  terminal.type('\x1b[<1;8;10M')
  terminal.reply(10)
  assert.equal(terminal.screen()[0], aligned('  Pick', 'type to search'))

  time += 300
  terminal.type('\x1b[<1;8;10M')

  assert.equal(await second, 'api')
})

test('clicks follow the list when it scrolls', async () => {
  const terminal = createTerminal({ rows: 8 })
  const items = Array.from({ length: 10 }, (_, index) => ({
    label: `project-${index}`,
    value: index,
  }))
  const result = terminal.select({ message: 'Pick', items, mouse: true })

  // 3 visible items, so 7 lines, ending on the last row.
  terminal.reply(8)
  terminal.type(KEYS.end)
  terminal.reply(8)

  assert.equal(terminal.screen()[2], '    project-7')

  // project-7 is on row 4, so project-8 on row 5.
  terminal.click(5)
  terminal.reply(8)
  terminal.click(5)

  assert.equal(await result, 8)
})

test('a position reply that was not asked for is ignored', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
  })

  terminal.reply(10)
  // Shift+F3 in some terminals looks like a reply.
  terminal.reply(1)
  terminal.click(5)

  assert.equal(terminal.screen()[3], '  ❯ 📁 billing-api')

  terminal.type(KEYS.enter)
  assert.equal(await result, 'billing-api')
})

test('a note is shown under the list, wrapped to its width', async () => {
  const terminal = createTerminal({ columns: 30 })
  const result = terminal.select({
    message: 'Pick',
    items: projects.slice(0, 1),
    note: 'Mouse support has not been checked here yet.',
  })

  assert.deepEqual(terminal.screen(), [
    aligned('  Pick', 'type to search', 29),
    '',
    '  ❯ 📁 api',
    '',
    '  ↑↓ move · Enter select',
    '',
    '  Mouse support has not been',
    '  checked here yet.',
  ])

  terminal.type(KEYS.enter)
  await result
})
