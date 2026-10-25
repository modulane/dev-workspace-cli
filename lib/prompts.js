// Interactive questions and menus, built on @inquirer/prompts.
//
// createPrompts() returns one function per screen: asking for the workspace
// path, confirming a workspace change, choosing a project or script, and
// waiting after a command. chooseProject() shows folders without a
// package.json dimmed and unselectable, returns CHANGE_WORKSPACE when the
// user picks that entry, and null for Exit or Back.
//
// Used by cli.js through the default instance exported at the bottom. Tests
// pass fake Inquirer functions to createPrompts().

import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from '@inquirer/prompts'

// Returned by chooseProject when the user wants another workspace.
export const CHANGE_WORKSPACE = Symbol('change-workspace')

export function createPrompts({
  confirm = inquirerConfirm,
  input = inquirerInput,
  select = inquirerSelect,
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
            description: script.command,
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
