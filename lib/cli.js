// The CLI itself: option handling, workspace setup and the interactive menus.
//
// start() handles one-shot options (help, version, aliases, reset, clearing
// the history) and otherwise runs the main loop: load or configure the
// workspace, list its projects (recently used ones first), list a project's
// scripts with its detected package manager, run the chosen script with that
// tool, optionally with arguments, then offer to run it again. Workspace
// paths typed at the prompt or passed with --workspace go through
// resolveDirectoryInput(), so ~, quotes and escaped spaces work without a
// shell.
//
// Direct mode: `dev-workspace <project>` opens that project's scripts, and
// `dev-workspace <project> <script> [-- args]` runs the script without any
// menu or prompt and resolves with its exit code (128 + the signal number
// when a signal stopped it), which index.js uses as the process exit code.
// The project is found by exact name, then ignoring case, then by unique
// prefix (findProject).
//
// The history (state.js) records each opened project and run script; it is
// read once per run, and saving it never stops the CLI.
//
// Every side effect goes through a dependency group (aliases, config,
// history, workspace, commands, prompts, ui, output) that createCli() accepts
// as overrides, so tests drive the whole flow with fakes. index.js calls
// startCli(), which uses the real modules and process arguments.

import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import {
  addAlias,
  listAliases,
  removeAlias,
  removeAllAliases,
} from './aliases.js'

import { HELP_TEXT, parseCliArgs } from './args.js'

import {
  getConfigPaths,
  migrateLegacyConfig,
  readWorkspaceConfig,
  resetWorkspaceConfig,
  saveWorkspaceConfig,
} from './config.js'

import {
  clearState,
  emptyState,
  getStatePath,
  readState,
  recentProjects,
  rememberProject,
  rememberScript,
  saveState,
} from './state.js'

import {
  getProjects,
  getScripts,
  isDirectory,
  resolveDirectoryInput,
} from './workspace.js'

import { detectPackageManager, runArguments } from './package-managers.js'

import { runCommand } from './commands.js'

import {
  CHANGE_WORKSPACE,
  RUN_WITH_ARGUMENTS,
  askForArguments,
  askForWorkspace,
  chooseProject,
  chooseScript,
  confirmWorkspaceChange,
  waitAfterCommand,
  waitForBack,
} from './prompts.js'

import { clearScreen, color, printHeader } from './ui.js'

const { version } = createRequire(import.meta.url)('../package.json')

// "pnpm (from pnpm-lock.yaml)", "yarn (from the packageManager field)"...
function describePackageManager({ name, source }) {
  if (source === 'default') return `${name} (default)`
  if (source === 'packageManager') {
    return `${name} (from the packageManager field)`
  }
  return `${name} (from ${source})`
}

// Quote arguments that would otherwise be read differently, for display.
function formatArgument(value) {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : JSON.stringify(value)
}

// The runCommand() options for a detected package manager. Yarn 1, the Yarn
// that still runs hooks, passes script arguments differently.
function runOptions({ name, runsHooks }, args) {
  if (args.length === 0) return { packageManager: name }

  return {
    packageManager: name,
    args,
    ...(name === 'yarn' && runsHooks !== false && { classicYarn: true }),
  }
}

// The command runCommand() starts, for display: "npm run dev -- --port 4000".
function describeRun(scriptName, options) {
  const { packageManager, args } = options

  return [
    packageManager,
    ...runArguments(packageManager, scriptName, args, options),
  ]
    .map(formatArgument)
    .join(' ')
}

// The exit code a shell reports for a finished script.
function exitCodeOf({ code, signal }) {
  if (signal) return 128 + (os.constants.signals[signal] ?? 0)

  return code ?? 1
}

// Find a project by exact name, then ignoring case, then by a prefix that
// matches only one project.
export function findProject(projects, name, root) {
  const lower = name.toLowerCase()
  const rules = [
    project => project.name === name,
    project => project.name.toLowerCase() === lower,
    project => project.name.toLowerCase().startsWith(lower),
  ]

  for (const rule of rules) {
    const matches = projects.filter(rule)

    if (matches.length === 1) return matches[0]

    if (matches.length > 1 && rule === rules[2]) {
      const names = matches.map(project => project.name).join(', ')

      throw new Error(
        `"${name}" matches several projects: ${names}. Type more of the name.`,
      )
    }
  }

  throw new Error(`No project named "${name}" in ${root}.`)
}

