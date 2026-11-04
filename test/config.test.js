import test from 'node:test'
import assert from 'node:assert/strict'

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'

import os from 'node:os'
import path from 'node:path'

import {
  getConfigPaths,
  migrateLegacyConfig,
  readMouseSetting,
  readWorkspaceConfig,
  resetWorkspaceConfig,
  saveMouseSetting,
  saveWorkspaceConfig,
} from '../lib/config.js'

// Resolve configuration paths inside a test home, ignoring the real
// environment so tests never touch the developer's own configuration.
function pathsIn(home) {
  return getConfigPaths({ env: {}, platform: 'linux', homeDirectory: home })
}

async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  )
}

async function withTempHome(callback) {
  const home = await mkdtemp(
    path.join(os.tmpdir(), 'dev-workspace-config-test-'),
  )

  try {
    await callback(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('getConfigPaths follows each platform convention', () => {
  const home = '/fake/home'
  const cases = [
    ['linux', {}, path.join(home, '.config')],
    ['linux', { XDG_CONFIG_HOME: '/xdg' }, '/xdg'],
    ['linux', { XDG_CONFIG_HOME: 'relative' }, path.join(home, '.config')],
    ['darwin', {}, path.join(home, 'Library', 'Preferences')],
    ['win32', { APPDATA: 'C:/Roaming' }, 'C:/Roaming'],
    ['win32', {}, path.join(home, 'AppData', 'Roaming')],
  ]

  for (const [platform, env, base] of cases) {
    const paths = getConfigPaths({ env, platform, homeDirectory: home })
    const directory = path.join(base, 'dev-workspace-cli')

    assert.equal(paths.directory, directory)
    assert.equal(paths.file, path.join(directory, 'config.json'))
    assert.equal(
      paths.legacyFile,
      path.join(home, '.dev-workspace-cli', 'config.json'),
    )
  }
})

test('getConfigPaths uses DEV_WORKSPACE_CONFIG when set', () => {
  const paths = getConfigPaths({
    env: { DEV_WORKSPACE_CONFIG: 'custom/settings.json' },
    platform: 'linux',
    homeDirectory: '/fake/home',
  })

  assert.equal(paths.file, path.resolve('custom/settings.json'))
  assert.equal(paths.directory, path.resolve('custom'))
  assert.equal(paths.legacyFile, null)
  assert.equal(paths.custom, true)
})

test('migrateLegacyConfig moves the old configuration', async () => {
  await withTempHome(async home => {
    const paths = pathsIn(home)

    await mkdir(path.dirname(paths.legacyFile), { recursive: true })
    await writeFile(paths.legacyFile, '{"workspace":"/old"}', 'utf8')

    assert.equal(await migrateLegacyConfig(paths), paths.legacyFile)
    assert.equal(await readWorkspaceConfig(paths.file), '/old')
    assert.equal(await exists(path.dirname(paths.legacyFile)), false)
  })
})

test('migrateLegacyConfig keeps other files in the old directory', async () => {
  await withTempHome(async home => {
    const paths = pathsIn(home)
    const other = path.join(path.dirname(paths.legacyFile), 'notes.txt')

    await mkdir(path.dirname(paths.legacyFile), { recursive: true })
    await writeFile(paths.legacyFile, '{"workspace":"/old"}', 'utf8')
    await writeFile(other, 'keep me', 'utf8')

    await migrateLegacyConfig(paths)

    assert.equal(await exists(paths.legacyFile), false)
    assert.equal(await exists(other), true)
  })
})

test('migrateLegacyConfig never overwrites a current configuration', async () => {
  await withTempHome(async home => {
    const paths = pathsIn(home)

    await saveWorkspaceConfig('/current', paths.file)
    await mkdir(path.dirname(paths.legacyFile), { recursive: true })
    await writeFile(paths.legacyFile, '{"workspace":"/old"}', 'utf8')

    assert.equal(await migrateLegacyConfig(paths), null)
    assert.equal(await readWorkspaceConfig(paths.file), '/current')
    assert.equal(await exists(paths.legacyFile), true)
  })
})

test('migrateLegacyConfig does nothing without a legacy file', async () => {
  await withTempHome(async home => {
    const paths = pathsIn(home)

    assert.equal(await migrateLegacyConfig(paths), null)
    assert.equal(
      await migrateLegacyConfig({ ...paths, legacyFile: null }),
      null,
    )
    assert.equal(await exists(paths.file), false)
  })
})

test('resetWorkspaceConfig deletes existing files only', async () => {
  await withTempHome(async home => {
    const paths = pathsIn(home)

    await saveWorkspaceConfig('/projects', paths.file)

    assert.deepEqual(
      await resetWorkspaceConfig([paths.file, paths.legacyFile, null]),
      [paths.file],
    )
    assert.equal(await exists(paths.file), false)
    assert.deepEqual(await resetWorkspaceConfig([paths.file]), [])
  })
})

test('resetWorkspaceConfig wraps unexpected errors', async () => {
  await withTempHome(async home => {
    // Deleting a directory with rm() and no recursive flag fails.
    await assert.rejects(
      resetWorkspaceConfig([home]),
      /Cannot delete configuration at/,
    )
  })
})

test('readWorkspaceConfig returns null when the config is missing', async () => {
  await withTempHome(async home => {
    const { file } = pathsIn(home)

    assert.equal(await readWorkspaceConfig(file), null)
  })
})

test('saveWorkspaceConfig creates the directory and saves the workspace', async () => {
  await withTempHome(async home => {
    const { file } = pathsIn(home)
    const workspace = path.join(home, 'projects')

    await saveWorkspaceConfig(workspace, file)

    const content = JSON.parse(await readFile(file, 'utf8'))

    assert.equal(content.workspace, workspace)
  })
})

test('saved workspace can be loaded again', async () => {
  await withTempHome(async home => {
    const { file } = pathsIn(home)
    const workspace = path.join(home, 'projects')

    await saveWorkspaceConfig(workspace, file)

    assert.equal(await readWorkspaceConfig(file), workspace)
  })
})

test('readWorkspaceConfig trims surrounding whitespace', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    await mkdir(directory, { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ workspace: '  /projects  ' }),
      'utf8',
    )

    assert.equal(await readWorkspaceConfig(file), '/projects')
  })
})

