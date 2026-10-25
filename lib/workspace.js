// Reading the workspace from disk.
//
// getProjects() lists the workspace's immediate subfolders as projects,
// leaving out folders that are never projects (dot-folders such as .git, and
// node_modules). Each project records whether it has a package.json; those
// without one are sorted after the others so the menu can show them dimmed.
// getScripts() reads the scripts from a project's package.json, with clear
// errors for unreadable or invalid files, and attaches pre/post hooks to
// their main script instead of listing them separately. isDirectory() checks
// paths entered by the user.
//
// Used by cli.js.

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

// Check whether a path points to an accessible directory.
export async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory()
  } catch {
    return false
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
