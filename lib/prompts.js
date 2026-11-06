// Interactive questions and menus.
//
// createPrompts() returns one function per screen: asking for the workspace
// path, confirming a workspace change, choosing a project or script, asking
// for script arguments, and the choice after a command. Menus use the list
// from list.js, which supports fuzzy search; the text and yes/no questions use
// @inquirer/prompts, with the theme from ui.js so they match the menus and
// respect NO_COLOR and FORCE_COLOR.
//
// chooseProject() shows the recently used projects first, under a "Recent"
// heading, and folders without a package.json dimmed and unselectable; one
// click opens a project. It returns the project, CHANGE_WORKSPACE for the
// `⚙ Workspace` button, or null for `✕ Exit` and Escape. chooseScript() puts
// the cursor on the project's last script, tagged "last run", shows each
// script's command next to it (the list cuts it to the width) followed by
// its pre/post hooks, and offers `▶ run` and `… args` buttons on the hovered
// script (→ presses `… args`). It returns { script, withArguments },
// RUN_WITH_ARGUMENTS for the `… Run with args` button, or null for
// `← Back` and Escape. With `forArguments`, it
// asks which script to run with arguments, and Back returns to the scripts.
// askForArguments() splits what the user typed with splitArguments().
// waitForBack() shows the body with a single Back button, for empty and
// error states. waitAfterCommand() returns true for "Run again".
//
// chooseProject(), chooseScript() and waitForBack() are drawn on the
// alternate screen and take the `header` and `body` the list draws above its
// message (see list.js); waitAfterCommand() is drawn inline, under the
// script's output. Buttons use symbols one column wide (⚙ ✕ ← … ▶ ↻).
//
// useMouse() turns the mouse on or off for every menu from then on, and
// gives a note (from terminal.js) to show under the next menu only, with a
// function called when that menu shows it.
//
// Used by cli.js through the default instance exported at the bottom. Tests
// pass fake prompt functions, and a theme, to createPrompts().

import {
  confirm as inquirerConfirm,
  input as inquirerInput,
} from '@inquirer/prompts'

import { splitArguments } from './args.js'
import { select as listSelect } from './list.js'
import { inquirerTheme } from './ui.js'

// Returned by chooseProject when the user wants another workspace.
export const CHANGE_WORKSPACE = Symbol('change-workspace')

// Returned by chooseScript when the user wants to pass arguments.
export const RUN_WITH_ARGUMENTS = Symbol('run-with-arguments')

function projectItem(project) {
  return {
    label: project.name,
    value: project,
    // Shown dimmed and skipped by the cursor: there is nothing to run.
    ...(project.hasPackageJson === false && {
      disabled: 'no package.json',
    }),
  }
}

// The list cuts the command to fit, but keeps the hooks note whole.
function scriptItem(script, lastScript) {
  return {
    label: script.name,
    value: script,
    detail: script.command,
    ...(script.hooks?.length && {
      detailEnd: `  (+ ${script.hooks.join(', ')})`,
    }),
    ...(script.name === lastScript && { hint: 'last run' }),
  }
}

// The header and body for the list, left out while unset.
function frame({ header, body } = {}) {
  return { ...(header && { header }), ...(body?.length && { body }) }
}

export function createPrompts({
  confirm = inquirerConfirm,
  input = inquirerInput,
  select = listSelect,
  theme = inquirerTheme(),
} = {}) {
  let mouse = false
  let note = null
  let noteShown = null

  // Every menu goes through here, so the mouse setting and the note reach
  // the list; options are left as they are while neither is set.
  function menu(options) {
    const shown = note

    note = null

    if (shown) noteShown?.()

    return select({
      ...options,
      ...(mouse && { mouse }),
      ...(shown && { note: shown }),
    })
  }

  return {
    useMouse(enabled, nextNote = null, onNoteShown = null) {
      mouse = enabled
      note = nextNote
      noteShown = onNoteShown
    },

    async askForWorkspace(validate) {
      return input({
        message: 'Workspace path',
        validate,
        theme,
      })
    },

    async confirmWorkspaceChange() {
      return confirm({
        message: 'Choose a new workspace directory?',
        default: true,
        theme,
      })
    },

    async chooseProject(projects, { recent = [], ...options } = {}) {
      const others = projects.filter(project => !recent.includes(project))
      const items = others.map(projectItem)

      if (recent.length > 0) {
        items.unshift({ separator: 'Recent' }, ...recent.map(projectItem), {
          separator: 'All projects',
        })
      }

      return menu({
        message: 'Select a project',
        items,
        toolbar: [
          { label: '⚙ Workspace', value: CHANGE_WORKSPACE },
          { label: '✕ Exit', value: null },
        ],
        escape: { value: null, label: 'exit' },
        enter: 'open',
        clickOpens: true,
        fullscreen: true,
        ...frame(options),
      })
    },

    // With `forArguments`, the list picks the script to run with arguments:
    // it has no "Run with args" button, and Back returns to the scripts.
    async chooseScript(
      scripts,
      { lastScript, forArguments = false, ...options } = {},
    ) {
      const toolbar = [{ label: '← Back', value: null }]

      if (!forArguments && scripts.length > 0) {
        toolbar.push({ label: '… Run with args', value: RUN_WITH_ARGUMENTS })
      }

      const choice = await menu({
        message: forArguments
          ? 'Run which script with arguments?'
          : 'Select a script',
        items: scripts.map(script => scriptItem(script, lastScript)),
        toolbar,
        escape: { value: null, label: 'back' },
        enter: forArguments ? 'select' : 'run',
        ...(!forArguments && {
          rowButtons: [
            {
              label: '▶ run',
              value: script => ({ script, withArguments: false }),
            },
            {
              label: '… args',
              value: script => ({ script, withArguments: true }),
              right: true,
            },
          ],
        }),
        default: scripts.find(script => script.name === lastScript),
        fullscreen: true,
        ...frame(options),
      })

      // Enter, or a click on the selected script.
      if (scripts.includes(choice)) {
        return { script: choice, withArguments: forArguments }
      }

      return choice
    },

    async askForArguments(scriptName) {
      const text = await input({
        message: `Arguments for ${scriptName}`,
        validate: value => {
          try {
            splitArguments(value)
            return true
          } catch (error) {
            return error.message
          }
        },
        theme,
      })

      return splitArguments(text)
    },

    async waitForBack(options = {}) {
      return menu({
        buttons: [{ label: '← Back to projects', value: true }],
        escape: { value: true, label: 'back' },
        searchable: false,
        fullscreen: true,
        ...frame(options),
      })
    },

    async waitAfterCommand() {
      return menu({
        message: 'What next?',
        items: [
          { icon: '↻', label: 'Run again', value: true },
          { icon: '←', label: 'Back to scripts', value: false },
        ],
        escape: { value: false, label: 'back' },
        searchable: false,
      })
    },
  }
}

export const {
  askForArguments,
  askForWorkspace,
  confirmWorkspaceChange,
  chooseProject,
  chooseScript,
  useMouse,
  waitForBack,
  waitAfterCommand,
} = createPrompts()