test('readWorkspaceConfig rejects malformed JSON', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    ;(await mkdir(directory, { recursive: true }),
      await writeFile(file, '{ invalid json', 'utf8'))

    await assert.rejects(
      readWorkspaceConfig(file),
      /Invalid configuration JSON/,
    )
  })
})

test('readWorkspaceConfig rejects invalid workspace values', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    await mkdir(directory, { recursive: true })

    const invalidConfigs = [
      { workspace: '' },
      { workspace: '   ' },
      { workspace: 123 },
      null,
      [],
    ]

    for (const config of invalidConfigs) {
      await writeFile(file, JSON.stringify(config), 'utf8')

      await assert.rejects(readWorkspaceConfig(file), /Invalid configuration/)
    }
  })
})

test('readWorkspaceConfig returns null when only other settings are saved', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    await mkdir(directory, { recursive: true })

    for (const config of [{}, { mouse: false }]) {
      await writeFile(file, JSON.stringify(config), 'utf8')
      assert.equal(await readWorkspaceConfig(file), null)
    }
  })
})

test('saveMouseSetting saves the setting and keeps the workspace', async () => {
  await withTempHome(async home => {
    const { file } = pathsIn(home)

    // Before any workspace is chosen, the directory may not exist yet.
    await saveMouseSetting(false, file)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      mouse: false,
    })
    assert.equal(await readMouseSetting(file), false)

    await saveWorkspaceConfig('/projects', file)
    await saveMouseSetting(true, file)

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      mouse: true,
      workspace: '/projects',
    })
  })
})

test('saveWorkspaceConfig rejects an empty workspace path', async () => {
  await withTempHome(async home => {
    const { file } = pathsIn(home)

    await assert.rejects(
      saveWorkspaceConfig('   ', file),
      /empty workspace path/,
    )
  })
})

test('readWorkspaceConfig reads a file that starts with a byte order mark', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    await mkdir(directory, { recursive: true })
    await writeFile(
      file,
      '\uFEFF' + JSON.stringify({ workspace: '/projects' }),
      'utf8',
    )

    assert.equal(await readWorkspaceConfig(file), '/projects')
  })
})

test('readMouseSetting is false only when the file turns the mouse off', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    assert.equal(await readMouseSetting(file), true)

    await mkdir(directory, { recursive: true })

    for (const [content, expected] of [
      [{ workspace: '/projects', mouse: false }, false],
      [{ workspace: '/projects', mouse: true }, true],
      [{ workspace: '/projects' }, true],
      [null, true],
    ]) {
      await writeFile(file, JSON.stringify(content), 'utf8')
      assert.equal(await readMouseSetting(file), expected)
    }

    await writeFile(file, '{ not json', 'utf8')
    assert.equal(await readMouseSetting(file), true)
  })
})

test('saveWorkspaceConfig keeps the other settings', async () => {
  await withTempHome(async home => {
    const { directory, file } = pathsIn(home)

    await mkdir(directory, { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ workspace: '/old', mouse: false }),
      'utf8',
    )
    await saveWorkspaceConfig('/projects', file)

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      workspace: '/projects',
      mouse: false,
    })

    // A file that is not an object is replaced.
    await writeFile(file, '[1, 2]', 'utf8')
    await saveWorkspaceConfig('/projects', file)

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      workspace: '/projects',
    })
  })
})
