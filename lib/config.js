// The saved configuration: where it lives, and reading, writing and deleting it.
//
// The file is stored in the platform's config directory (%APPDATA%,
// ~/Library/Preferences or $XDG_CONFIG_HOME), outside the package so it
// survives updates and uninstalls. DEV_WORKSPACE_CONFIG overrides the path;
// getConfigPaths() then reports `custom: true`, which state.js uses to name
// the history file.
// Files left in ~/.dev-workspace-cli by versions before 0.3.0 are moved
// automatically by migrateLegacyConfig().
//
// The file currently holds one setting: `{ "workspace": "<path>" }`. A file
// saved with a UTF-8 byte order mark, as some editors do, is read normally.
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

  if (
    config === null ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    typeof config.workspace !== 'string' ||
    !config.workspace.trim()
  ) {
    throw new Error(
      `Invalid configuration at ${configFile}: expected a non-empty "workspace" path.`,
    )
  }

  return config.workspace.trim()
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
    JSON.stringify({ workspace: normalizedWorkspace }, null, 2) + '\n',
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
