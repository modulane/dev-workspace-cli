// Which terminal the CLI runs in, and how well it supports the mouse.
// Used by cli.js.

export const MOUSE_CHECK_ISSUE =
  'https://github.com/modulane/dev-workspace-cli/issues/26'

// Mouse reporting needs a terminal on both sides: with output piped (for
// example to tee) or input redirected, nothing would answer it.
export function isTerminal({
  input = process.stdin,
  output = process.stdout,
} = {}) {
  return Boolean(input.isTTY && output.isTTY)
}

// Menus and questions read keys, so they need a terminal for input; output
// alone can be piped.
export function isInteractive({ input = process.stdin } = {}) {
  return Boolean(input.isTTY)
}

// Returns { id, name, support }, where support is what scripts/mouse-check.js
// found, as recorded in the roadmap's terminal support table: `full`,
// `partial`, `none` (the mouse stays off) or `unknown` (not checked yet).
// Git Bash is checked first: inside Windows Terminal it also sets WT_SESSION.
export function detectTerminal({
  env = process.env,
  platform = process.platform,
} = {}) {
  const program = env.TERM_PROGRAM

  if (env.MSYSTEM) return { id: 'git-bash', name: 'Git Bash', support: 'none' }

  if (program === 'vscode') {
    return {
      id: 'vscode',
      name: 'the VS Code integrated terminal',
      support: 'full',
    }
  }

  if (env.WT_SESSION) {
    return { id: 'windows-terminal', name: 'Windows Terminal', support: 'full' }
  }

  if (program === 'Apple_Terminal') {
    return { id: 'apple-terminal', name: 'macOS Terminal', support: 'partial' }
  }

  if (program === 'iTerm.app') {
    return { id: 'iterm2', name: 'iTerm2', support: 'unknown' }
  }

  if (program) {
    return { id: `program:${program}`, name: program, support: 'unknown' }
  }

  // The classic console sets none of the variables above, nor TERM.
  if (platform === 'win32' && !env.TERM && !env.ConEmuPID) {
    return {
      id: 'windows-console',
      name: 'the classic Windows console',
      support: 'full',
    }
  }

  return {
    id: `${platform}:${env.TERM || 'unknown'}`,
    name: 'this terminal',
    support: 'unknown',
  }
}

// The note shown under the first menu in a terminal without full mouse
// support, or null.
export function mouseNote({ name, support }) {
  switch (support) {
    case 'partial':
      // only MacOS terminal is known to be partial, so the note can be specific
      return `Mouse support is partial in ${name}: a click selects the row under the bottom of the pointer, which the › marker shows. For full mouse support, use the VS Code integrated terminal.`
    case 'none':
      return `${name} does not report the mouse, so it is off here. For mouse support, run the CLI from PowerShell in Windows Terminal.`
    case 'unknown':
      return `Mouse support has not been checked in ${name} yet. If it misbehaves, turn it off with --set-mouse off, and please help check it: ${MOUSE_CHECK_ISSUE}`
    default:
      return null
  }
}
