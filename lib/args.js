// Reading the command-line options, and the `--help` text.
// Used by cli.js and prompts.js.

import { parseArgs } from 'node:util'

import { ACCENTS } from './ui.js'

// The `--help` text, which must list every option parseCliArgs() accepts.
// `color` is ui.color, so NO_COLOR and the accent are respected.
export function formatHelp(color = value => String(value)) {
  return `
  ${color('Usage:', 'bold')} ${color('dev-workspace', 'accent')} [options] [project [script] [-- arguments]]
         ${color('dws', 'accent')} [options] [project [script] [-- arguments]]

  Browse the projects in your workspace and run their scripts.

  With a project, open its scripts directly; with a script too, run it and
  exit with its exit code. The project can be shortened to any prefix that
  matches only one project. Arguments after -- are passed to the script.

  ${color('Examples:', 'bold')}
    ${color('dws web', 'accent')}                  Open the scripts of the "web" project
    ${color('dws web dev', 'accent')}              Run the "dev" script of "web"
    ${color('dws web dev -- --port 4000', 'accent')}

  ${color('Options:', 'bold')}
    ${color('-w, --workspace', 'accent')} ${color('<path>', 'dim')}   Use <path> as the workspace and save it
        ${color('--no-mouse', 'accent')}           Use only the keyboard in menus, this time
        ${color('--set-mouse', 'accent')} ${color('<on|off>', 'dim')}
                             Save whether menus use the mouse
        ${color('--set-color', 'accent')} ${color('<name>', 'dim')}   Save the accent colour: cyan, blue, purple,
                             magenta, pink, orange, teal, sky, lavender,
                             coral, gold, bold
        ${color('--config-path', 'accent')}        Print the configuration file location
        ${color('--clear-history', 'accent')}      Forget recently used projects and scripts
        ${color('--add-alias', 'accent')} ${color('<name>', 'dim')}   Create another command that starts the CLI
        ${color('--remove-alias', 'accent')} ${color('<name>', 'dim')}
                             Delete an alias created with --add-alias
        ${color('--list-aliases', 'accent')}       List the available commands
        ${color('--reset', 'accent')}              Delete the saved configuration, history and
                             aliases
    ${color('-v, --version', 'accent')}            Print the version
    ${color('-h, --help', 'accent')}               Show this help

  ${color('Environment:', 'bold')}
    ${color('DEV_WORKSPACE_CONFIG', 'accent')}     Use a custom configuration file path
    ${color('NO_COLOR', 'accent')}                 Turn colours off
    ${color('FORCE_COLOR', 'accent')}              Turn colours on, even when output is not
                             a terminal (0 turns them off)
`
}

const SEE_HELP = '\n  Run "dev-workspace --help" to see the available options.'

// Parse command-line flags. Invalid input produces an actionable error.
export function parseCliArgs(args) {
  const separator = args.indexOf('--')
  const own = separator === -1 ? args : args.slice(0, separator)
  const scriptArgs = separator === -1 ? [] : args.slice(separator + 1)
  let parsed

  try {
    parsed = parseArgs({
      args: own,
      options: {
        workspace: { type: 'string', short: 'w' },
        'no-mouse': { type: 'boolean' },
        'set-mouse': { type: 'string' },
        'set-color': { type: 'string' },
        'config-path': { type: 'boolean' },
        'clear-history': { type: 'boolean' },
        'add-alias': { type: 'string' },
        'remove-alias': { type: 'string' },
        'list-aliases': { type: 'boolean' },
        reset: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: true,
    })
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS')) throw error

    throw new Error(`${error.message}${SEE_HELP}`, { cause: error })
  }

  const { values, positionals } = parsed
  const [project, script, ...extra] = positionals

  if (extra.length > 0) {
    throw new Error(
      `Unexpected argument "${extra[0]}". To pass arguments to the script, put them after --, for example: dws ${project} ${script} -- ${extra.join(' ')}${SEE_HELP}`,
    )
  }

  if (
    values['set-mouse'] !== undefined &&
    !['on', 'off'].includes(values['set-mouse'])
  ) {
    throw new Error(
      `Use --set-mouse on or --set-mouse off, not "${values['set-mouse']}".${SEE_HELP}`,
    )
  }

  if (
    values['set-color'] !== undefined &&
    !ACCENTS.includes(values['set-color'])
  ) {
    throw new Error(
      `Use --set-color with ${ACCENTS.slice(0, -1).join(', ')} or ${ACCENTS.at(-1)}, not "${values['set-color']}".${SEE_HELP}`,
    )
  }

  if (separator !== -1 && script === undefined) {
    throw new Error(
      `Arguments after -- need a project and a script, for example: dws web dev -- --port 4000${SEE_HELP}`,
    )
  }

  return {
    ...values,
    ...(project !== undefined && { project }),
    ...(script !== undefined && { script }),
    ...(separator !== -1 && { scriptArgs }),
  }
}

// Split typed text into arguments: whitespace separates them, and quotes
// group text containing spaces ("two words" or 'two words').
export function splitArguments(text) {
  const result = []
  let current = ''
  let quote = null
  let started = false

  for (const character of text) {
    if (quote) {
      if (character === quote) quote = null
      else current += character
    } else if (character === '"' || character === "'") {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      if (started) result.push(current)
      current = ''
      started = false
    } else {
      current += character
      started = true
    }
  }

  if (quote) throw new Error(`Close the ${quote} quote.`)
  if (started) result.push(current)

  return result
}
