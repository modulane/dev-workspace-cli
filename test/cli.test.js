import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { createCli, findProject, formatDuration } from '../lib/cli.js'
import { CHANGE_WORKSPACE, RUN_WITH_ARGUMENTS } from '../lib/prompts.js'
import { emptyState } from '../lib/state.js'
import { headerLines } from '../lib/ui.js'
import { resolveDirectoryInput } from '../lib/workspace.js'

const { version } = createRequire(import.meta.url)('../package.json')

const WORKSPACE = path.resolve('fake/workspace')

function createDependencies(overrides = {}) {
  const calls = {
    savedWorkspaces: [],
    discoveredWorkspaces: [],
    savedStates: [],
    mouse: [],
    mouseSettings: [],
    errors: [],
    logs: [],
    menus: [],
    runHeaders: [],
    time: 0,
  }

  const dependencies = {
    aliases: {
      addAlias: async name => [`/fake/bin/${name}`],
      listAliases: async () => [],
      removeAlias: async name => [`/fake/bin/${name}`],
      removeAllAliases: async () => [],
    },

    config: {
      getConfigPaths: () => ({
        directory: '/fake/home/.dev-workspace-cli',
        file: '/fake/home/.dev-workspace-cli/config.json',
        legacyFile: '/fake/home/.legacy/config.json',
      }),
      migrateLegacyConfig: async () => null,
      readMouseSetting: async () => true,
      readWorkspaceConfig: async () => WORKSPACE,
      resetWorkspaceConfig: async () => [],
      saveMouseSetting: async (enabled, file) => {
        calls.mouseSettings.push({ enabled, file })
      },
      saveWorkspaceConfig: async (workspace, file) => {
        calls.savedWorkspaces.push({ workspace, file })
      },
    },

    history: {
      readState: async () => emptyState(),
      saveState: async (file, state) => {
        calls.savedStates.push({ file, state })
      },
      clearState: async () => false,
    },

    terminal: {
      detectTerminal: () => ({
        id: 'windows-terminal',
        name: 'Windows Terminal',
        support: 'full',
      }),
      isInteractive: () => true,
      isTerminal: () => true,
    },

    workspace: {
      isDirectory: async () => true,
      getProjects: async root => {
        calls.discoveredWorkspaces.push({ root })
        return []
      },
      getScripts: async () => [],
      detectPackageManager: async () => ({ name: 'npm', source: 'default' }),
      readGitBranch: async () => null,
    },

    commands: {
      runCommand: async () => ({ code: 0 }),
    },

    prompts: {
      askForArguments: async () => [],
      askForWorkspace: async () => WORKSPACE,
      chooseProject: async (projects, options) => {
        calls.menus.push(options)
        return null
      },
      chooseScript: async (scripts, options) => {
        calls.menus.push(options)
        return null
      },
      confirmWorkspaceChange: async () => true,
      useMouse: (enabled, note = null, onNoteShown = null) => {
        calls.mouse.push({ enabled, note })
        calls.showNote = onNoteShown
      },
      waitAfterCommand: async () => undefined,
      waitForBack: async options => {
        calls.menus.push(options)
      },
    },

    ui: {
      leaveScreen: () => {
        calls.leftScreen = (calls.leftScreen ?? 0) + 1
      },
      color: value => String(value),
      headerLines,
      drawHeader: options => {
        calls.runHeaders.push(options)
        return headerLines(options, 80).map(line =>
          line.map(([text]) => text).join(''),
        )
      },
    },

    // Each reading is 4.2 seconds after the previous one.
    clock: {
      now: () => {
        calls.time += 4200
        return calls.time
      },
    },

    output: {
      log: (...args) => calls.logs.push(args),
      error: (...args) => calls.errors.push(args),
    },
  }

  for (const group of Object.keys(overrides)) {
    Object.assign(dependencies[group], overrides[group])
  }

  return { dependencies, calls }
}

test('CLI loads the saved workspace and discovers its projects', async () => {
  const { dependencies, calls } = createDependencies()
  const cli = createCli(dependencies)

  await cli.run()

  assert.equal(calls.discoveredWorkspaces.length, 1)
  assert.equal(calls.discoveredWorkspaces[0].root, WORKSPACE)
  assert.equal(calls.savedWorkspaces.length, 0)
})

test('CLI configures and saves the workspace when no configuration exists', async () => {
  const { dependencies, calls } = createDependencies({
    config: {
      readWorkspaceConfig: async () => null,
    },
  })

  const cli = createCli(dependencies)

  await cli.run()

  assert.equal(calls.savedWorkspaces.length, 1)
  assert.equal(calls.savedWorkspaces[0].workspace, WORKSPACE)
  assert.equal(
    calls.savedWorkspaces[0].file,
    '/fake/home/.dev-workspace-cli/config.json',
  )
  assert.equal(calls.discoveredWorkspaces.length, 1)
})

test('CLI does not continue when the user declines workspace recovery', async () => {
  const { dependencies, calls } = createDependencies({
    workspace: {
      isDirectory: async () => false,
    },
    prompts: {
      confirmWorkspaceChange: async () => false,
    },
  })

  const cli = createCli(dependencies)

  await assert.rejects(cli.run(), /A valid workspace is required to continue/)

  assert.equal(calls.discoveredWorkspaces.length, 0)
  assert.equal(calls.savedWorkspaces.length, 0)
})

test('CLI fails with a workspace error when discovery fails', async () => {
  const originalError = new Error('Permission denied')
  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => {
        throw originalError
      },
    },
  })

  const cli = createCli(dependencies)

  await assert.rejects(cli.run(), error => {
    assert.match(error.message, /Could not read workspace: Permission denied/)
    assert.equal(error.cause, originalError)
    return true
  })
})

