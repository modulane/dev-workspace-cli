// Command-line parsing and the `--help` text.
//
// parseCliArgs() turns process arguments into an options object using Node's
// built-in parseArgs, and replaces its errors with a message pointing to
// `--help`. Up to two positional arguments select a project and a script
// (direct mode); everything after `--` is kept, untouched, as the script's
// arguments. HELP_TEXT must list every option defined here.
//
// formatHelp() builds the `--help` text using a given color function, so
// NO_COLOR and non-TTY outputs can turn off colors; HELP_TEXT is the uncolored
// text.
//
// splitArguments() splits arguments typed at the "Run with arguments…" prompt
// into a list, honouring single and double quotes. No shell is involved, so
// nothing else is special.
//
// Used by cli.js, whose start() decides what each option does, and by
// prompts.js.

import { parseArgs } from 'node:util'

export function formatHelp(color = value => String(value)) {
  return `
  ${color('Usage:', 'bold')} ${color('dev-workspace', 'cyan')} [options] [project [script] [-- arguments]]
         ${color('dws', 'cyan')} [options] [project [script] [-- arguments]]

  Browse the projects in your workspace and run their scripts.

  With a project, open its scripts directly; with a script too, run it and
  exit with its exit code. The project can be shortened to any prefix that
  matches only one project. Arguments after -- are passed to the script.

  ${color('Examples:', 'bold')}
    ${color('dws web', 'cyan')}                  Open the scripts of the "web" project
    ${color('dws web dev', 'cyan')}              Run the "dev" script of "web"
    ${color('dws web dev -- --port 4000', 'cyan')}

  ${color('Options:', 'bold')}
    ${color('-w, --workspace', 'cyan')} ${color('<path>', 'dim')}   Use ${color('<path>', 'dim')} as the workspace and save it
        ${color('--config-path', 'cyan')}        Print the configuration file location
        ${color('--clear-history', 'cyan')}      Forget recently used projects and scripts
        ${color('--add-alias', 'cyan')} ${color('<name>', 'dim')}   Create another command that starts the CLI
        ${color('--remove-alias', 'cyan')} ${color('<name>', 'dim')}
                             Delete an alias created with --add-alias
        ${color('--list-aliases', 'cyan')}       List the available commands
        ${color('--reset', 'cyan')}              Delete the saved configuration, history and
                             aliases
    ${color('-v, --version', 'cyan')}            Print the version
    ${color('-h, --help', 'cyan')}               Show this help

  ${color('Environment:', 'bold')}
    ${color('DEV_WORKSPACE_CONFIG', 'cyan')}     Use a custom configuration file path
`
}

export const HELP_TEXT = formatHelp()

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
