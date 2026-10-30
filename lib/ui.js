// Terminal output helpers: colours, the boxed header and clearing the screen.
//
// color() wraps text in ANSI colour codes, unless output is not a terminal or
// NO_COLOR is set. printHeader() draws the box showing the workspace and the
// current section. It fits the terminal width, up to 72 columns, and treats a
// terminal narrower than 40 columns as 40 wide; text is measured and cut with
// width.js, so emoji and wide characters never push the border out of line.
// USE_COLORS is that decision, shared with list.js.
//
// Used by cli.js through the default instance exported at the bottom. Tests
// call createUi() with colours forced on or off, a fake log function and a
// terminal width.

import { fitText, textWidth } from './width.js'

const MIN_COLUMNS = 40
const MAX_HEADER_WIDTH = 72

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

export function createUi({
  useColors = USE_COLORS,
  log = (...args) => console.log(...args),
  columns = () => process.stdout.columns,
} = {}) {
  function color(value, shade) {
    if (!useColors || !ANSI[shade]) {
      return String(value)
    }

    return `${ANSI[shade]}${value}${ANSI.reset}`
  }

  function printHeader(workspace, section = 'PROJECT EXPLORER') {
    // Indented by two columns, with the last column left free.
    const terminal = Math.max(MIN_COLUMNS, columns() || 80)
    const width = Math.min(MAX_HEADER_WIDTH, terminal - 3)
    const cyan = text => color(text, 'cyan')

    function row(text = '', shade = 'reset', centered = false) {
      const available = width - 2
      const visible = fitText(` ${text} `, available)
      const remaining = available - textWidth(visible)

      const left = centered ? Math.floor(remaining / 2) : 0
      const right = remaining - left

      return (
        cyan('  │') +
        ' '.repeat(left) +
        color(visible, shade) +
        ' '.repeat(right) +
        cyan('│')
      )
    }

    const border = (left, middle, right) =>
      `  ${cyan(left + middle.repeat(width - 2) + right)}`

    log()
    log(border('╭', '━', '╮'))
    log(row())
    log(row('🚀  DEV WORKSPACE CLI', 'bold', true))
    log(row('⚙  DEVELOPER TOOLKIT', 'cyan', true))
    log(row())
    log(border('├', '─', '┤'))
    log(row('📂  WORKSPACE', 'yellow'))
    log(row(`📍 ${workspace}`, 'bold'))
    log(border('├', '─', '┤'))
    log(row(`🧭  ${section}`, 'green'))
    log(border('╰', '━', '╯'))
  }

  return { color, printHeader }
}

export function clearScreen() {
  console.clear()
}

export const { color, printHeader } = createUi()