test('CLI exits cleanly when the project list is empty', async () => {
  const { dependencies, calls } = createDependencies()
  const cli = createCli(dependencies)

  await cli.run()

  assert.equal(calls.discoveredWorkspaces.length, 1)
  assert.match(menuText(calls), /No project folders in this workspace\./)
  // The header starts with the workspace folder's name.
  assert.match(menuText(calls), /◆ workspace ─/)
})

test('CLI treats prompt cancellation as a normal exit', async () => {
  const cancellation = Object.assign(new Error('Prompt cancelled'), {
    name: 'ExitPromptError',
  })

  const { dependencies, calls } = createDependencies({
    prompts: {
      chooseProject: async () => {
        throw cancellation
      },
    },
    workspace: {
      getProjects: async () => [
        { name: 'example', directory: '/fake/workspace/example' },
      ],
    },
  })

  const cli = createCli(dependencies)

  await assert.doesNotReject(cli.start())

  assert.ok(calls.logs.some(args => args.join(' ').includes('Goodbye!')))
})

test('CLI opens a project and returns to the project list', async () => {
  const project = {
    name: 'example',
    directory: path.join(WORKSPACE, 'example'),
  }

  let projectSelections = 0
  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [{ name: 'dev', command: 'vite' }],
    },
    prompts: {
      chooseProject: async () => {
        projectSelections++
        return projectSelections === 1 ? project : null
      },
      chooseScript: async () => null,
    },
  })

  await createCli(dependencies).run()

  assert.equal(projectSelections, 2)
})

test('CLI handles a project with no npm scripts', async () => {
  const project = {
    name: 'empty-project',
    directory: path.join(WORKSPACE, 'empty-project'),
  }

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [],
    },
    prompts: {
      chooseProject: async () => project,
    },
  })

  // Select the project once, then exit the project list.
  let selections = 0
  dependencies.prompts.chooseProject = async () => {
    selections++
    return selections === 1 ? project : null
  }

  await createCli(dependencies).run()

  assert.match(menuText(calls), /No scripts in empty-project\./)
})

test('CLI runs a selected script and reports success', async () => {
  const project = {
    name: 'example',
    directory: path.join(WORKSPACE, 'example'),
  }
  const script = { name: 'dev', command: 'vite' }

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
    },
    prompts: {
      chooseProject: async () => project,
      chooseScript: async () => ({ script, withArguments: false }),
      waitAfterCommand: async () => undefined,
    },
    commands: {
      runCommand: async () => ({ code: 0 }),
    },
  })

  let projectSelections = 0
  dependencies.prompts.chooseProject = async () => {
    projectSelections++
    return projectSelections === 1 ? project : null
  }

  let scriptSelections = 0
  dependencies.prompts.chooseScript = async () => {
    scriptSelections++
    return scriptSelections === 1 ? { script, withArguments: false } : null
  }

  await createCli(dependencies).run()

  const lines = loggedText(calls).split('\n')

  assert.deepEqual(calls.runHeaders, [
    { workspace: WORKSPACE, crumbs: ['example', 'dev'], tag: 'npm · default' },
  ])
  assert.deepEqual(lines.slice(0, 6), [
    '',
    ...headerLines(calls.runHeaders[0], 80).map(line =>
      line.map(([text]) => text).join(''),
    ),
    '',
    '  ▶ npm run dev',
  ])
  assert.deepEqual(lines.slice(-3), ['', '  ✔ dev finished in 4.2s', ''])
})

test('CLI reports a non-zero script exit code', async () => {
  const project = {
    name: 'example',
    directory: path.join(WORKSPACE, 'example'),
  }
  const script = { name: 'test', command: 'vitest' }

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
    },
    commands: {
      runCommand: async () => ({ code: 7 }),
    },
  })

  let projectSelections = 0
  dependencies.prompts.chooseProject = async () =>
    ++projectSelections === 1 ? project : null

  let scriptSelections = 0
  dependencies.prompts.chooseScript = async () =>
    ++scriptSelections === 1 ? { script, withArguments: false } : null

  await createCli(dependencies).run()

  assert.match(loggedText(calls), /✖ test failed · exit 7 · 4\.2s/)
})

test('CLI reports a command interrupted by a signal', async () => {
  const project = {
    name: 'example',
    directory: path.join(WORKSPACE, 'example'),
  }
  const script = { name: 'build', command: 'vite build' }

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
    },
    commands: {
      runCommand: async () => ({
        code: null,
        signal: 'SIGTERM',
      }),
    },
  })

  let projectSelections = 0
  dependencies.prompts.chooseProject = async () =>
    ++projectSelections === 1 ? project : null

  let scriptSelections = 0
  dependencies.prompts.chooseScript = async () =>
    ++scriptSelections === 1 ? { script, withArguments: false } : null

  await createCli(dependencies).run()

  assert.match(loggedText(calls), /✖ build failed · SIGTERM · 4\.2s/)
})

test('CLI handles errors while reading a project package.json', async () => {
  const project = {
    name: 'broken-project',
    directory: path.join(WORKSPACE, 'broken-project'),
  }

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => {
        throw new Error('Invalid package JSON')
      },
    },
  })

  let projectSelections = 0
  dependencies.prompts.chooseProject = async () =>
    ++projectSelections === 1 ? project : null

  await createCli(dependencies).run()

  assert.match(
    menuText(calls),
    /Could not read package\.json: Invalid package JSON/,
  )
  assert.match(menuText(calls), /› broken-project/)
})

test('CLI handles errors when starting a command', async () => {
  const project = {
    name: 'example',
    directory: path.join(WORKSPACE, 'example'),
  }
  const script = { name: 'dev', command: 'vite' }

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
    },
    commands: {
      runCommand: async () => {
        throw new Error('npm unavailable')
      },
    },
  })

  let projectSelections = 0
  dependencies.prompts.chooseProject = async () =>
    ++projectSelections === 1 ? project : null

  let scriptSelections = 0
  dependencies.prompts.chooseScript = async () =>
    ++scriptSelections === 1 ? { script, withArguments: false } : null

  await createCli(dependencies).run()

  assert.ok(
    calls.errors.some(args =>
      args.join(' ').includes('✖ dev could not start: npm unavailable'),
    ),
  )
})

