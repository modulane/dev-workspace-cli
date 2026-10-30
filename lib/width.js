// Measuring text the way a terminal draws it.
//
// textWidth() returns the columns a text takes: emoji and East Asian wide
// characters count as two, combining marks and joiners as none, and ANSI
// escape codes as nothing. It is string-width, which also knows the symbols
// terminals draw narrow, such as ⚙ without its emoji variation selector.
// fitText() keeps the start of a text that fits in a number of columns,
// without splitting a character made of several code points (an emoji
// sequence, or a letter with its accents).
//
// Used by ui.js for the header, list.js for every line it draws and
// prompts.js for the script descriptions.

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
