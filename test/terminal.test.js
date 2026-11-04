import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOUSE_CHECK_ISSUE,
  detectTerminal,
  mouseNote,
} from '../lib/terminal.js'

const detect = (env, platform = 'linux') => detectTerminal({ env, platform })

test('detectTerminal recognises the terminals in the support table', () => {
  assert.deepEqual(
    [
      detect({ WT_SESSION: 'id' }, 'win32'),
      detect({}, 'win32'),
      detect({ TERM_PROGRAM: 'vscode' }, 'darwin'),
      detect({ TERM_PROGRAM: 'Apple_Terminal' }, 'darwin'),
      detect({ TERM_PROGRAM: 'iTerm.app' }, 'darwin'),
    ].map(({ id, support }) => [id, support]),
    [
      ['windows-terminal', 'full'],
      ['windows-console', 'full'],
      ['vscode', 'full'],
      ['apple-terminal', 'partial'],
      ['iterm2', 'unknown'],
    ],
  )
})

test('detectTerminal treats Git Bash as having no mouse, even in Windows Terminal', () => {
  for (const env of [
    { MSYSTEM: 'MINGW64', TERM_PROGRAM: 'mintty', TERM: 'xterm' },
    { MSYSTEM: 'MINGW64', WT_SESSION: 'id', TERM: 'xterm-256color' },
  ]) {
    assert.deepEqual(detect(env, 'win32'), {
      id: 'git-bash',
      name: 'Git Bash',
      support: 'none',
    })
  }
})

test('detectTerminal reports other terminals as not checked yet', () => {
  assert.deepEqual(detect({ TERM_PROGRAM: 'WezTerm' }), {
    id: 'program:WezTerm',
    name: 'WezTerm',
    support: 'unknown',
  })
  assert.deepEqual(detect({ TERM: 'xterm-256color' }), {
    id: 'linux:xterm-256color',
    name: 'this terminal',
    support: 'unknown',
  })
  assert.equal(detect({ ConEmuPID: '1' }, 'win32').support, 'unknown')
  assert.equal(detect({ TERM: 'xterm' }, 'win32').support, 'unknown')
  assert.equal(detect({}).id, 'linux:unknown')
})

test('mouseNote explains partial support and how to get full support', () => {
  const note = mouseNote(detect({ TERM_PROGRAM: 'Apple_Terminal' }, 'darwin'))

  assert.match(note, /partial in macOS Terminal/)
  assert.match(note, /VS Code integrated terminal/)

  const gitBash = mouseNote(detect({ MSYSTEM: 'MINGW64' }, 'win32'))

  assert.match(gitBash, /^Git Bash does not report the mouse/)
  assert.match(gitBash, /PowerShell in Windows Terminal/)
})

test('mouseNote asks for help in a terminal not checked yet', () => {
  const note = mouseNote(detect({ TERM_PROGRAM: 'iTerm.app' }, 'darwin'))

  assert.match(note, /not been checked in iTerm2/)
  assert.match(note, /--no-mouse/)
  assert.ok(note.endsWith(MOUSE_CHECK_ISSUE))
})

test('mouseNote has nothing to say where the mouse fully works', () => {
  assert.equal(mouseNote(detect({ WT_SESSION: 'id' }, 'win32')), null)
})
