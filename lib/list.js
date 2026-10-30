// The interactive list used by every menu, with fuzzy search.
//
// createList() returns select(), which draws a list of items under a message,
// lets the user move with the arrow keys, Page Up/Down and Home/End, and
// resolves with the value of the item chosen with Enter. In a searchable list,
// typing filters the items with fuzzyFilter() (best matches first, matched
// characters underlined), Backspace edits the search, and Escape or Ctrl+U
// clears it. Ctrl+C rejects with an ExitPromptError, as Inquirer's prompts do.
//
// Items are { label, value, icon, hint, description, disabled, action } or
// { separator }. Disabled items are shown dimmed and skipped by the cursor;
// action items ("Back", "Exit", …) and separators are hidden while searching,
// so Enter never triggers an action by accident.
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
// so the next drawing still starts on the first line. Visible item i is drawn
// on line 1 + i - top. Raw mode is turned off and the cursor shown again on
// every way out, including exit.
//
// Used by prompts.js. Tests pass fake input and output streams.

import { StringDecoder } from 'node:string_decoder'

import { fuzzyFilter } from './fuzzy.js'
import { USE_COLORS } from './ui.js'
import { fitText, textWidth } from './width.js'

const ESC = '\x1b'
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const CLEAR_DOWN = `${ESC}[J`

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

// The start of a CSI or SS3 sequence, or a lone ESC, at the end of the input.
const UNFINISHED = new RegExp(`${ESC}(\\[[0-9;<=>?]*[ -/]*|O)?$`)

// How long a lone ESC waits for the rest of a sequence, in milliseconds.
const ESCAPE_DELAY = 50

// Turn raw terminal input into keys: { name } or { name: 'char', text }.
export function parseKeys(text) {
  const keys = []
  let rest = text

  while (rest) {
    if (rest.startsWith(ESC)) {
      const sequence = CSI.exec(rest)?.[0] ?? SS3.exec(rest)?.[0]

      if (sequence) {
        if (SEQUENCES[sequence]) keys.push({ name: SEQUENCES[sequence] })
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

export function createList({
  input = process.stdin,
  output = process.stdout,
  exitEvents = process,
  useColors = USE_COLORS,
  escapeDelay = ESCAPE_DELAY,
} = {}) {
  return function select({
    message,
    items,
    default: defaultValue,
    pageSize = 15,
    searchable = true,
  }) {
    let query = ''
    let rows = []
    let cursor = -1
    let top = 0
    // The width of each line of the last drawing.
    let painted = []

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

    function visibleRows() {
      return Math.max(3, Math.min(pageSize, (output.rows || 24) - 4))
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

    function itemSegments({ item, positions }, selected) {
      const marker = selected ? ['❯ ', 'cyan'] : ['  ']
      const icon = item.icon ? [`${item.icon}  `] : ['']
      const base = item.disabled ? ['dim'] : selected ? ['cyan'] : []
      const matched = new Set(positions)
      const label = [...item.label].map((character, index) => [
        character,
        ...base,
        ...(matched.has(index) ? ['bold', 'underline'] : []),
      ])
      const note = item.disabled ? item.disabled : item.hint

      return [
        ['  '],
        marker,
        [icon[0], ...base],
        ...label,
        ...(note ? [[` ${note}`, 'dim']] : []),
      ]
    }

    function render() {
      const width = Math.max(10, (output.columns || 80) - 1)
      const size = visibleRows()
      const lines = []
      const prompt = [['  '], [message, 'bold']]

      if (query) prompt.push(['  '], [query, 'cyan'])
      else if (searchable) prompt.push(['  type to search', 'dim'])

      lines.push(prompt)

      for (const [offset, row] of rows.slice(top, top + size).entries()) {
        lines.push(
          row.item.separator
            ? [['  '], [row.item.separator, 'dim']]
            : itemSegments(row, top + offset === cursor),
        )
      }

      if (rows.length === 0) {
        lines.push([
          ['  '],
          ['No matches. Press Esc to clear the search.', 'dim'],
        ])
      }

      const description = rows[cursor]?.item.description

      if (description) lines.push([['  '], [description, 'dim']])

      const help = ['↑↓ move', 'Enter select']

      if (query) help.push('Esc clear search')
      if (rows.length > size) help.push(`${cursor + 1}/${rows.length}`)

      lines.push([['  '], [help.join(' · '), 'dim']])

      paint(lines.map(line => renderLine(line, width, useColors)))
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

      function close() {
        if (closed) return
        closed = true

        clearTimeout(pendingTimer)
        input.off('data', onData)
        output.off?.('resize', render)
        exitEvents.off('exit', close)
        input.setRawMode?.(wasRaw)
        input.pause()
        output.write(SHOW_CURSOR)
      }

      function finish(summary) {
        paint(summary === undefined ? [] : [summary])
        output.write('\n')
        close()
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

        try {
          for (const key of parseKeys(text)) {
            const result = handle(key)

            if (result === 'done') {
              const { item } = rows[cursor]

              finish(
                renderLine(
                  [['  '], [message, 'bold'], ['  '], [item.label, 'cyan']],
                  Math.max(10, (output.columns || 80) - 1),
                  useColors,
                ),
              )
              resolve(item.value)
              return
            }

            if (result === 'cancel') {
              finish()
              reject(new ExitPromptError('The prompt was closed with Ctrl+C.'))
              return
            }
          }

          render()
        } catch (error) {
          close()
          reject(error)
        }
      }

      input.setRawMode?.(true)
      input.on('data', onData)
      output.on?.('resize', render)
      exitEvents.on('exit', close)
      input.resume()
      output.write(HIDE_CURSOR)
      render()
    })
  }
}

export const select = createList()
