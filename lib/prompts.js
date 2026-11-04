// Interactive questions and menus.
//
// createPrompts() returns one function per screen: asking for the workspace
// path, confirming a workspace change, choosing a project or script, asking
// for script arguments, and the choice after a command. Menus use the list
// from list.js, which supports fuzzy search; the text and yes/no questions use
// @inquirer/prompts.
//
// chooseProject() shows the recently used projects first, under a "Recent"
// heading, and folders without a package.json dimmed and unselectable. It
// returns the project, CHANGE_WORKSPACE when the user picks that entry, or
// null for Exit. chooseScript() puts the cursor on the project's last script,
// shows the selected script's command, cut to the terminal width (measured
// with width.js, so wide characters count as two columns), and its
// pre/post hooks, and returns the script, RUN_WITH_ARGUMENTS when offered and
// picked, or null for Back. askForArguments() splits what the user typed with
// splitArguments(). waitAfterCommand() returns true for "Run again".
//
// useMouse() turns the mouse on or off for every menu from then on, and
// gives a note (from terminal.js) to show under the next menu only.
//
// Used by cli.js through the default instance exported at the bottom. Tests
// pass fake prompt functions and a terminal width to createPrompts().

import {
  confirm as inquirerConfirm,
  input as inquirerInput,
} from '@inquirer/prompts'

import { splitArguments } from './args.js'
import { select as listSelect } from './list.js'
import { fitText, textWidth } from './width.js'

// Returned by chooseProject when the user wants another workspace.
export const CHANGE_WORKSPACE = Symbol('change-workspace')

// Returned by chooseScript when the user wants to pass arguments.
export const RUN_WITH_ARGUMENTS = Symbol('run-with-arguments')

function truncate(text, width) {
  return textWidth(text) <= width ? text : `${fitText(text, width - 1)}…`
}

// The command shown under the selected script, cut to fit on one line. The
// hooks note is kept whole, so only the command itself is shortened. The list
// indents it by two columns and leaves the last column free.
function describeScript(script, terminalColumns) {
  const hooks = script.hooks?.length ? `  (+ ${script.hooks.join(', ')})` : ''
  const width = Math.max(20, (terminalColumns || 80) - 3) - textWidth(hooks)

  return truncate(script.command, Math.max(10, width)) + hooks
}

function projectItem(project) {
  return {
    icon: '📁',
    label: project.name,
    value: project,
    // Shown dimmed and skipped by the cursor: there is nothing to run.
    ...(project.hasPackageJson === false && {
      disabled: '(no package.json)',
    }),
  }
}

export function createPrompts({
  confirm = inquirerConfirm,
  input = inquirerInput,
  select = listSelect,
  columns = () => process.stdout.columns,
} = {}) {
  let mouse = false
  let note = null

  // Every menu goes through here, so the mouse setting and the note reach
  // the list; options are left as they are while neither is set.
  function menu(options) {
    const shown = note

    note = null

    return select({
      ...options,
      ...(mouse && { mouse }),
      ...(shown && { note: shown }),
    })
  }

  return {
    useMouse(enabled, nextNote = null) {
      mouse = enabled
      note = nextNote
    },

    async askForWorkspace(validate) {
      return input({
        message: 'Workspace path',
        validate,
      })
    },

    async confirmWorkspaceChange() {
      return confirm({
        message: 'Choose a new workspace directory?',
        default: true,
      })
    },

    async chooseProject(projects, { recent = [] } = {}) {
      const others = projects.filter(project => !recent.includes(project))
      const items = others.map(projectItem)

      if (recent.length > 0) {
        items.unshift({ separator: 'Recent' }, ...recent.map(projectItem), {
          separator: 'Projects',
        })
      }

      return menu({
        message: 'Select a project',
        items: [
          ...items,
          {
            // With its emoji selector, every terminal draws it two columns
            // wide, as string-width counts it.
            icon: '⚙️',
            label: 'Change workspace',
            value: CHANGE_WORKSPACE,
            action: true,
          },
          { icon: '↩', label: 'Exit', value: null, action: true },
        ],
      })
    },

    // With `forArguments`, the list picks the script to run with arguments:
    // it has no "Run with arguments…" entry, and Back returns to the scripts.
    async chooseScript(scripts, { lastScript, forArguments = false } = {}) {
      const items = scripts.map(script => ({
        icon: '▶',
        label: script.name,
        value: script,
        description: describeScript(script, columns()),
        ...(script.name === lastScript && { hint: '(last run)' }),
      }))

      if (!forArguments && scripts.length > 0) {
        items.push({
          icon: '…',
          label: 'Run with arguments…',
          value: RUN_WITH_ARGUMENTS,
          action: true,
        })
      }

      return menu({
        message: forArguments
          ? 'Run which script with arguments?'
          : 'Select a script',
        items: [
          ...items,
          {
            icon: '↩',
            label: forArguments ? 'Back to scripts' : 'Back to projects',
            value: null,
            action: true,
          },
        ],
        default: scripts.find(script => script.name === lastScript),
      })
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
      })

      return splitArguments(text)
    },

    async waitForBack(message = 'Return to projects') {
      return menu({
        message,
        items: [{ icon: '↩', label: 'Back', value: true }],
        searchable: false,
      })
    },

    async waitAfterCommand() {
      return menu({
        message: 'What next?',
        items: [
          { icon: '↻', label: 'Run again', value: true },
          { icon: '↩', label: 'Back to scripts', value: false },
        ],
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
