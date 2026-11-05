// Terminal output helpers: the colour theme and the header box.
//
// This file is the one place that knows colour codes. STYLES maps each style
// name to the codes that switch it on and off, and styleText() applies a list
// of them; color() is the same for a single string, and list.js uses
// styleText() for every line it draws. The theme sticks to one accent: cyan
// for "you are here" (the selected item, the current screen in the
// breadcrumb, the search), green, red and yellow only for results and
// warnings, and bold and dim for hierarchy. inquirerTheme() gives the
// Inquirer prompts the same look, so their text goes through color() too.
//
// colorsEnabled() decides whether to colour at all: FORCE_COLOR turns colours
// on (or off, set to 0 or false) whatever else is true, as in Node itself;
// otherwise output must be a terminal and NO_COLOR unset or empty.
// USE_COLORS is that decision for this process, shared with list.js.
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
// workspace line ends with the `toolbar` segments (list.js passes its toolbar
// buttons), and its path is shortened in the middle to fit next to them; on
// a window too narrow for both, the toolbar is left out. With `home`, the
// name is a button too: its segments hold { target: 'home' }. The lines are
// made of [text, ...styles] segments that list.js draws, so the box redraws
// with the list when the window is resized. It uses one thin line style and
// only characters one column wide, measured with width.js, so its border
// lines up in every terminal.
//
// Used by cli.js and prompts.js, color() and inquirerTheme() through the
// default instance exported at the bottom. Tests call createUi() with colours
// forced on or off.

import { textWidth, truncatePath, truncateText } from './width.js'

const NAME = 'dev-workspace'

// The fewest columns the workspace path keeps next to the toolbar.
const MIN_PATH = 8

export function colorsEnabled({
  env = process.env,
  stream = process.stdout,
} = {}) {
  const force = env.FORCE_COLOR

  if (force !== undefined) return force !== '0' && force !== 'false'

  return Boolean(stream.isTTY) && !env.NO_COLOR
}

export const USE_COLORS = colorsEnabled()

// Each style closes with its own code, not a full reset, so styles nest.
export const STYLES = {
  bold: ['\x1b[1m', '\x1b[22m'],
  dim: ['\x1b[2m', '\x1b[22m'],
  underline: ['\x1b[4m', '\x1b[24m'],
  cyan: ['\x1b[36m', '\x1b[39m'],
  green: ['\x1b[32m', '\x1b[39m'],
  yellow: ['\x1b[33m', '\x1b[39m'],
  red: ['\x1b[31m', '\x1b[39m'],
  // Bright black: a soft grey in every common terminal theme.
  hover: ['\x1b[100m', '\x1b[49m'],
  // Reverse video, for the focused button.
  focus: ['\x1b[7m', '\x1b[27m'],
}

// `text` with each of `styles` applied, the last one outermost. Unknown
// names are skipped.
export function styleText(text, styles, useColors = USE_COLORS) {
  if (!useColors) return String(text)

  return styles
    .filter(style => STYLES[style])
    .reduce(
      (styled, style) => `${STYLES[style][0]}${styled}${STYLES[style][1]}`,
      String(text),
    )
}

export function createUi({ useColors = USE_COLORS } = {}) {
  function color(value, ...styles) {
    return styleText(value, styles, useColors)
  }

  // Inquirer's theme, with every colour going through color().
  function inquirerTheme() {
    return {
      prefix: { idle: color('?', 'cyan'), done: color('✔', 'green') },
      style: {
        answer: text => color(text, 'cyan'),
        message: text => color(text, 'bold'),
        error: text => color(`> ${text}`, 'red'),
        defaultAnswer: text => color(`(${text})`, 'dim'),
        help: text => color(text, 'dim'),
        highlight: text => color(text, 'cyan'),
        key: text => color(`<${text}>`, 'cyan', 'bold'),
        confirmDefault: text => color(text, 'cyan'),
      },
    }
  }

  return { color, inquirerTheme }
}

// The header box, as lines of segments at most `width` columns wide, starting
// with the same two-column margin as the rest of the list.
export function headerLines(
  { workspace, crumbs = [], tag, toolbar = [], home = false },
  width,
) {
  // The box, corners included; its title row holds "╭─ ", the title, a space,
  // at least one "─", the tag part and "╮".
  const box = Math.max(10, width - 2)
  const room = box - 6
  const name = `◆ ${NAME}`
  const trail = crumbs.map(crumb => ` › ${crumb}`).join('')
  const tagPart = tag ? ` ${tag} ─` : ''

  const showTag = tag && textWidth(name + trail + tagPart) <= room
  const target = home ? [{ target: 'home' }] : []
  let title
  let fill

  if (textWidth(name + trail) <= room) {
    // The last crumb is the current screen: "you are here".
    title = [
      ['◆', 'cyan', ...target],
      [` ${NAME}`, 'bold', ...target],
      ...crumbs.flatMap((crumb, index) => [
        [' › ', 'dim'],
        index === crumbs.length - 1 ? [crumb, 'cyan'] : [crumb],
      ]),
    ]
    fill = room - textWidth(name + trail) - (showTag ? textWidth(tagPart) : 0)
  } else {
    const cut = truncateText(trail, Math.max(0, room - textWidth(name)))

    title = [
      ['◆', 'cyan', ...target],
      [` ${NAME}`, 'bold', ...target],
      [cut, 'dim'],
    ]
    fill = Math.max(0, room - textWidth(name + cut))
  }

  const top = [
    ['  '],
    ['╭─ ', 'dim'],
    ...title,
    [` ${'─'.repeat(fill + 1)}`, 'dim'],
    ...(showTag
      ? [
          [` ${tag} `, 'dim'],
          ['─', 'dim'],
        ]
      : []),
    ['╮', 'dim'],
  ]

  // The toolbar buttons carry their own spaces. The path keeps at least
  // MIN_PATH columns, or the toolbar is left out.
  const toolsWidth = toolbar.reduce((sum, [text]) => sum + textWidth(text), 0)
  const tools = box - 5 - toolsWidth >= MIN_PATH ? toolbar : []
  const path = truncatePath(
    workspace,
    box - 5 - (tools.length ? toolsWidth : 0),
  )
  const used = textWidth(path) + (tools.length ? toolsWidth : 0)

  return [
    top,
    [
      ['  '],
      ['│', 'dim'],
      [`  ${path}`],
      [' '.repeat(box - 4 - used)],
      ...tools,
      ['│', 'dim'],
    ],
    [['  '], [`╰${'─'.repeat(box - 2)}╯`, 'dim']],
  ]
}

export const { color, inquirerTheme } = createUi()
