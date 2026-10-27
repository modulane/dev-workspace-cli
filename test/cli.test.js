import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { createCli } from '../lib/cli.js'
import { CHANGE_WORKSPACE } from '../lib/prompts.js'
import { resolveDirectoryInput } from '../lib/workspace.js'

const { version } = createRequire(import.meta.url)('../package.json')

const WORKSPACE = path.resolve('fake/workspace')

function createDependencies(overrides = {}) {
  const calls = {
    savedWorkspaces: [],
    discoveredWorkspaces: [],
    errors: [],
    logs: [],
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
      readWorkspaceConfig: async () => WORKSPACE,
      resetWorkspaceConfig: async () => [],
      saveWorkspaceConfig: async (workspace, file) => {
        calls.savedWorkspaces.push({ workspace, file })
      },
    },

    workspace: {
      isDirectory: async () => true,
      getProjects: async root => {
        calls.discoveredWorkspaces.push({ root })
        return []
      },
      getScripts: async () => [],
      detectPackageManager: async () => ({ name: 'npm', source: 'default' }),
    },

    commands: {
      runCommand: async () => ({ code: 0 }),
    },

    prompts: {
      askForWorkspace: async () => WORKSPACE,
      chooseProject: async () => null,
      chooseScript: async () => null,
      confirmWorkspaceChange: async () => true,
      waitAfterCommand: async () => undefined,
      waitForBack: async () => undefined,
    },

    ui: {
      clearScreen: () => undefined,
      color: value => String(value),
      printHeader: () => undefined,
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
  assert.ok(
    calls.logs.some(args =>
      args.join(' ').includes('No project folders found'),
    ),
  )
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

  assert.ok(
    calls.logs.some(args => args.join(' ').includes('No scripts found')),
  )
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
      chooseScript: async () => script,
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
    return scriptSelections === 1 ? script : null
  }

  await createCli(dependencies).run()

  assert.ok(
    calls.logs.some(args =>
      args.join(' ').includes('Command completed successfully.'),
    ),
  )
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
    ++scriptSelections === 1 ? script : null

  await createCli(dependencies).run()

  assert.ok(
    calls.logs.some(args =>
      args.join(' ').includes('Command exited with code 7.'),
    ),
  )
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
    ++scriptSelections === 1 ? script : null

  await createCli(dependencies).run()

  assert.ok(
    calls.logs.some(args =>
      args.join(' ').includes('Command was interrupted (SIGTERM).'),
    ),
  )
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

  assert.ok(
    calls.errors.some(args =>
      args.join(' ').includes('Could not read package.json'),
    ),
  )
  assert.ok(
    calls.errors.some(args => args.join(' ').includes('Invalid package JSON')),
  )
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
    ++scriptSelections === 1 ? script : null

  await createCli(dependencies).run()

  assert.ok(
    calls.errors.some(args =>
      args.join(' ').includes('Could not start command: npm unavailable'),
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

test('CLI propagates unexpected errors', async () => {
  const { dependencies } = createDependencies({
    ui: {
      printHeader: () => {
        throw new Error('Unexpected UI failure')
      },
    },
  })

  await assert.rejects(createCli(dependencies).start(), /Unexpected UI failure/)
})

function loggedText(calls) {
  return calls.logs.map(args => args.join(' ')).join('\n')
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
    [['-v'], new RegExp(`^${version.replaceAll('.', '\.')}$`)],
    [['--config-path'], /^\/fake\/home\/\.dev-workspace-cli\/config\.json$/],
  ]

  for (const [args, expected] of cases) {
    const { dependencies, calls } = createDependencies()

    await createCli(dependencies).start(args)

    assert.match(loggedText(calls), expected)
    assert.equal(calls.discoveredWorkspaces.length, 0)
  }
})

test('CLI rejects unknown options with a pointer to --help', async () => {
  const { dependencies } = createDependencies()

  await assert.rejects(
    createCli(dependencies).start(['--nope']),
    /Unknown option '--nope'[\s\S]*dev-workspace --help/,
  )
})

test('CLI --reset deletes the current and legacy configuration', async () => {
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
  ])
  assert.match(
    loggedText(calls),
    /Deleted \/fake\/home\/\.legacy\/config\.json/,
  )
  assert.equal(calls.discoveredWorkspaces.length, 0)
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
      chooseScript: async () => (++scriptSelections === 1 ? script : null),
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
  assert.match(
    loggedText(calls),
    /Package manager: pnpm \(from pnpm-lock\.yaml\)/,
  )
  assert.match(loggedText(calls), /Running: pnpm run dev/)
})

test('CLI explains where the package manager choice comes from', async () => {
  const cases = [
    [
      { name: 'yarn', source: 'packageManager' },
      /yarn \(from the packageManager field\)/,
    ],
    [{ name: 'npm', source: 'default' }, /npm \(default\)/],
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

    assert.match(loggedText(calls), expected)
  }
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
