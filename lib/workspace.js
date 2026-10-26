// Reading the workspace from disk.
//
// getProjects() lists the workspace's immediate subfolders as projects,
// leaving out folders that are never projects (dot-folders such as .git, and
// node_modules). Each project records whether it has a package.json; those
// without one are sorted after the others so the menu can show them dimmed.
// getScripts() reads the scripts from a project's package.json, with clear
// errors for unreadable or invalid files, and attaches pre/post hooks to
// their main script instead of listing them separately.
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

// List immediate child directories in the workspace: projects with a
// package.json first, then the others, each group sorted by name.
export async function getProjects(root) {
  const entries = await readdir(root, { withFileTypes: true })

  const projects = await Promise.all(
    entries
      .filter(entry => entry.isDirectory() && !isNeverProject(entry.name))
      .map(async entry => {
        const directory = path.join(root, entry.name)

        return {
          name: entry.name,
          directory,
          hasPackageJson: await hasPackageJson(directory),
        }
      }),
  )

  return projects.sort(
    (a, b) =>
      Number(b.hasPackageJson) - Number(a.hasPackageJson) ||
      compareNames(a.name, b.name),
  )
}

// Read npm scripts from a project's package.json.
export async function getScripts(directory) {
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
    packageJson = JSON.parse(content)
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

  return groupLifecycleScripts(
    Object.entries(scripts)
      .filter(([, command]) => typeof command === 'string')
      .map(([name, command]) => ({ name, command })),
  )
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
