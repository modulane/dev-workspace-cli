// Every menu and question the CLI shows.
// Used by cli.js.

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

// Returned by chooseWorkspace when the user wants to type a path.
export const ENTER_PATH = Symbol('enter-path')

// How chooseAccent() names each accent from ui.js.
const ACCENT_LABELS = {
  cyan: 'Cyan',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
  pink: 'Pink',
  orange: 'Orange',
  teal: 'Teal',
  sky: 'Sky',
  lavender: 'Lavender',
  coral: 'Coral',
  gold: 'Gold',
  bold: 'No colour, bold text',
}

function projectItem(project, details) {
  // Shown dimmed and skipped by the cursor: there is nothing to run.
  if (project.hasPackageJson === false) {
    return { label: project.name, value: project, disabled: 'no package.json' }
  }

  return {
    label: project.name,
    value: project,
    ...(details && { load: () => details(project) }),
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
    // "last run" matters more; a script that needs arguments asks for them
    // anyway.
    ...(script.needsArguments && { hint: 'needs arguments' }),
    ...(script.name === lastScript && {
      hint: 'last run',
      hintStyle: 'accent',
    }),
  }
}

// The header and body for the list, left out while unset.
// A package's label under its monorepo: its folder (`api` for
// `packages/api`), or its whole path when another package has the same
// folder name.
function packageLabel(child, siblings) {
  const folder = child.path.split('/').at(-1)
  const shared = siblings.some(
    other => other !== child && other.path.split('/').at(-1) === folder,
  )

  return shared ? child.path : folder
}

function frame({ header, body } = {}) {
  return { ...(header && { header }), ...(body?.length && { body }) }
}

// Returns one function per screen. Menus use the list from list.js; text and
// yes/no questions use @inquirer/prompts with the theme from ui.js. Escape
// or Back returns null. Tests pass fake prompt functions, a theme and an
// emitter for the keypress events.
export function createPrompts({
  confirm = inquirerConfirm,
  input = inquirerInput,
  select = listSelect,
  theme = inquirerTheme(),
  // Where Inquirer's keypress events arrive (readline emits them on stdin).
  keys = process.stdin,
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

  // An Inquirer question that Escape aborts: it then resolves with null.
  async function inputOrEscape(options) {
    const controller = new AbortController()
    const onKeypress = (_, key) => {
      if (key?.name === 'escape') controller.abort()
    }

    keys.on('keypress', onKeypress)

    try {
      return await input(options, { signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) return null

      throw error
    } finally {
      keys.off('keypress', onKeypress)
    }
  }

  return {
    useMouse(enabled, nextNote = null, onNoteShown = null) {
      mouse = enabled
      note = nextNote
      noteShown = onNoteShown
    },

    // With `cancellable`, Escape resolves with null instead of a path.
    async askForWorkspace(validate, { cancellable = false } = {}) {
      const options = { message: 'Workspace path', validate, theme }

      return cancellable ? inputOrEscape(options) : input(options)
    },

    async confirmWorkspaceChange() {
      return confirm({
        message: 'Choose a new workspace directory?',
        default: true,
        theme,
      })
    },

    // Escape resolves with null; the name the user typed otherwise.
    async askForWorkspaceName(suggested, validate) {
      const name = await inputOrEscape({
        message: 'Name for this workspace',
        default: suggested,
        validate,
        theme,
      })

      return name === null ? null : name.trim()
    },

    async chooseWorkspace(
      folders,
      { saved = [], current, details, cancellable = false, ...options } = {},
    ) {
      const savedItems = saved.map(({ name, directory, missing }) => ({
        label: name,
        value: directory,
        detail: directory,
        ...(missing
          ? { disabled: 'not found' }
          : directory === current && { hint: 'current' }),
      }))
      const items = folders.map(folder => ({
        label: folder,
        value: folder,
        ...(details && { load: () => details(folder) }),
        ...(folder === current && { hint: 'current' }),
      }))
      // Group titles only when there is something to tell apart.
      const groups =
        savedItems.length && items.length
          ? [
              { separator: 'Saved' },
              ...savedItems,
              { separator: 'Suggested' },
              ...items,
            ]
          : [...savedItems, ...items]
      const offered = [...saved.map(({ directory }) => directory), ...folders]

      return menu({
        message: 'Select your workspace folder',
        items: [
          ...groups,
          { label: '… Enter another path', value: ENTER_PATH },
        ],
        ...(cancellable && { escape: { value: null, label: 'back' } }),
        ...(offered.includes(current) && { default: current }),
        searchable: false,
        clickOpens: true,
        fullscreen: true,
        ...frame(options),
      })
    },

    // Each colour's name is drawn in that colour, and moving the cursor
    // calls `preview` with it.
    async chooseAccent(accents, { current, preview, ...options } = {}) {
      return menu({
        message: 'Select an accent colour',
        items: accents.map((name, index) => ({
          label: ACCENT_LABELS[name] ?? name,
          value: name,
          style: name,
          ...(index === 0 && { hint: 'default' }),
        })),
        ...(accents.includes(current) && { default: current }),
        ...(preview && { preview }),
        searchable: false,
        clickOpens: true,
        fullscreen: true,
        ...frame(options),
      })
    },

    async chooseProject(
      projects,
      { recent = [], details, packages, default: selected, ...options } = {},
    ) {
      const item = project => projectItem(project, details)
      // A monorepo expands into `root`, which opens the scripts of its own
      // package.json, then its packages, each labelled with its folder
      // (packageLabel), in "Recent" as in "All projects"; a recent package
      // has its full name.
      const tree = project => {
        const children = packages?.(project) ?? []

        if (children.length === 0) return item(project)

        const root = {
          label: 'root',
          value: project,
          ...(details && { load: () => details(project, { root: true }) }),
        }

        return {
          ...item(project),
          children: [
            root,
            ...children.map(child => ({
              ...item(child),
              label: packageLabel(child, children),
            })),
          ],
        }
      }
      const others = projects.filter(project => !recent.includes(project))
      const items = others.map(tree)

      if (recent.length > 0) {
        items.unshift({ separator: 'Recent' }, ...recent.map(tree), {
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
        ...(selected && { default: selected }),
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
          // The list draws a divider between them, so they read as two.
          rowButtons: [
            {
              label: '▶ run',
              value: script => ({
                script,
                withArguments: Boolean(script.needsArguments),
              }),
            },
            {
              label: '… run with args',
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
        return {
          script: choice,
          withArguments: forArguments || Boolean(choice.needsArguments),
        }
      }

      return choice
    },

    // Escape goes back: null instead of the arguments.
    // With `required`, an empty answer is refused.
    async askForArguments(scriptName, { required = false } = {}) {
      const text = await inputOrEscape({
        message: `Arguments for ${scriptName}`,
        validate: value => {
          if (required && !value.trim()) {
            return `${scriptName} cannot run without arguments.`
          }

          try {
            splitArguments(value)
            return true
          } catch (error) {
            return error.message
          }
        },
        theme,
      })

      return text === null ? null : splitArguments(text)
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
        buttons: [
          { label: '↻ Run again', value: true, key: 'r' },
          { label: '← Back to scripts', value: false },
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
  askForWorkspaceName,
  chooseAccent,
  confirmWorkspaceChange,
  chooseProject,
  chooseScript,
  chooseWorkspace,
  useMouse,
  waitForBack,
  waitAfterCommand,
} = createPrompts()
