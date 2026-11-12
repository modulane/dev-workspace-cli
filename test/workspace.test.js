import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  isDirectory,
  getPackages,
  getProjects,
  getScripts,
  normalizePathInput,
  parsePnpmWorkspace,
  readGitBranch,
  readWorkspacePatterns,
  resolveDirectoryInput,
  suggestWorkspaces,
} from '../lib/workspace.js'

// Each test gets its own isolated temporary directory.
async function withTempDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-workspace-test-'))

  try {
    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('isDirectory recognizes directories and rejects missing paths', async () => {
  await withTempDirectory(async directory => {
    assert.equal(await isDirectory(directory), true)
    assert.equal(await isDirectory(path.join(directory, 'missing')), false)
  })
})

test('normalizePathInput undoes shell syntax on Linux and macOS', () => {
  const options = { platform: 'linux', homeDirectory: '/home/you' }
  const cases = [
    ['~', '/home/you'],
    ['~/projects', '/home/you/projects'],
    ['  ~/projects  ', '/home/you/projects'],
    ['"/home/you/my projects"', '/home/you/my projects'],
    ["'/home/you/my projects'", '/home/you/my projects'],
    ['"~/my projects"', '/home/you/my projects'],
    ['/home/you/my\\ projects', '/home/you/my projects'],
    ['~\\projects', '~\\projects'],
    ['~other/projects', '~other/projects'],
    ['"/unmatched', '"/unmatched'],
    ['"', '"'],
    ['""', ''],
  ]

  for (const [input, expected] of cases) {
    assert.equal(normalizePathInput(input, options), expected, input)
  }
})

test('normalizePathInput keeps backslashes as separators on Windows', () => {
  const options = { platform: 'win32', homeDirectory: 'C:\\Users\\you' }
  const cases = [
    ['~\\projects', 'C:\\Users\\you\\projects'],
    ['~/projects', 'C:\\Users\\you/projects'],
    ['"C:\\Users\\you\\my projects"', 'C:\\Users\\you\\my projects'],
    ['C:\\Users\\you\\my\\ projects', 'C:\\Users\\you\\my\\ projects'],
  ]

  for (const [input, expected] of cases) {
    assert.equal(normalizePathInput(input, options), expected, input)
  }
})

test('resolveDirectoryInput finds folders typed with ~ or quotes', async () => {
  await withTempDirectory(async home => {
    const projects = path.join(home, 'my projects')
    await mkdir(projects)

    for (const input of ['~/my projects', `"${projects}"`, `'${projects}'`]) {
      assert.deepEqual(
        await resolveDirectoryInput(input, { homeDirectory: home }),
        { directory: projects, exists: true },
        input,
      )
    }

    assert.deepEqual(
      await resolveDirectoryInput('~/missing', { homeDirectory: home }),
      { directory: path.join(home, 'missing'), exists: false },
    )
  })
})

test('resolveDirectoryInput prefers the path exactly as typed', async () => {
  const typed = path.resolve('"quoted"')
  const checked = []

  const result = await resolveDirectoryInput(' "quoted" ', {
    isDirectory: async directory => {
      checked.push(directory)
      return directory === typed
    },
  })

  assert.deepEqual(result, { directory: typed, exists: true })
  assert.deepEqual(checked, [typed])
})

test('resolveDirectoryInput does not turn empty quotes into the current folder', async () => {
  const result = await resolveDirectoryInput('""', {
    isDirectory: async () => false,
  })

  assert.deepEqual(result, { directory: path.resolve('""'), exists: false })
})

test('getProjects lists immediate folders alphabetically', async () => {
  await withTempDirectory(async directory => {
    await mkdir(path.join(directory, 'zeta'))
    await mkdir(path.join(directory, 'alpha'))
    await writeFile(path.join(directory, 'notes.txt'), 'Not a project')

    const projects = await getProjects(directory)

    assert.deepEqual(
      projects.map(project => project.name),
      ['alpha', 'zeta'],
    )
  })
})

test('getProjects leaves out folders that are never projects', async () => {
  await withTempDirectory(async directory => {
    for (const name of ['.git', '.vscode', '.idea', 'node_modules', 'web']) {
      await mkdir(path.join(directory, name))
    }

    // Names that only contain a dot or "node_modules" are still projects.
    await mkdir(path.join(directory, 'my.app'))
    await mkdir(path.join(directory, 'node_modules-tools'))

    const projects = await getProjects(directory)

    assert.deepEqual(
      projects.map(project => project.name),
      ['my.app', 'node_modules-tools', 'web'],
    )
  })
})

test('getProjects lists links to folders and leaves out broken links', async () => {
  await withTempDirectory(async directory => {
    const workspace = path.join(directory, 'workspace')
    const elsewhere = path.join(directory, 'elsewhere')

    await mkdir(path.join(workspace, 'real-app'), { recursive: true })
    await mkdir(path.join(elsewhere, 'linked-app'), { recursive: true })
    await mkdir(path.join(elsewhere, 'removed-app'))
    await writeFile(path.join(elsewhere, 'linked-app', 'package.json'), '{}')

    // "junction" lets Windows create the link without administrator rights;
    // other platforms ignore it and create a symbolic link.
    for (const name of ['linked-app', 'removed-app']) {
      await symlink(
        path.join(elsewhere, name),
        path.join(workspace, name),
        'junction',
      )
    }

    await rm(path.join(elsewhere, 'removed-app'), { recursive: true })

    const projects = await getProjects(workspace)

    assert.deepEqual(
      projects.map(({ name, hasPackageJson }) => [name, hasPackageJson]),
      [
        ['linked-app', true],
        ['real-app', false],
      ],
    )
  })
})

test('getScripts returns scripts from package.json', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: {
          dev: 'vite',
          build: 'vite build',
        },
      }),
    )

    assert.deepEqual(await getScripts(directory), [
      { name: 'dev', command: 'vite' },
      { name: 'build', command: 'vite build' },
    ])
  })
})

