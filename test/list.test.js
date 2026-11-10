import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'

import { createList, drawLines, parseKeys } from '../lib/list.js'
import { createScreen } from '../lib/screen.js'
import { textWidth } from '../lib/width.js'

const KEYS = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
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

  terminal.screenState = createScreen({ output, exitEvents })
  terminal.createSelect = (options = {}) =>
    createList({
      input,
      output,
      exitEvents,
      screen: terminal.screenState,
      useColors: false,
      now,
      ...options,
    })
  terminal.select = terminal.createSelect()

  terminal.type = (...keys) => {
    for (const key of keys) input.emit('data', Buffer.from(key))
  }

  // Answer the last position request: the list's last line is on `row`.
  terminal.reply = row => terminal.type(`\x1b[${row};1R`)
  terminal.click = (row, column = 8) =>
    terminal.type(`\x1b[<0;${column};${row}M\x1b[<0;${column};${row}m`)
  terminal.hover = (row, column = 8) =>
    terminal.type(`\x1b[<35;${column};${row}M`)

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
const toolbar = [
  { label: '⚙ Workspace', value: 'change' },
  { label: '✕ Exit', value: null },
]

// A header that draws the toolbar it is given on its second line, as the
// box from ui.js does.
function testHeader(width, { toolbar = [] } = {}) {
  return [
    [['  '], ['◆ home'], [' ']],
    [['  '], ...toolbar],
  ]
}

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
    { name: 'tab' },
  ])
  assert.deepEqual(parseKeys('\x1b[C\x1bOD\x1b[Z'), [
    { name: 'right' },
    { name: 'left' },
    { name: 'shift-tab' },
  ])
})

test('parseKeys tells Escape apart from escape sequences', () => {
  assert.deepEqual(parseKeys('\x1b'), [{ name: 'escape' }])
  assert.deepEqual(parseKeys('\x1b\x1b[A'), [
    { name: 'escape' },
    { name: 'up' },
  ])
  // Alt+x and F5 are recognised and ignored.
  assert.deepEqual(parseKeys('\x1bx\x1b[15~'), [])
  assert.deepEqual(parseKeys('é😀'), [
    { name: 'char', text: 'é' },
    { name: 'char', text: '😀' },
  ])
})

test('select draws the list and returns the chosen value', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Select a project',
    items: projects,
  })

  assert.deepEqual(terminal.screen(), [
    aligned('  Select a project', 'type to search'),
    '',
    '  ❯ 📁 api',
    '    📁 billing-api',
    '    📁 design-system',
    '    📁 docs',
    '    📁 web',
    '',
    '  ↑↓ move · enter select',
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

test('select stops reading before it leaves raw mode', async () => {
  const terminal = createTerminal()
  const steps = []
  const { pause, setRawMode } = terminal.input

  terminal.input.pause = () => {
    steps.push('pause')
    pause()
  }
  terminal.input.setRawMode = mode => {
    steps.push(`raw ${mode}`)
    setRawMode(mode)
  }

  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type(KEYS.enter)
  await result

  // On Windows, leaving raw mode while reading starts a line-mode read that
  // waits for Enter.
  assert.deepEqual(steps, ['raw true', 'pause', 'raw false'])
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

test('typing filters the list, best match first', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Select a project',
    items: projects,
    toolbar,
    header: testHeader,
  })

  terminal.type('a', 'p', 'i')

  // Buttons never match a search.
  assert.deepEqual(terminal.screen().slice(3), [
    '  Select a project  api',
    '',
    '  ❯ 📁 api',
    '    📁 billing-api',
    '',
    '  ↑↓ move · enter select · tab buttons · esc clear search',
  ])

  terminal.type(KEYS.down, KEYS.enter)

  assert.equal(await result, 'billing-api')
})

test('Backspace edits the search and Escape clears it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
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

  // The full list is back, with the cursor kept.
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
    ],
    default: 'build',
  })

  assert.deepEqual(terminal.screen(), [
    aligned('  Select a script', 'type to search'),
    '',
    '    dev    vite',
    aligned('  ❯ build  vite build', 'last run'),
    '',
    '  ↑↓ move · enter select',
  ])

  terminal.type(KEYS.enter)
  assert.equal(await result, 'build')
})

