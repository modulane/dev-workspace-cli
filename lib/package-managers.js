// Package manager detection and the details needed to run each one.
//
// detectPackageManager() decides which tool runs a project's scripts: the
// `packageManager` field in package.json first (for example "pnpm@9.1.0"),
// then the lockfile found in the project folder, then npm. It never throws;
// unreadable files simply fall through to the next rule. A package.json that
// starts with a byte order mark is read normally, as npm does.
//
// PACKAGE_MANAGERS lists the supported tools with an install hint for each,
// used by commands.js when a tool is missing. Used by cli.js, which shows the
// detected tool on the project screen and passes it to runCommand().

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parseJson } from './json.js'

export const PACKAGE_MANAGERS = {
  npm: { install: 'Install Node.js with npm, then restart the CLI.' },
  pnpm: {
    install:
      'Install it with "corepack enable pnpm" or "npm install --global pnpm".',
  },
  yarn: {
    install:
      'Install it with "corepack enable yarn" or "npm install --global yarn".',
  },
  bun: { install: 'Install it from https://bun.sh.' },
}

// Checked in this order when a folder holds more than one lockfile.
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
]

async function readPackageManagerField(directory) {
  try {
    const content = await readFile(path.join(directory, 'package.json'), 'utf8')
    const value = parseJson(content)?.packageManager

    if (typeof value !== 'string') return null

    // "pnpm@9.1.0+sha512.abc" -> "pnpm"
    const name = value.trim().split('@')[0]

    return Object.hasOwn(PACKAGE_MANAGERS, name) ? name : null
  } catch {
    return null
  }
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

// Return { name, source }, where source explains why the tool was chosen:
// "packageManager", a lockfile name, or "default".
export async function detectPackageManager(directory) {
  const fromField = await readPackageManagerField(directory)

  if (fromField) return { name: fromField, source: 'packageManager' }

  for (const [lockfile, name] of LOCKFILES) {
    if (await exists(path.join(directory, lockfile))) {
      return { name, source: lockfile }
    }
  }

  return { name: 'npm', source: 'default' }
}
