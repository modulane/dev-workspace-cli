// Terminal output helpers: colours, the header box and clearing the screen.
//
// color() wraps text in ANSI colour codes, unless output is not a terminal or
// NO_COLOR is set. USE_COLORS is that decision, shared with list.js.
//
// headerLines() returns the three lines of the box shown at the top of every
// menu, for a given width:
//
//   ╭─ ◆ dev-workspace › web-app ──────────── npm · package-lock.json ─╮
//   │  E:\dev                                                          │
//   ╰──────────────────────────────────────────────────────────────────╯
//
// The top border carries the name and the breadcrumb of the current screen,
// and an optional tag on the right, dropped when the name needs the room. The
// workspace path is cut with … when it does not fit. The lines are made of
// [text, ...styles] segments that list.js draws, so the box redraws with the
// list when the window is resized. It uses one thin line style and only
// characters one column wide, measured with width.js, so its border lines up
// in every terminal.
//
// Used by cli.js, color() through the default instance exported at the
// bottom. Tests call createUi() with colours forced on or off.

import { textWidth, truncateText } from './width.js'

const NAME = 'dev-workspace'

export const USE_COLORS = Boolean(process.stdout.isTTY && !process.env.NO_COLOR)

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

export function createUi({ useColors = USE_COLORS } = {}) {
  function color(value, shade) {
    if (!useColors || !ANSI[shade]) {
      return String(value)
    }

    return `${ANSI[shade]}${value}${ANSI.reset}`
  }

  return { color }
}

// The header box, as lines of segments at most `width` columns wide, starting
// with the same two-column margin as the rest of the list.
export function headerLines({ workspace, crumbs = [], tag }, width) {
  // The box, corners included; its title row holds "╭─ ", the title, a space,
  // at least one "─", the tag part and "╮".
  const box = Math.max(10, width - 2)
  const room = box - 6
  const name = `◆ ${NAME}`
  const trail = crumbs.map(crumb => ` › ${crumb}`).join('')
  const tagPart = tag ? ` ${tag} ─` : ''

  const showTag = tag && textWidth(name + trail + tagPart) <= room
  let title
  let fill

  if (textWidth(name + trail) <= room) {
    title = [
      ['◆', 'cyan'],
      [` ${NAME}`, 'bold'],
      ...crumbs.flatMap(crumb => [[' › ', 'dim'], [crumb]]),
    ]
    fill = room - textWidth(name + trail) - (showTag ? textWidth(tagPart) : 0)
  } else {
    const cut = truncateText(trail, Math.max(0, room - textWidth(name)))

    title = [['◆', 'cyan'], [` ${NAME}`, 'bold'], [cut]]
    fill = Math.max(0, room - textWidth(name + cut))
  }

  const top = [
    ['  '],
    ['╭─ ', 'dim'],
    ...title,
    [` ${'─'.repeat(fill + 1)}`, 'dim'],
    ...(showTag ? [[` ${tag} `], ['─', 'dim']] : []),
    ['╮', 'dim'],
  ]

  const path = truncateText(workspace, box - 5)

  return [
    top,
    [
      ['  '],
      ['│', 'dim'],
      [`  ${path}`],
      [' '.repeat(box - 4 - textWidth(path))],
      ['│', 'dim'],
    ],
    [['  '], [`╰${'─'.repeat(box - 2)}╯`, 'dim']],
  ]
}

export function clearScreen() {
  console.clear()
}

export const { color } = createUi()
