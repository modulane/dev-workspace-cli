// The CLI itself: option handling, workspace setup and the interactive menus.
//
// start() handles one-shot options (help, formatted with ui.color, version,
// aliases, the mouse setting, reset, clearing the history) and otherwise
// runs the main loop: load or configure the workspace, list its projects
// (recently used ones first, each with its script count, Git branch and
// package manager: projectDetails()), list a project's scripts with its
// detected package manager, run the chosen script with that tool, optionally
// with arguments, then offer to run it again. Every menu shows the header
// box from ui.js, with the project as a breadcrumb and its package manager
// as the tag; empty and error states are shown in the box's screen, as the
// list's body. Changing the workspace from the project list can be undone
// with Escape at the path prompt, which keeps the current one. Workspace
// paths typed at the prompt or passed with
// --workspace go through resolveDirectoryInput(), so ~, quotes and escaped
// spaces work without a shell.
//
// The menus are drawn on the alternate screen (screen.js). The CLI leaves it
// (ui.leaveScreen) before a script runs, so its output stays on the normal
// screen, and whenever the menus end, before any error or "Goodbye!".
//
// The run screen, on the normal screen: the header box with the project and
// script as breadcrumb (ui.drawHeader, drawn once with list.js), the command
// (`▶ npm run build`), the script's output, then the result: `✔ build
// finished in 4.2s` in green, or `✖ build failed · exit 1 · 0.8s` in red,
// with the signal name in place of the exit code when a signal stopped it.
// The duration is measured with clock.now() and shown by formatDuration().
// The Run again / Back to scripts buttons follow (waitAfterCommand).
//
// Menus and questions need a terminal for input: without one, and without
// a script to run directly, run() fails with a message saying so.
//
// Direct mode: `dev-workspace <project>` opens that project's scripts, and
// `dev-workspace <project> <script> [-- args]` runs the script without any
// menu or prompt and resolves with its exit code (128 + the signal number
// when a signal stopped it), which index.js uses as the process exit code.
// The project is found by exact name, then ignoring case, then by unique
// prefix (findProject).
//
// Project details are read only for the projects the list shows, and
// cached for the session, so a large workspace still opens at once; opening
// a project reads its details again the next time the list shows it, as a
// script may have changed them.
//
// The history (state.js) records each opened project and run script; it is
// read once per run, and saving it never stops the CLI.
//
// Menus use the mouse unless --no-mouse (this run) or `"mouse": false` in
// the configuration (saved with --set-mouse off) turns it off, input or
// output is not a terminal, or the terminal (terminal.js) reports no mouse
// events. In a terminal without full support, the first menu shows a note
// from mouseNote(), once per terminal: the history records it when a menu
// shows it.
//
// Every side effect goes through a dependency group (aliases, config,
// history, terminal, workspace, commands, prompts, ui, clock, output) that
// createCli() accepts as overrides, so tests drive the whole flow with
// fakes. index.js calls startCli(), which uses the real modules and process
// arguments.

import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import {
  addAlias,
  listAliases,
  removeAlias,
  removeAllAliases,
} from './aliases.js'

import { formatHelp, parseCliArgs } from './args.js'

import {
  getConfigPaths,
  migrateLegacyConfig,
  readMouseSetting,
  readWorkspaceConfig,
  resetWorkspaceConfig,
  saveMouseSetting,
  saveWorkspaceConfig,
} from './config.js'

import {
  clearState,
  emptyState,
  getStatePath,
  readState,
  recentProjects,
  rememberMouseNote,
  rememberProject,
  rememberScript,
  saveState,
} from './state.js'

import {
  detectTerminal,
  isInteractive,
  isTerminal,
  mouseNote,
} from './terminal.js'

import {
  getProjects,
  getScripts,
  isDirectory,
  readGitBranch,
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
  useMouse,
  waitAfterCommand,
  waitForBack,
} from './prompts.js'

import { drawLines } from './list.js'
import { screen } from './screen.js'

import { color, headerLines } from './ui.js'

const { version } = createRequire(import.meta.url)('../package.json')

// The header tag: "pnpm · pnpm-lock.yaml", "yarn · packageManager field"...
function describePackageManager({ name, source }) {
  if (source === 'default') return `${name} · default`
  if (source === 'packageManager') return `${name} · packageManager field`
  return `${name} · ${source}`
}

