// The interactive list used by every menu, with fuzzy search.
//
// createList() returns select(), which draws a list of items under a message,
// lets the user move with the arrow keys, Page Up/Down and Home/End, and
// resolves with the value of the item chosen with Enter. In a searchable list,
// typing filters the items with fuzzyFilter() (best matches first, matched
// characters underlined), Backspace edits the search, and Escape or Ctrl+U
// clears it. Ctrl+C rejects with an ExitPromptError, as Inquirer's prompts do.
//
// Items are { label, value, icon, detail, detailEnd, hint, disabled, action }
// or { separator }. Disabled items are shown dimmed and skipped by the cursor;
// action items ("Back", "Exit", …) and separators are hidden while searching,
// so Enter never triggers an action by accident.
//
// The layout, from the top: the `header` lines (a function of the width that
// returns lines of [text, ...styles] segments, such as the box from ui.js),
// the `body` lines ([text, style] pairs, for a message such as an error),
// the message with the search, the items, and the help line, with a blank
// line between each part. Lines are at most MAX_WIDTH columns wide. Items
// line up in columns: the icon and label, then the dim `detail` (cut with …
// to fit, except its `detailEnd`), then the `hint` or `disabled` reason on
// the right. Separators are shown in capitals, after a blank line, and a rule
// separates the actions from the items above them. When the list closes, the
// header stays, followed by a one-line summary of the answer.
//
// The list owns the terminal while it is open: raw mode, key decoding
// (parseKeys) and drawing. A chunk of input that ends in an unfinished
// escape sequence is held for up to 50 ms, so an arrow key split over two
// chunks is never read as Escape followed by typed text.
//
// It redraws in place by moving the cursor back to its first line, and never
// draws a line wider than the terminal, measured with textWidth() from
// width.js, so the line count stays exact. When the terminal gets narrower,
// it rewraps the lines already drawn; the list counts the rows they now take,
// so the next drawing still starts on the first line. Each drawing records
// which item is on which line, for the mouse. Raw mode is turned off and the
// cursor shown again on every way out, including exit and the signals in
// SIGNALS, which are then sent again so they still end the process.
//
// With `mouse`, the list also switches on mouse reporting (SGR mode, with
// motion) while it is open, and off again on every way out. To know which
// screen row each item is on, it asks the terminal for the cursor position
// after each drawing (ESC [ 6 n): the reply gives the row of the last line,
// which still holds after the window has scrolled. A list that closes while a
// reply is on its way waits for it, up to REPLY_TIMEOUT, so the reply never
// reaches whatever reads the input next, such as a script.
//
// A click selects the item under the pointer, and a click on the selected
// item opens it, so a double-click opens any item. A terminal sends a
// double-click as two presses, so clicks are ignored for OPEN_DELAY after an
// item opens; otherwise the second press would land on the next list. Hover
// marks the item under the pointer with ›, and with colours gives its whole
// row a grey background. The wheel moves the cursor, and
// pressing it (the middle button) opens the selected item, wherever the
// pointer is; the help line says so while the mouse is on.
// Keys work as without the mouse. A `note` is shown in yellow under the
// list, wrapped to its width.
//
// Used by prompts.js. Tests pass fake input and output streams.

import { StringDecoder } from 'node:string_decoder'

import { fuzzyFilter } from './fuzzy.js'
import { USE_COLORS } from './ui.js'
import { fitText, textWidth, truncateText, wrapText } from './width.js'

const ESC = '\x1b'
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const CLEAR_DOWN = `${ESC}[J`
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
  '\x7f': 'backspace',
  '\b': 'backspace',
  '\x03': 'ctrl-c',
  '\x15': 'ctrl-u',
}

// CSI sequences (ESC [ … final byte) and SS3 sequences (ESC O x). Unknown
// ones, such as Left/Right or mouse reports, are recognised and ignored.
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

const STYLES = {
  bold: ['\x1b[1m', '\x1b[22m'],
  dim: ['\x1b[2m', '\x1b[22m'],
  underline: ['\x1b[4m', '\x1b[24m'],
  cyan: ['\x1b[36m', '\x1b[39m'],
  green: ['\x1b[32m', '\x1b[39m'],
  yellow: ['\x1b[33m', '\x1b[39m'],
  red: ['\x1b[31m', '\x1b[39m'],
  // Bright black: a soft grey in every common terminal theme.
  hover: ['\x1b[100m', '\x1b[49m'],
}

// A line is a list of [text, ...styles] segments, cut to `width` columns
// before the styles are applied, so escape codes never count as width.
function renderLine(segments, width, useColors) {
  let used = 0
  let line = ''

  for (const [text, ...styles] of segments) {
    const part = fitText(text, width - used)

    used += textWidth(part)

    if (!part) continue

    line += useColors
      ? styles.reduce(
          (styled, style) => `${STYLES[style][0]}${styled}${STYLES[style][1]}`,
          part,
        )
      : part

    if (part.length < text.length) break
  }

  return line
}

const isSelectable = item => !item.separator && !item.disabled

