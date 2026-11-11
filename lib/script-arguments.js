// Recognising scripts that cannot run without arguments.
//
// Some scripts are helpers that other scripts call with the rest of the
// command, such as `"packages": "yarn workspaces foreach --all"`, called as
// `yarn packages run test`. Run on their own, they fail (Yarn: "Not enough
// positional arguments"). needsArguments() recognises them from the command
// alone, without running anything, so the menu can ask for the arguments
// first and direct mode can refuse to start them without any.
//
// Only the last command of a chain (after &&, ||, ; or |) is looked at,
// since the arguments are added at the end. It counts as needing arguments
// when, once its options are left out, nothing is left after:
//
//   yarn workspaces foreach   yarn workspace <name>
//   pnpm with only options (-r, --filter <pattern>, …)
//   npm with only workspace options (-ws, --workspace <name>), npm exec,
//   npm x, npx
//   bun with only --filter <pattern>
//   turbo run, lerna run, lerna exec
//
// Options that take a value (VALUE_OPTIONS) skip that value too, so
// `--include '@modulane/*'` is not read as a command. Anything else counts
// as runnable on its own, so a script is never blocked by mistake.
//
// Used by workspace.js, whose getScripts() marks such scripts with
// `needsArguments: true`.

import { splitArguments } from './args.js'

// The options that take a value, by tool.
const VALUE_OPTIONS = {
  yarn: ['--from', '--include', '--exclude', '-j', '--jobs'],
  pnpm: ['--filter', '-F', '--filter-prod', '--dir', '-C', '--test-pattern'],
  npm: ['--workspace', '-w', '--prefix'],
  npx: ['--package', '-p'],
  bun: ['--filter', '-F', '--cwd'],
  turbo: ['--filter', '-F', '--concurrency'],
  lerna: ['--scope', '--ignore', '--concurrency'],
}

// The words that are not options, in order.
function operands(words, valueOptions = []) {
  const found = []

  for (let index = 0; index < words.length; index++) {
    const word = words[index]

    if (!word.startsWith('-')) found.push(word)
    else if (valueOptions.includes(word)) index++
  }

  return found
}

// Whether `command` fails unless arguments are added after it.
export function needsArguments(command) {
  let words

  try {
    words = splitArguments(command.split(/&&|\|\||[;|]/).at(-1))
  } catch {
    return false
  }

  const [tool, ...rest] = words
  const options = rest.filter(word => word.startsWith('-'))
  const left = operands(rest, VALUE_OPTIONS[tool])

  // `pnpm --version` or `npm --help` runs on its own.
  if (options.some(option => /^(-v|--version|-h|--help)$/.test(option))) {
    return false
  }

  switch (tool) {
    case 'yarn':
      return (
        (left[0] === 'workspaces' &&
          left[1] === 'foreach' &&
          left.length === 2) ||
        (left[0] === 'workspace' && left.length === 2)
      )
    case 'pnpm':
    case 'bun':
      return options.length > 0 && left.length === 0
    case 'npm':
      return (
        (left.length === 0 &&
          options.some(option =>
            ['-ws', '--workspaces', '--workspace', '-w'].includes(option),
          )) ||
        (left.length === 1 && ['exec', 'x'].includes(left[0]))
      )
    case 'npx':
      return left.length === 0
    case 'turbo':
      return left.length === 1 && left[0] === 'run'
    case 'lerna':
      return left.length === 1 && ['run', 'exec'].includes(left[0])
    default:
      return false
  }
}