test('items load their details once, when first drawn', async () => {
  const terminal = createTerminal({ rows: 10 })
  const asked = []
  let fail
  const items = Array.from({ length: 20 }, (_, index) => ({
    label: `p${index + 1}`,
    value: index + 1,
    load: () => {
      asked.push(index + 1)

      if (index === 1) {
        return new Promise((resolve, reject) => {
          fail = reject
        })
      }

      return Promise.resolve({ detail: `${index + 1} scripts`, hint: 'npm' })
    },
  }))
  const result = terminal.select({ message: 'Pick', items })

  // Only the items in view are read, and the list redraws once they arrive.
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(asked, [1, 2, 3, 4, 5])
  assert.equal(terminal.screen()[2], aligned('  ❯ p1   1 scripts', 'npm'))
  assert.equal(terminal.screen()[3], '    p2')

  // A failed load leaves the item as it is, and is not tried again.
  fail(new Error('unreadable'))
  await new Promise(resolve => setImmediate(resolve))
  terminal.type(KEYS.down, KEYS.up)
  assert.equal(terminal.screen()[3], '    p2')
  assert.deepEqual(asked, [1, 2, 3, 4, 5])

  terminal.type(KEYS.pageDown, KEYS.pageDown)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(asked, [1, 2, 3, 4, 5, 6, 7, 8, 9])

  terminal.type(KEYS.enter)
  assert.equal(await result, 9)
})

test('a loaded detail keeps its end, such as the Git branch', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: [
      {
        label: 'api',
        value: 'api',
        load: async () => ({
          detail: '2 scripts',
          detailEnd: [[' · main', 'green']],
          hint: 'npm',
        }),
      },
    ],
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(
    terminal.screen()[2],
    aligned('  ❯ api  2 scripts · main', 'npm'),
  )

  terminal.type(KEYS.enter)
  assert.equal(await result, 'api')
})

test('details that arrive after the list closes are not drawn', async () => {
  const terminal = createTerminal()
  let finish
  const result = terminal.select({
    message: 'Pick',
    items: [
      {
        label: 'api',
        value: 'api',
        load: () =>
          new Promise(resolve => {
            finish = resolve
          }),
      },
    ],
  })

  await new Promise(resolve => setImmediate(resolve))
  terminal.type(KEYS.enter)
  assert.equal(await result, 'api')

  const written = terminal.written

  finish({ detail: 'late' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(terminal.written, written)
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
  assert.equal(terminal.screen().at(-2), '  ▼ 1 more')

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
  const select = terminal.createSelect({ useColors: true })
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
  // the hint lines around the items.
  assert.equal(terminal.screen().length, 9)
  assert.equal(terminal.screen()[1], '')
  assert.equal(terminal.screen().at(-2), '  ▼ 35 more')

  terminal.type(KEYS.pageDown)
  assert.ok(terminal.screen().includes('  ❯ project-5'))

  terminal.type(KEYS.down)
  assert.equal(terminal.screen()[1], '  ▲ 1 more')
  assert.equal(terminal.screen().at(-2), '  ▼ 34 more')

  terminal.type(KEYS.end)
  assert.equal(terminal.screen().at(-3), '  ❯ project-40')
  assert.equal(terminal.screen().at(-2), '')

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
  const select = terminal.createSelect({ useColors: true })
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
    items: projects,
    mouse: true,
  })

  // 9 lines (message, 5 items, help and the blank lines) ending on row 20:
  // the message is on row 12, api on row 14.
  terminal.reply(20)
  terminal.click(16)

  assert.equal(terminal.screen()[4], '  ❯ 📁 design-system')

  // The help line, blank lines and rows outside the list do nothing.
  terminal.reply(20)
  terminal.click(20)
  terminal.click(19)
  terminal.click(13)
  terminal.click(8)

  assert.equal(terminal.screen()[4], '  ❯ 📁 design-system')

  terminal.click(16)

  assert.equal(await result, 'design-system')
})

