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
// Used by ui.js for the header, and list.js for every line it draws, the
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
