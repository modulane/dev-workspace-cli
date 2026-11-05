import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHANGE_WORKSPACE,
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

test('chooseProject lists projects, then workspace and exit actions', async () => {
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
      {
        icon: '⚙',
        label: 'Change workspace',
        value: CHANGE_WORKSPACE,
        action: true,
      },
      { icon: '✕', label: 'Exit', value: null, action: true },
    ],
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
  assert.deepEqual(
    calls.select[0].items.map(item => item.value),
    [CHANGE_WORKSPACE, null],
  )
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
    [
      'Recent',
      'web',
      'api',
      'All projects',
      'docs',
      'Change workspace',
      'Exit',
    ],
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

test('chooseScript lists scripts with their command, then the actions', async () => {
  const scripts = [
    { name: 'dev', command: 'nuxt dev' },
    { name: 'build', command: 'nuxt build' },
  ]
  const { calls, prompts } = createPromptMocks({ select: scripts[0] })

  const result = await prompts.chooseScript(scripts)

  assert.equal(result, scripts[0])
  assert.deepEqual(calls.select[0], {
    message: 'Select a script',
    items: [
      { label: 'dev', value: scripts[0], detail: 'nuxt dev' },
      { label: 'build', value: scripts[1], detail: 'nuxt build' },
      {
        icon: '…',
        label: 'Run with arguments',
        value: RUN_WITH_ARGUMENTS,
        action: true,
      },
      { icon: '←', label: 'Back to projects', value: null, action: true },
    ],
    default: undefined,
  })
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
  assert.equal(calls.select[0].items[0].hint, undefined)
})

test('chooseScript asks which script to run with arguments', async () => {
  const scripts = [{ name: 'dev', command: 'nuxt dev' }]
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseScript(scripts, { forArguments: true })

  assert.equal(calls.select[0].message, 'Run which script with arguments?')
  assert.deepEqual(
    calls.select[0].items.map(item => item.label),
    ['dev', 'Back to scripts'],
  )
})

test('chooseScript supports an empty script list', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })

  const result = await prompts.chooseScript([])

  assert.equal(result, null)
  assert.deepEqual(calls.select[0].items, [
    { icon: '←', label: 'Back to projects', value: null, action: true },
  ])
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

test('waitForBack uses its default message', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  const result = await prompts.waitForBack()

  assert.equal(result, true)
  assert.deepEqual(calls.select[0], {
    message: 'Return to projects',
    items: [{ icon: '←', label: 'Back', value: true }],
    searchable: false,
  })
})

test('waitForBack accepts a custom message, header and body', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })
  const header = () => []
  const body = [['Could not read package.json', 'red']]

  await prompts.waitForBack('Return to scripts', { header, body })

  assert.equal(calls.select[0].message, 'Return to scripts')
  assert.equal(calls.select[0].header, header)
  assert.deepEqual(calls.select[0].body, body)
})

test('waitAfterCommand offers to run again first', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  const result = await prompts.waitAfterCommand()

  assert.equal(result, true)
  assert.deepEqual(calls.select[0], {
    message: 'What next?',
    items: [
      { icon: '↻', label: 'Run again', value: true },
      { icon: '←', label: 'Back to scripts', value: false },
    ],
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
