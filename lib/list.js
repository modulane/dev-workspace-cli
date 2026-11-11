// The list behind every menu: keys, mouse, search, buttons and drawing.
// Used by prompts.js, and by cli.js for drawLines().

import { StringDecoder } from 'node:string_decoder'

import { fuzzyFilter } from './fuzzy.js'
import { screen as sharedScreen } from './screen.js'
import { USE_COLORS, styleText } from './ui.js'
import { fitText, textWidth, truncateText, wrapText } from './width.js'

const ESC = '\x1b'
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const CLEAR_DOWN = `${ESC}[J`
const CURSOR_HOME = `${ESC}[H`
// Report presses (1000) and every motion (1003) in SGR format (1006).
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1003h${ESC}[?1006h`
const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l`
const REQUEST_POSITION = `${ESC}[6n`

// Signals that end the process without an exit event.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

// How long clicks are ignored after an item opens, and how long a closing
// list waits for its last position replies, in milliseconds.
const OPEN_DELAY = 300
const REPLY_TIMEOUT = 100

// The widest a line gets, so the columns stay together on wide terminals,
// and the widest the label column gets before details move further right.
export const MAX_WIDTH = 100
const MAX_LABEL_WIDTH = 32

export class ExitPromptError extends Error {
  name = 'ExitPromptError'
}

const SEQUENCES = {
  [`${ESC}[A`]: 'up',
  [`${ESC}OA`]: 'up',
  [`${ESC}[B`]: 'down',
  [`${ESC}OB`]: 'down',
  [`${ESC}[C`]: 'right',
  [`${ESC}OC`]: 'right',
  [`${ESC}[D`]: 'left',
  [`${ESC}OD`]: 'left',
  [`${ESC}[Z`]: 'shift-tab',
  [`${ESC}[5~`]: 'pageup',
  [`${ESC}[6~`]: 'pagedown',
  [`${ESC}[H`]: 'home',
  [`${ESC}OH`]: 'home',
  [`${ESC}[1~`]: 'home',
  [`${ESC}[7~`]: 'home',
  [`${ESC}[F`]: 'end',
  [`${ESC}OF`]: 'end',
  [`${ESC}[4~`]: 'end',
  [`${ESC}[8~`]: 'end',
}

const CONTROLS = {
  '\r': 'enter',
  '\n': 'enter',
  '\t': 'tab',
  '\x7f': 'backspace',
  '\b': 'backspace',
  '\x03': 'ctrl-c',
  '\x15': 'ctrl-u',
}

// CSI sequences (ESC [ … final byte) and SS3 sequences (ESC O x). Unknown
// ones, such as function keys, are recognised and ignored.
const CSI = new RegExp(`^${ESC}\\[[0-9;<=>?]*[ -/]*[@-~]`)
const SS3 = new RegExp(`^${ESC}O.`)

// ESC [ < button ; column ; row, then M for a press or m for a release.
const MOUSE_REPORT = new RegExp(`^${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`)
// ESC [ row ; column R, the reply to REQUEST_POSITION.
const POSITION_REPORT = new RegExp(`^${ESC}\\[(\\d+);(\\d+)R$`)

// The start of a CSI or SS3 sequence, or a lone ESC, at the end of the input.
const UNFINISHED = new RegExp(`${ESC}(\\[[0-9;<=>?]*[ -/]*|O)?$`)

// How long a lone ESC waits for the rest of a sequence, in milliseconds.
const ESCAPE_DELAY = 50

function mouseKey([, code, column, row, final]) {
  const button = Number(code)
  let type

  // Bit 64 marks the wheel, bit 32 motion; the low bits are the button.
  if (button & 64) type = button & 1 ? 'wheel-down' : 'wheel-up'
  else if (button & 32) type = 'move'
  else type = ['left', 'middle', 'right', 'none'][button & 3]

  return {
    name: 'mouse',
    type,
    column: Number(column),
    row: Number(row),
    released: final === 'm',
  }
}

// Turn raw terminal input into keys: { name } or { name: 'char', text },
// mouse reports into { name: 'mouse', type, column, row, released } and
// cursor position replies into { name: 'position', row, column }.
export function parseKeys(text) {
  const keys = []
  let rest = text

  while (rest) {
    if (rest.startsWith(ESC)) {
      const sequence = CSI.exec(rest)?.[0] ?? SS3.exec(rest)?.[0]

      if (sequence) {
        const mouse = MOUSE_REPORT.exec(sequence)
        const position = POSITION_REPORT.exec(sequence)

        if (mouse) keys.push(mouseKey(mouse))
        else if (position) {
          keys.push({
            name: 'position',
            row: Number(position[1]),
            column: Number(position[2]),
          })
        } else if (SEQUENCES[sequence]) keys.push({ name: SEQUENCES[sequence] })
        rest = rest.slice(sequence.length)
        continue
      }

      // A lone Escape, or Escape before another Escape. ESC + a character is
      // Alt+character, which the list does not use.
      if (rest.length === 1 || rest[1] === ESC) keys.push({ name: 'escape' })
      rest = rest.slice(rest.length === 1 || rest[1] === ESC ? 1 : 2)
      continue
    }

    if (rest.startsWith('\r\n')) {
      keys.push({ name: 'enter' })
      rest = rest.slice(2)
      continue
    }

    const [character] = rest

    if (CONTROLS[character]) {
      keys.push({ name: CONTROLS[character] })
    } else if (character >= ' ') {
      keys.push({ name: 'char', text: character })
    }

    rest = rest.slice(character.length)
  }

  return keys
}

// Without colours, a focused button is framed by brackets in place of the
// spaces around its text, so it keeps its width.
// Every button is one segment, ` label `.
function bracket(parts, id) {
  const part = parts.find(part => part.target === id)

  if (part) part.text = `[${part.text.slice(1, -1)}]`
}

// A line is a list of [text, ...styles] segments, cut to `width` columns
// before the styles are applied, so escape codes never count as width. A
// segment holding a { target } is part of that button: it is drawn in the
// accent when focused (reversed) or hovered (on grey), and its columns (from 1) are returned in `targets`.
function renderLine(segments, width, useColors, { focus, hover } = {}) {
  const parts = segments.map(([text, ...rest]) => {
    const target = rest.find(part => typeof part === 'object')?.target
    const styles = rest.filter(part => typeof part === 'string')

    // In the accent: reversed when focused, on grey when hovered.
    if (target !== undefined && target === focus) {
      styles.push('accent', 'focus')
    } else if (target !== undefined && target === hover) {
      styles.push('accent', 'hover')
    }

    return { text, styles, target }
  })

  if (!useColors && focus !== undefined) bracket(parts, focus)

  const targets = []
  let used = 0
  let line = ''

  for (const { text, styles, target } of parts) {
    const part = fitText(text, width - used)
    const size = textWidth(part)

    if (target !== undefined && size > 0) {
      const previous = targets.at(-1)

      if (previous?.id === target && previous.to === used) {
        previous.to = used + size
      } else targets.push({ id: target, from: used + 1, to: used + size })
    }

    used += size

    if (!part) continue

    line += styleText(part, styles, useColors)

    if (part.length < text.length) break
  }

  return { text: line, targets }
}

// The width every line is drawn at: the terminal's, less one column, up to
// MAX_WIDTH.
function widthFor(columns) {
  return Math.min(MAX_WIDTH, Math.max(10, (columns || 80) - 1))
}

// Lines drawn once, outside any list, as a list would draw them: `build`
// returns the lines of segments for a width, such as the header box from
// ui.js. Returns the drawn lines as strings.
export function drawLines(
  build,
  { columns = process.stdout.columns, useColors = USE_COLORS } = {},
) {
  const width = widthFor(columns)

  return build(width).map(line => renderLine(line, width, useColors).text)
}

const isSelectable = item => !item.separator && !item.disabled

// An item's icon and label, as drawn after its marker.
const labelText = item =>
  item.icon ? `${item.icon} ${item.label}` : item.label

// A row button's label without its symbol, for the help line: "args".
const helpName = label => label.replace(/^\S+\s+/, '')

// Returns select(options), which resolves with the value of the chosen item,
// with `escape.value` for Escape on an empty search, or with the value of a
// pressed button; Ctrl+C rejects with an ExitPromptError. Tests pass fake
// input and output streams, and a screen from createScreen().
//
// The main options:
//
//   items       { label, value, icon, detail, detailEnd, hint, hintStyle,
//               disabled, load, style } or { separator }. `load` returns a
//               promise of { detail, detailEnd, hint }, called the first
//               time the item is drawn.
//   toolbar     [{ label, value }] in the header box
//   buttons     [{ label, value, key }] on a row under the body
//   rowButtons  [{ label, value(itemValue), right }] on the hovered item;
//               → presses the one marked `right`
//   header      a function of (width, { toolbar }) returning lines, such as
//               the box from ui.js
//   body        lines shown above the message, such as an error
//   fullscreen  draw on the alternate screen instead of inline
//   mouse       turn mouse reporting on while the list is open
//   preview     called with the selected value before each drawing
//
// A line is a list of [text, ...styles] segments (see renderLine).
export function createList({
  input = process.stdin,
  output = process.stdout,
  exitEvents = process,
  screen = sharedScreen,
  useColors = USE_COLORS,
  escapeDelay = ESCAPE_DELAY,
  now = () => Date.now(),
} = {}) {
  // Clicks before this time are the end of a double-click that opened the
  // previous list's item.
  let clicksFrom = 0

  return function select({
    message = '',
    items = [],
    default: defaultValue,
    pageSize = 15,
    searchable = true,
    mouse = false,
    note,
    header,
    body = [],
    fullscreen = false,
    clickOpens = false,
    enter = 'select',
    escape,
    toolbar = [],
    buttons = [],
    rowButtons = [],
    preview,
  }) {
    let query = ''
    let rows = []
    let cursor = -1
    let top = 0
    // The width of each line of the last drawing (inline lists).
    let painted = []
    // The screen row of the first line, from the terminal's position reply
    // (always 1 on the alternate screen), and the line count of each drawing
    // whose reply has not arrived yet.
    let firstRow = fullscreen ? 1 : null
    const positionRequests = []
    // The screen cell under the mouse pointer.
    let pointer = null
    // For each line of the last drawing: the index in `rows` of its item,
    // and the columns of its buttons.
    let lineItems = []
    let lineTargets = []
    // What each item's `load` resolved with, and the items already asked.
    const loaded = new Map()
    const loading = new Set()
    // Redraws the open list; set while it is open.
    let redraw = null

    const showItems = items.length > 0
    const rightButton = rowButtons.findIndex(button => button.right)
    // The buttons ↑ and Tab reach, in order, after the list.
    const focusable = [
      ...toolbar.map((_, index) => `toolbar:${index}`),
      ...buttons.map((_, index) => `button:${index}`),
    ]
    // 'list', or the id of the focused button.
    let focus =
      items.some(isSelectable) || focusable.length === 0 ? 'list' : focusable[0]

    // Labels line up in a column, as wide as the widest one (icon included),
    // up to MAX_LABEL_WIDTH.
    const labelWidth = Math.min(
      MAX_LABEL_WIDTH,
      Math.max(
        0,
        ...items
          .filter(item => !item.separator)
          .map(item => textWidth(labelText(item))),
      ),
    )

    function lineWidth() {
      return widthFor(output.columns)
    }

    function toolbarSegments() {
      return toolbar.map(({ label }, index) => [
        ` ${label} `,
        { target: `toolbar:${index}` },
      ])
    }

    function headerLines(width) {
      if (!header) return []

      return header(width, toolbar.length ? { toolbar: toolbarSegments() } : {})
    }

    function buttonLine() {
      return [
        [' '],
        ...buttons.map(({ label }, index) => [
          ` ${label} `,
          { target: `button:${index}` },
        ]),
      ]
    }

    function noteLines(width) {
      return note ? wrapText(note, width - 2) : []
    }

    function filter() {
      if (!query) return items.map(item => ({ item, positions: [] }))

      return fuzzyFilter(
        items.filter(item => !item.separator),
        query,
        item => item.label,
      )
    }

    function firstSelectable() {
      return rows.findIndex(row => isSelectable(row.item))
    }

    // As many items as fit in the window next to everything else the list
    // draws: the message, the hint lines above and below the items and the
    // help line, the header, body, buttons and note with a blank line after
    // each, and the blank line before each separator. An inline list keeps
    // the last row free.
    function visibleRows() {
      const width = lineWidth()
      const parts = [
        headerLines(width),
        body,
        buttons.length ? [buttons] : [],
        noteLines(width),
      ]
      let others = 4

      for (const lines of parts) if (lines.length) others += lines.length + 1

      others += rows.filter(row => row.item.separator).length

      const room = (output.rows || 24) - others - (fullscreen ? 0 : 1)

      return Math.max(3, Math.min(pageSize, room))
    }

    // Keep the cursor inside the window, and show a separator that sits
    // directly above the first item instead of scrolling past it.
    function scrollToCursor() {
      const size = visibleRows()

      if (cursor === -1 || cursor === firstSelectable()) top = 0
      else if (cursor < top) top = cursor
      else if (cursor >= top + size) top = cursor - size + 1

      top = Math.max(0, Math.min(top, rows.length - size))
    }

    function update(selectValue) {
      rows = filter()

      const kept = rows.findIndex(
        row => isSelectable(row.item) && row.item.value === selectValue,
      )

      cursor = kept === -1 ? firstSelectable() : kept
      scrollToCursor()
    }

    // Move to the next selectable item in `direction`, `steps` times.
    function move(direction, steps = 1) {
      let index = cursor

      for (let step = 0; step < steps; step++) {
        let next = index + direction

        while (
          next >= 0 &&
          next < rows.length &&
          !isSelectable(rows[next].item)
        )
          next += direction

        if (next < 0 || next >= rows.length) break

        index = next
      }

      focus = 'list'
      cursor = index
      scrollToCursor()
    }

    function moveToEnd(direction) {
      move(direction, rows.length)
    }

    // The index in `rows` of the selectable item drawn under the pointer, or
    // -1.
    function itemAt(cell) {
      if (firstRow === null || cell === null) return -1

      const index = lineItems[cell.row - firstRow]

      if (index === undefined || index >= rows.length) return -1

      return isSelectable(rows[index].item) ? index : -1
    }

    // The id of the button drawn under the pointer, or undefined.
    function targetAt(cell) {
      if (firstRow === null || cell === null) return undefined

      return lineTargets[cell.row - firstRow]?.find(
        ({ from, to }) => cell.column >= from && cell.column <= to,
      )?.id
    }

    // What the list resolves with, and the label its summary shows.
    function chooseItem(index) {
      const { item } = rows[index]

      return { value: item.value, label: item.label }
    }

    function pressRowButton(buttonIndex, rowIndex) {
      const { item } = rows[rowIndex]

      return {
        value: rowButtons[buttonIndex].value(item.value),
        label: item.label,
      }
    }

    // Press the button with this id: resolve with its value, or, for a
    // scroll hint, move a page.
    function press(id) {
      const [kind, first, second] = id.split(':')

      switch (kind) {
        case 'toolbar':
          return toolbar[first]
        case 'button':
          return buttons[first]
        case 'row':
          return pressRowButton(Number(first), Number(second))
        case 'up':
          return move(-1, visibleRows() - 1)
        case 'down':
          return move(1, visibleRows() - 1)
      }
    }

    // ↑ and the wheel: past the first item, on to the buttons, one by one.
    function up() {
      if (focus === 'list') {
        const atTop = cursor === -1 || cursor === firstSelectable()

        if (!atTop || focusable.length === 0) return move(-1)

        focus = focusable[0]
        return
      }

      const index = focusable.indexOf(focus) + 1

      if (index >= focusable.length) return 'unchanged'

      focus = focusable[index]
    }

    // ↓ and the wheel: back from the buttons to the list.
    function down() {
      if (focus === 'list') return move(1)

      const index = focusable.indexOf(focus) - 1

      if (index >= 0) focus = focusable[index]
      else if (items.some(isSelectable)) focus = 'list'
      else return 'unchanged'
    }

    // Tab and Shift+Tab: the list, then each button, then the list again.
    // A list without selectable items is left out.
    function cycleFocus(direction) {
      const ring = items.some(isSelectable) ? ['list', ...focusable] : focusable

      if (ring.length < 2 && ring[0] === focus) return 'unchanged'

      const index = Math.max(0, ring.indexOf(focus))

      focus = ring[(index + direction + ring.length) % ring.length]
    }

    // ←/→ between buttons; → on an item presses its `right` row button.
    function sideways(direction) {
      if (focus === 'list') {
        if (direction === 1 && rightButton !== -1 && cursor !== -1) {
          return pressRowButton(rightButton, cursor)
        }

        return 'unchanged'
      }

      const index = focusable.indexOf(focus) + direction

      if (index < 0 || index >= focusable.length) return 'unchanged'

      focus = focusable[index]
    }

    // The label an Escape answer shows in the summary.
    function escapeLabel() {
      const found = [...items, ...toolbar, ...buttons].find(
        entry => !entry.separator && entry.value === escape.value,
      )

      return found?.label ?? escape.label
    }

    // The detail, cut with … to fit in `room` columns; its end stays whole.
    // The detail as dim segments, followed by its end: a string drawn dim
    // too, or segments with their own styles.
    function fitDetail({ detail, detailEnd = '' }, room) {
      const ends =
        typeof detailEnd === 'string'
          ? detailEnd
            ? [[detailEnd, 'dim']]
            : []
          : detailEnd
      const endText = ends.map(([text]) => text).join('')
      const end = textWidth(endText)

      if (textWidth(detail) + end <= room) return [[detail, 'dim'], ...ends]
      if (room - end < 2) {
        return [[truncateText(detail + endText, room), 'dim']]
      }

      return [[truncateText(detail, room - end), 'dim'], ...ends]
    }

    // Start loading an item's details the first time it is drawn.
    function startLoad(item) {
      if (!item.load || loading.has(item)) return

      loading.add(item)

      Promise.resolve()
        .then(() => item.load())
        .then(
          ({ detail, hint } = {}) => {
            loaded.set(item, {
              ...(detail && { detail }),
              ...(hint && { hint }),
            })
            redraw?.()
          },
          () => {},
        )
    }

    function itemSegments(row, index, hovered, width) {
      const { positions } = row
      const item = { ...row.item, ...loaded.get(row.item) }
      const selected = index === cursor
      const marker = selected
        ? ['❯ ', 'accent']
        : hovered
          ? ['› ', 'dim']
          : ['  ']
      const base = item.disabled
        ? ['dim']
        : selected
          ? ['accent']
          : item.style
            ? [item.style]
            : []
      const matched = new Set(positions)
      const segments = [['  '], marker]

      if (item.icon) segments.push([`${item.icon} `, ...base])

      for (const [position, character] of [...item.label].entries()) {
        segments.push([
          character,
          ...base,
          ...(matched.has(position) ? ['bold', 'underline'] : []),
        ])
      }

      // The tag on the right, or the row buttons on the hovered item.
      const tag = item.disabled || item.hint
      const trailer =
        hovered && rowButtons.length
          ? rowButtons.flatMap(({ label }, button) => [
              // A divider in the faint accent of the header's border, so
              // side-by-side buttons never read as one.
              ...(button > 0 ? [['│', 'border']] : []),
              [` ${label} `, 'accent', { target: `row:${button}:${index}` }],
            ])
          : tag
            ? [[tag, item.disabled ? 'dim' : (item.hintStyle ?? 'dim')]]
            : []
      const trailerWidth = trailer.reduce(
        (sum, [text]) => sum + textWidth(text),
        0,
      )
      const trailerRoom = trailerWidth ? trailerWidth + 2 : 0
      let used = 4 + textWidth(labelText(item))

      if (item.detail) {
        const column = Math.max(used + 2, 4 + labelWidth + 2)
        const parts = fitDetail(item, width - column - trailerRoom)
        const text = parts.map(([part]) => part).join('')

        if (text) {
          segments.push([' '.repeat(column - used)], ...parts)
          used = column + textWidth(text)
        }
      }

      if (trailer.length) {
        // On the right, or straight after the label when there is no room.
        const gap = Math.max(2, width - used - trailerWidth)

        segments.push([' '.repeat(gap)], ...trailer)
        used += gap + trailerWidth
      }

      if (!hovered || !useColors) return segments
      if (used < width) segments.push([' '.repeat(width - used)])

      return segments.map(segment => [...segment, 'hover'])
    }

    // `▲ n more` or `▼ n more`, for the items hidden above or below.
    function scrollHint(id, symbol, hidden) {
      const count = hidden.filter(row => !row.item.separator).length

      if (count === 0) return []

      return [['  '], [`${symbol} ${count} more`, 'dim', { target: id }]]
    }

    function helpLine() {
      const help = []

      if (showItems) {
        help.push('↑↓ move', `enter ${focus === 'list' ? enter : 'press'}`)

        // Opening with the wheel is not something people expect, so say it.
        if (mouse) help.push(`middle-click ${enter}`)
        if (rightButton !== -1) {
          help.push(`→ ${helpName(rowButtons[rightButton].label)}`)
        }
        if (focusable.length) help.push('tab buttons')
      } else if (focusable.length) {
        help.push('enter press')
        if (focusable.length > 1) help.push('←→ move')
      }

      // Keys work only where typing does not search.
      if (!searchable) {
        for (const { key, label } of buttons) {
          if (key) help.push(`${key} ${helpName(label).toLowerCase()}`)
        }
      }

      if (query) help.push('esc clear search')
      else if (escape) help.push(`esc ${escape.label}`)

      return [['  '], [help.join(' · '), 'dim']]
    }

    function render() {
      // Before anything is styled, so the drawing already shows its effect.
      if (preview && cursor !== -1) preview(rows[cursor].item.value)

      const width = lineWidth()
      const size = visibleRows()
      const lines = []
      // Found on the last drawing, before its lines are forgotten.
      const hoveredItem = mouse ? itemAt(pointer) : -1
      const hoveredTarget = mouse ? targetAt(pointer) : undefined
      const look = {
        focus: focus === 'list' ? undefined : focus,
        hover: hoveredTarget,
      }
      const frame = headerLines(width)

      lineItems = []

      if (frame.length) lines.push(...frame, [])

      if (body.length) {
        for (const [text, ...styles] of body) {
          lines.push([['  '], [text, ...styles]])
        }

        lines.push([])
      }

      if (buttons.length) lines.push(buttonLine(), [])

      if (showItems) {
        const prompt = [['  '], [message, 'bold']]

        if (query) prompt.push(['  '], [query, 'accent'])
        else if (searchable) {
          const hint = 'type to search'
          const gap = width - 2 - textWidth(message) - textWidth(hint)

          prompt.push([' '.repeat(Math.max(2, gap))], [hint, 'dim'])
        }

        lines.push(prompt, scrollHint('up', '▲', rows.slice(0, top)))

        for (const [offset, row] of rows.slice(top, top + size).entries()) {
          const index = top + offset
          const { item } = row

          if (item.separator) {
            if (offset > 0) lines.push([])

            lines.push([['  '], [item.separator.toUpperCase(), 'dim']])
            continue
          }

          startLoad(item)
          lineItems[lines.length] = index
          lines.push(itemSegments(row, index, index === hoveredItem, width))
        }

        if (rows.length === 0) {
          lines.push([
            ['  '],
            ['No matches. Press Esc to clear the search.', 'dim'],
          ])
        }

        lines.push(scrollHint('down', '▼', rows.slice(top + size)))
      }

      lines.push(helpLine())

      const notes = noteLines(width)

      if (notes.length) {
        lines.push([])

        for (const line of notes) lines.push([['  '], [line, 'yellow']])
      }

      const drawn = lines.map(line => renderLine(line, width, useColors, look))

      lineTargets = drawn.map(line => line.targets)
      paint(drawn.map(line => line.text))

      if (mouse && !fullscreen) {
        output.write(REQUEST_POSITION)
        positionRequests.push(lines.length)
      }
    }

    // A reply to REQUEST_POSITION: the cursor is at the end of the last line.
    // A reply nobody asked for, such as Shift+F3 in some terminals, is ignored.
    function locate({ row }) {
      const lines = positionRequests.shift()

      if (lines !== undefined) firstRow = row - lines + 1

      return 'unchanged'
    }

    function point({ type, row, column, released }) {
      if (type === 'wheel-up') return up()
      if (type === 'wheel-down') return down()

      const beforeItem = itemAt(pointer)
      const beforeTarget = targetAt(pointer)

      pointer = { row, column }

      const index = itemAt(pointer)
      const target = targetAt(pointer)

      // Pressing the wheel opens the item, or presses the button, that the
      // wheel moved to.
      if (type === 'middle' && !released) {
        if (now() < clicksFrom) return
        if (focus !== 'list') return press(focus)
        return cursor === -1 ? undefined : chooseItem(cursor)
      }

      if (type !== 'left' || released) {
        return index === beforeItem && target === beforeTarget
          ? 'unchanged'
          : undefined
      }

      if (now() < clicksFrom) return
      if (target !== undefined) return press(target)
      if (index === -1) return

      focus = 'list'

      if (index === cursor || clickOpens) return chooseItem(index)

      cursor = index
    }

    function paint(lines) {
      if (fullscreen) {
        const shown = lines.slice(0, Math.max(1, output.rows || 24))

        output.write(`${CURSOR_HOME}${CLEAR_DOWN}${shown.join('\n')}`)
        return
      }

      // Each line was narrower than the terminal when drawn, so it takes one
      // row, unless the terminal has since become narrower and rewrapped it.
      const columns = output.columns || 80
      const rows = painted.reduce(
        (sum, width) => sum + Math.max(1, Math.ceil(width / columns)),
        0,
      )
      let text = ''

      if (rows > 1) text += `${ESC}[${rows - 1}A`
      if (rows > 0) text += '\r'

      output.write(`${text}${CLEAR_DOWN}${lines.join('\n')}`)
      painted = lines.map(line => textWidth(line))
    }

    update(defaultValue)

    return new Promise((resolve, reject) => {
      const decoder = new StringDecoder('utf8')
      const wasRaw = Boolean(input.isRaw)
      let closed = false
      // The start of an escape sequence whose end has not arrived yet.
      let pending = ''
      let pendingTimer = null
      // Set while the list waits for its last position replies to close.
      let closing = null

      function close() {
        if (closed) return
        closed = true
        redraw = null

        clearTimeout(pendingTimer)
        input.off('data', onData)
        output.off?.('resize', render)
        exitEvents.off('exit', close)
        for (const signal of SIGNALS) exitEvents.off(signal, onSignal)
        // Paused first: on Windows, leaving raw mode while reading starts a
        // line-mode console read, which can stay blocked until Enter and
        // then holds back the keys of the next menu.
        input.pause()
        input.setRawMode?.(wasRaw)
        output.write(mouse ? `${MOUSE_OFF}${SHOW_CURSOR}` : SHOW_CURSOR)
      }

      // A signal (kill, a closing window) ends the process without an exit
      // event, which would leave the terminal in mouse mode with a hidden
      // cursor. Restore it, then send the signal again: with no listener
      // left, it ends the process as it would have.
      function onSignal(signal) {
        close()
        exitEvents.kill(exitEvents.pid, signal)
      }

      // Draw the header and the summary (or nothing), then close and call
      // `settle`. A position reply still on its way would reach whatever
      // reads the input next, such as a script, so the list first waits for
      // it, up to REPLY_TIMEOUT.
      function finish(lines, settle) {
        const width = lineWidth()

        paint(lines.map(line => renderLine(line, width, useColors).text))
        output.write('\n')

        if (positionRequests.length === 0) {
          close()
          return settle()
        }

        output.off?.('resize', render)

        const timer = setTimeout(() => closing(), REPLY_TIMEOUT)

        closing = () => {
          clearTimeout(timer)
          closing = null
          close()
          settle()
        }
      }

      // The header, then a one-line summary of the answer, when the list has
      // a message to sum up.
      function summaryLines(label) {
        const frame = headerLines(lineWidth())

        if (!showItems) return frame

        const summary = [['  '], [message, 'bold'], ['  '], [label, 'accent']]

        return frame.length ? [...frame, [], summary] : [summary]
      }

      function clearSearch() {
        if (!query) return 'unchanged'

        const selected = rows[cursor]?.item.value

        query = ''
        update(selected)
      }

      function handle(key) {
        switch (key.name) {
          case 'up':
            return up()
          case 'down':
            return down()
          case 'pageup':
            return move(-1, visibleRows() - 1)
          case 'pagedown':
            return move(1, visibleRows() - 1)
          case 'home':
            return moveToEnd(-1)
          case 'end':
            return moveToEnd(1)
          case 'tab':
            return cycleFocus(1)
          case 'shift-tab':
            return cycleFocus(-1)
          case 'left':
            return sideways(-1)
          case 'right':
            return sideways(1)
          case 'escape':
            if (query || !escape) return clearSearch()
            return { value: escape.value, label: escapeLabel() }
          case 'ctrl-u':
            return clearSearch()
          case 'backspace':
            if (query) {
              query = query.slice(0, -1)
              update()
            }
            return
          case 'char':
            if (searchable && showItems) {
              focus = 'list'
              query += key.text
              update()
              return
            }

            return pressKey(key.text)
          case 'enter':
            if (focus !== 'list') return press(focus)
            if (cursor === -1) return
            return chooseItem(cursor)
          case 'ctrl-c':
            return 'cancel'
          case 'mouse':
            return mouse ? point(key) : 'unchanged'
          case 'position':
            return locate(key)
        }
      }

      // A button's `key`, in a list that does not search.
      function pressKey(text) {
        const index = buttons.findIndex(
          button => button.key?.toLowerCase() === text.toLowerCase(),
        )

        return index === -1 ? 'unchanged' : press(`button:${index}`)
      }

      // An arrow key can arrive split over two chunks (ESC, then "[A"), for
      // example over SSH. A chunk ending in an unfinished sequence keeps it
      // back briefly: the next chunk completes it, or after ESCAPE_DELAY it is
      // read as it is, a lone ESC then being the Escape key.
      function onData(chunk) {
        const text =
          pending + (typeof chunk === 'string' ? chunk : decoder.write(chunk))
        const unfinished = UNFINISHED.exec(text)

        clearTimeout(pendingTimer)
        pending = unfinished ? unfinished[0] : ''

        if (unfinished) {
          pendingTimer = setTimeout(() => {
            const rest = pending

            pending = ''
            readKeys(rest)
          }, escapeDelay)
        }

        readKeys(unfinished ? text.slice(0, unfinished.index) : text)
      }

      function readKeys(text) {
        if (!text) return

        // Pointer motion and position replies that change nothing are not
        // redrawn, or every redraw would ask for another position.
        let changed = false

        try {
          for (const key of parseKeys(text)) {
            // Closing: only the awaited position replies matter now.
            if (closing) {
              if (key.name === 'position') positionRequests.shift()
              if (positionRequests.length === 0) return closing()
              continue
            }

            const result = handle(key)

            if (result !== 'unchanged') changed = true

            if (result === 'cancel') {
              finish([], () =>
                reject(
                  new ExitPromptError('The prompt was closed with Ctrl+C.'),
                ),
              )
            } else if (result && typeof result === 'object') {
              clicksFrom = now() + OPEN_DELAY

              finish(summaryLines(result.label), () => resolve(result.value))
            } else continue

            if (!closing) return
          }

          if (changed && !closing) render()
        } catch (error) {
          close()
          reject(error)
        }
      }

      if (fullscreen) screen.enter()
      else screen.leave()

      input.setRawMode?.(true)
      input.on('data', onData)
      output.on?.('resize', render)
      exitEvents.on('exit', close)
      for (const signal of SIGNALS) exitEvents.on(signal, onSignal)
      input.resume()
      output.write(mouse ? `${HIDE_CURSOR}${MOUSE_ON}` : HIDE_CURSOR)

      // Details that arrive together are drawn once.
      let redrawQueued = false

      redraw = () => {
        if (redrawQueued) return
        redrawQueued = true

        queueMicrotask(() => {
          redrawQueued = false
          if (!closed && !closing) render()
        })
      }

      render()
    })
  }
}

export const select = createList()
