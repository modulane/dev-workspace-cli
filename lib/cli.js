// The CLI itself: the options, the workspace setup, the menus and direct mode.
// Used by index.js.

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
  readColorSetting,
  readDepthSetting,
  readMouseSetting,
  readSavedWorkspaces,
  readWorkspaceConfig,
  resetWorkspaceConfig,
  saveColorSetting,
  saveDepthSetting,
  saveMouseSetting,
  saveSavedWorkspaces,
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
  MAX_DEPTH,
  getPackages,
  getProjects,
  getScripts,
  isDirectory,
  readGitBranch,
  resolveDirectoryInput,
  suggestWorkspaces,
} from './workspace.js'

import { detectPackageManager, runArguments } from './package-managers.js'

import { runCommand } from './commands.js'

import {
  CHANGE_WORKSPACE,
  ENTER_PATH,
  RUN_WITH_ARGUMENTS,
  askForArguments,
  askForWorkspace,
  askForWorkspaceName,
  chooseAccent,
  chooseProject,
  chooseScript,
  chooseWorkspace,
  confirmWorkspaceChange,
  useMouse,
  waitAfterCommand,
  waitForBack,
} from './prompts.js'

import { drawLines } from './list.js'
import { screen } from './screen.js'

import { ACCENTS, color, folderName, headerLines, setAccent } from './ui.js'

const { version } = createRequire(import.meta.url)('../package.json')

// The header tag: "pnpm · pnpm-lock.yaml", "yarn · packageManager field"...
function describePackageManager({ name, source }) {
  if (source === 'default') return `${name} · default`
  if (source === 'packageManager') return `${name} · packageManager field`
  return `${name} · ${source}`
}

