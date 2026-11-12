import test from 'node:test'
import assert from 'node:assert/strict'

import { formatHelp, parseCliArgs, splitArguments } from '../lib/args.js'
import { ACCENTS, createUi } from '../lib/ui.js'

test('parseCliArgs returns no options for an empty command line', () => {
  assert.deepEqual({ ...parseCliArgs([]) }, {})
})

test('parseCliArgs reads long and short flags', () => {
  assert.deepEqual(
    { ...parseCliArgs(['-w', '/projects', '-v', '-h']) },
    { workspace: '/projects', version: true, help: true },
  )
  assert.deepEqual(
    { ...parseCliArgs(['--workspace=/projects', '--config-path', '--reset']) },
    { workspace: '/projects', 'config-path': true, reset: true },
  )
  assert.deepEqual({ ...parseCliArgs(['--no-mouse']) }, { 'no-mouse': true })
  assert.deepEqual(
    { ...parseCliArgs(['--set-mouse', 'off']) },
    { 'set-mouse': 'off' },
  )
  assert.throws(
    () => parseCliArgs(['--set-mouse', 'no']),
    /Use --set-mouse on or --set-mouse off, not "no"\.\n.*--help/,
  )
})

test('parseCliArgs reads alias options', () => {
  assert.deepEqual(
    { ...parseCliArgs(['--add-alias', 'dev', '--list-aliases']) },
    { 'add-alias': 'dev', 'list-aliases': true },
  )
  assert.deepEqual(
    { ...parseCliArgs(['--remove-alias=dev']) },
    { 'remove-alias': 'dev' },
  )
})

test('parseCliArgs explains how to get help for invalid input', () => {
  for (const args of [['--nope'], ['--workspace'], ['-x', 'web']]) {
    assert.throws(
      () => parseCliArgs(args),
      error => {
        assert.match(error.message, /dev-workspace --help/)
        assert.match(error.cause.code, /^ERR_PARSE_ARGS/)
        return true
      },
    )
  }
})

test('formatHelp documents every option', () => {
  for (const flag of [
    '--workspace',
    '--list-workspaces',
    '--remove-workspace',
    '--no-mouse',
    '--set-mouse',
    '--set-color',
    '--set-depth',
    '--config-path',
    '--clear-history',
    '--add-alias',
    '--remove-alias',
    '--list-aliases',
    '--reset',
    '--version',
    '--help',
    'DEV_WORKSPACE_CONFIG',
  ]) {
    assert.ok(formatHelp().includes(flag), flag)
  }
})

test('formatHelp defaults to plain text', () => {
  assert.equal(
    formatHelp(),
    `
  Usage: dev-workspace [options] [project [script] [-- arguments]]
         dws [options] [project [script] [-- arguments]]

  Browse the projects in your workspace and run their scripts.

  With a project, open its scripts directly; with a script too, run it and
  exit with its exit code. The project can be shortened to any prefix that
  matches only one project. Arguments after -- are passed to the script.

  Examples:
    dws web                  Open the scripts of the "web" project
    dws web dev              Run the "dev" script of "web"
    dws web dev -- --port 4000

  Options:
    -w, --workspace <name|path>
                             Use a saved workspace, or <path> (saved too)
        --list-workspaces    List the saved workspaces
        --remove-workspace <name>
                             Forget a saved workspace
        --no-mouse           Use only the keyboard in menus, this time
        --set-mouse <on|off>
                             Save whether menus use the mouse
        --set-color <name>   Save the accent colour: cyan, blue, purple,
                             magenta, pink, orange, teal, sky, lavender,
                             coral, gold, bold
        --set-depth <1-3>    Save how many folder levels to search for
                             projects (1, the default, lists only the
                             workspace's own subfolders)
        --config-path        Print the configuration file location
        --clear-history      Forget recently used projects and scripts
        --add-alias <name>   Create another command that starts the CLI
        --remove-alias <name>
                             Delete an alias created with --add-alias
        --list-aliases       List the available commands
        --reset              Delete the saved configuration, history and
                             aliases
    -v, --version            Print the version
    -h, --help               Show this help

  Environment:
    DEV_WORKSPACE_CONFIG     Use a custom configuration file path
    NO_COLOR                 Turn colours off
    FORCE_COLOR              Turn colours on, even when output is not
                             a terminal (0 turns them off)
`,
  )
})