test('CLI treats prompt abortion as a normal exit', async () => {
  const abortion = Object.assign(new Error('Prompt aborted'), {
    name: 'AbortPromptError',
  })

  const { dependencies, calls } = createDependencies({
    prompts: {
      chooseProject: async () => {
        throw abortion
      },
    },
    workspace: {
      getProjects: async () => [
        { name: 'example', directory: '/fake/workspace/example' },
      ],
    },
  })

  await assert.doesNotReject(createCli(dependencies).start())

  assert.ok(calls.logs.some(args => args.join(' ').includes('Goodbye!')))
})

test('CLI propagates unexpected errors, after leaving the alternate screen', async () => {
  const { dependencies, calls } = createDependencies({
    prompts: {
      chooseProject: async () => {
        throw new Error('Unexpected UI failure')
      },
    },
  })

  await assert.rejects(createCli(dependencies).start(), /Unexpected UI failure/)
  assert.equal(calls.leftScreen, 1)
})

function loggedText(calls) {
  return calls.logs.map(args => args.join(' ')).join('\n')
}

// What the recorded menus show above their message: the header box, at 80
// columns, and the body.
function menuText(calls) {
  return calls.menus
    .flatMap(options => [
      ...(options?.header?.(80) ?? []).map(line =>
        line.map(([text]) => text).join(''),
      ),
      ...(options?.body ?? []).map(([text]) => text),
    ])
    .join('\n')
}