// A count in the list: "12 scripts", "1 package", "no scripts".
function describeCount(count, noun) {
  if (count === 0) return `no ${noun}s`

  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// The branches a project usually starts on, coloured apart from the others.
const MAIN_BRANCHES = ['main', 'master', 'trunk']

// The Git branch after a project's detail, in colour: " · main".
function branchSegments(branch) {
  if (!branch) return {}

  return {
    detailEnd: [
      [' · ', 'dim'],
      [branch, MAIN_BRANCHES.includes(branch) ? 'mainBranch' : 'branch'],
    ],
  }
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

// Whether two paths name the same folder: Windows paths ignore case.
function samePath(a, b, platform = process.platform) {
  const normalize = value =>
    platform === 'win32'
      ? path.resolve(value).toLowerCase()
      : path.resolve(value)

  return normalize(a) === normalize(b)
}

// The name a workspace is saved under, or undefined.
function nameOf(saved, directory) {
  return Object.keys(saved).find(name => samePath(saved[name], directory))
}

// The saved name matching `typed` exactly, else ignoring case.
function findName(saved, typed) {
  const names = Object.keys(saved)

  return (
    names.find(name => name === typed) ??
    names.find(name => name.toLowerCase() === typed.toLowerCase())
  )
}

// `base`, or `base-2`, `base-3`… when another workspace has the name.
function uniqueName(base, saved) {
  let name = base

  for (let number = 2; findName(saved, name) !== undefined; number++) {
    name = `${base}-${number}`
  }

  return name
}

// Why a typed workspace name cannot be used, or true. A name must never
// read as a path, as --workspace accepts both.
export function checkWorkspaceName(typed, saved) {
  const name = typed.trim()
  const taken = findName(saved, name)

  if (!name) return 'Please enter a name.'
  if (/[\\/]/.test(name) || /^[.~]/.test(name)) {
    return 'A name cannot contain / or \\, or start with . or ~.'
  }
  if (taken !== undefined) return `"${taken}" already names ${saved[taken]}.`

  return true
}

// Find a project by exact name, then ignoring case, then by the last part
// of a nested project's name (`web` for `clients/acme/web`), then by a
// prefix that matches only one project. A \ typed on Windows reads as /.
// A package that matches along with its monorepo is left out, so `sho`
// still finds `shop` and not also `shop/packages/api`.
export function findProject(projects, typed, root) {
  const name = typed.replaceAll('\\', '/')
  const lower = name.toLowerCase()
  const rules = [
    project => project.name === name,
    project => project.name.toLowerCase() === lower,
    project => project.name.toLowerCase().split('/').at(-1) === lower,
    project => project.name.toLowerCase().startsWith(lower),
  ]

  for (const rule of rules) {
    const found = projects.filter(rule)
    const matches = found.filter(
      project =>
        !project.monorepo ||
        !found.some(other => other.directory === project.monorepo.directory),
    )

    if (matches.length === 1) return matches[0]

    if (matches.length > 1 && rule !== rules[0] && rule !== rules[1]) {
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
    readColorSetting,
    readDepthSetting,
    readMouseSetting,
    readSavedWorkspaces,
    readWorkspaceConfig,
    resetWorkspaceConfig,
    saveColorSetting,
    saveDepthSetting,
    saveMouseSetting,
    saveSavedWorkspaces,
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
    getPackages,
    getProjects,
    detectPackageManager,
    getScripts,
    isDirectory,
    readGitBranch,
    resolveDirectoryInput,
    suggestWorkspaces,
  },
  commands: {
    runCommand,
  },
  prompts: {
    askForArguments,
    askForWorkspace,
    askForWorkspaceName,
    chooseAccent,
    chooseProject,
    chooseScript,
    chooseWorkspace,
    confirmWorkspaceChange,
    useMouse,
    waitAfterCommand,
    waitForBack,
  },
  ui: {
    color,
    headerLines,
    setAccent,
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
  // The current workspace's saved name, shown in the header.
  let workspaceName = null
  // How many folder levels the project list searches, read once per run.
  let depth = 1
  let history = emptyState()
  // Project details and monorepo packages by directory, as promises, for
  // this session.
  const details = new Map()
  const packageLists = new Map()

  // The header box for a menu, drawn by the list at its current width, with
  // the list's toolbar.
  function header(crumbs = [], tag) {
    return (width, buttons = {}) =>
      ui.headerLines(
        { workspace: root, name: workspaceName, crumbs, tag, ...buttons },
        width,
      )
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

  // The saved workspaces, { name: path }. The current workspace of a file
  // saved before workspaces had names is included under its folder name.
  async function savedWorkspaces() {
    const saved = await config.readSavedWorkspaces(configFile)
    const current =
      root || (await config.readWorkspaceConfig(configFile).catch(() => null))

    if (current && nameOf(saved, current) === undefined) {
      saved[uniqueName(folderName(current), saved)] = current
    }

    return saved
  }

  // Make a folder the current workspace, saved under its saved name, the
  // `name` given, or its folder name.
  async function saveWorkspace(value, { name } = {}) {
    const saved = await savedWorkspaces()
    const directory = (await findWorkspace(value)).directory
    const known = nameOf(saved, directory)

    workspaceName = known ?? name ?? uniqueName(folderName(directory), saved)
    saved[workspaceName] = directory
    root = directory

    await config.saveWorkspaceConfig(root, configFile)
    await config.saveSavedWorkspaces(saved, configFile)

    const named =
      workspaceName === folderName(root) ? '' : ` as "${workspaceName}"`

    output.log()
    output.log(ui.color(`  Workspace saved: ${root}${named}`, 'green'))
    output.log()

    return root
  }

  // Switch to a folder from the workspace list or the path prompt. From the
  // project list (`cancellable`), a folder not saved yet is named first, and
  // Escape there keeps the current workspace.
  async function addWorkspace(value, { cancellable }) {
    const saved = await savedWorkspaces()
    const { directory } = await findWorkspace(value)

    if (!cancellable || nameOf(saved, directory) !== undefined) {
      return saveWorkspace(directory)
    }

    output.log(ui.color(`  Press Esc to keep ${root}.`, 'dim'))

    const name = await prompts.askForWorkspaceName(
      uniqueName(folderName(directory), saved),
      typed => checkWorkspaceName(typed, saved),
    )

    if (name === null) return root

    return saveWorkspace(directory, { name })
  }

  // A suggested workspace folder's detail: "8 projects", counting the
  // folders with a package.json.
  async function folderDetails(folder) {
    const count = (await workspace.getProjects(folder, { depth })).filter(
      project => project.hasPackageJson,
    ).length

    if (count === 0) return { detail: 'no projects' }

    return { detail: `${count} project${count === 1 ? '' : 's'}` }
  }

  // First run, or an unavailable workspace: a folder is required. The common
  // workspace folders that exist are offered first, then a typed path. From
  // the project list (`cancellable`), Escape keeps the current workspace.
  async function configureWorkspace({ cancellable = false } = {}) {
    const saved = await savedWorkspaces()
    const known = await Promise.all(
      Object.entries(saved).map(async ([name, directory]) => ({
        name,
        directory,
        missing: !(await workspace.isDirectory(directory)),
      })),
    )
    const folders = (await workspace.suggestWorkspaces()).filter(
      folder => nameOf(saved, folder) === undefined,
    )

    if (known.length + folders.length > 0) {
      const choice = await prompts.chooseWorkspace(folders, {
        saved: known,
        cancellable,
        details: folderDetails,
        ...(cancellable
          ? { current: root, header: header(['workspace']) }
          : {
              body: [
                ['Configure your development workspace.', 'bold'],
                ['Choose the folder that contains your projects.', 'dim'],
              ],
            }),
      })

      // The path prompt and the "Workspace saved" message use the normal
      // screen.
      ui.leaveScreen()

      if (choice === null) return root
      if (choice !== ENTER_PATH) return addWorkspace(choice, { cancellable })
    }

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

    return addWorkspace(directory, { cancellable })
  }

  // --workspace: a saved workspace's name, or else a path, saved under its
  // folder name.
  async function useWorkspaceOption(directory) {
    const saved = await savedWorkspaces()
    const name = findName(saved, directory)

    if (name !== undefined) {
      if (!(await workspace.isDirectory(saved[name]))) {
        throw new Error(
          `The workspace "${name}" is unavailable: ${saved[name]}. Remove it with --remove-workspace ${name}.`,
        )
      }

      return saveWorkspace(saved[name])
    }

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
      workspaceName = nameOf(await savedWorkspaces(), root) ?? null
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

    const directory = await configureWorkspace()

    // A first run: the colour comes with the workspace. A configuration
    // saved before colours could be chosen keeps the default.
    if (!ACCENTS.includes(await config.readColorSetting(configFile))) {
      await chooseColor()
    }

    return directory
  }

  // The accent colour, previewed on the whole screen as the cursor moves,
  // then saved.
  async function chooseColor() {
    const accent = await prompts.chooseAccent(ACCENTS, {
      preview: ui.setAccent,
      header: header(['accent colour']),
      body: [
        ['Choose an accent colour.', 'bold'],
        ['It marks where you are: the selected entry and the screen.', 'dim'],
      ],
    })

    ui.setAccent(accent)
    await config.saveColorSetting(accent, configFile)
  }

  // The list's details for a project: its script count (as its script menu
  // counts them) and Git branch, with its package manager as the tag.
  // A monorepo's details start with its package count; a package shows its
  // package name as the tag when it differs from its folder name, and a
  // branch only when it is a Git repository of its own (its folder has a
  // .git). A monorepo's `root` entry (`root: true`) shows only the script
  // count of its own package.json.
  async function readDetails(project, root) {
    const { directory, monorepo } = project
    const [packageManager, branch] = await Promise.all([
      workspace.detectPackageManager(toolDirectory(project)),
      root ? null : workspace.readGitBranch(directory),
    ])
    let detail

    try {
      const scripts = await workspace.getScripts(directory, {
        groupHooks: packageManager.runsHooks,
      })

      detail = describeCount(scripts.length, 'script')
    } catch {
      detail = 'invalid package.json'
    }

    if (root) return { detail }

    if (project.workspaces) {
      const count = (await packagesOf(project)).length

      detail = `${describeCount(count, 'package')} · ${detail}`
    }

    return {
      detail,
      ...branchSegments(branch),
      hint: monorepo ? packageTag(project) : packageManager.name,
    }
  }

  function packageTag({ path: folder, packageName }) {
    return packageName === folder.split('/').at(-1) ? undefined : packageName
  }

  // Where the package manager is detected: a package uses its monorepo's.
  function toolDirectory(project) {
    return project.monorepo?.directory ?? project.directory
  }

  // A monorepo's packages, read once per session, as projects named after
  // the monorepo and their path in it (`shop/packages/api`), with
  // `monorepo` pointing back to it. A monorepo whose packages cannot be
  // read simply has none.
  function packagesOf(monorepo) {
    if (!packageLists.has(monorepo.directory)) {
      packageLists.set(
        monorepo.directory,
        workspace.getPackages(monorepo.directory, monorepo.workspaces).then(
          found =>
            found.map(({ path: folder, directory, packageName }) => ({
              name: `${monorepo.name}/${folder}`,
              path: folder,
              directory,
              hasPackageJson: true,
              monorepo,
              ...(packageName && { packageName }),
            })),
          () => [],
        ),
      )
    }

    return packageLists.get(monorepo.directory)
  }

  // The packages of every monorepo among `projects`, by monorepo directory.
  async function readPackages(projects) {
    const monorepos = projects.filter(project => project.workspaces)
    const lists = await Promise.all(monorepos.map(packagesOf))

    return new Map(
      monorepos.map((monorepo, index) => [monorepo.directory, lists[index]]),
    )
  }

  // The projects and every monorepo's packages, for finding one by name.
  async function readAllProjects() {
    const projects = await readProjects()
    const packages = await readPackages(projects)

    return [...projects, ...[...packages.values()].flat()]
  }

  function projectDetails(project, { root = false } = {}) {
    const key = root ? `root:${project.directory}` : project.directory

    if (!details.has(key)) details.set(key, readDetails(project, root))

    return details.get(key)
  }

  async function readProjects() {
    try {
      return await workspace.getProjects(root, { depth })
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
      name: workspaceName,
      crumbs: [project.name, script.name],
      tag: describePackageManager(packageManager),
    })) {
      output.log(line)
    }

    output.log()
    output.log(
      `  ${ui.color('▶', 'accent')} ${ui.color(describeRun(script.name, options), 'bold')}`,
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
  // returns to the script list, and so does Escape at the arguments prompt.
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

      if (!withArguments) return { script, args: [] }

      // A script that needs arguments shows what they complete.
      if (script.needsArguments) {
        output.log(
          ui.color(
            `  ${script.name} runs: ${script.command} <arguments>`,
            'dim',
          ),
        )
      }

      output.log(ui.color('  Press Esc to go back to the scripts.', 'dim'))

      const args = await prompts.askForArguments(script.name, {
        required: Boolean(script.needsArguments),
      })

      if (args !== null) return { script, args }
    }
  }

  async function projectMenu(project) {
    // Read again for the list once back: the project, and when it is a
    // monorepo or one of its packages, the monorepo's packages and count.
    const monorepo = project.monorepo ?? (project.workspaces && project)

    details.delete(project.directory)
    details.delete(`root:${project.directory}`)

    if (monorepo) {
      packageLists.delete(monorepo.directory)
      details.delete(monorepo.directory)
    }

    // Detected first: hooks are grouped under their main script only when the
    // package manager runs them.
    const packageManager = await workspace.detectPackageManager(
      toolDirectory(project),
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
    const project = findProject(await readAllProjects(), name, root)
    const packageManager = await workspace.detectPackageManager(
      toolDirectory(project),
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

    const script = scripts.find(found => found.name === scriptName)

    if (script.needsArguments && !scriptArgs?.length) {
      throw new Error(
        `"${scriptName}" cannot run without arguments (it runs: ${script.command}). Add them after --, for example: dws ${project.name} ${scriptName} -- <arguments>`,
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

    history = await historyStore.readState(stateFile)
    depth = await config.readDepthSetting(configFile, MAX_DEPTH)

    if (direct) {
      if (options.workspace === undefined) {
        await initializeWorkspace({ interactive: false })
      }

      return runDirectly(options)
    }

    // Before the workspace, so the first-run list has the mouse too.
    await setUpMouse(options)

    // Whatever ends the menus, messages such as an error or "Goodbye!" are
    // printed on the normal screen.
    try {
      if (options.workspace === undefined) await initializeWorkspace()

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
        : findProject(await readAllProjects(), options.project, root)
    // The last project or package opened, selected again in the list.
    let lastOpened = null

    while (true) {
      if (opening) {
        lastOpened = opening.directory
        await projectMenu(opening)
        opening = null
      }

      const projects = await readProjects()
      const packages = await readPackages(projects)
      const everything = [...projects, ...[...packages.values()].flat()]
      const choice = await prompts.chooseProject(projects, {
        recent: recentProjects(history, everything),
        details: projectDetails,
        packages: project => packages.get(project.directory),
        default: everything.find(project => project.directory === lastOpened),
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

  async function setColor(name) {
    await config.saveColorSetting(name, configFile)
    ui.setAccent(name)

    output.log(`  The accent colour is now ${ui.color(name, 'accent')}.`)
  }

  async function setDepth(value) {
    const levels = Number(value)

    await config.saveDepthSetting(levels, configFile)

    output.log(
      ui.color(
        levels === 1
          ? '  The project list shows the workspace folders only.'
          : `  The project list searches ${levels} folder levels for projects.`,
        'green',
      ),
    )
  }

  async function printWorkspaces() {
    const current = await config
      .readWorkspaceConfig(configFile)
      .catch(() => null)
    const saved = await savedWorkspaces()
    const names = Object.keys(saved)

    if (names.length === 0) {
      output.log('  No saved workspaces yet. Run dev-workspace to choose one.')
      return
    }

    const width = Math.max(...names.map(name => name.length))

    for (const name of names) {
      const mark = current && samePath(saved[name], current) ? ' (current)' : ''

      output.log(`  ${name.padEnd(width)}  ${saved[name]}${mark}`)
    }
  }

  async function removeWorkspace(typed) {
    const saved = await savedWorkspaces()
    const name = findName(saved, typed)
    const current = await config
      .readWorkspaceConfig(configFile)
      .catch(() => null)

    if (name === undefined) {
      throw new Error(
        `No saved workspace named "${typed}". See them with --list-workspaces.`,
      )
    }

    if (current && samePath(saved[name], current)) {
      throw new Error(
        `"${name}" is the current workspace. Switch to another one first, with --workspace <name|path>.`,
      )
    }

    const directory = saved[name]

    delete saved[name]
    await config.saveSavedWorkspaces(saved, configFile)

    output.log(
      `  Removed the workspace "${name}". Its folder is left as it is: ${directory}`,
    )
  }

  async function deleteAlias(name) {
    await aliases.removeAlias(name)

    output.log(`  Removed alias "${name}".`)
  }

  // Resolve with the exit code of a script run directly, otherwise undefined.
  async function start(args = []) {
    const options = parseCliArgs(args)

    // Before anything is drawn, the help included.
    ui.setAccent(await config.readColorSetting(configFile))

    if (options.help) return output.log(formatHelp(ui.color))
    if (options.version) return output.log(version)
    if (options['config-path']) return output.log(configFile)
    if (options['list-aliases']) return printAliases()
    if (options['list-workspaces']) return printWorkspaces()
    if (options['remove-workspace'] !== undefined) {
      return removeWorkspace(options['remove-workspace'])
    }
    if (options['add-alias'] !== undefined) {
      return createAlias(options['add-alias'])
    }
    if (options['remove-alias'] !== undefined) {
      return deleteAlias(options['remove-alias'])
    }
    if (options['set-mouse'] !== undefined) {
      return setMouse(options['set-mouse'])
    }
    if (options['set-color'] !== undefined) {
      return setColor(options['set-color'])
    }
    if (options['set-depth'] !== undefined) {
      return setDepth(options['set-depth'])
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
        output.log(`\n  ${ui.color('Goodbye!', 'accent')}\n`)
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