const defaultDependencies = {
  aliases: {
    addAlias,
    listAliases,
    removeAlias,
    removeAllAliases,
  },
  config: {
    getConfigPaths,
    migrateLegacyConfig,
    readWorkspaceConfig,
    resetWorkspaceConfig,
    saveWorkspaceConfig,
  },
  history: {
    clearState,
    readState,
    saveState,
  },
  workspace: {
    getProjects,
    detectPackageManager,
    getScripts,
    isDirectory,
    resolveDirectoryInput,
  },
  commands: {
    runCommand,
  },
  prompts: {
    askForArguments,
    askForWorkspace,
    chooseProject,
    chooseScript,
    confirmWorkspaceChange,
    waitAfterCommand,
    waitForBack,
  },
  ui: {
    clearScreen,
    color,
    printHeader,
  },
  output: {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
  },
}

function mergeDependencies(overrides = {}) {
  return Object.fromEntries(
    Object.entries(defaultDependencies).map(([group, functions]) => [
      group,
      { ...functions, ...overrides[group] },
    ]),
  )
}

// Create an isolated CLI instance. Each instance owns its workspace state.
export function createCli(overrides = {}) {
  const dependencies = mergeDependencies(overrides)
  const {
    aliases,
    config,
    history: historyStore,
    workspace,
    commands,
    prompts,
    ui,
    output,
  } = dependencies

  const configPaths = config.getConfigPaths()
  const { file: configFile } = configPaths
  const stateFile = getStatePath(configFile, { custom: configPaths.custom })

  let root = ''
  let history = emptyState()

  // Update the history and save it. History is a convenience, so a failed
  // save is ignored rather than interrupting the user.
  async function remember(change) {
    history = change(history)

    try {
      await historyStore.saveState(stateFile, history)
    } catch {
      // Nothing to do: the next run simply has an older history.
    }
  }

  // Turn a typed path (prompt or --workspace) into an absolute directory.
  function findWorkspace(value) {
    return workspace.resolveDirectoryInput(value, {
      isDirectory: workspace.isDirectory,
    })
  }

  // Return true for a usable workspace, otherwise a message explaining why.
  async function validateWorkspace(value) {
    if (!value.trim()) {
      return 'Please enter a directory path.'
    }

    const { directory, exists } = await findWorkspace(value)

    if (!exists) {
      return `No accessible directory at ${directory}`
    }

    return true
  }

  async function saveWorkspace(value) {
    root = (await findWorkspace(value)).directory

    await config.saveWorkspaceConfig(root, configFile)

    output.log()
    output.log(ui.color(`  Workspace saved: ${root}`, 'green'))
    output.log()

    return root
  }

  async function configureWorkspace() {
    output.log()
    output.log('  Configure your development workspace.')
    output.log('  Enter the folder containing your projects.')
    output.log()

    const directory = await prompts.askForWorkspace(validateWorkspace)

    return saveWorkspace(directory)
  }

  async function useWorkspaceOption(directory) {
    const result = await validateWorkspace(directory)

    if (result !== true) {
      throw new Error(`Invalid workspace "${directory}": ${result}`)
    }

    return saveWorkspace(directory)
  }

  // With `interactive: false` (running a script directly), a missing or
  // unusable workspace is an error instead of a question.
  async function initializeWorkspace({ interactive = true } = {}) {
    let readFrom = configFile
    let savedPath = null

    try {
      const movedFrom = await config.migrateLegacyConfig(configPaths)

      if (movedFrom) {
        output.log(
          ui.color(
            `  Moved configuration from ${movedFrom} to ${configFile}`,
            'dim',
          ),
        )
      }
    } catch (error) {
      output.log(
        ui.color(
          `  Could not move old configuration: ${error.message}`,
          'yellow',
        ),
      )
      readFrom = configPaths.legacyFile
    }

    try {
      savedPath = await config.readWorkspaceConfig(readFrom)
    } catch (error) {
      if (!interactive) throw error

      output.log(ui.color(`  ${error.message}`, 'yellow'))
      output.log(
        ui.color('  Configuration must be repaired or recreated.', 'yellow'),
      )
    }

    if (savedPath && (await workspace.isDirectory(path.resolve(savedPath)))) {
      root = path.resolve(savedPath)
      return root
    }

    if (!interactive) {
      throw new Error(
        savedPath
          ? `Saved workspace is unavailable: ${savedPath}. Pass another one with --workspace <path>.`
          : 'No workspace is configured yet. Run dev-workspace once to choose one, or pass --workspace <path>.',
      )
    }

    if (savedPath) {
      output.log()
      output.log(
        ui.color(`  Saved workspace is unavailable: ${savedPath}`, 'yellow'),
      )

      const reconfigure = await prompts.confirmWorkspaceChange()

      if (!reconfigure) {
        throw new Error('A valid workspace is required to continue.')
      }
    }

    return configureWorkspace()
  }

  async function readProjects() {
    try {
      return await workspace.getProjects(root)
    } catch (error) {
      throw new Error(`Could not read workspace: ${error.message}`, {
        cause: error,
      })
    }
  }

  // Run a script from the menu, then report how it ended.
  async function runFromMenu(project, packageManager, { script, args }) {
    const options = runOptions(packageManager, args)

    output.log()
    output.log(ui.color('  ----------------------------------------', 'dim'))
    output.log(`  Running: ${describeRun(script.name, options)}`)
    output.log(`  Directory: ${project.directory}`)
    output.log(ui.color('  ----------------------------------------', 'dim'))
    output.log()

    await remember(state =>
      rememberScript(state, project.directory, script.name),
    )

    try {
      const result = await commands.runCommand(
        script.name,
        project.directory,
        options,
      )

      output.log()

      if (result.code === 0) {
        output.log(ui.color('  Command completed successfully.', 'green'))
      } else if (result.signal) {
        output.log(
          ui.color(`  Command was interrupted (${result.signal}).`, 'yellow'),
        )
      } else {
        output.log(
          ui.color(
            `  Command exited with code ${result.code ?? 'unknown'}.`,
            'red',
          ),
        )
      }
    } catch (error) {
      output.error(
        ui.color(`  Could not start command: ${error.message}`, 'red'),
      )
    }

    output.log()
  }

  // Ask which script to run and return { script, args }, or null for Back.
  async function chooseRun(scripts, lastScript) {
    while (true) {
      const selected = await prompts.chooseScript(scripts, { lastScript })

      if (selected !== RUN_WITH_ARGUMENTS) {
        return selected && { script: selected, args: [] }
      }

      const script = await prompts.chooseScript(scripts, {
        lastScript,
        forArguments: true,
      })

      if (script) {
        return { script, args: await prompts.askForArguments(script.name) }
      }
    }
  }

  async function projectMenu(project) {
    // Detected first: hooks are grouped under their main script only when the
    // package manager runs them.
    const packageManager = await workspace.detectPackageManager(
      project.directory,
    )
    let scripts

    try {
      scripts = await workspace.getScripts(project.directory, {
        groupHooks: packageManager.runsHooks,
      })
    } catch (error) {
      ui.clearScreen()
      ui.printHeader(root, `PROJECT / ${project.name}`)
      output.error(
        ui.color(`  Could not read package.json: ${error.message}`, 'red'),
      )
      output.log()

      await prompts.waitForBack('Return to projects')
      return
    }

    await remember(state => rememberProject(state, project.directory))

    // The run to repeat when the user picks "Run again".
    let run = null

    while (true) {
      ui.clearScreen()
      ui.printHeader(root, `PROJECT / ${project.name}`)

      if (!run) {
        if (scripts.length === 0) {
          output.log(ui.color('  No scripts found in this project.', 'yellow'))
          output.log('  Check that package.json defines a scripts object.')
          output.log()

          await prompts.waitForBack('Return to projects')
          return
        }

        output.log(
          ui.color(
            `  Package manager: ${describePackageManager(packageManager)}`,
            'dim',
          ),
        )
        output.log()

        run = await chooseRun(scripts, history.lastScripts[project.directory])

        if (!run) return
      }

      await runFromMenu(project, packageManager, run)

      if (!(await prompts.waitAfterCommand())) run = null
    }
  }

  // `dev-workspace <project> <script> [-- args]`: no menus, no prompts.
  async function runDirectly({
    project: name,
    script: scriptName,
    scriptArgs,
  }) {
    const project = findProject(await readProjects(), name, root)
    const packageManager = await workspace.detectPackageManager(
      project.directory,
    )
    let scripts

    // Every script can be run by name, including hooks the menu groups.
    try {
      scripts = await workspace.getScripts(project.directory, {
        groupHooks: false,
      })
    } catch (error) {
      throw new Error(`Could not read package.json: ${error.message}`, {
        cause: error,
      })
    }

    if (!scripts.some(script => script.name === scriptName)) {
      const available = scripts.map(script => script.name).join(', ')

      throw new Error(
        available
          ? `No script named "${scriptName}" in ${project.name}. Available scripts: ${available}.`
          : `${project.name} has no scripts.`,
      )
    }

    const options = runOptions(packageManager, scriptArgs ?? [])

    output.error(
      ui.color(
        `  Running ${describeRun(scriptName, options)} in ${project.directory}`,
        'dim',
      ),
    )

    await remember(state =>
      rememberScript(state, project.directory, scriptName),
    )

    const result = await commands.runCommand(
      scriptName,
      project.directory,
      options,
    )

    return exitCodeOf(result)
  }

  async function run(options = {}) {
    const direct = options.script !== undefined

    if (options.workspace !== undefined) {
      await useWorkspaceOption(options.workspace)
    } else {
      await initializeWorkspace({ interactive: !direct })
    }

    history = await historyStore.readState(stateFile)

    if (direct) return runDirectly(options)

    // `dev-workspace <project>` starts in that project's script menu.
    let opening =
      options.project === undefined
        ? null
        : findProject(await readProjects(), options.project, root)

    while (true) {
      if (opening) {
        await projectMenu(opening)
        opening = null
      }

      ui.clearScreen()
      ui.printHeader(root)

      const projects = await readProjects()

      if (projects.length === 0) {
        output.log(ui.color('  No project folders found.', 'yellow'))
        output.log()
      }

      const choice = await prompts.chooseProject(projects, {
        recent: recentProjects(history, projects),
      })

      if (!choice) return

      if (choice === CHANGE_WORKSPACE) {
        await configureWorkspace()
        continue
      }

      opening = choice
    }
  }

  async function reset() {
    const removed = await config.resetWorkspaceConfig([
      configFile,
      configPaths.legacyFile,
      stateFile,
    ])

    if (removed.length === 0) {
      output.log(`  No saved configuration found at ${configFile}`)
    }

    for (const file of removed) {
      output.log(`  Deleted ${file}`)
    }

    for (const name of await aliases.removeAllAliases()) {
      output.log(`  Deleted alias "${name}"`)
    }
  }

  async function clearHistory() {
    if (await historyStore.clearState(stateFile)) {
      output.log(`  Deleted the history at ${stateFile}`)
    } else {
      output.log(`  No history found at ${stateFile}`)
    }
  }

  async function printAliases() {
    const names = await aliases.listAliases()

    output.log('  Built in: dev-workspace, dws')

    if (names.length === 0) {
      output.log('  Custom:   none (add one with --add-alias <name>)')
    } else {
      output.log(`  Custom:   ${names.join(', ')}`)
    }
  }

  async function createAlias(name) {
    const files = await aliases.addAlias(name)

    output.log(
      ui.color(`  Created alias "${name}". Run it with: ${name}`, 'green'),
    )
    output.log(ui.color(`  Location: ${path.dirname(files[0])}`, 'dim'))
  }

  async function deleteAlias(name) {
    await aliases.removeAlias(name)

    output.log(`  Removed alias "${name}".`)
  }

  // Resolve with the exit code of a script run directly, otherwise undefined.
  async function start(args = []) {
    const options = parseCliArgs(args)

    if (options.help) return output.log(HELP_TEXT)
    if (options.version) return output.log(version)
    if (options['config-path']) return output.log(configFile)
    if (options['list-aliases']) return printAliases()
    if (options['add-alias'] !== undefined) {
      return createAlias(options['add-alias'])
    }
    if (options['remove-alias'] !== undefined) {
      return deleteAlias(options['remove-alias'])
    }
    if (options.reset) return reset()
    if (options['clear-history']) return clearHistory()

    try {
      return await run(options)
    } catch (error) {
      if (
        error.name === 'ExitPromptError' ||
        error.name === 'AbortPromptError'
      ) {
        output.log(`\n  ${ui.color('Goodbye!', 'cyan')}\n`)
        return
      }

      throw error
    }
  }

  return { run, start }
}

// Preserve the simple production entry point.
export function startCli(overrides, args = process.argv.slice(2)) {
  return createCli(overrides).start(args)
}