test('CLI lets the user change the workspace from the project list', async () => {
  const otherWorkspace = path.resolve('fake/other')
  const choices = [CHANGE_WORKSPACE, null]

  const { dependencies, calls } = createDependencies({
    prompts: {
      chooseProject: async () => choices.shift(),
      askForWorkspace: async () => otherWorkspace,
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(calls.savedWorkspaces, [
    {
      workspace: otherWorkspace,
      file: '/fake/home/.dev-workspace-cli/config.json',
    },
  ])
  assert.deepEqual(
    calls.discoveredWorkspaces.map(call => call.root),
    [WORKSPACE, otherWorkspace],
  )
})

test('CLI keeps the workspace when its change is cancelled with Escape', async () => {
  const choices = [CHANGE_WORKSPACE, null]
  const asked = []

  const { dependencies, calls } = createDependencies({
    prompts: {
      chooseProject: async () => choices.shift(),
      askForWorkspace: async (validate, options) => {
        asked.push(options)
        return null
      },
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(asked, [{ cancellable: true }])
  assert.match(loggedText(calls), /Press Esc to keep .*workspace\./)
  assert.deepEqual(calls.savedWorkspaces, [])
  assert.deepEqual(
    calls.discoveredWorkspaces.map(call => call.root),
    [WORKSPACE, WORKSPACE],
  )
})

test('CLI offers a workspace change when the project list is empty', async () => {
  let offeredProjects

  const { dependencies } = createDependencies({
    prompts: {
      chooseProject: async projects => {
        offeredProjects = projects
        return null
      },
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(offeredProjects, [])
})

test('CLI saves the workspace passed with --workspace', async () => {
  const otherWorkspace = path.resolve('fake/other')
  let configRead = false

  const { dependencies, calls } = createDependencies({
    config: {
      readWorkspaceConfig: async () => {
        configRead = true
        return WORKSPACE
      },
    },
  })

  await createCli(dependencies).start(['--workspace', 'fake/other'])

  assert.equal(configRead, false)
  assert.equal(calls.savedWorkspaces[0].workspace, otherWorkspace)
  assert.equal(calls.discoveredWorkspaces[0].root, otherWorkspace)
})

test('CLI rejects a missing --workspace directory', async () => {
  const { dependencies, calls } = createDependencies({
    workspace: { isDirectory: async () => false },
  })

  await assert.rejects(
    createCli(dependencies).start(['-w', 'missing']),
    /Invalid workspace "missing": No accessible directory at .*missing$/,
  )
  assert.equal(calls.savedWorkspaces.length, 0)
})

test('CLI saves the absolute path behind a quoted, ~-prefixed prompt answer', async () => {
  const home = path.resolve('fake/home')
  const projects = path.join(home, 'my projects')
  let validation

  const { dependencies, calls } = createDependencies({
    config: { readWorkspaceConfig: async () => null },
    workspace: {
      isDirectory: async directory => directory === projects,
      resolveDirectoryInput: (value, options) =>
        resolveDirectoryInput(value, { ...options, homeDirectory: home }),
    },
    prompts: {
      askForWorkspace: async validate => {
        validation = {
          missing: await validate('~/missing'),
          quoted: await validate('"~/my projects"'),
        }
        return '"~/my projects"'
      },
    },
  })

  await createCli(dependencies).run()

  assert.equal(
    validation.missing,
    `No accessible directory at ${path.join(home, 'missing')}`,
  )
  assert.equal(validation.quoted, true)
  assert.equal(calls.savedWorkspaces[0].workspace, projects)
  assert.equal(calls.discoveredWorkspaces[0].root, projects)
})

test('CLI prints help, version and config path without starting', async () => {
  const cases = [
    [['--help'], /Usage: dev-workspace/],
    [['-v'], new RegExp(`^${version.replaceAll('.', '\\.')}$`)],
    [['--config-path'], /^\/fake\/home\/\.dev-workspace-cli\/config\.json$/],
  ]

  for (const [args, expected] of cases) {
    const { dependencies, calls } = createDependencies()

    await createCli(dependencies).start(args)

    assert.match(loggedText(calls), expected)
    assert.equal(calls.discoveredWorkspaces.length, 0)
  }
})

test('CLI colors help text through ui.color', async () => {
  const { dependencies, calls } = createDependencies({
    ui: {
      color: (value, shade) => `[${shade}]${value}[/${shade}]`,
    },
  })

  await createCli(dependencies).start(['--help'])

  const text = loggedText(calls)
  assert.match(text, /\[bold\]Usage:\[\/bold\]/)
  assert.match(text, /\[cyan\]dev-workspace\[\/cyan\]/)
  assert.match(text, /\[cyan\]-w, --workspace\[\/cyan\]/)
})

test('CLI rejects unknown options with a pointer to --help', async () => {
  const { dependencies } = createDependencies()

  await assert.rejects(
    createCli(dependencies).start(['--nope']),
    /Unknown option '--nope'[\s\S]*dev-workspace --help/,
  )
})

test('CLI --reset deletes the configuration, legacy file and history', async () => {
  let requested

  const { dependencies, calls } = createDependencies({
    config: {
      resetWorkspaceConfig: async files => {
        requested = files
        return ['/fake/home/.legacy/config.json']
      },
    },
  })

  await createCli(dependencies).start(['--reset'])

  assert.deepEqual(requested, [
    '/fake/home/.dev-workspace-cli/config.json',
    '/fake/home/.legacy/config.json',
    path.join('/fake/home/.dev-workspace-cli', 'state.json'),
  ])
  assert.match(
    loggedText(calls),
    /Deleted \/fake\/home\/\.legacy\/config\.json/,
  )
  assert.equal(calls.discoveredWorkspaces.length, 0)
})

test('CLI --reset leaves a state.json next to a custom configuration alone', async () => {
  let requested

  const { dependencies } = createDependencies({
    config: {
      getConfigPaths: () => ({
        directory: '/home/me/dotfiles',
        file: '/home/me/dotfiles/dws.json',
        legacyFile: null,
        custom: true,
      }),
      resetWorkspaceConfig: async files => {
        requested = files
        return []
      },
    },
  })

  await createCli(dependencies).start(['--reset'])

  assert.deepEqual(requested, [
    '/home/me/dotfiles/dws.json',
    null,
    path.join('/home/me/dotfiles', 'dws.state.json'),
  ])
})

test('CLI --reset reports when there is nothing to delete', async () => {
  const { dependencies, calls } = createDependencies()

  await createCli(dependencies).start(['--reset'])

  assert.match(loggedText(calls), /No saved configuration found/)
})

test('CLI reports a migrated legacy configuration', async () => {
  const { dependencies, calls } = createDependencies({
    config: {
      migrateLegacyConfig: async () => '/fake/home/.legacy/config.json',
    },
  })

  await createCli(dependencies).run()

  assert.match(
    loggedText(calls),
    /Moved configuration from \/fake\/home\/\.legacy\/config\.json/,
  )
})

test('CLI reads the legacy configuration when migration fails', async () => {
  let readFrom

  const { dependencies, calls } = createDependencies({
    config: {
      migrateLegacyConfig: async () => {
        throw new Error('Permission denied')
      },
      readWorkspaceConfig: async file => {
        readFrom = file
        return WORKSPACE
      },
    },
  })

  await createCli(dependencies).run()

  assert.equal(readFrom, '/fake/home/.legacy/config.json')
  assert.match(loggedText(calls), /Could not move old configuration/)
  assert.equal(calls.discoveredWorkspaces[0].root, WORKSPACE)
})

test('CLI --add-alias creates an alias without starting', async () => {
  let created

  const { dependencies, calls } = createDependencies({
    aliases: {
      addAlias: async name => {
        created = name
        return [path.join('/fake/bin', `${name}.cmd`)]
      },
    },
  })

  await createCli(dependencies).start(['--add-alias', 'dev'])

  assert.equal(created, 'dev')
  assert.match(loggedText(calls), /Created alias "dev"\. Run it with: dev/)
  assert.ok(
    loggedText(calls).includes(path.dirname(path.join('/fake/bin', 'dev.cmd'))),
  )
  assert.equal(calls.discoveredWorkspaces.length, 0)
})

test('CLI --remove-alias deletes an alias', async () => {
  let removed

  const { dependencies, calls } = createDependencies({
    aliases: {
      removeAlias: async name => {
        removed = name
        return []
      },
    },
  })

  await createCli(dependencies).start(['--remove-alias', 'dev'])

  assert.equal(removed, 'dev')
  assert.match(loggedText(calls), /Removed alias "dev"/)
})

test('CLI passes alias errors on to the caller', async () => {
  const { dependencies } = createDependencies({
    aliases: {
      addAlias: async () => {
        throw new Error('"ls" is already a command')
      },
    },
  })

  await assert.rejects(
    createCli(dependencies).start(['--add-alias', 'ls']),
    /already a command/,
  )
})

test('CLI --list-aliases shows built-in and custom aliases', async () => {
  const empty = createDependencies()

  await createCli(empty.dependencies).start(['--list-aliases'])

  assert.match(loggedText(empty.calls), /Built in: dev-workspace, dws/)
  assert.match(loggedText(empty.calls), /Custom: +none/)

  const custom = createDependencies({
    aliases: { listAliases: async () => ['dev', 'ws'] },
  })

  await createCli(custom.dependencies).start(['--list-aliases'])

  assert.match(loggedText(custom.calls), /Custom: +dev, ws/)
})

test('CLI --reset also deletes custom aliases', async () => {
  const { dependencies, calls } = createDependencies({
    aliases: { removeAllAliases: async () => ['dev'] },
  })

  await createCli(dependencies).start(['--reset'])

  assert.match(loggedText(calls), /No saved configuration found/)
  assert.match(loggedText(calls), /Deleted alias "dev"/)
})

test('CLI runs scripts with the detected package manager', async () => {
  const project = {
    name: 'example',
    directory: path.join(WORKSPACE, 'example'),
  }
  const script = { name: 'dev', command: 'vite' }
  const runs = []
  let scriptSelections = 0
  let projectSelections = 0

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
      detectPackageManager: async () => ({
        name: 'pnpm',
        source: 'pnpm-lock.yaml',
      }),
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async () =>
        ++scriptSelections === 1 ? { script, withArguments: false } : null,
    },
    commands: {
      runCommand: async (...args) => {
        runs.push(args)
        return { code: 0 }
      },
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(runs, [
    ['dev', project.directory, { packageManager: 'pnpm' }],
  ])
  assert.match(loggedText(calls), /▶ pnpm run dev/)
})

test('CLI shows the project and its package manager in the header', async () => {
  const cases = [
    [
      { name: 'pnpm', source: 'pnpm-lock.yaml' },
      /◆ workspace › p ─+ pnpm · pnpm-lock\.yaml ─╮/,
    ],
    [{ name: 'yarn', source: 'packageManager' }, /yarn · packageManager field/],
    [{ name: 'npm', source: 'default' }, /npm · default/],
  ]

  for (const [detected, expected] of cases) {
    const project = { name: 'p', directory: path.join(WORKSPACE, 'p') }
    let projectSelections = 0

    const { dependencies, calls } = createDependencies({
      workspace: {
        getProjects: async () => [project],
        getScripts: async () => [{ name: 'dev', command: 'vite' }],
        detectPackageManager: async () => detected,
      },
      prompts: {
        chooseProject: async () => (++projectSelections === 1 ? project : null),
      },
    })

    await createCli(dependencies).run()

    assert.match(menuText(calls), expected)
  }
})

test('CLI gives the project list the scripts, branch and package manager of each project', async () => {
  const projects = ['api', 'docs', 'web', 'broken'].map(name => ({
    name,
    directory: path.join(WORKSPACE, name),
    hasPackageJson: true,
  }))
  const scripts = {
    api: [{ name: 'dev' }, { name: 'build' }],
    docs: [{ name: 'dev' }],
    web: [],
  }
  const reads = []
  const lists = []

  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => projects,
      detectPackageManager: async directory =>
        directory.endsWith('docs')
          ? { name: 'yarn', source: 'yarn.lock', runsHooks: false }
          : { name: 'pnpm', source: 'pnpm-lock.yaml', runsHooks: true },
      readGitBranch: async directory =>
        directory.endsWith('docs') ? null : 'main',
      getScripts: async (directory, options) => {
        const name = path.basename(directory)

        reads.push([name, options])
        if (!scripts[name]) throw new Error('Invalid JSON')
        return scripts[name]
      },
    },
    prompts: {
      chooseProject: async (shown, options) => {
        lists.push(options.details)
        return null
      },
    },
  })

  await createCli(dependencies).run()

  const [details] = lists

  assert.deepEqual(await Promise.all(projects.map(details)), [
    { detail: '2 scripts · main', hint: 'pnpm' },
    { detail: '1 script', hint: 'yarn' },
    { detail: 'no scripts · main', hint: 'pnpm' },
    { detail: 'invalid package.json · main', hint: 'pnpm' },
  ])
  // Counted as the script menu counts them.
  assert.deepEqual(reads[1], ['docs', { groupHooks: false }])

  // Read once per session.
  await details(projects[1])
  assert.equal(reads.length, 4)
})

test('CLI reads the details of a project again after opening it', async () => {
  const project = {
    name: 'api',
    directory: path.join(WORKSPACE, 'api'),
    hasPackageJson: true,
  }
  const shown = []
  let branch = 'main'
  let lists = 0

  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [{ name: 'dev', command: 'vite' }],
      readGitBranch: async () => branch,
    },
    prompts: {
      chooseProject: async (projects, { details }) => {
        shown.push((await details(project)).detail)
        branch = 'feat/login'
        return ++lists === 1 ? project : null
      },
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(shown, ['1 script · main', '1 script · feat/login'])
})

test('CLI groups hooks only when the package manager runs them', async () => {
  for (const runsHooks of [true, false]) {
    const project = { name: 'p', directory: path.join(WORKSPACE, 'p') }
    let projectSelections = 0
    let scriptOptions

    const { dependencies } = createDependencies({
      workspace: {
        getProjects: async () => [project],
        getScripts: async (directory, options) => {
          scriptOptions = options
          return [{ name: 'build', command: 'node build.js' }]
        },
        detectPackageManager: async () => ({
          name: 'yarn',
          source: 'yarn.lock',
          runsHooks,
        }),
      },
      prompts: {
        chooseProject: async () => (++projectSelections === 1 ? project : null),
      },
    })

    await createCli(dependencies).run()

    assert.deepEqual(scriptOptions, { groupHooks: runsHooks })
  }
})

// A workspace with a few projects, for direct mode and history tests.
function projectFixtures() {
  return ['web', 'web-admin', 'api', 'Docs'].map(name => ({
    name,
    directory: path.join(WORKSPACE, name),
    hasPackageJson: true,
  }))
}

function directDependencies(overrides = {}) {
  const runs = []
  const result = createDependencies({
    workspace: {
      getProjects: async () => projectFixtures(),
      getScripts: async () => [
        { name: 'dev', command: 'vite' },
        { name: 'prebuild', command: 'node clean.js' },
        { name: 'build', command: 'vite build' },
      ],
      detectPackageManager: async () => ({
        name: 'pnpm',
        source: 'pnpm-lock.yaml',
        runsHooks: true,
      }),
      ...overrides.workspace,
    },
    commands: {
      runCommand: async (...args) => {
        runs.push(args)
        return { code: 0 }
      },
      ...overrides.commands,
    },
    config: { ...overrides.config },
    prompts: {
      chooseProject: async () => {
        throw new Error('direct mode must not show the project list')
      },
      ...overrides.prompts,
    },
    ui: {
      leaveScreen: () => {
        throw new Error('direct mode never uses the alternate screen')
      },
    },
  })

  return { ...result, runs }
}

test('findProject matches exactly, then ignoring case, then by unique prefix', () => {
  const projects = projectFixtures()
  const find = name => findProject(projects, name, WORKSPACE).name

  assert.equal(find('web'), 'web')
  assert.equal(find('docs'), 'Docs')
  assert.equal(find('web-'), 'web-admin')
  assert.equal(find('a'), 'api')
  assert.throws(
    () => find('we'),
    /"we" matches several projects: web, web-admin\. Type more of the name\./,
  )
  assert.throws(() => find('mobile'), /No project named "mobile" in /)
})

test('CLI runs a script directly and returns its exit code', async () => {
  const { dependencies, calls, runs } = directDependencies()

  const code = await createCli(dependencies).start(['web', 'dev'])

  assert.equal(code, 0)
  assert.deepEqual(runs, [
    ['dev', path.join(WORKSPACE, 'web'), { packageManager: 'pnpm' }],
  ])
  assert.match(
    calls.errors.map(args => args.join(' ')).join('\n'),
    /Running pnpm run dev in .*web$/,
  )
  assert.deepEqual(calls.savedStates.at(-1).state.lastScripts, {
    [path.join(WORKSPACE, 'web')]: 'dev',
  })
})

test('CLI passes on the exit code or signal of a script run directly', async () => {
  for (const [result, expected] of [
    [{ code: 7 }, 7],
    [{ code: null, signal: 'SIGINT' }, 130],
    [{ code: null, signal: 'SIGTERM' }, 143],
    [{ code: null }, 1],
  ]) {
    const { dependencies } = directDependencies({
      commands: { runCommand: async () => result },
    })

    assert.equal(
      await createCli(dependencies).start(['api', 'build']),
      expected,
      JSON.stringify(result),
    )
  }
})

test('CLI passes script arguments in direct mode', async () => {
  const cases = [
    [
      { name: 'npm', source: 'default', runsHooks: true },
      { packageManager: 'npm', args: ['--port', '4000', 'two words'] },
      'npm run dev -- --port 4000 "two words"',
    ],
    [
      { name: 'yarn', source: 'yarn.lock', runsHooks: true },
      {
        packageManager: 'yarn',
        args: ['--port', '4000', 'two words'],
        classicYarn: true,
      },
      'yarn run dev --port 4000 "two words"',
    ],
    [
      { name: 'yarn', source: 'yarn.lock', runsHooks: false },
      { packageManager: 'yarn', args: ['--port', '4000', 'two words'] },
      'yarn run dev --port 4000 "two words"',
    ],
  ]

  for (const [detected, options, shown] of cases) {
    const { dependencies, calls, runs } = directDependencies({
      workspace: { detectPackageManager: async () => detected },
    })

    await createCli(dependencies).start([
      'web',
      'dev',
      '--',
      '--port',
      '4000',
      'two words',
    ])

    assert.deepEqual(runs[0][2], options)
    assert.ok(calls.errors[0].join(' ').includes(shown), calls.errors[0][0])
  }
})

test('CLI runs hooks by name in direct mode', async () => {
  let scriptOptions
  const { dependencies, runs } = directDependencies({
    workspace: {
      getScripts: async (directory, options) => {
        scriptOptions = options
        return [{ name: 'prebuild', command: 'node clean.js' }]
      },
    },
  })

  await createCli(dependencies).start(['web', 'prebuild'])

  assert.deepEqual(scriptOptions, { groupHooks: false })
  assert.equal(runs[0][0], 'prebuild')
})

test('CLI explains a direct run that cannot start', async () => {
  const unknown = directDependencies()

  await assert.rejects(
    createCli(unknown.dependencies).start(['web', 'deploy']),
    /No script named "deploy" in web\. Available scripts: dev, prebuild, build\./,
  )
  assert.equal(unknown.runs.length, 0)

  const empty = directDependencies({
    workspace: { getScripts: async () => [] },
  })

  await assert.rejects(
    createCli(empty.dependencies).start(['web', 'dev']),
    /web has no scripts\./,
  )

  const broken = directDependencies({
    workspace: {
      getScripts: async () => {
        throw new Error('Invalid JSON')
      },
    },
  })

  await assert.rejects(
    createCli(broken.dependencies).start(['web', 'dev']),
    /Could not read package\.json: Invalid JSON/,
  )

  const ambiguous = directDependencies()

  await assert.rejects(
    createCli(ambiguous.dependencies).start(['we', 'dev']),
    /matches several projects/,
  )
})

test('CLI never prompts for a workspace when running a script directly', async () => {
  const prompts = {
    askForWorkspace: async () => {
      throw new Error('must not prompt')
    },
    confirmWorkspaceChange: async () => {
      throw new Error('must not prompt')
    },
  }

  const missing = directDependencies({
    config: { readWorkspaceConfig: async () => null },
    prompts,
  })

  await assert.rejects(
    createCli(missing.dependencies).start(['web', 'dev']),
    /No workspace is configured yet\. Run dev-workspace once to choose one, or pass --workspace <path>\./,
  )

  const unavailable = directDependencies({ prompts })
  unavailable.dependencies.workspace.isDirectory = async () => false

  await assert.rejects(
    createCli(unavailable.dependencies).start(['web', 'dev']),
    /Saved workspace is unavailable: .*Pass another one with --workspace/,
  )

  const invalid = directDependencies({
    config: {
      readWorkspaceConfig: async () => {
        throw new Error('Invalid configuration JSON')
      },
    },
    prompts,
  })

  await assert.rejects(
    createCli(invalid.dependencies).start(['web', 'dev']),
    /Invalid configuration JSON/,
  )
})

test('CLI opens a project given without a script, then the project list', async () => {
  const steps = []
  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => projectFixtures(),
      getScripts: async directory => {
        steps.push(`scripts of ${path.basename(directory)}`)
        return [{ name: 'dev', command: 'vite' }]
      },
    },
    prompts: {
      chooseProject: async () => {
        steps.push('project list')
        return null
      },
    },
  })

  await createCli(dependencies).start(['doc'])

  assert.deepEqual(steps, ['scripts of Docs', 'project list'])
})

test('CLI shows recent projects first and remembers opened ones', async () => {
  const projects = projectFixtures()
  const offered = []
  let selections = 0

  const { dependencies, calls } = createDependencies({
    history: {
      readState: async () => ({
        ...emptyState(),
        recentProjects: [projects[2].directory, '/elsewhere'],
      }),
    },
    workspace: {
      getProjects: async () => projects,
      getScripts: async () => [{ name: 'dev', command: 'vite' }],
    },
    prompts: {
      chooseProject: async (list, options) => {
        offered.push(options.recent.map(project => project.name))
        return ++selections === 1 ? projects[1] : null
      },
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(offered, [['api'], ['web-admin', 'api']])
  assert.deepEqual(calls.savedStates[0].state.recentProjects, [
    projects[1].directory,
    projects[2].directory,
    '/elsewhere',
  ])
  assert.equal(
    calls.savedStates[0].file,
    path.join('/fake/home/.dev-workspace-cli', 'state.json'),
  )
})

test('CLI starts the script list on the last script run', async () => {
  const project = projectFixtures()[0]
  let projectSelections = 0
  let scriptOptions

  const { dependencies } = createDependencies({
    history: {
      readState: async () => ({
        ...emptyState(),
        lastScripts: { [project.directory]: 'build' },
      }),
    },
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [{ name: 'build', command: 'vite build' }],
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async (scripts, options) => {
        scriptOptions = options
        return null
      },
    },
  })

  await createCli(dependencies).run()

  assert.equal(scriptOptions.lastScript, 'build')
  assert.equal(typeof scriptOptions.header, 'function')
})

test('CLI keeps going when the history cannot be saved', async () => {
  const project = projectFixtures()[0]
  const script = { name: 'dev', command: 'vite' }
  let projectSelections = 0
  let scriptSelections = 0
  let runs = 0

  const { dependencies } = createDependencies({
    history: {
      saveState: async () => {
        throw new Error('Disk full')
      },
    },
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
    },
    commands: {
      runCommand: async () => {
        runs++
        return { code: 0 }
      },
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async () =>
        ++scriptSelections === 1 ? { script, withArguments: false } : null,
    },
  })

  await createCli(dependencies).run()

  assert.equal(runs, 1)
})

test('CLI runs a script with arguments typed in the menu', async () => {
  const project = projectFixtures()[0]
  const dev = { name: 'dev', command: 'vite' }
  const answers = [RUN_WITH_ARGUMENTS, RUN_WITH_ARGUMENTS, null]
  const forArguments = [null, { script: dev, withArguments: true }]
  const runs = []
  let projectSelections = 0

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [dev],
    },
    commands: {
      runCommand: async (...args) => {
        runs.push(args)
        return { code: 0 }
      },
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async (scripts, options) =>
        options.forArguments ? forArguments.shift() : answers.shift(),
      askForArguments: async name => {
        assert.equal(name, 'dev')
        return ['--port', '4000']
      },
    },
  })

  await createCli(dependencies).run()

  // Back from the first "which script" list returned to the script list.
  assert.deepEqual(forArguments, [])
  assert.deepEqual(answers, [])
  assert.deepEqual(runs, [
    [
      'dev',
      project.directory,
      { packageManager: 'npm', args: ['--port', '4000'] },
    ],
  ])
  assert.match(loggedText(calls), /▶ npm run dev -- --port 4000/)
})

test('CLI runs the same script again when asked', async () => {
  const project = projectFixtures()[0]
  const script = { name: 'test', command: 'vitest' }
  const again = [true, true, false]
  const runs = []
  let projectSelections = 0
  let scriptSelections = 0

  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [script],
    },
    commands: {
      runCommand: async (...args) => {
        runs.push(args)
        return { code: 1 }
      },
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async () =>
        ++scriptSelections === 1 ? { script, withArguments: false } : null,
      waitAfterCommand: async () => again.shift(),
    },
  })

  await createCli(dependencies).run()

  assert.equal(runs.length, 3)
  assert.equal(scriptSelections, 2)
  assert.ok(runs.every(([name]) => name === 'test'))
})

