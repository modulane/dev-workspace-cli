// Reading the workspace from disk: projects, scripts and Git branches.
// Used by cli.js and commands.js.

import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { parseJson } from './json.js'
import { needsArguments } from './script-arguments.js'

// Check whether a path points to an accessible directory.
export async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
  }
}

// Undo what a shell would have done to the text before passing it on.
export function normalizePathInput(
  value,
  { platform = process.platform, homeDirectory = os.homedir() } = {},
) {
  let result = value.trim()
  const quote = result[0]

  if (
    result.length >= 2 &&
    (quote === '"' || quote === "'") &&
    result.at(-1) === quote
  ) {
    result = result.slice(1, -1)
  }

  // On Windows, both / and \ separate the home directory from the rest.
  const separators = platform === 'win32' ? ['/', '\\'] : ['/']

  if (
    result === '~' ||
    separators.some(separator => result.startsWith(`~${separator}`))
  ) {
    result = homeDirectory + result.slice(1)
  }

  // On Windows, \ is the path separator, never an escape.
  if (platform !== 'win32') {
    result = result.replaceAll('\\ ', ' ')
  }

  return result
}

// Resolve typed text to an absolute directory. The text is tried as typed
// first, so a folder whose real name contains quotes or backslashes still
// works, then in its normalized form. `exists` is false when neither is a
// directory, and `directory` is then the path the user most likely meant.
export async function resolveDirectoryInput(
  value,
  { isDirectory: check = isDirectory, ...options } = {},
) {
  const typed = path.resolve(value.trim())

  if (await check(typed)) return { directory: typed, exists: true }

  const normalized = normalizePathInput(value, options)

  // An empty pair of quotes would otherwise resolve to the current folder.
  if (!normalized) return { directory: typed, exists: false }

  const directory = path.resolve(normalized)

  return {
    directory,
    exists: directory !== typed && (await check(directory)),
  }
}

// The folders people usually keep their projects in, in the order offered.
export const SUGGESTED_FOLDERS = ['dev', 'projects', 'code', 'src', 'repos']