test('getScripts returns an empty array when package.json is missing', async () => {
  await withTempDirectory(async directory => {
    assert.deepEqual(await getScripts(directory), [])
  })
})

test('getScripts returns an empty array when scripts are absent', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    )

    assert.deepEqual(await getScripts(directory), [])
  })
})

test('getScripts rejects malformed JSON', async () => {
  await withTempDirectory(async directory => {
    await writeFile(path.join(directory, 'package.json'), '{ invalid json')

    await assert.rejects(
      getScripts(directory),
      /Invalid JSON in .*package\.json/,
    )
  })
})

test('getScripts rejects a non-object scripts field', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ scripts: ['not', 'an', 'object'] }),
    )

    await assert.rejects(getScripts(directory), /"scripts" must be an object/)
  })
})

test('getScripts wraps errors when package.json cannot be read', async () => {
  await withTempDirectory(async directory => {
    await mkdir(path.join(directory, 'package.json'))

    await assert.rejects(getScripts(directory), error => {
      assert.match(error.message, /Cannot read .*package\.json/)
      assert.ok(error.cause)
      return true
    })
  })
})

test('getScripts rejects package.json values that are not objects', async () => {
  await withTempDirectory(async directory => {
    const packagePath = path.join(directory, 'package.json')

    for (const content of ['null', '[]', '"not an object"', '42']) {
      await writeFile(packagePath, content)

      await assert.rejects(getScripts(directory), /expected a JSON object/)
    }
  })
})

test('getProjects rejects a missing workspace', async () => {
  await withTempDirectory(async directory => {
    await assert.rejects(
      getProjects(path.join(directory, 'missing'), directory),
    )
  })
})

test('getProjects lists folders without a package.json last', async () => {
  await withTempDirectory(async directory => {
    for (const name of ['notes', 'web', 'archive', 'api']) {
      await mkdir(path.join(directory, name))
    }

    await writeFile(path.join(directory, 'web', 'package.json'), '{}')
    await writeFile(path.join(directory, 'api', 'package.json'), '{}')

    // A folder named package.json does not count.
    await mkdir(path.join(directory, 'archive', 'package.json'))

    const projects = await getProjects(directory)

    assert.deepEqual(
      projects.map(({ name, hasPackageJson }) => [name, hasPackageJson]),
      [
        ['api', true],
        ['web', true],
        ['archive', false],
        ['notes', false],
      ],
    )
  })
})

test('getProjects sorts names ignoring case and by number', async () => {
  await withTempDirectory(async directory => {
    for (const name of ['beta', 'App10', 'app2', 'Alpha']) {
      await mkdir(path.join(directory, name))
    }

    const projects = await getProjects(directory)

    assert.deepEqual(
      projects.map(project => project.name),
      ['Alpha', 'app2', 'App10', 'beta'],
    )
  })
})

