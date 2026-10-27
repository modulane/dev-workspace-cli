// The CLI itself: option handling, workspace setup and the interactive menus.
//
// start() handles one-shot options (help, version, aliases, reset) and
// otherwise runs the main loop: load or configure the workspace, list its
// projects, list a project's scripts with its detected package manager, run
// the chosen script with that tool, repeat. Workspace paths typed at the
// prompt or passed with --workspace go through resolveDirectoryInput(), so
// ~, quotes and escaped spaces work without a shell.
//
// Every side effect goes through a dependency group (aliases, config,
// workspace, commands, prompts, ui, output) that createCli() accepts as
// overrides, so tests drive the whole flow with fakes. index.js calls
// startCli(), which uses the real modules and process arguments.

import { createRequire } from 'node:module'
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
  getProjects,
  getScripts,
  isDirectory,
  resolveDirectoryInput,
} from './workspace.js'

import { detectPackageManager } from './package-managers.js'

import { runCommand } from './commands.js'

import {
  CHANGE_WORKSPACE,
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
  return {
    aliases: { ...defaultDependencies.aliases, ...overrides.aliases },
    config: { ...defaultDependencies.config, ...overrides.config },
    workspace: { ...defaultDependencies.workspace, ...overrides.workspace },
    commands: { ...defaultDependencies.commands, ...overrides.commands },
    prompts: { ...defaultDependencies.prompts, ...overrides.prompts },
    ui: { ...defaultDependencies.ui, ...overrides.ui },
    output: { ...defaultDependencies.output, ...overrides.output },
  }
}

// Create an isolated CLI instance. Each instance owns its workspace state.
export function createCli(overrides = {}) {
  const dependencies = mergeDependencies(overrides)
  const { aliases, config, workspace, commands, prompts, ui, output } =
    dependencies

  const configPaths = config.getConfigPaths()
  const { file: configFile } = configPaths

  let root = ''

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

  async function initializeWorkspace() {
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
      output.log(ui.color(`  ${error.message}`, 'yellow'))
      output.log(
        ui.color('  Configuration must be repaired or recreated.', 'yellow'),
      )
    }

    if (savedPath && (await workspace.isDirectory(path.resolve(savedPath)))) {
      root = path.resolve(savedPath)
      return root
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

    while (true) {
      ui.clearScreen()
      ui.printHeader(root, `PROJECT / ${project.name}`)

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

      const selected = await prompts.chooseScript(scripts)

      if (!selected) return

      output.log()
      output.log(ui.color('  ----------------------------------------', 'dim'))
      output.log(`  Running: ${packageManager.name} run ${selected.name}`)
      output.log(`  Directory: ${project.directory}`)
      output.log(ui.color('  ----------------------------------------', 'dim'))
      output.log()

      try {
        const result = await commands.runCommand(
          selected.name,
          project.directory,
          { packageManager: packageManager.name },
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
      await prompts.waitAfterCommand()
    }
  }

  async function run(options = {}) {
    if (options.workspace !== undefined) {
      await useWorkspaceOption(options.workspace)
    } else {
      await initializeWorkspace()
    }

    while (true) {
      ui.clearScreen()
      ui.printHeader(root)

      let projects

      try {
        projects = await workspace.getProjects(root)
      } catch (error) {
        throw new Error(`Could not read workspace: ${error.message}`, {
          cause: error,
        })
      }

      if (projects.length === 0) {
        output.log(ui.color('  No project folders found.', 'yellow'))
        output.log()
      }

      const choice = await prompts.chooseProject(projects)

      if (!choice) return

      if (choice === CHANGE_WORKSPACE) {
        await configureWorkspace()
        continue
      }

      await projectMenu(choice)
    }
  }

  async function reset() {
    const removed = await config.resetWorkspaceConfig([
      configFile,
      configPaths.legacyFile,
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

    try {
      await run(options)
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