test('CLI --clear-history deletes only the history', async () => {
  for (const [existed, expected] of [
    [true, /Deleted the history at .*state\.json/],
    [false, /No history found at .*state\.json/],
  ]) {
    let cleared
    let configReset = false

    const { dependencies, calls } = createDependencies({
      history: {
        clearState: async file => {
          cleared = file
          return existed
        },
      },
      config: {
        resetWorkspaceConfig: async () => {
          configReset = true
          return []
        },
      },
    })

    await createCli(dependencies).start(['--clear-history'])

    assert.equal(
      cleared,
      path.join('/fake/home/.dev-workspace-cli', 'state.json'),
    )
    assert.match(loggedText(calls), expected)
    assert.equal(configReset, false)
    assert.equal(calls.discoveredWorkspaces.length, 0)
  }
})

test('CLI turns the mouse on in a terminal that supports it, without a note', async () => {
  const { dependencies, calls } = createDependencies()

  await createCli(dependencies).run()

  assert.deepEqual(calls.mouse, [{ enabled: true, note: null }])
  assert.equal(calls.savedStates.length, 0)
})

test('CLI shows the mouse note once per terminal', async () => {
  const { dependencies, calls } = createDependencies({
    terminal: {
      detectTerminal: () => ({
        id: 'iterm2',
        name: 'iTerm2',
        support: 'unknown',
      }),
    },
  })

  await createCli(dependencies).run()

  assert.equal(calls.mouse[0].enabled, true)
  assert.match(calls.mouse[0].note, /not been checked in iTerm2/)
  // Recorded only once a menu shows it.
  assert.equal(calls.savedStates.length, 0)

  await calls.showNote()
  assert.deepEqual(calls.savedStates[0].state.mouseNotes, ['iterm2'])

  dependencies.history.readState = async () => calls.savedStates[0].state
  await createCli(dependencies).run()

  assert.deepEqual(calls.mouse[1], { enabled: true, note: null })
})