test('with clickOpens, one click opens an item', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    mouse: true,
    clickOpens: true,
  })

  terminal.reply(20)
  terminal.click(15)

  assert.equal(await result, 'billing-api')
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
    '  ↑↓ move · enter select · middle-click select',
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
    '  ↑↓ move · enter select',
    '',
    '  Mouse support has not been',
    '  checked here yet.',
  ])

  terminal.type(KEYS.enter)
  await result
})

test('Escape clears the search, then goes back with an empty search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    escape: { value: 'back', label: 'back' },
  })

  assert.equal(terminal.screen().at(-1), '  ↑↓ move · enter select · esc back')

  terminal.type('w', KEYS.escape)
  t.mock.timers.tick(50)

  // Only the search was cleared.
  assert.ok(terminal.screen()[0].includes('type to search'))
  assert.ok(terminal.screen().includes('  ❯ 📁 web'))

  // An arrow key split over two chunks is still not Escape.
  terminal.type('\x1b')
  t.mock.timers.tick(49)
  terminal.type('[A')
  assert.ok(terminal.screen().includes('  ❯ 📁 docs'))

  terminal.type(KEYS.escape)
  t.mock.timers.tick(50)

  assert.equal(await result, 'back')
})

test('without an escape value, Escape on an empty search does nothing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const result = terminal.select({ message: 'Pick', items: projects })

  terminal.type(KEYS.escape)
  t.mock.timers.tick(50)
  terminal.type(KEYS.enter)

  assert.equal(await result, 'api')
})

test('toolbar buttons sit in the header and are clicked by column', async () => {
  const terminal = createTerminal({ columns: 80 })
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    toolbar,
    header: testHeader,
    mouse: true,
    fullscreen: true,
  })

  assert.deepEqual(terminal.screen().slice(0, 4), [
    '  ◆ home ',
    '   ⚙ Workspace  ✕ Exit ',
    '',
    aligned('  Pick', 'type to search', 79),
  ])
  assert.equal(
    terminal.screen().at(-1),
    '  ↑↓ move · enter select · middle-click select · tab buttons',
  )
  // On the alternate screen, rows count from the top: nothing to ask.
  assert.ok(!terminal.written.includes('\x1b[6n'))

  // The margin and the columns past the last button do nothing.
  terminal.click(2, 2)
  terminal.click(2, 24)
  assert.equal(terminal.screen()[5], '  ❯ 📁 api')

  terminal.click(2, 18)

  assert.equal(await result, null)
})

test('↑ on the first item moves to the buttons, one by one', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    toolbar,
    header: testHeader,
  })
  const buttons = () => terminal.screen()[1]

  terminal.type(KEYS.down, KEYS.up)
  assert.equal(buttons(), '   ⚙ Workspace  ✕ Exit ')

  // Without colours, brackets replace the spaces around a focused button.
  terminal.type(KEYS.up)
  assert.equal(buttons(), '  [⚙ Workspace] ✕ Exit ')
  assert.match(terminal.screen().at(-1), /enter press/)

  // ↑ again goes on to the next button, and stays at the last one.
  terminal.type(KEYS.up, KEYS.up)
  assert.equal(buttons(), '   ⚙ Workspace [✕ Exit]')

  // ↓ comes back the same way, to the first item.
  terminal.type(KEYS.down, KEYS.down)
  assert.equal(buttons(), '   ⚙ Workspace  ✕ Exit ')
  assert.ok(terminal.screen().includes('  ❯ 📁 api'))

  terminal.type(KEYS.up, KEYS.enter)

  assert.equal(await result, 'change')
})

