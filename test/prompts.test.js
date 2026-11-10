import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  CHANGE_WORKSPACE,
  ENTER_PATH,
  RUN_WITH_ARGUMENTS,
  createPrompts,
} from '../lib/prompts.js'

// Passed through to Inquirer as it is.
const THEME = { prefix: '>' }

function createPromptMocks(results = {}) {
  const calls = {
    confirm: [],
    input: [],
    select: [],
  }

  return {
    calls,
    prompts: createPrompts({
      confirm: async options => {
        calls.confirm.push(options)
        return Object.hasOwn(results, 'confirm')
          ? results.confirm
          : 'mock-result'
      },
      input: async options => {
        calls.input.push(options)
        return Object.hasOwn(results, 'input') ? results.input : 'mock-result'
      },
      select: async options => {
        calls.select.push(options)
        return Object.hasOwn(results, 'select') ? results.select : 'mock-result'
      },
      theme: THEME,
    }),
  }
}

test('askForWorkspace passes its message and validator to input', async () => {
  const { calls, prompts } = createPromptMocks({ input: '/projects' })
  const validate = value => value.length > 0

  const result = await prompts.askForWorkspace(validate)

  assert.equal(result, '/projects')
  assert.equal(calls.input.length, 1)
  assert.equal(calls.input[0].message, 'Workspace path')
  assert.equal(calls.input[0].validate, validate)
  assert.equal(calls.input[0].theme, THEME)
})

// An input prompt that waits until its signal aborts, as Inquirer's does, or
// fails with `error` once a key is pressed.
function abortableInput(keys, error) {
  return (options, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () =>
        reject(
          Object.assign(new Error('aborted'), { name: 'AbortPromptError' }),
        ),
      )
      if (error) keys.once('keypress', () => reject(error))
    })
}

test('askForWorkspace returns null on Escape when cancellable', async () => {
  const keys = new EventEmitter()
  const prompts = createPrompts({ input: abortableInput(keys), keys })

  const answer = prompts.askForWorkspace(() => true, { cancellable: true })

  keys.emit('keypress', 'a', { name: 'a' })
  keys.emit('keypress', undefined, undefined)
  keys.emit('keypress', undefined, { name: 'escape' })

  assert.equal(await answer, null)
  assert.equal(keys.listenerCount('keypress'), 0)
})

test('askForWorkspace passes other errors on when cancellable', async () => {
  const keys = new EventEmitter()
  const failure = new Error('closed')
  const prompts = createPrompts({ input: abortableInput(keys, failure), keys })

  const answer = prompts.askForWorkspace(() => true, { cancellable: true })

  keys.emit('keypress', 'a', { name: 'a' })

  await assert.rejects(answer, failure)
  assert.equal(keys.listenerCount('keypress'), 0)
})

test('askForWorkspace returns the typed path when cancellable', async () => {
  const keys = new EventEmitter()
  const prompts = createPrompts({ input: async () => '/projects', keys })

  assert.equal(
    await prompts.askForWorkspace(() => true, { cancellable: true }),
    '/projects',
  )
})

test('confirmWorkspaceChange defaults to true', async () => {
  const { calls, prompts } = createPromptMocks({ confirm: true })

  const result = await prompts.confirmWorkspaceChange()

  assert.equal(result, true)
  assert.deepEqual(calls.confirm, [
    {
      message: 'Choose a new workspace directory?',
      default: true,
      theme: THEME,
    },
  ])
})

test('chooseWorkspace lists the folders, then a way to type another path', async () => {
  const { calls, prompts } = createPromptMocks({ select: ENTER_PATH })
  const details = async folder => ({ detail: folder })

  const result = await prompts.chooseWorkspace(['/home/dev', '/home/code'], {
    details,
    body: [['Choose a folder.']],
  })

  assert.equal(result, ENTER_PATH)

  const { items, ...options } = calls.select[0]

  assert.deepEqual(
    items.map(({ label, value, hint }) => ({ label, value, hint })),
    [
      { label: '/home/dev', value: '/home/dev', hint: undefined },
      { label: '/home/code', value: '/home/code', hint: undefined },
      { label: '… Enter another path', value: ENTER_PATH, hint: undefined },
    ],
  )
  assert.deepEqual(await items[1].load(), { detail: '/home/code' })
  assert.equal(items[2].load, undefined)
  // On first run, a folder is required: Escape does nothing.
  assert.deepEqual(options, {
    message: 'Select your workspace folder',
    searchable: false,
    clickOpens: true,
    fullscreen: true,
    body: [['Choose a folder.']],
  })
})