test('CLI keeps the mouse off where the terminal reports no mouse events', async () => {
  const { dependencies, calls } = createDependencies({
    terminal: {
      detectTerminal: () => ({
        id: 'git-bash',
        name: 'Git Bash',
        support: 'none',
      }),
    },
  })

  await createCli(dependencies).run()

  assert.equal(calls.mouse[0].enabled, false)
  assert.match(calls.mouse[0].note, /PowerShell in Windows Terminal/)
})

test('CLI keeps the mouse off, with no note, with --no-mouse or the setting', async () => {
  const unchecked = {
    detectTerminal: () => ({
      id: 'iterm2',
      name: 'iTerm2',
      support: 'unknown',
    }),
  }
  const flag = createDependencies({ terminal: unchecked })

  await createCli(flag.dependencies).start(['--no-mouse'])

  const setting = createDependencies({
    terminal: unchecked,
    config: { readMouseSetting: async () => false },
  })

  await createCli(setting.dependencies).run()

  for (const { calls } of [flag, setting]) {
    assert.deepEqual(calls.mouse, [{ enabled: false, note: null }])
    assert.equal(calls.savedStates.length, 0)
  }
})

test('CLI leaves the mouse alone when running a script directly', async () => {
  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [
        { name: 'web', directory: '/w/web', hasPackageJson: true },
      ],
      getScripts: async () => [{ name: 'dev', command: 'vite' }],
    },
  })

  await createCli(dependencies).start(['web', 'dev'])

  assert.deepEqual(calls.mouse, [])
})

