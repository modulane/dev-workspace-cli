// Terminal output helpers: the colour theme and the header box.
//
// This file is the one place that knows colour codes. STYLES maps each style
// name to the codes that switch it on and off, and styleText() applies a list
// of them; color() is the same for a single string, and list.js uses
// styleText() for every line it draws. The theme sticks to one accent, the
// `accent` style, for "you are here" (the selected item, the current screen
// in the breadcrumb, the search) and, faint, for the header box's border
// (`border`); green, red and yellow only for results and warnings; muted
// colours for the Git branch (`branch`, `mainBranch`); and bold and dim for
// hierarchy. inquirerTheme() gives the
// Inquirer prompts the same look, so their text goes through color() too.
//
// The accent is one of ACCENTS, cyan unless the user chose another one
// (cli.js reads it from the configuration): setAccent() switches it for the
// whole process, and the first-run list calls it as its cursor moves, to
// preview each choice. Cyan, blue (the bright variant, readable on a dark
// background) and magenta are basic colours; the others come from the
// 256-colour palette, which every current terminal supports; `bold` means
// no accent colour at all. Code that draws asks for `accent`, never for the
// colour itself.
//
// colorsEnabled() decides whether to colour at all: FORCE_COLOR turns colours
// on (or off, set to 0 or false) whatever else is true, as in Node itself;
// otherwise output must be a terminal and NO_COLOR unset or empty.
// USE_COLORS is that decision for this process, shared with list.js.
//
// headerLines() returns the three lines of the box shown at the top of every
// menu, for a given width:
//
//   ╭─ ◆ dev › web-app ─────────────────────── npm · package-lock.json ─╮
//   │  E:\dev                                                           │
//   ╰───────────────────────────────────────────────────────────────────╯
//
// The top border carries the breadcrumb of the current screen, starting with
// the name of the workspace folder (folderName()), and an optional tag on
// the right, dropped when the breadcrumb needs the room. The
// workspace line ends with the `toolbar` segments (list.js passes its toolbar
// buttons), and its path is shortened in the middle to fit next to them; on
// a window too narrow for both, the toolbar is left out. The lines are made
// of [text, ...styles] segments that list.js draws, so the box redraws
// with the list when the window is resized. It uses one thin line style and
// only characters one column wide, measured with width.js, so its border
// lines up in every terminal.
//
// Used by cli.js and prompts.js, color() and inquirerTheme() through the
// default instance exported at the bottom. Tests call createUi() with colours
// forced on or off.

import { textWidth, truncatePath, truncateText } from './width.js'

// The last folder of a path, Windows or POSIX: "dev" for E:\dev. A root
// such as C:\ or / is its own name.
export function folderName(directory) {
  return directory.split(/[\\/]/).findLast(Boolean) ?? directory
}

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
  blue: ['\x1b[94m', '\x1b[39m'],
  magenta: ['\x1b[35m', '\x1b[39m'],
  // The other accents, from the 256-colour palette.
  purple: [color256(141), '\x1b[39m'],
  pink: [color256(212), '\x1b[39m'],
  orange: [color256(208), '\x1b[39m'],
  teal: [color256(37), '\x1b[39m'],
  sky: [color256(117), '\x1b[39m'],
  lavender: [color256(183), '\x1b[39m'],
  coral: [color256(209), '\x1b[39m'],
  gold: [color256(220), '\x1b[39m'],
  green: ['\x1b[32m', '\x1b[39m'],
  yellow: ['\x1b[33m', '\x1b[39m'],
  red: ['\x1b[31m', '\x1b[39m'],
  // Muted colours for the Git branch, softer than the result colours: the
  // default branch apart from the others.
  branch: [color256(179), '\x1b[39m'],
  mainBranch: [color256(108), '\x1b[39m'],
  // Bright black: a soft grey in every common terminal theme.
  hover: ['\x1b[100m', '\x1b[49m'],
  // Reverse video, for the focused button.
  focus: ['\x1b[7m', '\x1b[27m'],
}