test('chooseWorkspace starts on the current folder, and Escape goes back', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })
  const header = () => []

  const result = await prompts.chooseWorkspace(['/home/dev', '/home/code'], {
    current: '/home/code',
    cancellable: true,
    header,
  })

  assert.equal(result, null)
  assert.equal(calls.select[0].items[1].hint, 'current')
  assert.equal(calls.select[0].default, '/home/code')
  assert.deepEqual(calls.select[0].escape, { value: null, label: 'back' })
  assert.equal(calls.select[0].header, header)
  assert.equal(Object.hasOwn(calls.select[0].items[0], 'load'), false)
})

test('chooseProject lists projects, with workspace and exit buttons', async () => {
  const projects = [
    { name: 'project-a', directory: '/projects/a' },
    { name: 'project-b', directory: '/projects/b' },
  ]
  const { calls, prompts } = createPromptMocks({
    select: projects[0],
  })

  const result = await prompts.chooseProject(projects)

  assert.equal(result, projects[0])
  assert.deepEqual(calls.select[0], {
    message: 'Select a project',
    items: [
      { label: 'project-a', value: projects[0] },
      { label: 'project-b', value: projects[1] },
    ],
    toolbar: [
      { label: '⚙ Workspace', value: CHANGE_WORKSPACE },
      { label: '✕ Exit', value: null },
    ],
    // Escape exits, and one click opens a project.
    escape: { value: null, label: 'exit' },
    enter: 'open',
    clickOpens: true,
    fullscreen: true,
  })
})

test('chooseProject passes the header and body to the list', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })
  const header = () => []
  const body = [['No project folders in this workspace.', 'yellow']]

  await prompts.chooseProject([], { header, body })
  await prompts.chooseProject([], { header, body: [] })

  assert.equal(calls.select[0].header, header)
  assert.deepEqual(calls.select[0].body, body)
  // An empty body is left out.
  assert.equal(Object.hasOwn(calls.select[1], 'body'), false)
})

test('chooseProject supports an empty project list', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })

  const result = await prompts.chooseProject([])

  assert.equal(result, null)
  assert.deepEqual(calls.select[0].items, [])
  assert.equal(calls.select[0].toolbar.length, 2)
})

test('chooseProject shows recent projects first, under a heading', async () => {
  const projects = ['api', 'docs', 'web'].map(name => ({
    name,
    directory: `/projects/${name}`,
  }))
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseProject(projects, { recent: [projects[2], projects[0]] })

  assert.deepEqual(
    calls.select[0].items.map(item => item.separator ?? item.label),
    ['Recent', 'web', 'api', 'All projects', 'docs'],
  )
})

test('chooseProject disables folders without a package.json', async () => {
  const projects = [
    { name: 'web', directory: '/projects/web', hasPackageJson: true },
    { name: 'notes', directory: '/projects/notes', hasPackageJson: false },
  ]
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseProject(projects)

  assert.deepEqual(calls.select[0].items.slice(0, 2), [
    { label: 'web', value: projects[0] },
    { label: 'notes', value: projects[1], disabled: 'no package.json' },
  ])
})

test('chooseProject lets the list load the details of each project', async () => {
  const projects = [
    { name: 'web', directory: '/projects/web', hasPackageJson: true },
    { name: 'notes', directory: '/projects/notes', hasPackageJson: false },
  ]
  const { calls, prompts } = createPromptMocks({ select: null })
  const asked = []
  const details = async project => {
    asked.push(project)
    return { detail: '3 scripts' }
  }

  await prompts.chooseProject(projects, { recent: [projects[0]], details })

  const [, web, , notes] = calls.select[0].items

  assert.deepEqual(await web.load(), { detail: '3 scripts' })
  assert.deepEqual(asked, [projects[0]])
  // A folder without a package.json has nothing to load.
  assert.equal(notes.load, undefined)
})