test('CLI --set-mouse saves the setting and exits', async () => {
  for (const [value, enabled, message] of [
    ['off', false, /only the keyboard.*dws --set-mouse on/],
    ['on', true, /use the mouse again/],
  ]) {
    const { dependencies, calls } = createDependencies()

    await createCli(dependencies).start(['--set-mouse', value])

    assert.deepEqual(calls.mouseSettings, [
      { enabled, file: '/fake/home/.dev-workspace-cli/config.json' },
    ])
    assert.match(calls.logs.at(-1)[0], message)
    assert.equal(calls.discoveredWorkspaces.length, 0)
  }
})

test('CLI keeps the mouse off, with no note, without a terminal on both sides', async () => {
  const { dependencies, calls } = createDependencies({
    terminal: {
      detectTerminal: () => ({
        id: 'iterm2',
        name: 'iTerm2',
        support: 'unknown',
      }),
      isTerminal: () => false,
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(calls.mouse, [{ enabled: false, note: null }])
})

test('CLI refuses to open the menus without a terminal for input', async () => {
  const { dependencies, calls } = createDependencies({
    terminal: { isInteractive: () => false },
  })

  for (const args of [[], ['web'], ['--workspace', WORKSPACE]]) {
    await assert.rejects(
      createCli(dependencies).start(args),
      /menus need an interactive terminal.*dev-workspace <project> <script>/,
    )
  }

  assert.equal(calls.discoveredWorkspaces.length, 0)
  assert.equal(calls.menus.length, 0)
  // --workspace is still saved: it needs no terminal.
  assert.equal(calls.savedWorkspaces.length, 1)
})

test('CLI runs a script directly without a terminal for input', async () => {
  const { dependencies } = createDependencies({
    terminal: { isInteractive: () => false },
    workspace: {
      getProjects: async () => [
        { name: 'web', directory: '/w/web', hasPackageJson: true },
      ],
      getScripts: async () => [{ name: 'dev', command: 'vite' }],
    },
  })

  assert.equal(await createCli(dependencies).start(['web', 'dev']), 0)
})

test('CLI asks for arguments when a script is picked with its args button', async () => {
  const project = projectFixtures()[0]
  const dev = { name: 'dev', command: 'vite' }
  const answers = [{ script: dev, withArguments: true }, null]
  const runs = []
  let projectSelections = 0

  const { dependencies, calls } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [dev],
    },
    commands: {
      runCommand: async (...args) => {
        // The script's output goes to the normal screen.
        runs.push({ args, leftScreen: calls.leftScreen })
        return { code: 0 }
      },
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async () => answers.shift(),
      askForArguments: async () => ['--open'],
    },
  })

  await createCli(dependencies).run()

  assert.deepEqual(runs, [
    {
      args: [
        'dev',
        project.directory,
        { packageManager: 'npm', args: ['--open'] },
      ],
      leftScreen: 1,
    },
  ])
  // Once more when the menus end.
  assert.equal(calls.leftScreen, 2)
})

