// Interactive questions and menus, built on @inquirer/prompts.
//
// createPrompts() returns one function per screen: asking for the workspace
// path, confirming a workspace change, choosing a project or script, and
// waiting after a command. chooseProject() shows folders without a
// package.json dimmed and unselectable, returns CHANGE_WORKSPACE when the
// user picks that entry, and null for Exit or Back. chooseScript() shows the
// selected script's command, cut to the terminal width, and its pre/post
// hooks.
//
// Used by cli.js through the default instance exported at the bottom. Tests
// pass fake Inquirer functions and a terminal width to createPrompts().

import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from '@inquirer/prompts'

// Returned by chooseProject when the user wants another workspace.
export const CHANGE_WORKSPACE = Symbol('change-workspace')

function truncate(text, width) {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

// The command shown under the selected script, cut to fit on one line. The
// hooks note is kept whole, so only the command itself is shortened.
function describeScript(script, terminalColumns) {
  const hooks = script.hooks?.length ? `  (+ ${script.hooks.join(', ')})` : ''
  const width = Math.max(20, (terminalColumns || 80) - 2) - hooks.length

  return truncate(script.command, Math.max(10, width)) + hooks
}

export function createPrompts({
  confirm = inquirerConfirm,
  input = inquirerInput,
  select = inquirerSelect,
  columns = () => process.stdout.columns,
} = {}) {
  const menuTheme = {
    prefix: {
      idle: ' ',
      done: ' ',
    },
    style: {
      message: text => text,
      highlight: text => `\x1b[36m${text}\x1b[0m`,
      description: text => `\x1b[2m${text}\x1b[0m`,
    },
  }

  return {
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

    async chooseProject(projects) {
      return select({
        message: 'Select a project',
        choices: [
          ...projects.map(project => ({
            name: `📁  ${project.name}`,
            value: project,
            // Shown dimmed and skipped by the cursor: there is nothing to run.
            ...(project.hasPackageJson === false && {
              disabled: '(no package.json)',
            }),
          })),
          { name: '⚙  Change workspace', value: CHANGE_WORKSPACE },
          { name: '↩  Exit', value: null },
        ],
        pageSize: 15,
        loop: false,
      })
    },

    async chooseScript(scripts) {
      return select({
        message: 'Select a script',
        choices: [
          ...scripts.map(script => ({
            name: `▶  ${script.name}`,
            value: script,
            description: describeScript(script, columns()),
          })),
          { name: '↩  Back to projects', value: null },
        ],
        pageSize: 15,
        loop: false,
      })
    },

    async waitForBack(message = 'Return to projects') {
      return select({
        message,
        choices: [{ name: '↩  Back', value: true }],
      })
    },

    async waitAfterCommand() {
      return select({
        message: 'What next?',
        choices: [{ name: '↩  Return to project scripts', value: true }],
      })
    },
  }
}

export const {
  askForWorkspace,
  confirmWorkspaceChange,
  chooseProject,
  chooseScript,
  waitForBack,
  waitAfterCommand,
} = createPrompts()