test('the wheel reaches the buttons, and pressing it presses one', async () => {
  let time = 0
  const terminal = createTerminal({ now: () => time })
  const options = {
    message: 'Pick',
    items: projects,
    toolbar,
    header: testHeader,
    mouse: true,
    fullscreen: true,
  }
  const first = terminal.select(options)
  const wheelUp = '\x1b[<64;8;12M'
  const wheelDown = '\x1b[<65;8;12M'
  const middle = '\x1b[<1;8;12M'

  terminal.type(wheelDown, wheelUp, wheelUp, wheelUp)
  assert.equal(terminal.screen()[1], '   ⚙ Workspace [✕ Exit]')

  terminal.type(middle)
  assert.equal(await first, null)

  // Back down to the list, pressing the wheel opens the item again.
  const second = terminal.select(options)

  time += 300
  terminal.type(wheelUp, wheelDown, wheelDown, middle)
  assert.equal(await second, 'billing-api')
})

test('Tab and the arrow keys move the focus between buttons', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    toolbar,
    header: testHeader,
  })
  const buttons = () => terminal.screen()[1]

  terminal.type('\t')
  assert.equal(buttons(), '  [⚙ Workspace] ✕ Exit ')

  terminal.type(KEYS.right)
  assert.equal(buttons(), '   ⚙ Workspace [✕ Exit]')

  // At the last button, → stays; ← goes back, and Shift+Tab too.
  terminal.type(KEYS.right, KEYS.left, '\x1b[Z')
  assert.equal(buttons(), '   ⚙ Workspace  ✕ Exit ')

  // From the list, Shift+Tab goes round to the last button.
  terminal.type('\x1b[Z')
  assert.equal(buttons(), '   ⚙ Workspace [✕ Exit]')

  // Page Down returns to the list.
  terminal.type(KEYS.pageDown)
  assert.equal(buttons(), '   ⚙ Workspace  ✕ Exit ')

  terminal.type('\t', KEYS.enter)

  assert.equal(await result, 'change')
})

test('typing returns the focus to the list and searches', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    toolbar,
    header: testHeader,
  })

  terminal.type('\t', 'w', KEYS.enter)

  assert.equal(await result, 'web')
})

test('a focused button is drawn reversed in the accent, a hovered one on grey', async () => {
  const terminal = createTerminal()
  const select = terminal.createSelect({ useColors: true })
  const result = select({
    message: 'Pick',
    items: projects,
    toolbar,
    header: testHeader,
    mouse: true,
    fullscreen: true,
  })

  terminal.type('\t')
  assert.ok(
    terminal
      .screen()[1]
      .includes('\x1b[7m\x1b[36m ⚙ Workspace \x1b[39m\x1b[27m'),
  )

  terminal.hover(2, 18)
  assert.ok(
    terminal.screen()[1].includes('\x1b[100m\x1b[36m ✕ Exit \x1b[39m\x1b[49m'),
  )

  terminal.type(KEYS.enter)
  assert.equal(await result, 'change')
})

const scripts = [
  { label: 'dev', value: 'dev', detail: 'vite', hint: 'last run' },
  { label: 'build', value: 'build', detail: 'vite build' },
]
const rowButtons = [
  { label: '▶ run', value: value => `run ${value}` },
  { label: '… args', value: value => `args ${value}`, right: true },
]

test('the hovered item shows its row buttons in place of its tag', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: scripts,
    rowButtons,
    mouse: true,
    fullscreen: true,
  })

  assert.equal(terminal.screen()[2], aligned('  ❯ dev    vite', 'last run'))
  assert.equal(
    terminal.screen().at(-1),
    '  ↑↓ move · enter select · middle-click select · → args',
  )

  terminal.hover(4)
  assert.equal(terminal.screen()[2], aligned('  ❯ dev    vite', 'last run'))
  assert.equal(
    terminal.screen()[3],
    // A divider keeps the two buttons apart.
    aligned('  › build  vite build', ' ▶ run │ … args '),
  )

  // ▶ run covers columns 44 to 50 of the row.
  terminal.click(4, 47)

  assert.equal(await result, 'run build')
})