test('CLI draws the header on the list that asks which script takes arguments', async () => {
  const project = projectFixtures()[0]
  const dev = { name: 'dev', command: 'vite' }
  const answers = [RUN_WITH_ARGUMENTS, null]
  const headers = []
  let projectSelections = 0

  const { dependencies } = createDependencies({
    workspace: {
      getProjects: async () => [project],
      getScripts: async () => [dev],
    },
    prompts: {
      chooseProject: async () => (++projectSelections === 1 ? project : null),
      chooseScript: async (scripts, options) => {
        headers.push(options.header)
        return options.forArguments ? null : answers.shift()
      },
    },
  })

  await createCli(dependencies).run()

  assert.equal(headers.length, 3)
  assert.ok(headers.every(header => header === headers[0]))

  // The header passes the list's buttons on to the box.
  const [, path] = headers[0](60, {
    toolbar: [[' ← Back ', { target: 'toolbar:0' }]],
  })

  assert.ok(path.some(([text]) => text === ' ← Back '))
})

test('formatDuration shows tenths of seconds, then minutes', () => {
  assert.equal(formatDuration(800), '0.8s')
  assert.equal(formatDuration(-5), '0.0s')
  assert.equal(formatDuration(42_049), '42.0s')
  assert.equal(formatDuration(59_960), '1m 00s')
  assert.equal(formatDuration(125_400), '2m 05s')
})