test('chooseScript lists scripts with their command, with back and args buttons', async () => {
  const scripts = [
    { name: 'dev', command: 'nuxt dev' },
    { name: 'build', command: 'nuxt build' },
  ]
  const { calls, prompts } = createPromptMocks({ select: scripts[0] })

  const result = await prompts.chooseScript(scripts)
  const { rowButtons, ...options } = calls.select[0]

  // Enter or a click on the selected script runs it without arguments.
  assert.deepEqual(result, { script: scripts[0], withArguments: false })
  assert.deepEqual(options, {
    message: 'Select a script',
    items: [
      { label: 'dev', value: scripts[0], detail: 'nuxt dev' },
      { label: 'build', value: scripts[1], detail: 'nuxt build' },
    ],
    toolbar: [
      { label: '← Back', value: null },
      { label: '… Run with args', value: RUN_WITH_ARGUMENTS },
    ],
    escape: { value: null, label: 'back' },
    enter: 'run',
    default: undefined,
    fullscreen: true,
  })
  assert.deepEqual(
    rowButtons.map(({ label, right }) => ({ label, right })),
    [
      { label: '▶ run', right: undefined },
      { label: '… run with args', right: true },
    ],
  )
  assert.deepEqual(rowButtons[0].value(scripts[1]), {
    script: scripts[1],
    withArguments: false,
  })
  assert.deepEqual(rowButtons[1].value(scripts[1]), {
    script: scripts[1],
    withArguments: true,
  })
})

test('chooseScript passes button answers on as they are', async () => {
  const script = { name: 'dev', command: 'nuxt dev' }

  for (const answer of [
    null,
    RUN_WITH_ARGUMENTS,
    { script, withArguments: true },
  ]) {
    const { prompts } = createPromptMocks({ select: answer })

    assert.equal(await prompts.chooseScript([script]), answer)
  }
})

test('chooseScript keeps the hooks note apart, so the list never cuts it', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })
  const header = () => []

  await prompts.chooseScript(
    [
      {
        name: 'build',
        command: 'vite build',
        hooks: ['prebuild', 'postbuild'],
      },
    ],
    { header },
  )

  assert.deepEqual(calls.select[0].items[0], {
    label: 'build',
    value: calls.select[0].items[0].value,
    detail: 'vite build',
    detailEnd: '  (+ prebuild, postbuild)',
  })
  assert.equal(calls.select[0].header, header)
})

test('chooseScript starts on the last script run', async () => {
  const scripts = [
    { name: 'dev', command: 'nuxt dev' },
    { name: 'build', command: 'nuxt build' },
  ]
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseScript(scripts, { lastScript: 'build' })

  assert.equal(calls.select[0].default, scripts[1])
  assert.equal(calls.select[0].items[1].hint, 'last run')
  // The tag is in the accent, the name stays as the others.
  assert.equal(calls.select[0].items[1].hintStyle, 'accent')
  assert.equal(calls.select[0].items[1].style, undefined)
  assert.equal(calls.select[0].items[0].hintStyle, undefined)
  assert.equal(calls.select[0].items[0].hint, undefined)
})

test('chooseScript asks which script to run with arguments', async () => {
  const scripts = [{ name: 'dev', command: 'nuxt dev' }]
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseScript(scripts, { forArguments: true })

  assert.equal(calls.select[0].message, 'Run which script with arguments?')
  assert.deepEqual(
    calls.select[0].items.map(item => item.label),
    ['dev'],
  )
  assert.deepEqual(calls.select[0].toolbar, [{ label: '← Back', value: null }])
  assert.equal(calls.select[0].rowButtons, undefined)

  // The script picked here is run with arguments.
  const { prompts: picking } = createPromptMocks({ select: scripts[0] })

  assert.deepEqual(
    await picking.chooseScript(scripts, { forArguments: true }),
    { script: scripts[0], withArguments: true },
  )
})

test('chooseScript supports an empty script list', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })

  const result = await prompts.chooseScript([])

  assert.equal(result, null)
  assert.deepEqual(calls.select[0].items, [])
  // Nothing to run with arguments.
  assert.deepEqual(calls.select[0].toolbar, [{ label: '← Back', value: null }])
})