function color256(code) {
  return `\x1b[38;5;${code}m`
}

// The accent colours to choose from, the default first. Each is a style.
// Green, red and yellow stay out: they mean results and warnings.
export const ACCENTS = [
  'cyan',
  'blue',
  'purple',
  'magenta',
  'pink',
  'orange',
  'teal',
  'sky',
  'lavender',
  'coral',
  'gold',
  'bold',
]

// Use `name` as the accent from now on; an unknown name means the default.
// The `border` of the header box is a faint version of it, or plain dim
// for the bold accent, as bold and dim share their closing code.
export function setAccent(name) {
  const accent = ACCENTS.includes(name) ? name : ACCENTS[0]
  const [open, close] = STYLES[accent]

  STYLES.accent = STYLES[accent]
  STYLES.border =
    accent === 'bold'
      ? STYLES.dim
      : [`${STYLES.dim[0]}${open}`, `${close}${STYLES.dim[1]}`]
}

setAccent(ACCENTS[0])

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
      // Read when a prompt starts, so it has the accent of the moment.
      prefix: {
        get idle() {
          return color('?', 'accent')
        },
        done: color('✔', 'green'),
      },
      style: {
        answer: text => color(text, 'accent'),
        message: text => color(text, 'bold'),
        error: text => color(`> ${text}`, 'red'),
        defaultAnswer: text => color(`(${text})`, 'dim'),
        help: text => color(text, 'dim'),
        highlight: text => color(text, 'accent'),
        key: text => color(`<${text}>`, 'accent', 'bold'),
        confirmDefault: text => color(text, 'accent'),
      },
    }
  }

  return { color, inquirerTheme }
}

// The header box, as lines of segments at most `width` columns wide, starting
// with the same two-column margin as the rest of the list.
export function headerLines(
  { workspace, crumbs = [], tag, toolbar = [] },
  width,
) {
  // The box, corners included; its title row holds "╭─ ", the title, a space,
  // at least one "─", the tag part and "╮".
  const box = Math.max(10, width - 2)
  const room = box - 6
  // A long folder name is cut to leave room for the breadcrumb.
  const folder = truncateText(folderName(workspace), Math.max(1, room - 2))
  const name = `◆ ${folder}`
  const trail = crumbs.map(crumb => ` › ${crumb}`).join('')
  const tagPart = tag ? ` ${tag} ─` : ''

  const showTag = tag && textWidth(name + trail + tagPart) <= room
  let title
  let fill

  if (textWidth(name + trail) <= room) {
    // The last crumb is the current screen: "you are here".
    title = [
      ['◆', 'accent'],
      [` ${folder}`, 'bold'],
      ...crumbs.flatMap((crumb, index) => [
        [' › ', 'dim'],
        index === crumbs.length - 1 ? [crumb, 'accent'] : [crumb],
      ]),
    ]
    fill = room - textWidth(name + trail) - (showTag ? textWidth(tagPart) : 0)
  } else {
    const cut = truncateText(trail, Math.max(0, room - textWidth(name)))

    title = [
      ['◆', 'accent'],
      [` ${folder}`, 'bold'],
      [cut, 'dim'],
    ]
    fill = Math.max(0, room - textWidth(name + cut))
  }

  const top = [
    ['  '],
    ['╭─ ', 'border'],
    ...title,
    [` ${'─'.repeat(fill + 1)}`, 'border'],
    ...(showTag
      ? [
          [` ${tag} `, 'dim'],
          ['─', 'border'],
        ]
      : []),
    ['╮', 'border'],
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
      ['│', 'border'],
      [`  ${path}`],
      [' '.repeat(box - 4 - used)],
      ...tools,
      ['│', 'border'],
    ],
    [['  '], [`╰${'─'.repeat(box - 2)}╯`, 'border']],
  ]
}

export const { color, inquirerTheme } = createUi()
