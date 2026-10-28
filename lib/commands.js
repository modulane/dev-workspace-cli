// Running a project's script with its package manager.
//
// runCommand() starts `<tool> run <script>` (npm, pnpm, yarn or bun), with
// any extra arguments for the script (`args`), in the project directory with
// the terminal attached, without a shell (cross-spawn handles Windows .cmd
// files), and resolves with the exit code or signal once the script ends. A
// missing tool produces an error with an install hint.
//
// Used by cli.js, which passes the tool chosen by detectPackageManager(), and
// `classicYarn` for Yarn 1, which needs extra arguments passed differently.
// The spawn function, signal source and Node.js version (which changes the
// install hint) can be injected for tests.

import spawn from 'cross-spawn'

import { installHint, runArguments } from './package-managers.js'

// Ctrl+C reaches every process attached to the terminal. The child decides
// how to stop; the CLI ignores it so it can return to the menu afterwards.
function ignoreInterrupt() {}

// Run a project's script without invoking a shell.
export function runCommand(
  scriptName,
  directory,
  {
    packageManager = 'npm',
    args = [],
    classicYarn = false,
    spawnProcess = spawn,
    signals = process,
    nodeVersion = process.versions.node,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const runArgs = runArguments(packageManager, scriptName, args, {
      classicYarn,
    })
    const child = spawnProcess(packageManager, runArgs, {
      cwd: directory,
      stdio: 'inherit',
    })

    signals.on('SIGINT', ignoreInterrupt)

    const finish = () => signals.off('SIGINT', ignoreInterrupt)

    child.on('error', error => {
      finish()

      if (error.code === 'ENOENT') {
        const hint = installHint(packageManager, nodeVersion)

        reject(
          new Error(
            `Could not find ${packageManager}, which this project uses. ${hint}`,
            { cause: error },
          ),
        )
        return
      }

      reject(
        new Error(`Could not start ${packageManager}: ${error.message}`, {
          cause: error,
        }),
      )
    })

    child.on('close', (code, signal) => {
      finish()

      if (signal) {
        resolve({ code: null, signal })
        return
      }

      resolve({ code })
    })
  })
}
