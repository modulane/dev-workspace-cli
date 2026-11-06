import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { createScreen } from '../lib/screen.js'

function createFakes() {
  const output = { written: '', write: text => (output.written += text) }
  const exitEvents = Object.assign(new EventEmitter(), {
    pid: 7,
    killed: [],
    kill(pid, signal) {
      exitEvents.killed.push([pid, signal])
    },
  })

  return { output, exitEvents, screen: createScreen({ output, exitEvents }) }
}

test('enter and leave switch the alternate screen once each', () => {
  const { output, exitEvents, screen } = createFakes()

  screen.leave()
  assert.equal(output.written, '')

  screen.enter()
  screen.enter()
  assert.equal(output.written, '\x1b[?1049h')
  assert.equal(screen.active, true)
  assert.equal(exitEvents.listenerCount('exit'), 1)

  screen.leave()
  screen.leave()
  assert.equal(output.written, '\x1b[?1049h\x1b[?1049l')
  assert.equal(screen.active, false)
  assert.equal(exitEvents.listenerCount('exit'), 0)
  assert.equal(exitEvents.listenerCount('SIGINT'), 0)
})

test('the alternate screen is left when the process exits', () => {
  const { output, exitEvents, screen } = createFakes()

  screen.enter()
  exitEvents.emit('exit')

  assert.ok(output.written.endsWith('\x1b[?1049l'))
  assert.equal(screen.active, false)
})

test('a signal leaves the alternate screen, then ends the process', () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const { output, exitEvents, screen } = createFakes()

    screen.enter()
    exitEvents.emit(signal, signal)

    assert.ok(output.written.endsWith('\x1b[?1049l'))
    // Sent again with no listener left, so the default action ends it.
    assert.equal(exitEvents.listenerCount(signal), 0)
    assert.deepEqual(exitEvents.killed, [[7, signal]])
  }
})
