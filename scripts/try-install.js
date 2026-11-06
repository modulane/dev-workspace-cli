#!/usr/bin/env node

// Try the first install of the working copy as a new user would get it,
// without publishing it and without touching your own settings:
//
//   node scripts/try-install.js                   first run, ~/dev and ~/projects
//   node scripts/try-install.js --empty-home      no folder to suggest
//   node scripts/try-install.js --legacy          config from before 0.3.0
//   node scripts/try-install.js --again           the same sandbox: second run
//   node scripts/try-install.js --again -- web dev   arguments for dws
//
// Development only: scripts/ is outside the package's "files" list and no
// npm script points here, so none of it is published
// (test/package.test.js checks what the package holds).
//
// It packs the working copy with `npm pack` (so only the files in the
// package's "files" list are included), installs that archive globally into
// a temporary npm prefix, and runs the installed `dws` with a fake home
// folder: HOME, USERPROFILE, APPDATA, LOCALAPPDATA and XDG_CONFIG_HOME all
// point into the sandbox and DEV_WORKSPACE_CONFIG is removed, so the run has
// no configuration and no history, as on a new machine. The fake home has
// sample projects in dev/ and projects/ for the first-run question to offer.
//
// The sandbox is left in the system temp folder so you can look at what was
// written, and replaced by the next run unless --again is given.

import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import spawn from 'cross-spawn'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SANDBOX = path.join(os.tmpdir(), 'dws-try-install')
const PACKAGE_DIR = path.join(SANDBOX, 'pack')
const PREFIX = path.join(SANDBOX, 'npm-global')
const HOME = path.join(SANDBOX, 'home')

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    again: { type: 'boolean' },
    'empty-home': { type: 'boolean' },
    legacy: { type: 'boolean' },
  },
})

// Run a command and stop the script when it fails.
function run(command, args, options = {}) {
  const result = spawn.sync(command, args, { stdio: 'inherit', ...options })

  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }

  return result
}

async function writeProject(directory, scripts, branch) {
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ name: path.basename(directory), scripts }, null, 2)}\n`,
  )

  if (branch) {
    await mkdir(path.join(directory, '.git'), { recursive: true })
    await writeFile(
      path.join(directory, '.git', 'HEAD'),
      `ref: refs/heads/${branch}\n`,
    )
  }
}

async function createHome() {
  await mkdir(HOME, { recursive: true })

  if (!values['empty-home']) {
    const say = text => `node -e "console.log('${text}')"`

    await writeProject(
      path.join(HOME, 'dev', 'storefront'),
      { dev: say('dev server'), build: say('built'), test: say('tests pass') },
      'main',
    )
    await writeProject(
      path.join(HOME, 'dev', 'api'),
      { start: say('api started'), fail: 'node -e "process.exit(1)"' },
      'feat/auth',
    )
    await mkdir(path.join(HOME, 'dev', 'notes'), { recursive: true })
    await writeProject(path.join(HOME, 'projects', 'blog'), {
      dev: say('blog'),
    })
  }

  if (values.legacy) {
    const legacyDir = path.join(HOME, '.dev-workspace-cli')

    await mkdir(legacyDir, { recursive: true })
    await writeFile(
      path.join(legacyDir, 'config.json'),
      `${JSON.stringify({ workspace: path.join(HOME, 'dev') })}\n`,
    )
  }
}

async function install() {
  await rm(SANDBOX, { recursive: true, force: true })
  await mkdir(PACKAGE_DIR, { recursive: true })

  console.log('Packing the working copy…')
  const packed = run(
    'npm',
    ['pack', '--json', '--pack-destination', PACKAGE_DIR],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  )
  // npm 11 prints an array, npm 12 an object keyed by package name.
  const report = JSON.parse(packed.stdout)
  const [{ filename }] = Array.isArray(report) ? report : Object.values(report)

  console.log(`Installing ${filename} into ${PREFIX}…`)
  run('npm', [
    'install',
    '--global',
    '--prefix',
    PREFIX,
    '--no-audit',
    '--no-fund',
    path.join(PACKAGE_DIR, filename),
  ])

  await createHome()
}

const bin =
  process.platform === 'win32'
    ? path.join(PREFIX, 'dws.cmd')
    : path.join(PREFIX, 'bin', 'dws')

if (!values.again) {
  await install()
} else if (!existsSync(bin)) {
  console.error('No sandbox yet: run without --again first.')
  process.exit(1)
}

const env = {
  ...process.env,
  HOME,
  USERPROFILE: HOME,
  APPDATA: path.join(HOME, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(HOME, 'AppData', 'Local'),
  XDG_CONFIG_HOME: path.join(HOME, '.config'),
}
delete env.DEV_WORKSPACE_CONFIG

console.log(`\nRunning the installed dws with home ${HOME}\n`)

// cross-spawn runs the .cmd shim on Windows with the arguments escaped.
const result = spawn.sync(bin, positionals, {
  stdio: 'inherit',
  env,
  cwd: HOME,
})

console.log(`\nSandbox left in ${SANDBOX}`)
process.exit(result.status ?? 1)
