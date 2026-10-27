// Package manager detection and the details needed to run each one.
//
// detectPackageManager() decides which tool runs a project's scripts: the
// `packageManager` field in package.json first (for example "pnpm@9.1.0"),
// then the lockfile found in the project folder, then npm. It never throws;
// unreadable files simply fall through to the next rule.
//
// It also reports whether the tool runs custom pre/post scripts (`runsHooks`).
// Every supported tool does except Yarn 2 and later, recognised by a
// packageManager field of "yarn@2" or later, or by the `__metadata:` block
// that starts their yarn.lock (Yarn 1 lockfiles never have one).
//
// PACKAGE_MANAGERS lists the supported tools. installHint() tells how to
// install one, used by commands.js when a tool is missing. For pnpm and Yarn
// it depends on the Node.js version: Node.js 25 and later no longer ship
// Corepack, so `corepack enable` only works there once Corepack is installed.
// Used by cli.js, which shows the detected tool on the project screen and
// passes it to runCommand().

import { access, open, readFile } from 'node:fs/promises'
import path from 'node:path'

// `corepack: true` marks tools that Corepack can enable.
export const PACKAGE_MANAGERS = {
  npm: { install: 'Install Node.js with npm, then restart the CLI.' },
  pnpm: { corepack: true },
  yarn: { corepack: true },
  bun: { install: 'Install it from https://bun.sh.' },
}

const LAST_NODE_WITH_COREPACK = 24

export function installHint(name, nodeVersion = process.versions.node) {
  if (!Object.hasOwn(PACKAGE_MANAGERS, name)) {
    return 'Install it, then restart the CLI.'
  }

  if (!PACKAGE_MANAGERS[name].corepack) return PACKAGE_MANAGERS[name].install

  if (Number.parseInt(nodeVersion, 10) > LAST_NODE_WITH_COREPACK) {
    return `Install it with "npm install --global ${name}", or with "npm install --global corepack" followed by "corepack enable ${name}".`
  }

  return `Install it with "corepack enable ${name}" or "npm install --global ${name}".`
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
    const value = JSON.parse(content)?.packageManager

    if (typeof value !== 'string') return null

    // "pnpm@9.1.0+sha512.abc" -> name "pnpm", major 9
    const [name, version = ''] = value.trim().split('@')
    const major = /^\d+/.exec(version)?.[0]

    if (!Object.hasOwn(PACKAGE_MANAGERS, name)) return null

    return { name, major: major === undefined ? null : Number(major) }
  } catch {
    return null
  }
}

// Yarn 2+ lockfiles start, after a comment header, with `__metadata:`.
// Only the beginning is read, since lockfiles can be large.
async function hasModernYarnLockfile(directory) {
  let handle

  try {
    handle = await open(path.join(directory, 'yarn.lock'))
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(1024),
      0,
      1024,
      0,
    )

    return /^__metadata:/m.test(buffer.toString('utf8', 0, bytesRead))
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

// Yarn 2 and later no longer run custom pre/post scripts; every other
// supported tool does. A version in the packageManager field decides;
// otherwise yarn.lock does.
async function runsHooks(directory, name, major) {
  if (name !== 'yarn') return true
  if (major !== null) return major < 2

  return !(await hasModernYarnLockfile(directory))
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

// Return { name, source, runsHooks }, where source explains why the tool was
// chosen: "packageManager", a lockfile name, or "default".
export async function detectPackageManager(directory) {
  const fromField = await readPackageManagerField(directory)

  if (fromField) {
    return {
      name: fromField.name,
      source: 'packageManager',
      runsHooks: await runsHooks(directory, fromField.name, fromField.major),
    }
  }

  for (const [lockfile, name] of LOCKFILES) {
    if (await exists(path.join(directory, lockfile))) {
      return {
        name,
        source: lockfile,
        runsHooks: await runsHooks(directory, name, null),
      }
    }
  }

  return { name: 'npm', source: 'default', runsHooks: true }
}
