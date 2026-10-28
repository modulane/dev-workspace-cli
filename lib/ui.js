// Terminal output helpers: colours, the boxed header and clearing the screen.
//
// color() wraps text in ANSI colour codes, unless output is not a terminal or
// NO_COLOR is set. printHeader() draws the box showing the workspace and the
// current section. USE_COLORS is that decision, shared with list.js.
//
// Used by cli.js through the default instance exported at the bottom. Tests
// call createUi() with colours forced on or off and a fake log function.

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
} = {}) {
  function color(value, shade) {
    if (!useColors || !ANSI[shade]) {
      return String(value)
    }

    return `${ANSI[shade]}${value}${ANSI.reset}`
  }

  function printHeader(workspace, section = 'PROJECT EXPLORER') {
    const width = 44
    const cyan = text => color(text, 'cyan')

    function row(text = '', shade = 'reset', centered = false) {
      const available = width - 2
      const content = ` ${text} `
      const visible = content.slice(0, available)
      const remaining = available - visible.length

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