// A project's detail in the list: "12 scripts · main".
function describeProject(scriptCount, branch) {
  const scripts =
    scriptCount === 0
      ? 'no scripts'
      : `${scriptCount} script${scriptCount === 1 ? '' : 's'}`

  return branch ? `${scripts} · ${branch}` : scripts
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

// A run's duration: "0.8s", "42.0s", "2m 05s".
export function formatDuration(milliseconds) {
  const seconds = Math.max(0, milliseconds) / 1000

  if (seconds < 59.95) return `${seconds.toFixed(1)}s`

  const whole = Math.round(seconds)

  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
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
    readMouseSetting,
    readWorkspaceConfig,
    resetWorkspaceConfig,
    saveMouseSetting,
    saveWorkspaceConfig,
  },
  history: {
    clearState,
    readState,
    saveState,
  },
  terminal: {
    detectTerminal,
    isInteractive,
    isTerminal,
  },
  workspace: {
    getProjects,
    detectPackageManager,
    getScripts,
    isDirectory,
    readGitBranch,
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
    useMouse,
    waitAfterCommand,
    waitForBack,
  },
  ui: {
    color,
    headerLines,
    // The header box above a script's output, as text lines.
    drawHeader: options => drawLines(width => headerLines(options, width)),
    leaveScreen: () => screen.leave(),
  },
  clock: {
    now: () => performance.now(),
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
    terminal,
    workspace,
    commands,
    prompts,
    ui,
    clock,
    output,
  } = dependencies

  const configPaths = config.getConfigPaths()
  const { file: configFile } = configPaths
  const stateFile = getStatePath(configFile, { custom: configPaths.custom })

  let root = ''
  let history = emptyState()
  // Project details by directory, as promises, for this session.
  const details = new Map()

  // The header box for a menu, drawn by the list at its current width, with
  // the list's toolbar.
  function header(crumbs = [], tag) {
    return (width, buttons = {}) =>
      ui.headerLines({ workspace: root, crumbs, tag, ...buttons }, width)
  }

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

  async function setUpMouse(options) {
    if (
      options['no-mouse'] ||
      !terminal.isTerminal() ||
      !(await config.readMouseSetting(configFile))
    ) {
      return prompts.useMouse(false)
    }

    const found = terminal.detectTerminal()
    const note = history.mouseNotes.includes(found.id) ? null : mouseNote(found)

    // Recorded once a menu shows it: the CLI can still stop before that, for
    // example when `dws <project>` names no project.
    prompts.useMouse(found.support !== 'none', note, () =>
      remember(state => rememberMouseNote(state, found.id)),
    )
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

  // First run, or an unavailable workspace: a path is required. From the
  // project list (`cancellable`), Escape keeps the current workspace.
  async function configureWorkspace({ cancellable = false } = {}) {
    output.log()
    output.log('  Configure your development workspace.')
    output.log('  Enter the folder containing your projects.')

    if (cancellable) {
      output.log(ui.color(`  Press Esc to keep ${root}.`, 'dim'))
    }

    output.log()

    const directory = await prompts.askForWorkspace(validateWorkspace, {
      cancellable,
    })

    if (directory === null) return root

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

  // The list's details for a project: its script count (as its script menu
  // counts them) and Git branch, with its package manager as the tag.
  async function readDetails({ directory }) {
    const [packageManager, branch] = await Promise.all([
      workspace.detectPackageManager(directory),
      workspace.readGitBranch(directory),
    ])
    let detail

    try {
      const scripts = await workspace.getScripts(directory, {
        groupHooks: packageManager.runsHooks,
      })

      detail = describeProject(scripts.length, branch)
    } catch {
      detail = branch
        ? `invalid package.json · ${branch}`
        : 'invalid package.json'
    }

    return { detail, hint: packageManager.name }
  }

  function projectDetails(project) {
    if (!details.has(project.directory)) {
      details.set(project.directory, readDetails(project))
    }

    return details.get(project.directory)
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

  // Run a script from the menu: the header box, the command, the script's
  // output, then how it ended and how long it took.
  async function runFromMenu(project, packageManager, { script, args }) {
    const options = runOptions(packageManager, args)

    // The output stays on the normal screen, visible after the menus return.
    ui.leaveScreen()

    output.log()

    for (const line of ui.drawHeader({
      workspace: root,
      crumbs: [project.name, script.name],
      tag: describePackageManager(packageManager),
    })) {
      output.log(line)
    }

    output.log()
    output.log(
      `  ${ui.color('▶', 'cyan')} ${ui.color(describeRun(script.name, options), 'bold')}`,
    )
    output.log()

    await remember(state =>
      rememberScript(state, project.directory, script.name),
    )

    const started = clock.now()

    try {
      const result = await commands.runCommand(
        script.name,
        project.directory,
        options,
      )
      const time = formatDuration(clock.now() - started)

      output.log()

      if (result.code === 0 && !result.signal) {
        output.log(ui.color(`  ✔ ${script.name} finished in ${time}`, 'green'))
      } else {
        const reason = result.signal ?? `exit ${result.code ?? 'unknown'}`

        output.log(
          ui.color(`  ✖ ${script.name} failed · ${reason} · ${time}`, 'red'),
        )
      }
    } catch (error) {
      output.log()
      output.error(
        ui.color(`  ✖ ${script.name} could not start: ${error.message}`, 'red'),
      )
    }

    output.log()
  }

  // Ask which script to run and return { script, args }, or null for Back.
  // The `… Run with args` button first asks which script; Back from there
  // returns to the script list.
  async function chooseRun(scripts, lastScript, frame) {
    while (true) {
      let selected = await prompts.chooseScript(scripts, {
        lastScript,
        header: frame,
      })

      if (!selected) return null

      if (selected === RUN_WITH_ARGUMENTS) {
        selected = await prompts.chooseScript(scripts, {
          lastScript,
          forArguments: true,
          header: frame,
        })

        if (!selected) continue
      }

      const { script, withArguments } = selected

      return {
        script,
        args: withArguments ? await prompts.askForArguments(script.name) : [],
      }
    }
  }

  async function projectMenu(project) {
    details.delete(project.directory)

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
      await prompts.waitForBack({
        header: header([project.name]),
        body: [
          [`Could not read package.json: ${error.message}`, 'red'],
          ['Fix the file, then open the project again.', 'dim'],
        ],
      })
      return
    }

    await remember(state => rememberProject(state, project.directory))

    // The run to repeat when the user picks "Run again".
    let run = null

    const frame = header([project.name], describePackageManager(packageManager))

    while (true) {
      if (!run) {
        if (scripts.length === 0) {
          await prompts.waitForBack({
            header: frame,
            body: [
              [`No scripts in ${project.name}.`, 'yellow'],
              ['Add a "scripts" object to its package.json.', 'dim'],
            ],
          })
          return
        }

        run = await chooseRun(
          scripts,
          history.lastScripts[project.directory],
          frame,
        )

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
    }

    // Without a terminal for input, a menu or question would fail with a
    // prompt error, or wait for input that never comes.
    if (!direct && !terminal.isInteractive()) {
      throw new Error(
        'The menus need an interactive terminal. To run a script without them, use: dev-workspace <project> <script>',
      )
    }

    if (options.workspace === undefined) {
      await initializeWorkspace({ interactive: !direct })
    }

    history = await historyStore.readState(stateFile)

    if (direct) return runDirectly(options)

    await setUpMouse(options)

    // Whatever ends the menus, messages such as an error or "Goodbye!" are
    // printed on the normal screen.
    try {
      await menus(options)
    } finally {
      ui.leaveScreen()
    }
  }

  async function menus(options) {
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

      const projects = await readProjects()
      const choice = await prompts.chooseProject(projects, {
        recent: recentProjects(history, projects),
        details: projectDetails,
        header: header(),
        body:
          projects.length === 0
            ? [
                ['No project folders in this workspace.', 'yellow'],
                ['Add one, or change the workspace.', 'dim'],
              ]
            : [],
      })

      if (!choice) return

      if (choice === CHANGE_WORKSPACE) {
        await configureWorkspace({ cancellable: true })
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

  async function setMouse(value) {
    await config.saveMouseSetting(value === 'on', configFile)

    output.log(
      ui.color(
        value === 'on'
          ? '  Menus use the mouse again.'
          : '  Menus use only the keyboard. Turn the mouse back on with: dws --set-mouse on',
        'green',
      ),
    )
  }

  async function deleteAlias(name) {
    await aliases.removeAlias(name)

    output.log(`  Removed alias "${name}".`)
  }

  // Resolve with the exit code of a script run directly, otherwise undefined.
  async function start(args = []) {
    const options = parseCliArgs(args)

    if (options.help) return output.log(formatHelp(ui.color))
    if (options.version) return output.log(version)
    if (options['config-path']) return output.log(configFile)
    if (options['list-aliases']) return printAliases()
    if (options['add-alias'] !== undefined) {
      return createAlias(options['add-alias'])
    }
    if (options['remove-alias'] !== undefined) {
      return deleteAlias(options['remove-alias'])
    }
    if (options['set-mouse'] !== undefined) {
      return setMouse(options['set-mouse'])
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
