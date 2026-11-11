// Custom command aliases: `--add-alias`, `--remove-alias` and `--list-aliases`.
// Used by cli.js.

import { chmod, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const COMMAND = 'dev-workspace'
const PACKAGE = '@modulane/dev-workspace-cli'

// Every launcher contains this marker, so the CLI only ever lists or deletes
// files it created itself.
const MARKER = 'dev-workspace-cli alias'
const MARKER_PATTERN = new RegExp(`${MARKER}: (\\S+) ->`)

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i

// Names shipped with the package, and shell builtins that would shadow it.
const RESERVED_NAMES = new Set([
  COMMAND,
  'dws',
  'alias',
  'cd',
  'eval',
  'exec',
  'exit',
  'export',
  'set',
  'source',
  'type',
  'unset',
])

function defaults(options = {}) {
  return {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
  }
}

function getPathDirectories({ env, platform }) {
  const value = env.PATH ?? env.Path ?? ''

  return value.split(platform === 'win32' ? ';' : ':').filter(Boolean)
}

function getExtensions({ env, platform }) {
  if (platform !== 'win32') return ['']

  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)

  // PowerShell also runs .ps1 files found on PATH.
  return [...extensions, '.PS1'].map(extension => extension.toLowerCase())
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

// An alias is a launcher file written next to the installed `dev-workspace`
// command: three on Windows (cmd, PowerShell, Git Bash), one shell script
// elsewhere. Every exported function takes `{ env, platform }`, so tests can
// simulate any system and PATH.
//
// Return the first file on PATH that runs as `name`, or null.
export async function findCommand(name, options) {
  const settings = defaults(options)

  for (const directory of getPathDirectories(settings)) {
    for (const extension of getExtensions(settings)) {
      const file = path.join(directory, name + extension)

      if (await isFile(file)) return file
    }
  }

  return null
}

// Aliases are created next to the installed dev-workspace command, because
// that directory is known to be on PATH whatever installed the package.
async function findBinDirectory(options) {
  const launcher = await findCommand(COMMAND, options)

  if (!launcher) {
    throw new Error(
      `Could not find the ${COMMAND} command on your PATH. ` +
        `Aliases need a global install: npm install --global ${PACKAGE}`,
    )
  }

  return path.dirname(launcher)
}

function validateName(name) {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid alias "${name}": use up to 32 letters, digits, ".", "_" or "-", starting with a letter or digit.`,
    )
  }

  if (RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`"${name}" is reserved and cannot be used as an alias.`)
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function shellLauncher(name, target) {
  const quoted = shellQuote(target)

  return [
    '#!/bin/sh',
    `# ${MARKER}: ${name} -> ${COMMAND}`,
    `if [ -x ${quoted} ]; then`,
    `  exec ${quoted} "$@"`,
    'fi',
    `echo "The \\"${name}\\" alias points to ${target}, which no longer exists." >&2`,
    `echo "Reinstall ${PACKAGE} or delete $0." >&2`,
    'exit 127',
    '',
  ].join('\n')
}

// A batch file that starts another batch file without `call` never returns,
// so the lines after it only run when the target is missing.
function cmdLauncher(name, target) {
  return [
    '@echo off',
    `rem ${MARKER}: ${name} -> ${COMMAND}`,
    `if not exist "${target}" goto missing`,
    `"${target}" %*`,
    ':missing',
    `echo The "${name}" alias points to ${target}, which no longer exists. 1>&2`,
    `echo Reinstall ${PACKAGE} or delete "%~f0". 1>&2`,
    'exit /b 127',
    '',
  ].join('\r\n')
}

function powershellLauncher(name, target) {
  const quoted = `'${target.replaceAll("'", "''")}'`

  return [
    `# ${MARKER}: ${name} -> ${COMMAND}`,
    `$target = ${quoted}`,
    'if (Test-Path -LiteralPath $target) {',
    '  & $target @args',
    '  exit $LASTEXITCODE',
    '}',
    `[Console]::Error.WriteLine("The ""${name}"" alias points to $target, which no longer exists.")`,
    `[Console]::Error.WriteLine("Reinstall ${PACKAGE} or delete $PSCommandPath.")`,
    'exit 127',
    '',
  ].join('\r\n')
}