// An item's icon and label, as drawn after its marker.
const labelText = item =>
  item.icon ? `${item.icon} ${item.label}` : item.label

export function createList({
  input = process.stdin,
  output = process.stdout,
  exitEvents = process,
  useColors = USE_COLORS,
  escapeDelay = ESCAPE_DELAY,
  now = () => Date.now(),
} = {}) {
  // Clicks before this time are the end of a double-click that opened the
  // previous list's item.
  let clicksFrom = 0

  return function select({
    message,
    items,
    default: defaultValue,
    pageSize = 15,
    searchable = true,
    mouse = false,
    note,
    header,
    body = [],
  }) {
    let query = ''
    let rows = []
    let cursor = -1
    let top = 0
    // The width of each line of the last drawing.
    let painted = []
    // The screen row of the first line, from the terminal's position reply,
    // and the line count of each drawing whose reply has not arrived yet.
    let firstRow = null
    const positionRequests = []
    // The screen row under the mouse pointer.
    let pointerRow = null
    // The index in `rows` of the item on each line of the last drawing.
    let lineItems = []

    // Labels line up in a column, as wide as the widest one (icon included),
    // up to MAX_LABEL_WIDTH. Actions have no details, so they do not count.
    const labelWidth = Math.min(
      MAX_LABEL_WIDTH,
      Math.max(
        0,
        ...items
          .filter(item => !item.separator && !item.action)
          .map(item => textWidth(labelText(item))),
      ),
    )

    function lineWidth() {
      return Math.min(MAX_WIDTH, Math.max(10, (output.columns || 80) - 1))
    }

    function headerLines(width) {
      return header ? header(width) : []
    }

    function noteLines(width) {
      return note ? wrapText(note, width - 2) : []
    }

    function filter() {
      if (!query) return items.map(item => ({ item, positions: [] }))

      return fuzzyFilter(
        items.filter(item => !item.separator && !item.action),
        query,
        item => item.label,
      )
    }

    function firstSelectable() {
      return rows.findIndex(row => isSelectable(row.item))
    }

    // As many items as fit in the window next to everything else the list
    // draws: the message, help line and blank lines, the header, body and
    // note, the blank line before each separator and the rule.
    function visibleRows() {
      const width = lineWidth()
      const parts = [headerLines(width), body, noteLines(width)]
      let others = 4

      for (const lines of parts) if (lines.length) others += lines.length + 1

      others += rows.filter(row => row.item.separator).length
      if (rows.some(row => row.item.action)) others += 1

      return Math.max(3, Math.min(pageSize, (output.rows || 24) - others - 1))
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

      cursor = index
      scrollToCursor()
    }

    function moveToEnd(direction) {
      move(direction, rows.length)
    }

    // The index in `rows` of the selectable item drawn on a screen row, or -1.
    function itemAt(screenRow) {
      if (firstRow === null || screenRow === null) return -1

      const index = lineItems[screenRow - firstRow]

      if (index === undefined || index >= rows.length) return -1

      return isSelectable(rows[index].item) ? index : -1
    }

    // The detail, cut with … to fit in `room` columns; its end stays whole.
    function fitDetail({ detail, detailEnd = '' }, room) {
      const end = textWidth(detailEnd)

      if (textWidth(detail) + end <= room) return detail + detailEnd
      if (room - end < 2) return truncateText(detail + detailEnd, room)

      return truncateText(detail, room - end) + detailEnd
    }

    function itemSegments({ item, positions }, selected, hovered, width) {
      const marker = selected
        ? ['❯ ', 'cyan']
        : hovered
          ? ['› ', 'dim']
          : ['  ']
      const base = item.disabled ? ['dim'] : selected ? ['cyan'] : []
      const matched = new Set(positions)
      const segments = [['  '], marker]

      if (item.icon) segments.push([`${item.icon} `, ...base])

      for (const [index, character] of [...item.label].entries()) {
        segments.push([
          character,
          ...base,
          ...(matched.has(index) ? ['bold', 'underline'] : []),
        ])
      }

      const tag = item.disabled || item.hint
      const tagRoom = tag ? textWidth(tag) + 2 : 0
      let used = 4 + textWidth(labelText(item))

      if (item.detail) {
        const column = Math.max(used + 2, 4 + labelWidth + 2)
        const text = fitDetail(item, width - column - tagRoom)

        if (text) {
          segments.push([' '.repeat(column - used)], [text, 'dim'])
          used = column + textWidth(text)
        }
      }

      if (tag) {
        // On the right, or straight after the label when there is no room.
        const gap = Math.max(2, width - used - textWidth(tag))

        segments.push([' '.repeat(gap)], [tag, 'dim'])
        used += gap + textWidth(tag)
      }

      if (!hovered || !useColors) return segments
      if (used < width) segments.push([' '.repeat(width - used)])

      return segments.map(([text, ...styles]) => [text, ...styles, 'hover'])
    }

    function render() {
      const width = lineWidth()
      const size = visibleRows()
      const frame = headerLines(width)
      const lines = []
      // Found on the last drawing, before its lines are forgotten.
      const hovered = mouse ? itemAt(pointerRow) : -1

      lineItems = []

      if (frame.length) lines.push(...frame, [])

      if (body.length) {
        for (const [text, ...styles] of body) {
          lines.push([['  '], [text, ...styles]])
        }

        lines.push([])
      }

      const prompt = [['  '], [message, 'bold']]

      if (query) prompt.push(['  '], [query, 'cyan'])
      else if (searchable) {
        const hint = 'type to search'
        const gap = width - 2 - textWidth(message) - textWidth(hint)

        prompt.push([' '.repeat(Math.max(2, gap))], [hint, 'dim'])
      }

      lines.push(prompt, [])

      for (const [offset, row] of rows.slice(top, top + size).entries()) {
        const index = top + offset
        const { item } = row

        if (item.separator) {
          if (offset > 0) lines.push([])

          lines.push([['  '], [item.separator.toUpperCase(), 'dim']])
          continue
        }

        if (item.action && offset > 0 && !rows[index - 1].item.action) {
          lines.push([['  '], ['─'.repeat(Math.max(0, width - 2)), 'dim']])
        }

        lineItems[lines.length] = index
        lines.push(
          itemSegments(row, index === cursor, index === hovered, width),
        )
      }

      if (rows.length === 0) {
        lines.push([
          ['  '],
          ['No matches. Press Esc to clear the search.', 'dim'],
        ])
      }

      const help = ['↑↓ move', 'Enter select']

      // Opening with the wheel is not something people expect, so say it.
      if (mouse) help.push('Middle-click select')
      if (query) help.push('Esc clear search')
      if (rows.length > size) help.push(`${cursor + 1}/${rows.length}`)

      lines.push([], [['  '], [help.join(' · '), 'dim']])

      const notes = noteLines(width)

      if (notes.length) {
        lines.push([])

        for (const line of notes) lines.push([['  '], [line, 'yellow']])
      }

      paint(lines.map(line => renderLine(line, width, useColors)))

      if (mouse) {
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

    function point({ type, row, released }) {
      if (type === 'wheel-up') return move(-1)
      if (type === 'wheel-down') return move(1)

      const before = itemAt(pointerRow)

      pointerRow = row

      const index = itemAt(row)

      // Pressing the wheel opens the item the wheel moved to.
      if (type === 'middle' && !released) {
        return cursor === -1 || now() < clicksFrom ? undefined : 'done'
      }

      if (type !== 'left' || released) {
        return index === before ? 'unchanged' : undefined
      }

      if (index === -1 || now() < clicksFrom) return
      if (index === cursor) return 'done'

      cursor = index
    }

    function paint(lines) {
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

        clearTimeout(pendingTimer)
        input.off('data', onData)
        output.off?.('resize', render)
        exitEvents.off('exit', close)
        for (const signal of SIGNALS) exitEvents.off(signal, onSignal)
        input.setRawMode?.(wasRaw)
        input.pause()
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
      function finish(summary, settle) {
        const width = lineWidth()
        const frame = headerLines(width)
        const lines = frame.length ? [...frame, [], summary] : [summary]

        paint(
          summary === undefined
            ? []
            : lines.map(line => renderLine(line, width, useColors)),
        )
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

      function handle(key) {
        switch (key.name) {
          case 'up':
            return move(-1)
          case 'down':
            return move(1)
          case 'pageup':
            return move(-1, visibleRows() - 1)
          case 'pagedown':
            return move(1, visibleRows() - 1)
          case 'home':
            return moveToEnd(-1)
          case 'end':
            return moveToEnd(1)
          case 'escape':
          case 'ctrl-u':
            if (query) {
              const selected = rows[cursor]?.item.value
              query = ''
              update(selected)
            }
            return
          case 'backspace':
            if (query) {
              query = query.slice(0, -1)
              update()
            }
            return
          case 'char':
            if (searchable) {
              query += key.text
              update()
            }
            return
          case 'enter':
            if (cursor === -1) return
            return 'done'
          case 'ctrl-c':
            return 'cancel'
          case 'mouse':
            return mouse ? point(key) : 'unchanged'
          case 'position':
            return locate(key)
        }
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

            if (result === 'done') {
              const { item } = rows[cursor]

              clicksFrom = now() + OPEN_DELAY

              finish(
                [['  '], [message, 'bold'], ['  '], [item.label, 'cyan']],
                () => resolve(item.value),
              )
            } else if (result === 'cancel') {
              finish(undefined, () =>
                reject(
                  new ExitPromptError('The prompt was closed with Ctrl+C.'),
                ),
              )
            } else continue

            if (!closing) return
          }

          if (changed && !closing) render()
        } catch (error) {
          close()
          reject(error)
        }
      }

      input.setRawMode?.(true)
      input.on('data', onData)
      output.on?.('resize', render)
      exitEvents.on('exit', close)
      for (const signal of SIGNALS) exitEvents.on(signal, onSignal)
      input.resume()
      output.write(mouse ? `${HIDE_CURSOR}${MOUSE_ON}` : HIDE_CURSOR)
      render()
    })
  }
}

export const select = createList()