test('getScripts attaches pre and post hooks to their main script', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        scripts: {
          prebuild: 'node clean.js',
          build: 'node build.js',
          postbuild: 'node report.js',
          pretest: 'node lint.js',
          test: 'node --test',
          // No "install" or "view" script: these stay ordinary entries.
          postinstall: 'node setup.js',
          preview: 'node serve.js',
          pre: 'node odd.js',
        },
      }),
    )

    assert.deepEqual(await getScripts(directory), [
      {
        name: 'build',
        command: 'node build.js',
        hooks: ['prebuild', 'postbuild'],
      },
      { name: 'test', command: 'node --test', hooks: ['pretest'] },
      { name: 'postinstall', command: 'node setup.js' },
      { name: 'preview', command: 'node serve.js' },
      { name: 'pre', command: 'node odd.js' },
    ])
  })
})

test('getScripts lists hooks as ordinary scripts when grouping is off', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        scripts: {
          prebuild: 'node clean.js',
          build: 'node build.js',
          postbuild: 'node report.js',
        },
      }),
    )

    assert.deepEqual(await getScripts(directory, { groupHooks: false }), [
      { name: 'prebuild', command: 'node clean.js' },
      { name: 'build', command: 'node build.js' },
      { name: 'postbuild', command: 'node report.js' },
    ])
  })
})

test('getScripts reads a package.json that starts with a byte order mark', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      '\uFEFF' + JSON.stringify({ scripts: { hello: 'echo hello' } }),
    )

    assert.deepEqual(await getScripts(directory), [
      { name: 'hello', command: 'echo hello' },
    ])
  })
})

test('readGitBranch reads the branch, or the short commit, from .git/HEAD', async () => {
  await withTempDirectory(async directory => {
    const head = path.join(directory, '.git', 'HEAD')

    await mkdir(path.join(directory, '.git'))
    assert.equal(await readGitBranch(directory), null)

    await writeFile(head, 'ref: refs/heads/feat/login\n')
    assert.equal(await readGitBranch(directory), 'feat/login')

    await writeFile(head, '0123456789abcdef0123456789abcdef01234567\n')
    assert.equal(await readGitBranch(directory), '0123456')

    await writeFile(head, 'garbage\n')
    assert.equal(await readGitBranch(directory), null)
  })
})

test('readGitBranch follows a .git file, and is null outside Git', async () => {
  await withTempDirectory(async directory => {
    const project = path.join(directory, 'worktree')
    const gitDir = path.join(directory, 'main', '.git', 'worktrees', 'wt')

    await mkdir(project)
    assert.equal(await readGitBranch(project), null)

    await mkdir(gitDir, { recursive: true })
    await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(
      path.join(project, '.git'),
      `gitdir: ${path.relative(project, gitDir)}\n`,
    )
    assert.equal(await readGitBranch(project), 'main')

    await writeFile(path.join(project, '.git'), 'not a pointer\n')
    assert.equal(await readGitBranch(project), null)
  })
})

test('suggestWorkspaces returns the common folders that exist, in order', async () => {
  await withTempDirectory(async directory => {
    await mkdir(path.join(directory, 'repos'))
    await mkdir(path.join(directory, 'dev'))
    await writeFile(path.join(directory, 'code'), 'a file, not a folder')

    // Without drive roots to look at; on Windows, the folders are still
    // found through the forward slashes of the Linux path joins.
    assert.deepEqual(
      await suggestWorkspaces({
        homeDirectory: directory,
        cwd: directory,
        platform: 'linux',
      }),
      [path.posix.join(directory, 'dev'), path.posix.join(directory, 'repos')],
    )
  })
})