test('→ presses the right row button of the selected item', async () => {
  const terminal = createTerminal()
  const result = terminal.select({
    message: 'Pick',
    items: scripts,
    rowButtons,
  })

  // Without the mouse, the buttons never show.
  assert.ok(!terminal.screen().join('\n').includes('▶ run'))

  terminal.type(KEYS.down, KEYS.left, KEYS.right)

  assert.equal(await result, 'args build')
})

test('a click on a scroll hint moves a page', async () => {
  const terminal = createTerminal({ rows: 10 })
  const items = Array.from({ length: 40 }, (_, index) => ({
    label: `project-${index + 1}`,
    value: index + 1,
  }))
  const result = terminal.select({
    message: 'Pick',
    items,
    mouse: true,
    fullscreen: true,
  })

  // On the alternate screen no row stays free: 6 items, from row 3.
  assert.equal(terminal.screen().length, 10)
  assert.equal(terminal.screen()[8], '  ▼ 34 more')

  terminal.click(9, 4)
  terminal.click(9, 4)
  assert.equal(terminal.screen()[1], '  ▲ 5 more')
  assert.equal(terminal.screen()[7], '  ❯ project-11')

  terminal.click(2, 4)
  assert.equal(terminal.screen()[2], '  ❯ project-6')

  terminal.type(KEYS.enter)
  assert.equal(await result, 6)
})

test('a list of buttons starts on the first one, and keys press them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const terminal = createTerminal()
  const options = {
    body: [['No scripts.', 'yellow']],
    buttons: [
      { label: '↻ Run again', value: 'again', key: 'r' },
      { label: '← Back', value: 'back' },
    ],
    escape: { value: 'back', label: 'back' },
    searchable: false,
  }
  const first = terminal.select(options)

  assert.deepEqual(terminal.screen(), [
    '  No scripts.',
    '',
    ' [↻ Run again] ← Back ',
    '',
    '  enter press · ←→ move · r run again · esc back',
  ])

  terminal.type(KEYS.right)
  assert.equal(terminal.screen()[2], '  ↻ Run again [← Back]')

  terminal.type('x', 'R')
  assert.equal(await first, 'again')

  const second = terminal.select(options)

  terminal.type(KEYS.escape)
  t.mock.timers.tick(50)
  assert.equal(await second, 'back')

  const third = terminal.select(options)

  terminal.type('\t', KEYS.enter)
  assert.equal(await third, 'back')
})

test('a fullscreen list draws on the alternate screen, from the top', async () => {
  const terminal = createTerminal({ rows: 6 })
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    header: testHeader,
    note: 'A note.',
    fullscreen: true,
  })

  assert.ok(terminal.written.startsWith('\x1b[?1049h'))
  assert.equal(terminal.screenState.active, true)
  // Never taller than the window.
  assert.equal(terminal.screen().length, 6)

  // A resize redraws everything from the top-left corner, header included.
  terminal.written = ''
  terminal.output.columns = 30
  terminal.output.emit('resize')
  assert.ok(terminal.written.startsWith('\x1b[H\x1b[J  ◆ home'))

  terminal.type(KEYS.enter)
  assert.equal(await result, 'api')
  // The next screen draws over it.
  assert.equal(terminal.screenState.active, true)

  // An inline list leaves the alternate screen first.
  terminal.written = ''
  const next = terminal.select({ message: 'Pick', items: projects })

  assert.ok(terminal.written.startsWith('\x1b[?1049l'))
  assert.equal(terminal.screenState.active, false)

  terminal.type(KEYS.enter)
  await next
})

