// Reading the workspace from disk.
//
// getProjects() lists the workspace's immediate subfolders, and links to
// folders (symbolic links, and junctions on Windows), as projects, leaving
// out folders that are never projects (dot-folders such as .git, and
// node_modules). Each project records whether it has a package.json; those
// without one are sorted after the others so the menu can show them dimmed.
// getScripts() reads the scripts from a project's package.json, with clear
// errors for unreadable or invalid files (a leading byte order mark is
// ignored, as npm does), and attaches pre/post hooks to their main script
// instead of listing them separately. cli.js turns that off with
// `{ groupHooks: false }` for package managers that never run the hooks
// (Yarn 2+), so the hooks stay listed and runnable on their own.
//
// readGitBranch() reads a project's current Git branch straight from
// .git/HEAD, without running Git (a .git file, as in worktrees and
// submodules, points to the real folder): the branch name, the first seven
// characters of the commit when HEAD is detached, or null outside Git.
//
// suggestWorkspaces() returns the common workspace folders that exist, for
// the first-run question: the folder above the current one when the CLI is
// started inside a project, SUGGESTED_FOLDERS in the home directory, and on
// Windows, SUGGESTED_FOLDERS at the root of each drive (E:\dev), each drive
// given DRIVE_TIMEOUT to answer.
//
// isDirectory() checks paths entered by the user. resolveDirectoryInput()
// turns what the user typed into an absolute path. Typed text never passes
// through a shell, so it also accepts the forms a shell would have cleaned
// up: a leading ~, surrounding quotes (Explorer's "Copy as path") and, outside
// Windows, backslash-escaped spaces. normalizePathInput() does that cleanup
// and accepts `{ platform, homeDirectory }` so tests can cover every platform.
//
// Used by cli.js.

import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { parseJson } from './json.js'

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

// List immediate child directories in the workspace, and links to them:
// projects with a package.json first, then the others, each group sorted by
// name.
export async function getProjects(root) {
  const entries = await readdir(root, { withFileTypes: true })

  const projects = await Promise.all(
    entries
      .filter(entry => !isNeverProject(entry.name))
      .map(async entry => {
        if (!(await isFolder(root, entry))) return null

        const directory = path.join(root, entry.name)

        return {
          name: entry.name,
          directory,
          hasPackageJson: await hasPackageJson(directory),
        }
      }),
  )

  return projects
    .filter(project => project !== null)
    .sort(
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
    .map(([name, command]) => ({ name, command }))

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
