import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  isDirectory,
  getProjects,
  getScripts,
  normalizePathInput,
  resolveDirectoryInput,
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
