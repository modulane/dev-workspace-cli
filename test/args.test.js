import test from 'node:test'
import assert from 'node:assert/strict'

import { HELP_TEXT, parseCliArgs, splitArguments } from '../lib/args.js'

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

test('HELP_TEXT documents every option', () => {
  for (const flag of [
    '--workspace',
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
    assert.ok(HELP_TEXT.includes(flag), flag)
  }
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