test('suggestWorkspaces adds the folder above a project and Windows drive roots', async () => {
  const folders = new Set([
    'C:\\',
    'E:\\',
    'C:\\Users\\you\\projects',
    'E:\\dev',
    'e:\\work',
  ])
  const options = {
    homeDirectory: 'C:\\Users\\you',
    platform: 'win32',
    isDirectory: async folder => folders.has(folder),
  }

  // Run inside e:\work\web, a project: e:\work comes first.
  assert.deepEqual(
    await suggestWorkspaces({
      ...options,
      cwd: 'e:\\work\\web',
      isFile: async file => file === 'e:\\work\\web\\package.json',
    }),
    ['e:\\work', 'C:\\Users\\you\\projects', 'E:\\dev'],
  )

  // E:\dev, found above the project and on the drive, is offered once.
  assert.deepEqual(
    await suggestWorkspaces({
      ...options,
      cwd: 'E:\\dev\\web',
      isFile: async () => true,
    }),
    ['E:\\dev', 'C:\\Users\\you\\projects'],
  )

  // A drive root has no folder above it.
  assert.deepEqual(
    await suggestWorkspaces({
      ...options,
      cwd: 'C:\\',
      isFile: async () => true,
    }),
    ['C:\\Users\\you\\projects', 'E:\\dev'],
  )
})

test('suggestWorkspaces skips a drive that does not answer in time', async () => {
  const result = await suggestWorkspaces({
    homeDirectory: 'C:\\Users\\you',
    cwd: 'C:\\',
    platform: 'win32',
    isFile: async () => false,
    isDirectory: folder =>
      folder.startsWith('Z:')
        ? new Promise(() => {})
        : Promise.resolve(folder === 'C:\\' || folder === 'C:\\dev'),
    timeout: 10,
  })

  assert.deepEqual(result, ['C:\\dev'])
})

// Create each folder, with a package.json for the paths that end in /.
async function createTree(root, paths) {
  for (const entry of paths) {
    const folder = path.join(root, ...entry.split('/').filter(Boolean))

    await mkdir(folder, { recursive: true })

    if (entry.endsWith('/')) {
      await writeFile(path.join(folder, 'package.json'), '{}', 'utf8')
    }
  }
}

test('getProjects searches nested folders down to the depth', async () => {
  await withTempDirectory(async directory => {
    await createTree(directory, [
      'web/',
      'web/packages/ui/',
      'apps/site/',
      'apps/notes',
      'clients/acme/web/',
      'clients/acme/api/',
      'clients/beta/site/',
      'clients/empty',
      'clients/node_modules/lib/',
      'clients/.cache/tool/',
      'docs/images',
      'deep/a/b/c/',
    ])

    const names = async depth =>
      (await getProjects(directory, { depth })).map(project => [
        project.name,
        project.hasPackageJson,
      ])

    // Depth 1, the default, lists the workspace's own folders only.
    assert.deepEqual(await names(undefined), [
      ['web', true],
      ['apps', false],
      ['clients', false],
      ['deep', false],
      ['docs', false],
    ])

    // A folder is replaced by what it holds only when that includes a
    // project; a folder with a package.json is never searched.
    assert.deepEqual(await names(2), [
      ['apps/site', true],
      ['web', true],
      ['apps/notes', false],
      ['clients', false],
      ['deep', false],
      ['docs', false],
    ])

    // node_modules and dot-folders are never entered, and deep/a/b/c is
    // below the deepest level.
    assert.deepEqual(await names(3), [
      ['apps/site', true],
      ['clients/acme/api', true],
      ['clients/acme/web', true],
      ['clients/beta/site', true],
      ['web', true],
      ['apps/notes', false],
      ['clients/empty', false],
      ['deep', false],
      ['docs', false],
    ])

    // The depth is kept between 1 and 3.
    assert.deepEqual(await names(9), await names(3))
    assert.deepEqual(await names(0), await names(1))

    const projects = await getProjects(directory, { depth: 3 })

    assert.equal(
      projects.find(project => project.name === 'clients/acme/api').directory,
      path.join(directory, 'clients', 'acme', 'api'),
    )
  })
})

test('parsePnpmWorkspace reads the packages list in either style', () => {
  assert.deepEqual(
    parsePnpmWorkspace(
      [
        '﻿# the workspace',
        'packages:',
        "  - 'packages/*'",
        '  - "apps/**"',
        '',
        '  # tools too',
        '  - tools/cli # the CLI',
        "  - '!**/test/**'",
        "  - 'docs' # it's the site",
        'catalog:',
        '  - not-a-package',
      ].join('\r\n'),
    ),
    ['packages/*', 'apps/**', 'tools/cli', '!**/test/**', 'docs'],
  )
  assert.deepEqual(parsePnpmWorkspace('packages: [\'a/*\', "b"]\n'), [
    'a/*',
    'b',
  ])
  assert.deepEqual(
    parsePnpmWorkspace(
      'packages: [\n  \'apps/*\', # the apps\n  "libs/*",\n]\ncatalog:\n  a: b\n',
    ),
    ['apps/*', 'libs/*'],
  )
  assert.deepEqual(
    parsePnpmWorkspace('packages:\n- apps/*\n- libs/*\ncatalog:\n- no\n'),
    ['apps/*', 'libs/*'],
  )
  assert.deepEqual(parsePnpmWorkspace('catalog:\n  react: ^19\n'), [])
})

