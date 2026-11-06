// Measuring text the way a terminal draws it.
//
// textWidth() returns the columns a text takes: emoji and East Asian wide
// characters count as two, combining marks and joiners as none, and ANSI
// escape codes as nothing. It is string-width, which also knows the symbols
// terminals draw narrow, such as ⚙ without its emoji variation selector.
// fitText() keeps the start of a text that fits in a number of columns,
// without splitting a character made of several code points (an emoji
// sequence, or a letter with its accents). truncateText() does the same, but
// ends a text it shortens with …, so the cut shows.
// wrapText() breaks a text into lines of at most a number of columns, between
// words; a word wider than a line is cut with fitText().
//
// Used by ui.js for the header and its workspace path, and list.js for every line it draws, the
// details next to each item and the mouse note.

import stringWidth from 'string-width'

const segmenter = new Intl.Segmenter()

export function textWidth(text) {
  return stringWidth(text)
}

export function fitText(text, width) {
  let used = 0
  let result = ''

  for (const { segment } of segmenter.segment(text)) {
    const columns = stringWidth(segment)

    if (used + columns > width) break

    result += segment
    used += columns
  }

  return result
}

export function truncateText(text, width) {
  if (textWidth(text) <= width) return text
  if (width < 1) return ''

  return `${fitText(text, width - 1)}…`
}

// The end of a text that fits in `width` columns, after …
function truncateStart(text, width) {
  if (width < 1) return ''

  const segments = [...segmenter.segment(text)].map(({ segment }) => segment)
  let used = 1
  let result = ''

  for (const segment of segments.reverse()) {
    const columns = stringWidth(segment)

    if (used + columns > width) break

    result = segment + result
    used += columns
  }

  return `…${result}`
}

export function truncatePath(text, width) {
  if (textWidth(text) <= width) return text

  const separator = /[\\/]/.exec(text)?.[0]

  if (!separator) return truncateText(text, width)

  const [root, ...folders] = text.split(separator)
  const fits = (start, end) =>
    textWidth([...start, '…', ...end].join(separator)) <= width
  const start = [root]
  const end = []

  // The last folders first, then the first ones, while … stays between.
  while (
    end.length < folders.length &&
    fits(start, [folders.at(-end.length - 1), ...end])
  ) {
    end.unshift(folders.at(-end.length - 1))
  }

  // Not even the last folder fits after the root: keep the end of the path.
  if (end.length === 0) return truncateStart(text, width)

  while (
    start.length < folders.length - end.length &&
    fits([...start, folders[start.length - 1]], end)
  ) {
    start.push(folders[start.length - 1])
  }

  return [...start, '…', ...end].join(separator)
}

export function wrapText(text, width) {
  const lines = []
  let line = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word

    if (textWidth(joined) <= width) {
      line = joined
      continue
    }

    if (line) lines.push(line)

    let rest = word

    while (textWidth(rest) > width) {
      // A character wider than the whole line still takes a line of its own.
      const part =
        fitText(rest, width) ||
        segmenter.segment(rest)[Symbol.iterator]().next().value.segment

      lines.push(part)
      rest = rest.slice(part.length)
    }

    line = rest
  }

  if (line) lines.push(line)

  return lines
}
