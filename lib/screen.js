// The terminal's alternate screen, where the menus are drawn.
//
// createScreen() returns { enter, leave, active }. enter() switches to the
// alternate screen (ESC [ ? 1049 h), as `less` and `vim` do: the menus can
// then redraw the whole window from its top-left corner, and the normal
// screen, with its scrollback and any script output, comes back unchanged on
// leave(). Both are safe to call at any time: entering twice or leaving the
// normal screen writes nothing.
//
// While the alternate screen is on, it is left on every way out: the exit
// event, and the signals in SIGNALS, which are then sent again so they still
// end the process.
//
// list.js enters it for a fullscreen list and leaves it for an inline one.
// cli.js leaves it before a script runs and when the menus end, before any
// message is printed. Both use the shared `screen` exported at the bottom;
// tests create their own with fake output and exit events.

const ENTER = '\x1b[?1049h'
const LEAVE = '\x1b[?1049l'

// Signals that end the process without an exit event.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

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
