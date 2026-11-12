// The configuration file: where it lives, and reading and saving it.
// Used by cli.js.

import {
  access,
  constants,
  copyFile,
  mkdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { parseJson } from './json.js'

const APP_NAME = 'dev-workspace-cli'

// Return the platform's base directory for user configuration.
function getConfigBase({ env, platform, homeDirectory }) {
  if (platform === 'win32') {
    return env.APPDATA || path.join(homeDirectory, 'AppData', 'Roaming')
  }

  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Preferences')
  }

  // The XDG spec says relative values must be ignored.
  if (env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)) {
    return env.XDG_CONFIG_HOME
  }

  return path.join(homeDirectory, '.config')
}

// Keep user settings outside the installed package so they survive
// updates and uninstalls. DEV_WORKSPACE_CONFIG overrides the location.
export function getConfigPaths({
  env = process.env,
  platform = process.platform,
  homeDirectory = os.homedir(),
} = {}) {
  if (env.DEV_WORKSPACE_CONFIG) {
    const file = path.resolve(env.DEV_WORKSPACE_CONFIG)

    return {
      directory: path.dirname(file),
      file,
      legacyFile: null,
      custom: true,
    }
  }

  const directory = path.join(
    getConfigBase({ env, platform, homeDirectory }),
    APP_NAME,
  )

  return {
    directory,
    file: path.join(directory, 'config.json'),
    // Versions before 0.3.0 stored the configuration here.
    legacyFile: path.join(homeDirectory, `.${APP_NAME}`, 'config.json'),
    custom: false,
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

// Move a configuration saved by an older version to the current location.
// Return the old path when a file was moved, otherwise null.
export async function migrateLegacyConfig({ file, legacyFile }) {
  if (!legacyFile || legacyFile === file) return null
  if (await exists(file)) return null
  if (!(await exists(legacyFile))) return null

  await mkdir(path.dirname(file), { recursive: true })
  await copyFile(legacyFile, file, constants.COPYFILE_EXCL)
  await rm(legacyFile)

  // Leave the old directory alone if anything else is still in it.
  await rmdir(path.dirname(legacyFile)).catch(() => {})

  return legacyFile
}

// The file looks like this; every key but `workspace` is optional, and
// saving one setting keeps the others:
//
//   { "workspace": "<path>", "color": "cyan", "mouse": false }
//
// Return null when no configuration exists yet.
// Invalid configuration should produce an actionable error.
export async function readWorkspaceConfig(configFile) {
  let content

  try {
    content = await readFile(configFile, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null

    throw new Error(
      `Cannot read configuration at ${configFile}: ${error.message}`,
      { cause: error },
    )
  }

  let config

  try {
    config = parseJson(content)
  } catch (error) {
    throw new Error(
      `Invalid configuration JSON at ${configFile}: ${error.message}`,
      { cause: error },
    )
  }

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(
      `Invalid configuration at ${configFile}: expected a non-empty "workspace" path.`,
    )
  }

  // Saved by --set-mouse or --set-color before any workspace was chosen.
  if (!Object.hasOwn(config, 'workspace')) return null

  if (typeof config.workspace !== 'string' || !config.workspace.trim()) {
    throw new Error(
      `Invalid configuration at ${configFile}: expected a non-empty "workspace" path.`,
    )
  }

  return config.workspace.trim()
}

// True unless the configuration turns the mouse off with `"mouse": false`.
export async function readMouseSetting(configFile) {
  try {
    return parseJson(await readFile(configFile, 'utf8'))?.mouse !== false
  } catch {
    return true
  }
}

// The settings of a valid file, kept when the workspace changes.
async function readSettings(configFile) {
  try {
    const config = parseJson(await readFile(configFile, 'utf8'))

    return config !== null &&
      typeof config === 'object' &&
      !Array.isArray(config)
      ? config
      : {}
  } catch {
    return {}
  }
}

// The saved accent colour's name, or null when none is saved. Never fails,
// as readMouseSetting(); cli.js checks the name.
export async function readColorSetting(configFile) {
  try {
    const color = parseJson(await readFile(configFile, 'utf8'))?.color

    return typeof color === 'string' ? color : null
  } catch {
    return null
  }
}

// Save one setting, keeping the others.
async function saveSetting(name, value, configFile) {
  await mkdir(path.dirname(configFile), { recursive: true })

  await writeFile(
    configFile,
    JSON.stringify(
      { ...(await readSettings(configFile)), [name]: value },
      null,
      2,
    ) + '\n',
    'utf8',
  )
}

// The saved workspaces, { name: path }, leaving out entries that are not a
// name and a path. Never fails, as readMouseSetting().
export async function readSavedWorkspaces(configFile) {
  const saved = (await readSettings(configFile)).workspaces

  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}

  return Object.fromEntries(
    Object.entries(saved).filter(
      ([name, directory]) =>
        name.trim() && typeof directory === 'string' && directory.trim(),
    ),
  )
}

export function saveSavedWorkspaces(workspaces, configFile) {
  return saveSetting('workspaces', workspaces, configFile)
}

// The saved search depth, a whole number from 1 to `max`; 1 when none is
// saved or the value is not one. Never fails, as readMouseSetting().
export async function readDepthSetting(configFile, max = 3) {
  try {
    const depth = parseJson(await readFile(configFile, 'utf8'))?.depth

    return Number.isInteger(depth) && depth >= 1 && depth <= max ? depth : 1
  } catch {
    return 1
  }
}

export function saveDepthSetting(depth, configFile) {
  return saveSetting('depth', depth, configFile)
}

export function saveMouseSetting(enabled, configFile) {
  return saveSetting('mouse', enabled, configFile)
}

export function saveColorSetting(color, configFile) {
  return saveSetting('color', color, configFile)
}

// Create the configuration directory if needed, then persist the path.
export async function saveWorkspaceConfig(workspace, configFile) {
  const normalizedWorkspace =
    typeof workspace === 'string' ? workspace.trim() : ''

  if (!normalizedWorkspace) {
    throw new Error('Cannot save an empty workspace path.')
  }

  await mkdir(path.dirname(configFile), { recursive: true })

  await writeFile(
    configFile,
    JSON.stringify(
      { ...(await readSettings(configFile)), workspace: normalizedWorkspace },
      null,
      2,
    ) + '\n',
    'utf8',
  )
}

// Delete the given configuration files and return the ones that existed.
export async function resetWorkspaceConfig(files) {
  const removed = []

  for (const file of files) {
    if (!file) continue

    try {
      await rm(file)
      removed.push(file)
    } catch (error) {
      if (error.code === 'ENOENT') continue

      throw new Error(
        `Cannot delete configuration at ${file}: ${error.message}`,
        { cause: error },
      )
    }
  }

  return removed
}
