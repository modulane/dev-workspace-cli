import test from 'node:test'
import assert from 'node:assert/strict'
import { CHANGE_WORKSPACE, createPrompts } from '../lib/prompts.js'

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
})

test('confirmWorkspaceChange defaults to true', async () => {
  const { calls, prompts } = createPromptMocks({ confirm: true })

  const result = await prompts.confirmWorkspaceChange()

  assert.equal(result, true)
  assert.deepEqual(calls.confirm, [
    {
      message: 'Choose a new workspace directory?',
      default: true,
    },
  ])
})

test('chooseProject maps projects and adds workspace and exit choices', async () => {
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
    choices: [
      {
        name: '📁  project-a',
        value: projects[0],
      },
      {
        name: '📁  project-b',
        value: projects[1],
      },
      {
        name: '⚙  Change workspace',
        value: CHANGE_WORKSPACE,
      },
      {
        name: '↩  Exit',
        value: null,
      },
    ],
    pageSize: 15,
    loop: false,
  })
})

test('chooseProject supports an empty project list', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })

  const result = await prompts.chooseProject([])

  assert.equal(result, null)
  assert.deepEqual(calls.select[0].choices, [
    { name: '⚙  Change workspace', value: CHANGE_WORKSPACE },
    { name: '↩  Exit', value: null },
  ])
})

test('chooseScript formats scripts and adds a back choice', async () => {
  const scripts = [
    { name: 'dev', command: 'nuxt dev' },
    { name: 'build', command: 'nuxt build' },
  ]
  const { calls, prompts } = createPromptMocks({ select: scripts[0] })

  const result = await prompts.chooseScript(scripts)

  assert.equal(result, scripts[0])
  assert.deepEqual(calls.select[0], {
    message: 'Select a script',
    choices: [
      {
        name: '▶  dev',
        value: scripts[0],
        description: 'nuxt dev',
      },
      {
        name: '▶  build',
        value: scripts[1],
        description: 'nuxt build',
      },
      {
        name: '↩  Back to projects',
        value: null,
      },
    ],
    pageSize: 15,
    loop: false,
  })
})

test('chooseScript supports an empty script list', async () => {
  const { calls, prompts } = createPromptMocks({ select: null })

  const result = await prompts.chooseScript([])

  assert.equal(result, null)
  assert.deepEqual(calls.select[0].choices, [
    { name: '↩  Back to projects', value: null },
  ])
})

test('waitForBack uses its default message', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  const result = await prompts.waitForBack()

  assert.equal(result, true)
  assert.deepEqual(calls.select[0], {
    message: 'Return to projects',
    choices: [{ name: '↩  Back', value: true }],
  })
})

test('waitForBack accepts a custom message', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  await prompts.waitForBack('Return to scripts')

  assert.equal(calls.select[0].message, 'Return to scripts')
})

test('waitAfterCommand offers a return to project scripts', async () => {
  const { calls, prompts } = createPromptMocks({ select: true })

  const result = await prompts.waitAfterCommand()

  assert.equal(result, true)
  assert.deepEqual(calls.select[0], {
    message: 'What next?',
    choices: [{ name: '↩  Return to project scripts', value: true }],
  })
})

test('chooseProject returns the selected project object', async () => {
  const project = {
    name: 'foo',
    directory: '/projects/foo',
  }

  const prompts = createPrompts({
    select: async ({ choices }) => choices[0].value,
  })

  assert.equal(await prompts.chooseProject([project]), project)
})

test('chooseProject disables folders without a package.json', async () => {
  const projects = [
    { name: 'web', directory: '/projects/web', hasPackageJson: true },
    { name: 'notes', directory: '/projects/notes', hasPackageJson: false },
  ]
  const { calls, prompts } = createPromptMocks({ select: null })

  await prompts.chooseProject(projects)

  assert.deepEqual(calls.select[0].choices.slice(0, 2), [
    { name: '📁  web', value: projects[0] },
    { name: '📁  notes', value: projects[1], disabled: '(no package.json)' },
  ])
})
