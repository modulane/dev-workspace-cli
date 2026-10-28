// History: recently used projects and the last script run in each.
//
// It is kept in state.json, next to the configuration file but apart from
// it, so clearing the history (--clear-history) never touches the settings.
// Projects are identified by their absolute directory, so the history of
// several workspaces can live side by side:
//
//   { "version": 1, "recentProjects": ["<dir>", …],
//     "lastScripts": { "<dir>": "<script>" } }
//
// History is a convenience: readState() returns an empty history for a
// missing, unreadable or invalid file instead of failing, and saveState()
// writes a temporary file first, so an interrupted write never leaves a
// broken file. rememberProject() and rememberScript() return an updated copy
// and keep the lists bounded; recentProjects() picks the recently used ones
// out of a project list.
//
// Used by cli.js.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parseJson } from './json.js'

const VERSION = 1
const MAX_RECENT_PROJECTS = 20
const MAX_LAST_SCRIPTS = 200

export const RECENT_SHOWN = 5

export function getStatePath(configFile) {
  return path.join(path.dirname(configFile), 'state.json')
}

export function emptyState() {
  return { version: VERSION, recentProjects: [], lastScripts: {} }
}

const isText = value => typeof value === 'string' && value !== ''

export async function readState(file) {
  try {
    const data = parseJson(await readFile(file, 'utf8'))

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return emptyState()
    }

    const recentProjects = Array.isArray(data.recentProjects)
      ? data.recentProjects.filter(isText)
      : []
    const lastScripts =
      data.lastScripts !== null &&
      typeof data.lastScripts === 'object' &&
      !Array.isArray(data.lastScripts)
        ? Object.fromEntries(
            Object.entries(data.lastScripts).filter(([, name]) => isText(name)),
          )
        : {}

    return { version: VERSION, recentProjects, lastScripts }
  } catch {
    return emptyState()
  }
}

export async function saveState(file, state) {
  const temporary = `${file}.${process.pid}.tmp`

  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8')

  try {
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

// Delete the history file. Return true when there was one.
export async function clearState(file) {
  try {
    await rm(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false

    throw new Error(`Cannot delete history at ${file}: ${error.message}`, {
      cause: error,
    })
  }
}

export function rememberProject(state, directory) {
  return {
    ...state,
    recentProjects: [
      directory,
      ...state.recentProjects.filter(entry => entry !== directory),
    ].slice(0, MAX_RECENT_PROJECTS),
  }
}

export function rememberScript(state, directory, script) {
  // Re-inserted so the oldest entries are the first ones dropped.
  const { [directory]: _previous, ...others } = state.lastScripts
  const entries = [...Object.entries(others), [directory, script]]

  return {
    ...rememberProject(state, directory),
    lastScripts: Object.fromEntries(entries.slice(-MAX_LAST_SCRIPTS)),
  }
}

// The projects from `projects` that were used recently, most recent first.
// Folders without a package.json are left out: they cannot be opened.
export function recentProjects(state, projects, limit = RECENT_SHOWN) {
  const byDirectory = new Map(
    projects
      .filter(project => project.hasPackageJson !== false)
      .map(project => [project.directory, project]),
  )

  return state.recentProjects
    .map(directory => byDirectory.get(directory))
    .filter(Boolean)
    .slice(0, limit)
}
