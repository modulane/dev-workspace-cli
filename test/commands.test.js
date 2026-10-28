import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { runCommand } from '../lib/commands.js'

// Create a fake child process whose events can be triggered by each test.
function createFakeProcess() {
  const child = new EventEmitter()

  return child
}

// Run the command with a fake process and return the captured spawn call.
function createSpawnMock(child) {
  const calls = []

  function spawnMock(...args) {
    calls.push(args)
    return child
  }

  return { spawnMock, calls }
}

test('runCommand launches the selected npm script in the project directory', async () => {
  const child = createFakeProcess()
  const { spawnMock, calls } = createSpawnMock(child)

  const resultPromise = runCommand('dev', '/projects/example', {
    spawnProcess: spawnMock,
  })

  assert.equal(calls.length, 1)

  const [command, args, options] = calls[0]

  assert.equal(command, 'npm')
  assert.deepEqual(args, ['run', 'dev'])
  assert.equal(options.cwd, '/projects/example')
  assert.equal(options.stdio, 'inherit')
  assert.equal('shell' in options, false)

  child.emit('close', 0, null)

  assert.deepEqual(await resultPromise, { code: 0 })
})

test('runCommand ignores Ctrl+C in the CLI while the command runs', async () => {
  for (const ending of ['close', 'error']) {
    const child = createFakeProcess()
    const signals = new EventEmitter()
    const { spawnMock } = createSpawnMock(child)

    const resultPromise = runCommand('dev', '/projects/example', {
      spawnProcess: spawnMock,
      signals,
    })

    assert.equal(signals.listenerCount('SIGINT'), 1)

    if (ending === 'close') {
      child.emit('close', null, 'SIGINT')
      await resultPromise
    } else {
      child.emit('error', new Error('failed'))
      await assert.rejects(resultPromise)
    }

    assert.equal(signals.listenerCount('SIGINT'), 0)
  }
})

test('runCommand returns a non-zero exit code when a script fails', async () => {
  const child = createFakeProcess()
  const { spawnMock } = createSpawnMock(child)

  const resultPromise = runCommand('test', '/projects/example', {
    spawnProcess: spawnMock,
  })

  child.emit('close', 7, null)

  assert.deepEqual(await resultPromise, { code: 7 })
})

test('runCommand reports a signal when a command is interrupted', async () => {
  const child = createFakeProcess()
  const { spawnMock } = createSpawnMock(child)

  const resultPromise = runCommand('build', '/projects/example', {
    spawnProcess: spawnMock,
  })

  child.emit('close', null, 'SIGTERM')

  assert.deepEqual(await resultPromise, {
    code: null,
    signal: 'SIGTERM',
  })
})

test('runCommand provides an actionable error when npm cannot be found', async () => {
  const child = createFakeProcess()
  const { spawnMock } = createSpawnMock(child)

  const resultPromise = runCommand('dev', '/projects/example', {
    spawnProcess: spawnMock,
  })

  const originalError = Object.assign(new Error('spawn npm ENOENT'), {
    code: 'ENOENT',
  })

  child.emit('error', originalError)

  await assert.rejects(resultPromise, error => {
    assert.match(error.message, /Could not find npm/)
    assert.equal(error.cause, originalError)
    return true
  })
})

test('runCommand wraps other process startup errors', async () => {
  const child = createFakeProcess()
  const { spawnMock } = createSpawnMock(child)

  const resultPromise = runCommand('dev', '/projects/example', {
    spawnProcess: spawnMock,
  })

  const originalError = Object.assign(new Error('Permission denied'), {
    code: 'EACCES',
  })

  child.emit('error', originalError)

  await assert.rejects(resultPromise, error => {
    assert.match(error.message, /Could not start npm: Permission denied/)
    assert.equal(error.cause, originalError)
    return true
  })
})

test('runCommand runs the script with the given package manager', async () => {
  for (const packageManager of ['pnpm', 'yarn', 'bun']) {
    const child = createFakeProcess()
    const { spawnMock, calls } = createSpawnMock(child)

    const resultPromise = runCommand('test', '/projects/example', {
      spawnProcess: spawnMock,
      packageManager,
    })

    assert.equal(calls[0][0], packageManager)
    assert.deepEqual(calls[0][1], ['run', 'test'])

    child.emit('close', 0, null)

    assert.deepEqual(await resultPromise, { code: 0 })
  }
})

test('runCommand explains how to install a missing package manager', async () => {
  const cases = [
    [
      'pnpm',
      '24.11.1',
      /Could not find pnpm, which this project uses\. Install it with "corepack enable pnpm"/,
    ],
    ['yarn', '24.11.1', /Install it with "corepack enable yarn"/],
    // Node.js 25 and later no longer ship Corepack.
    [
      'pnpm',
      '26.0.0',
      /Install it with "npm install --global pnpm", or with "npm install --global corepack" followed by "corepack enable pnpm"/,
    ],
    ['bun', '26.0.0', /https:\/\/bun\.sh/],
    ['custom', '26.0.0', /Install it, then restart the CLI/],
  ]

  for (const [packageManager, nodeVersion, expected] of cases) {
    const child = createFakeProcess()
    const { spawnMock } = createSpawnMock(child)

    const resultPromise = runCommand('dev', '/projects/example', {
      spawnProcess: spawnMock,
      packageManager,
      nodeVersion,
    })

    child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await assert.rejects(resultPromise, expected)
  }
})

test('runCommand wraps startup errors without an error code', async () => {
  const child = createFakeProcess()
  const { spawnMock } = createSpawnMock(child)

  const resultPromise = runCommand('dev', '/projects/example', {
    spawnProcess: spawnMock,
  })

  const originalError = new Error('Unexpected startup failure')

  child.emit('error', originalError)

  await assert.rejects(resultPromise, error => {
    assert.match(
      error.message,
      /Could not start npm: Unexpected startup failure/,
    )
    assert.equal(error.cause, originalError)
    return true
  })
})

test('runCommand passes extra arguments the way each package manager needs', async () => {
  const cases = [
    ['npm', ['run', 'dev', '--', '--port', '4000']],
    ['pnpm', ['run', 'dev', '--port', '4000']],
    ['yarn', ['run', 'dev', '--port', '4000']],
    ['bun', ['run', 'dev', '--port', '4000']],
  ]

  for (const [packageManager, expected] of cases) {
    const child = createFakeProcess()
    const { spawnMock, calls } = createSpawnMock(child)

    const resultPromise = runCommand('dev', '/projects/example', {
      spawnProcess: spawnMock,
      packageManager,
      args: ['--port', '4000'],
    })

    assert.deepEqual(calls[0][1], expected, packageManager)

    child.emit('close', 0, null)
    await resultPromise
  }
})