test('readWorkspacePatterns finds the npm, Yarn and pnpm workspaces', async () => {
  await withTempDirectory(async directory => {
    const project = async (name, files) => {
      const folder = path.join(directory, name)

      await mkdir(folder)

      for (const [file, content] of Object.entries(files)) {
        await writeFile(path.join(folder, file), content, 'utf8')
      }

      return readWorkspacePatterns(folder)
    }

    assert.deepEqual(
      await project('npm', {
        'package.json': JSON.stringify({ workspaces: ['packages/*', 3] }),
      }),
      ['packages/*'],
    )
    assert.deepEqual(
      await project('yarn', {
        'package.json': JSON.stringify({
          workspaces: { packages: ['apps/*'], nohoist: ['**/react'] },
        }),
      }),
      ['apps/*'],
    )
    assert.deepEqual(
      await project('pnpm', {
        'package.json': '{}',
        'pnpm-workspace.yaml': 'packages:\n  - libs/*\n',
      }),
      ['libs/*'],
    )
    assert.equal(
      await project('plain', { 'package.json': '{ "name": "plain" }' }),
      null,
    )
    assert.equal(await project('broken', { 'package.json': '{' }), null)
  })
})

test('getProjects marks monorepos with their workspace patterns', async () => {
  await withTempDirectory(async directory => {
    await createTree(directory, ['shop/', 'web/'])
    await writeFile(
      path.join(directory, 'shop', 'package.json'),
      JSON.stringify({ workspaces: ['packages/*'] }),
    )

    assert.deepEqual(await getProjects(directory), [
      {
        name: 'shop',
        directory: path.join(directory, 'shop'),
        hasPackageJson: true,
        workspaces: ['packages/*'],
      },
      {
        name: 'web',
        directory: path.join(directory, 'web'),
        hasPackageJson: true,
      },
    ])
  })
})

test('getPackages expands the workspace patterns into packages', async () => {
  await withTempDirectory(async directory => {
    await createTree(directory, [
      'packages/api/',
      'packages/ui/',
      'packages/notes',
      'packages/node_modules/dependency/',
      'apps/web/',
      'apps/mobile/ios/',
      'apps/mobile/ios/test/',
      'tools/cli/',
    ])
    await writeFile(
      path.join(directory, 'packages', 'api', 'package.json'),
      JSON.stringify({ name: '@shop/api' }),
    )

    const packages = await getPackages(directory, [
      './packages/*/',
      'apps/**',
      'tools/cli',
      'missing/*',
      '.',
      '!**/test',
    ])

    assert.deepEqual(
      packages.map(({ path: folder, packageName }) => [folder, packageName]),
      [
        ['apps/mobile/ios', undefined],
        ['apps/web', undefined],
        ['packages/api', '@shop/api'],
        ['packages/ui', undefined],
        ['tools/cli', undefined],
      ],
    )
    assert.equal(packages[2].directory, path.join(directory, 'packages', 'api'))
  })
})

test('getPackages leaves out a folder and what it holds with a trailing /**', async () => {
  await withTempDirectory(async directory => {
    await createTree(directory, [
      'packages/api/',
      'packages/test/',
      'packages/test/fixture/',
      'packages/testing/',
    ])

    const packages = await getPackages(directory, [
      'packages/**',
      '!**/test/**',
    ])

    assert.deepEqual(
      packages.map(({ path: folder }) => folder),
      ['packages/api', 'packages/testing'],
    )
  })
})

test('getScripts marks scripts that cannot run without arguments', async () => {
  await withTempDirectory(async directory => {
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'yarn packages run test',
          packages: 'yarn workspaces foreach --all --verbose',
        },
      }),
    )

    assert.deepEqual(await getScripts(directory), [
      { name: 'test', command: 'yarn packages run test' },
      {
        name: 'packages',
        command: 'yarn workspaces foreach --all --verbose',
        needsArguments: true,
      },
    ])
  })
})