test('drawLines draws lines once, at the width a list uses', () => {
  const widths = []
  const build = width => {
    widths.push(width)
    return [[['  '], ['done', 'green']], [['x'.repeat(200)]]]
  }

  assert.deepEqual(drawLines(build, { columns: 40, useColors: false }), [
    '  done',
    'x'.repeat(39),
  ])
  assert.equal(
    drawLines(build, { columns: 300, useColors: true })[0],
    '  \x1b[32mdone\x1b[39m',
  )
  assert.deepEqual(widths, [39, 100])
})

test('an item style colours its label until it is selected', async () => {
  const terminal = createTerminal()
  const select = terminal.createSelect({ useColors: true })
  const result = select({
    message: 'Pick',
    items: [
      { label: 'dev', value: 1, style: 'red' },
      { label: 'test', value: 2, style: 'yellow' },
    ],
  })

  const [first, second] = terminal.screen().slice(2, 4)

  // The selected item is in the accent, the other in its own style.
  assert.ok(first.includes('\x1b[36md'), JSON.stringify(first))
  assert.ok(second.includes('\x1b[33mt'), JSON.stringify(second))

  terminal.type(KEYS.enter)
  await result
})

test('preview is called with the selected value before each drawing', async () => {
  const terminal = createTerminal()
  const previewed = []
  const result = terminal.select({
    message: 'Pick',
    items: projects,
    default: 'docs',
    preview: value => previewed.push(value),
  })

  terminal.type(KEYS.down)

  assert.deepEqual(previewed, ['docs', 'web'])

  terminal.type(KEYS.enter)
  assert.equal(await result, 'web')
})

test('a detail end can be segments with their own styles', async () => {
  const terminal = createTerminal({ columns: 40 })
  const select = terminal.createSelect({ useColors: true })
  const result = select({
    message: 'Pick',
    items: [
      {
        label: 'api',
        value: 1,
        detail: '2 scripts',
        detailEnd: [
          [' · ', 'dim'],
          ['main', 'green'],
        ],
      },
      {
        label: 'web',
        value: 2,
        detail: `${'x'.repeat(60)}`,
        detailEnd: [[' · feat', 'yellow']],
      },
    ],
  })

  const [api, web] = terminal.screen().slice(2, 4)

  assert.ok(
    api.includes('\x1b[2m2 scripts\x1b[22m\x1b[2m · \x1b[22m\x1b[32mmain'),
    JSON.stringify(api),
  )
  // The detail is cut, the end kept whole.
  assert.ok(web.includes('…\x1b[22m\x1b[33m · feat'), JSON.stringify(web))

  terminal.type(KEYS.enter)
  await result
})

test('a hint style colours the tag, not the label', async () => {
  const terminal = createTerminal()
  const select = terminal.createSelect({ useColors: true })
  const result = select({
    message: 'Pick',
    items: [
      { label: 'dev', value: 1 },
      { label: 'build', value: 2, hint: 'last run', hintStyle: 'accent' },
    ],
  })

  const line = terminal.screen()[3]

  assert.ok(line.includes('\x1b[36mlast run\x1b[39m'), JSON.stringify(line))
  assert.ok(line.includes('  build'), JSON.stringify(line))

  terminal.type(KEYS.enter)
  await result
})

test('row buttons are divided by a line in the faint accent', async () => {
  const terminal = createTerminal()
  const select = terminal.createSelect({ useColors: true })
  const result = select({
    message: 'Pick',
    items: scripts,
    rowButtons,
    mouse: true,
    fullscreen: true,
  })

  terminal.hover(4)

  const line = terminal.screen()[3]

  assert.ok(
    line.includes('\x1b[2m\x1b[36m│\x1b[39m\x1b[22m'),
    JSON.stringify(line),
  )

  terminal.type(KEYS.enter)
  await result
})