test('askForArguments splits the answer and validates quotes', async () => {
  const { calls, prompts } = createPromptMocks({
    input: '--port 4000 "two words"',
  })

  const result = await prompts.askForArguments('dev')

  assert.deepEqual(result, ['--port', '4000', 'two words'])
  assert.equal(calls.input[0].message, 'Arguments for dev')
  assert.equal(calls.input[0].theme, THEME)
  assert.equal(calls.input[0].validate('--port 4000'), true)
  assert.equal(calls.input[0].validate('"open'), 'Close the " quote.')
})

test('waitForBack shows a single Back button, which Escape presses too', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  const result = await prompts.waitForBack()

  assert.equal(result, true)
  assert.deepEqual(calls.select[0], {
    buttons: [{ label: '← Back to projects', value: true }],
    escape: { value: true, label: 'back' },
    searchable: false,
    fullscreen: true,
  })
})

test('waitForBack accepts a header and body', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })
  const header = () => []
  const body = [['Could not read package.json', 'red']]

  await prompts.waitForBack({ header, body })

  assert.equal(calls.select[0].header, header)
  assert.deepEqual(calls.select[0].body, body)
})

test('waitAfterCommand offers to run again first', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  const result = await prompts.waitAfterCommand()

  assert.equal(result, true)
  assert.deepEqual(calls.select[0], {
    buttons: [
      { label: '↻ Run again', value: true, key: 'r' },
      { label: '← Back to scripts', value: false },
    ],
    escape: { value: false, label: 'back' },
    searchable: false,
  })
})

test('useMouse turns the mouse on for every menu and shows the note once', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseProject([])
  assert.equal(calls.select[0].mouse, undefined)

  let shown = 0

  prompts.useMouse(true, 'A note.', () => shown++)
  assert.equal(shown, 0)
  await prompts.chooseProject([])
  await prompts.waitAfterCommand()
  assert.equal(shown, 1)
  prompts.useMouse(false)
  await prompts.waitForBack()

  assert.deepEqual(
    calls.select.slice(1).map(({ mouse, note }) => ({ mouse, note })),
    [
      { mouse: true, note: 'A note.' },
      { mouse: true, note: undefined },
      { mouse: undefined, note: undefined },
    ],
  )
})

test('chooseAccent shows each colour in its own colour, and previews it', async () => {
  const { calls, prompts } = createPromptMocks({ select: 'teal' })
  const preview = () => {}
  const header = () => []

  const result = await prompts.chooseAccent(['cyan', 'teal', 'bold'], {
    current: 'teal',
    preview,
    header,
  })

  assert.equal(result, 'teal')
  assert.deepEqual(calls.select[0], {
    message: 'Select an accent colour',
    items: [
      { label: 'Cyan', value: 'cyan', style: 'cyan', hint: 'default' },
      { label: 'Teal', value: 'teal', style: 'teal' },
      { label: 'No colour, bold text', value: 'bold', style: 'bold' },
    ],
    default: 'teal',
    preview,
    searchable: false,
    clickOpens: true,
    fullscreen: true,
    header,
  })
})

test('askForArguments returns null on Escape, to go back', async () => {
  const keys = new EventEmitter()
  const prompts = createPrompts({ input: abortableInput(keys), keys })

  const answer = prompts.askForArguments('dev')

  keys.emit('keypress', undefined, { name: 'escape' })

  assert.equal(await answer, null)
  assert.equal(keys.listenerCount('keypress'), 0)
})

test('chooseProject expands a monorepo into its packages', async () => {
  const shop = { name: 'shop', directory: '/projects/shop', workspaces: ['*'] }
  const web = { name: 'web', directory: '/projects/web' }
  const api = {
    name: 'shop/packages/api',
    path: 'packages/api',
    directory: '/projects/shop/packages/api',
    monorepo: shop,
  }
  const { calls, prompts } = createPromptMocks({ select: api })

  const result = await prompts.chooseProject([shop, web], {
    recent: [api],
    packages: project => (project === shop ? [api] : undefined),
    default: api,
  })

  assert.equal(result, api)
  assert.deepEqual(calls.select[0].items, [
    { separator: 'Recent' },
    // In "Recent", a package has its full name and no packages of its own.
    { label: 'shop/packages/api', value: api },
    { separator: 'All projects' },
    {
      label: 'shop',
      value: shop,
      children: [{ label: 'packages/api', value: api }],
    },
    { label: 'web', value: web },
  ])
  assert.equal(calls.select[0].default, api)
})
