import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  clearState,
  emptyState,
  getStatePath,
  readState,
  recentProjects,
  rememberProject,
  rememberScript,
  saveState,
} from '../lib/state.js'

async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dws-state-'))

  try {
    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('getStatePath puts state.json next to the configuration', () => {
  assert.equal(
    getStatePath(path.join('/config', 'dev-workspace-cli', 'config.json')),
    path.join('/config', 'dev-workspace-cli', 'state.json'),
  )
})

test('saveState and readState round-trip the history', async () => {
  await withDirectory(async directory => {
    const file = path.join(directory, 'nested', 'state.json')
    const state = rememberScript(emptyState(), '/projects/web', 'dev')

    await saveState(file, state)

    assert.deepEqual(await readState(file), state)
    // No temporary file is left behind.
    assert.deepEqual(await readdir(path.dirname(file)), ['state.json'])
    assert.match(await readFile(file, 'utf8'), /^\{\n {2}"version": 1,/)
  })
})

test('readState returns an empty history for missing or invalid files', async () => {
  await withDirectory(async directory => {
    const file = path.join(directory, 'state.json')

    assert.deepEqual(await readState(file), emptyState())

    for (const content of ['not json', '[]', 'null', '"text"']) {
      await writeFile(file, content)
      assert.deepEqual(await readState(file), emptyState(), content)
    }
  })
})

test('readState keeps only valid entries, and ignores a byte order mark', async () => {
  await withDirectory(async directory => {
    const file = path.join(directory, 'state.json')

    await writeFile(
      file,
      '﻿' +
        JSON.stringify({
          recentProjects: ['/projects/web', 42, '', null],
          lastScripts: { '/projects/web': 'dev', '/projects/api': 7 },
        }),
    )

    assert.deepEqual(await readState(file), {
      version: 1,
      recentProjects: ['/projects/web'],
      lastScripts: { '/projects/web': 'dev' },
    })

    await writeFile(
      file,
      JSON.stringify({ recentProjects: 'x', lastScripts: [] }),
    )
    assert.deepEqual(await readState(file), emptyState())
  })
})

test('saveState reports a failed write and cleans up', async () => {
  await withDirectory(async directory => {
    // A folder where the file should be makes the final rename fail.
    const file = path.join(directory, 'state.json')

    await saveState(path.join(file, 'inner.json'), emptyState())

    await assert.rejects(saveState(file, emptyState()))
    assert.deepEqual(await readdir(directory), ['state.json'])
  })
})

test('clearState deletes the file and reports whether it existed', async () => {
  await withDirectory(async directory => {
    const file = path.join(directory, 'state.json')

    await saveState(file, emptyState())

    assert.equal(await clearState(file), true)
    assert.equal(await clearState(file), false)

    // A folder cannot be deleted as a file.
    await assert.rejects(clearState(directory), /Cannot delete history/)
  })
})

test('rememberProject moves the project to the front, without duplicates', () => {
  let state = emptyState()

  for (const directory of ['/a', '/b', '/c', '/a']) {
    state = rememberProject(state, directory)
  }

  assert.deepEqual(state.recentProjects, ['/a', '/c', '/b'])

  for (let index = 0; index < 30; index++) {
    state = rememberProject(state, `/p${index}`)
  }

  assert.equal(state.recentProjects.length, 20)
  assert.equal(state.recentProjects[0], '/p29')
})

test('rememberScript records the last script and drops the oldest ones', () => {
  let state = rememberScript(emptyState(), '/a', 'dev')

  state = rememberScript(state, '/a', 'test')

  assert.deepEqual(state.lastScripts, { '/a': 'test' })
  assert.deepEqual(state.recentProjects, ['/a'])

  for (let index = 0; index < 250; index++) {
    state = rememberScript(state, `/p${index}`, 'build')
  }

  const remembered = Object.keys(state.lastScripts)

  assert.equal(remembered.length, 200)
  assert.equal(remembered.at(-1), '/p249')
  assert.ok(!remembered.includes('/a'))
})

test('recentProjects returns up to five existing projects, most recent first', () => {
  const projects = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => ({
    name,
    directory: `/${name}`,
    hasPackageJson: name !== 'g',
  }))
  const state = {
    ...emptyState(),
    recentProjects: ['/gone', '/g', '/f', '/a', '/b', '/c', '/d', '/e'],
  }

  assert.deepEqual(
    recentProjects(state, projects).map(project => project.name),
    ['f', 'a', 'b', 'c', 'd'],
  )
})
