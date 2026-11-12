// The terminal's alternate screen, where the menus are drawn.
// Used by cli.js and list.js.

const ENTER = '\x1b[?1049h'
const LEAVE = '\x1b[?1049l'

// Signals that end the process without an exit event.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

// Returns { enter, leave, active }. Leaving brings back the normal screen
// and its scrollback unchanged. Both are safe to call twice, and the
// alternate screen is left on exit and on the signals above. Tests pass
// fake output and exit events.
export function createScreen({
  output = process.stdout,
  exitEvents = process,
} = {}) {
  let active = false

  function onSignal(signal) {
    leave()
    exitEvents.kill(exitEvents.pid, signal)
  }

  function enter() {
    if (active) return

    active = true
    exitEvents.on('exit', leave)
    for (const signal of SIGNALS) exitEvents.on(signal, onSignal)
    output.write(ENTER)
  }

  function leave() {
    if (!active) return

    active = false
    exitEvents.off('exit', leave)
    for (const signal of SIGNALS) exitEvents.off(signal, onSignal)
    output.write(LEAVE)
  }

  return {
    enter,
    leave,
    get active() {
      return active
    },
  }
}

export const screen = createScreen()