test('formatHelp stays plain when colors are disabled', () => {
  const { color } = createUi({ useColors: false })

  assert.equal(formatHelp(color), formatHelp())
  assert.ok(!formatHelp(color).includes('\x1b['))
})

test('formatHelp applies colors to headings, commands, options and environment', () => {
  const colored = formatHelp((value, shade) => `[${shade}]${value}[/${shade}]`)

  assert.ok(colored.includes('[bold]Usage:[/bold]'))
  assert.ok(colored.includes('[accent]dev-workspace[/accent]'))
  assert.ok(colored.includes('[accent]dws[/accent]'))
  assert.ok(colored.includes('[bold]Examples:[/bold]'))
  assert.ok(colored.includes('[accent]dws web[/accent]'))
  assert.ok(colored.includes('[bold]Options:[/bold]'))
  assert.ok(
    colored.includes('[accent]-w, --workspace[/accent] [dim]<name|path>[/dim]'),
  )
  assert.ok(colored.includes('Use a saved workspace, or <path>'))
  assert.ok(colored.includes('[bold]Environment:[/bold]'))
  assert.ok(colored.includes('[accent]DEV_WORKSPACE_CONFIG[/accent]'))
})

test('parseCliArgs reads a project and a script for direct mode', () => {
  assert.deepEqual({ ...parseCliArgs(['web']) }, { project: 'web' })
  assert.deepEqual(
    { ...parseCliArgs(['-w', '/projects', 'web', 'dev']) },
    { workspace: '/projects', project: 'web', script: 'dev' },
  )
})

test('parseCliArgs keeps everything after -- as script arguments', () => {
  assert.deepEqual(
    { ...parseCliArgs(['web', 'dev', '--', '--port', '4000', '--', '-w']) },
    {
      project: 'web',
      script: 'dev',
      scriptArgs: ['--port', '4000', '--', '-w'],
    },
  )
  assert.deepEqual(
    { ...parseCliArgs(['web', 'dev', '--']) },
    { project: 'web', script: 'dev', scriptArgs: [] },
  )
})

test('parseCliArgs explains where script arguments go', () => {
  assert.throws(
    () => parseCliArgs(['web', 'dev', '4000']),
    /Unexpected argument "4000"[\s\S]*dws web dev -- 4000[\s\S]*--help/,
  )
  assert.throws(
    () => parseCliArgs(['web', '--', '--port']),
    /need a project and a script/,
  )
})

test('splitArguments splits on whitespace and honours quotes', () => {
  assert.deepEqual(splitArguments(''), [])
  assert.deepEqual(splitArguments('  --port   4000 '), ['--port', '4000'])
  assert.deepEqual(splitArguments(`--name "two words" 'it"s'`), [
    '--name',
    'two words',
    'it"s',
  ])
  assert.deepEqual(splitArguments('--title= "" a""b'), ['--title=', '', 'ab'])
  // No shell is involved, so backslashes are kept, as in Windows paths.
  assert.deepEqual(splitArguments('C:\\dir\\file.txt'), ['C:\\dir\\file.txt'])
  assert.throws(() => splitArguments('"open'), /Close the " quote/)
})

test('parseCliArgs accepts only the accent colours for --set-color', () => {
  for (const name of ACCENTS) {
    assert.deepEqual(
      { ...parseCliArgs(['--set-color', name]) },
      {
        'set-color': name,
      },
    )
  }

  assert.throws(
    () => parseCliArgs(['--set-color', 'green']),
    /Use --set-color with cyan, blue, .*, gold or bold, not "green"\.\n.*--help/,
  )
})

test('parseCliArgs accepts only 1, 2 and 3 for --set-depth', () => {
  for (const depth of ['1', '2', '3']) {
    assert.deepEqual(
      { ...parseCliArgs(['--set-depth', depth]) },
      {
        'set-depth': depth,
      },
    )
  }

  for (const depth of ['0', '4', 'two', '1.5']) {
    assert.throws(
      () => parseCliArgs(['--set-depth', depth]),
      new RegExp(
        `Use --set-depth with 1, 2 or 3, not "${depth}"\\.\\n.*--help`,
      ),
    )
  }
})

test('formatHelp names every accent colour', () => {
  const help = formatHelp().replace(/\s+/g, ' ')

  assert.ok(help.includes(`colour: ${ACCENTS.join(', ')}`), help)
})