// The drives a Windows folder can be on, A and B being floppy drives.
const DRIVES = [...'CDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => `${letter}:\\`)

// How long a drive may take to answer: a disconnected network drive can
// otherwise hold the first run up for seconds.
const DRIVE_TIMEOUT = 500

// Whether `check` finds a folder, false when it takes longer than `timeout`.
function checkWithin(check, folder, timeout) {
  let timer

  return Promise.race([
    check(folder),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeout)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function hasFile(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

// The common workspace folders that exist, as absolute paths, each once:
// the folder above the current one when the CLI runs inside a project, the
// suggested folders in the home directory, then, on Windows, at the root of
// each drive (E:\dev).
export async function suggestWorkspaces({
  homeDirectory = os.homedir(),
  cwd = process.cwd(),
  platform = process.platform,
  isDirectory: check = isDirectory,
  isFile = hasFile,
  timeout = DRIVE_TIMEOUT,
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const inProject =
    pathApi.dirname(cwd) !== cwd &&
    (await isFile(pathApi.join(cwd, 'package.json')))
  const home = SUGGESTED_FOLDERS.map(name => pathApi.join(homeDirectory, name))
  let drives = []

  if (platform === 'win32') {
    const found = await Promise.all(
      DRIVES.map(drive => checkWithin(check, drive, timeout)),
    )

    drives = DRIVES.filter((_, index) => found[index]).flatMap(drive =>
      SUGGESTED_FOLDERS.map(name => pathApi.join(drive, name)),
    )
  }

  const candidates = [...(inProject ? [pathApi.dirname(cwd)] : []), ...home]
  const found = await Promise.all([
    ...candidates.map(folder => check(folder)),
    ...drives.map(folder => checkWithin(check, folder, timeout)),
  ])
  // Windows paths ignore case: E:\Dev and e:\dev are one folder.
  const key = folder => (platform === 'win32' ? folder.toLowerCase() : folder)
  const seen = new Set()

  return [...candidates, ...drives].filter((folder, index) => {
    if (!found[index] || seen.has(key(folder))) return false

    seen.add(key(folder))
    return true
  })
}

// The Git folder of a project: .git itself, or where a .git file points.
async function gitDirectory(directory) {
  const dotGit = path.join(directory, '.git')

  if (await isDirectory(dotGit)) return dotGit

  const match = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))

  return match ? path.resolve(directory, match[1]) : null
}

// The current branch of a project, the short commit when HEAD is detached,
// or null when the project is not in Git or HEAD cannot be read.
export async function readGitBranch(directory) {
  try {
    const gitDir = await gitDirectory(directory)

    if (!gitDir) return null

    const head = (await readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim()
    const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)

    if (branch) return branch[1]

    return /^[0-9a-f]{7,}$/i.test(head) ? head.slice(0, 7) : null
  } catch {
    return null
  }
}

// Tool and editor folders (.git, .vscode, .idea, …) and installed
// dependencies can sit in a workspace but are never projects.
function isNeverProject(name) {
  return name.startsWith('.') || name === 'node_modules'
}

async function hasPackageJson(directory) {
  try {
    return (await stat(path.join(directory, 'package.json'))).isFile()
  } catch {
    return false
  }
}

// Ignore case and compare numbers by value, so "app2" comes before "App10".
function compareNames(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

// A link to a folder (a symbolic link, or a junction on Windows) counts as the
// folder itself. readdir() describes the link, not its target, so follow it;
// a broken link or a link to a file is not a folder.
async function isFolder(root, entry) {
  if (entry.isDirectory()) return true

  return entry.isSymbolicLink() && isDirectory(path.join(root, entry.name))
}

// The package folders of a pnpm-workspace.yaml: the `packages` list, in
// block (`- 'apps/*'`) or flow (`['apps/*']`) style. Only that key is read,
// so a small reader does instead of a YAML parser.
export function parsePnpmWorkspace(content) {
  const lines = (
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  ).split(/\r?\n/)
  const start = lines.findIndex(line => /^packages\s*:/.test(line))

  if (start === -1) return []

  const unquote = value => {
    const text = value.trim()
    const quoted = /^(['"])(.*)\1$/.exec(text)

    // A comment can follow a value that has no quotes.
    return quoted ? quoted[2] : text.replace(/\s+#.*$/, '').trim()
  }
  const rest = lines[start].replace(/^packages\s*:/, '').trim()

  if (rest.startsWith('[')) {
    return rest
      .replace(/^\[/, '')
      .replace(/\].*$/, '')
      .split(',')
      .map(unquote)
      .filter(Boolean)
  }

  const patterns = []

  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    // Items may be indented or not (`- apps/*` right under `packages:`).
    const item = /^\s*-\s+(.+)$/.exec(line)

    // The list ends at the next key.
    if (!item) break

    patterns.push(unquote(item[1]))
  }

  return patterns.filter(Boolean)
}

// The package folder patterns of a monorepo, or null for any other project:
// the `workspaces` field of package.json (npm, Yarn and Bun: a list, or an
// object with a `packages` list), else the `packages` of pnpm-workspace.yaml.
export async function readWorkspacePatterns(directory) {
  let field

  try {
    field = parseJson(
      await readFile(path.join(directory, 'package.json'), 'utf8'),
    )?.workspaces
  } catch {
    // An unreadable package.json is reported when its scripts are read.
  }

  const list = Array.isArray(field) ? field : field?.packages
  let patterns = Array.isArray(list)
    ? list.filter(pattern => typeof pattern === 'string')
    : []

  if (patterns.length === 0) {
    try {
      patterns = parsePnpmWorkspace(
        await readFile(path.join(directory, 'pnpm-workspace.yaml'), 'utf8'),
      )
    } catch {
      // No pnpm workspace either.
    }
  }

  return patterns.length > 0 ? patterns : null
}

// A workspace pattern as a regular expression for a folder path with /:
// `*` matches within one folder name, `**` any number of folders.
function patternToRegExp(pattern) {
  let source = ''

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]

    if (character === '*' && pattern[index + 1] === '*') {
      // `**/` may also match no folder at all.
      const slash = pattern[index + 2] === '/'

      source += slash ? '(?:.*/)?' : '.*'
      index += slash ? 2 : 1
    } else if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }

  return new RegExp(`^${source}$`)
}

// How many folders deep a `**` pattern is followed.
const MAX_PACKAGE_DEPTH = 5

// Clean a pattern up: `./apps/*/` and `apps/*/package.json` mean `apps/*`.
function cleanPattern(pattern) {
  return pattern
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/package\.json$/, '')
    .replace(/\/+$/, '')
}

// The folders under `base` (a path with /, relative to `root`) down to
// `levels` more folders, never entering node_modules or dot-folders.
async function foldersUnder(root, base, levels) {
  if (levels === 0) return []

  let entries

  try {
    entries = await readdir(path.join(root, base), { withFileTypes: true })
  } catch {
    return []
  }

  const found = await Promise.all(
    entries
      .filter(entry => !isNeverProject(entry.name))
      .map(async entry => {
        if (!(await isFolder(path.join(root, base), entry))) return []

        const relative = base ? `${base}/${entry.name}` : entry.name

        return [relative, ...(await foldersUnder(root, relative, levels - 1))]
      }),
  )

  return found.flat()
}

// The packages of a monorepo: the folders its workspace patterns match
// (patterns starting with ! leave folders out) that have a package.json,
// each named by its path in the monorepo (`packages/api`), with the `name`
// from its package.json as `packageName`, sorted by path.
export async function getPackages(directory, patterns) {
  const cleaned = patterns.map(cleanPattern)
  const include = cleaned.filter(pattern => !pattern.startsWith('!'))
  const exclude = cleaned
    .filter(pattern => pattern.startsWith('!'))
    .map(pattern => patternToRegExp(cleanPattern(pattern.slice(1))))
  const paths = new Set()

  await Promise.all(
    include.map(async pattern => {
      const parts = pattern.split('/')
      const wild = parts.findIndex(part => /[*?]/.test(part))

      if (wild === -1) {
        if (pattern && pattern !== '.') paths.add(pattern)
        return
      }

      const base = parts.slice(0, wild).join('/')
      const levels = parts.includes('**')
        ? MAX_PACKAGE_DEPTH
        : parts.length - wild
      const matcher = patternToRegExp(pattern)

      for (const folder of await foldersUnder(directory, base, levels)) {
        if (matcher.test(folder)) paths.add(folder)
      }
    }),
  )

  const packages = await Promise.all(
    [...paths]
      .filter(folder => !exclude.some(matcher => matcher.test(folder)))
      .map(async folder => {
        const packageDirectory = path.join(directory, ...folder.split('/'))

        if (!(await hasPackageJson(packageDirectory))) return null

        let packageName

        try {
          packageName = parseJson(
            await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
          )?.name
        } catch {
          // The name is only shown; its scripts report a broken file.
        }

        return {
          path: folder,
          directory: packageDirectory,
          ...(typeof packageName === 'string' && { packageName }),
        }
      }),
  )

  return packages.filter(Boolean).sort((a, b) => compareNames(a.path, b.path))
}

// How deep getProjects() looks for projects: 1 lists the immediate
// subfolders only.
export const DEFAULT_DEPTH = 1
export const MAX_DEPTH = 3

// The projects in `folder`, `level` folders below the workspace. A folder
// with a package.json is a project, and the search stops there. Any other
// folder is searched in turn while `level` is under `depth`; it is replaced
// by what it holds when that includes a project, and listed itself, as a
// folder without a package.json, otherwise.
async function findProjects(folder, prefix, level, depth) {
  const entries = await readdir(folder, { withFileTypes: true })

  const found = await Promise.all(
    entries
      .filter(entry => !isNeverProject(entry.name))
      .map(async entry => {
        if (!(await isFolder(folder, entry))) return []

        const directory = path.join(folder, entry.name)
        // Always with /, so a name reads the same on every system.
        const name = prefix + entry.name

        if (await hasPackageJson(directory)) {
          const workspaces = await readWorkspacePatterns(directory)

          return [
            {
              name,
              directory,
              hasPackageJson: true,
              ...(workspaces && { workspaces }),
            },
          ]
        }

        if (level < depth) {
          // A subfolder that cannot be read simply holds no projects.
          const inside = await findProjects(
            directory,
            `${name}/`,
            level + 1,
            depth,
          ).catch(() => [])

          if (inside.some(project => project.hasPackageJson)) return inside
        }

        return [{ name, directory, hasPackageJson: false }]
      }),
  )

  return found.flat()
}

// List the projects in the workspace: its subfolders, and links to them,
// down to `depth` levels (DEFAULT_DEPTH to MAX_DEPTH), as findProjects()
// describes. Projects found deeper are named by their path in the workspace
// (`clients/acme/web`). Projects with a package.json come first, then the
// others, each group sorted by name.
export async function getProjects(root, { depth = DEFAULT_DEPTH } = {}) {
  const levels = Math.min(MAX_DEPTH, Math.max(1, Math.trunc(depth) || 1))
  const projects = await findProjects(root, '', 1, levels)

  return projects.sort(
    (a, b) =>
      Number(b.hasPackageJson) - Number(a.hasPackageJson) ||
      compareNames(a.name, b.name),
  )
}

// Read npm scripts from a project's package.json. With `groupHooks: false`,
// pre/post hooks are listed as ordinary scripts.
export async function getScripts(directory, { groupHooks = true } = {}) {
  const packagePath = path.join(directory, 'package.json')
  let content

  try {
    content = await readFile(packagePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []

    throw new Error(`Cannot read ${packagePath}: ${error.message}`, {
      cause: error,
    })
  }

  let packageJson

  try {
    packageJson = parseJson(content)
  } catch (error) {
    throw new Error(`Invalid JSON in ${packagePath}: ${error.message}`, {
      cause: error,
    })
  }

  if (
    packageJson === null ||
    typeof packageJson !== 'object' ||
    Array.isArray(packageJson)
  ) {
    throw new Error(`Invalid ${packagePath}: expected a JSON object.`)
  }

  const scripts = packageJson.scripts

  if (scripts == null) return []

  if (typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw new Error(`Invalid ${packagePath}: "scripts" must be an object.`)
  }

  const list = Object.entries(scripts)
    .filter(([, command]) => typeof command === 'string')
    .map(([name, command]) =>
      needsArguments(command)
        ? { name, command, needsArguments: true }
        : { name, command },
    )

  return groupHooks ? groupLifecycleScripts(list) : list
}

const HOOK_PREFIXES = ['pre', 'post']

// Package managers run "prebuild" before "build" and "postbuild" after it.
// When the main script exists, attach its hooks to it as `hooks` instead of
// listing them as separate entries. A hook without its main script (for
// example "postinstall" alone) stays an ordinary script.
function groupLifecycleScripts(scripts) {
  const names = new Set(scripts.map(script => script.name))

  const isHook = name =>
    HOOK_PREFIXES.some(
      prefix =>
        name.length > prefix.length &&
        name.startsWith(prefix) &&
        names.has(name.slice(prefix.length)),
    )

  return scripts
    .filter(script => !isHook(script.name))
    .map(script => {
      const hooks = HOOK_PREFIXES.map(prefix => prefix + script.name).filter(
        hook => names.has(hook),
      )

      return hooks.length > 0 ? { ...script, hooks } : script
    })
}