// Describe the launcher files for an alias. Windows needs one per shell:
// cmd.exe, PowerShell, and Git Bash (no extension).
async function getLaunchers(name, binDirectory, { platform }) {
  const target = path.join(binDirectory, COMMAND)

  if (platform !== 'win32') {
    return [
      {
        file: path.join(binDirectory, name),
        content: shellLauncher(name, target),
        executable: true,
      },
    ]
  }

  const powershellTarget = (await isFile(`${target}.ps1`))
    ? `${target}.ps1`
    : `${target}.cmd`

  return [
    {
      file: path.join(binDirectory, `${name}.cmd`),
      content: cmdLauncher(name, `${target}.cmd`),
    },
    {
      file: path.join(binDirectory, `${name}.ps1`),
      content: powershellLauncher(name, powershellTarget),
    },
    {
      file: path.join(binDirectory, name),
      content: shellLauncher(name, target.replaceAll('\\', '/')),
      executable: true,
    },
  ]
}

// Return the alias name a file belongs to, or null if it is not a launcher.
async function readAliasName(file) {
  try {
    const info = await stat(file)

    if (!info.isFile() || info.size > 4096) return null

    return (await readFile(file, 'utf8')).match(MARKER_PATTERN)?.[1] ?? null
  } catch {
    return null
  }
}

function permissionError(error, binDirectory) {
  if (error.code !== 'EACCES' && error.code !== 'EPERM') return error

  return new Error(
    `No permission to write to ${binDirectory}. ` +
      'Run the command again with the permissions you used to install the CLI.',
    { cause: error },
  )
}

// Create launcher files for a new alias and return their paths.
export async function addAlias(name, options) {
  const settings = defaults(options)

  validateName(name)

  const binDirectory = await findBinDirectory(settings)
  const launchers = await getLaunchers(name, binDirectory, settings)

  if ((await readAliasName(launchers[0].file)) === name) {
    throw new Error(`The alias "${name}" already exists.`)
  }

  // Also check the launcher paths themselves: on Windows an extensionless
  // file is not found through PATHEXT but would still be overwritten.
  let existing = await findCommand(name, settings)

  for (const { file } of launchers) {
    if (!existing && (await isFile(file))) existing = file
  }

  if (existing) {
    throw new Error(
      `"${name}" is already a command (${existing}). Choose another name.`,
    )
  }

  try {
    for (const { file, content, executable } of launchers) {
      await writeFile(file, content, 'utf8')

      if (executable) await chmod(file, 0o755)
    }
  } catch (error) {
    throw permissionError(error, binDirectory)
  }

  return launchers.map(({ file }) => file)
}

// Delete the launcher files of an alias and return their paths.
export async function removeAlias(name, options) {
  const settings = defaults(options)

  if (!NAME_PATTERN.test(name)) {
    throw new Error(`No alias named "${name}" was found.`)
  }

  const binDirectory = await findBinDirectory(settings)
  const launchers = await getLaunchers(name, binDirectory, settings)
  const owned = []

  for (const { file } of launchers) {
    if ((await readAliasName(file)) === name) owned.push(file)
  }

  if (owned.length === 0) {
    throw new Error(`No alias named "${name}" was found in ${binDirectory}.`)
  }

  try {
    for (const file of owned) await rm(file)
  } catch (error) {
    throw permissionError(error, binDirectory)
  }

  return owned
}

// Return the names of all aliases created by the CLI, sorted.
export async function listAliases(options) {
  const settings = defaults(options)

  let binDirectory

  try {
    binDirectory = await findBinDirectory(settings)
  } catch {
    return []
  }

  const names = new Set()

  for (const entry of await readdir(binDirectory)) {
    const name = await readAliasName(path.join(binDirectory, entry))

    if (name) names.add(name)
  }

  return [...names].sort((a, b) => a.localeCompare(b))
}

// Delete every alias created by the CLI and return their names.
export async function removeAllAliases(options) {
  const names = await listAliases(options)

  for (const name of names) await removeAlias(name, options)

  return names
}
