import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import spawn from 'cross-spawn'

import { findCommand } from '../lib/aliases.js'
import { runCommand } from '../lib/commands.js'
import {
  PACKAGE_MANAGERS,
  detectPackageManager,
  installHint,
} from '../lib/package-managers.js'

async function withProject(files, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dev-workspace-pm-'))

  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(directory, name), content, 'utf8')
    }

    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const packageJson = fields => JSON.stringify({ name: 'example', ...fields })

test('detectPackageManager prefers the packageManager field', async () => {
  await withProject(
    {
      'package.json': packageJson({ packageManager: 'pnpm@9.1.0+sha512.abc' }),
      'yarn.lock': '',
    },
    async directory => {
      assert.deepEqual(await detectPackageManager(directory), {
        name: 'pnpm',
        source: 'packageManager',
      })
    },
  )
})

test('detectPackageManager falls back to the lockfile', async () => {
  const cases = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
  ]

  for (const [lockfile, name] of cases) {
    await withProject(
      { 'package.json': packageJson({}), [lockfile]: '' },
      async directory => {
        assert.deepEqual(await detectPackageManager(directory), {
          name,
          source: lockfile,
        })
      },
    )
  }
})

test('detectPackageManager uses a fixed order for several lockfiles', async () => {
  await withProject(
    { 'package-lock.json': '', 'yarn.lock': '', 'pnpm-lock.yaml': '' },
    async directory => {
      assert.equal((await detectPackageManager(directory)).name, 'pnpm')
    },
  )
})

test('detectPackageManager ignores unknown or invalid packageManager values', async () => {
  const values = ['deno@2.0.0', 42, '', '@1.0.0']

  for (const value of values) {
    await withProject(
      {
        'package.json': packageJson({ packageManager: value }),
        'yarn.lock': '',
      },
      async directory => {
        assert.deepEqual(await detectPackageManager(directory), {
          name: 'yarn',
          source: 'yarn.lock',
        })
      },
    )
  }
})

test('detectPackageManager defaults to npm', async () => {
  await withProject({ 'package.json': '{ invalid json' }, async directory => {
    assert.deepEqual(await detectPackageManager(directory), {
      name: 'npm',
      source: 'default',
    })
  })

  await withProject({}, async directory => {
    assert.equal((await detectPackageManager(directory)).name, 'npm')
  })
})

test('installHint offers Corepack only where Node.js ships it', () => {
  for (const name of ['pnpm', 'yarn']) {
    assert.equal(
      installHint(name, '24.11.1'),
      `Install it with "corepack enable ${name}" or "npm install --global ${name}".`,
    )

    for (const nodeVersion of ['25.0.0', '26.12.1']) {
      assert.equal(
        installHint(name, nodeVersion),
        `Install it with "npm install --global ${name}", or with "npm install --global corepack" followed by "corepack enable ${name}".`,
      )
    }
  }

  assert.match(installHint('npm', '26.0.0'), /Install Node\.js with npm/)
  assert.match(installHint('bun', '20.0.0'), /https:\/\/bun\.sh/)
  assert.equal(installHint('toString'), 'Install it, then restart the CLI.')
})

// Run a real script with every package manager installed on this machine.
// The script records npm_config_user_agent, which each tool sets to its own
// name, proving which tool ran it. CI installs all of them and sets
// REQUIRE_ALL_PACKAGE_MANAGERS so none is skipped there.
//
// The variable is removed first: when the tests run under `npm test`, npm has
// already set it, and Bun keeps an existing value instead of replacing it.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key.toLowerCase() !== 'npm_config_user_agent',
  ),
)

for (const name of Object.keys(PACKAGE_MANAGERS)) {
  const installed = await findCommand(name)
  const required = process.env.REQUIRE_ALL_PACKAGE_MANAGERS === '1'

  test(
    `runCommand runs a real script with ${name}`,
    { skip: !installed && !required && `${name} is not installed` },
    async () => {
      await withProject(
        {
          'package.json': packageJson({
            scripts: { record: 'node record.js' },
          }),
          'record.js':
            "require('fs').writeFileSync('agent.txt', String(process.env.npm_config_user_agent))\n",
        },
        async directory => {
          const result = await runCommand('record', directory, {
            packageManager: name,
            // Keep the test output clean; the real CLI inherits stdio.
            spawnProcess: (command, args, options) =>
              spawn(command, args, {
                ...options,
                env: cleanEnv,
                stdio: 'ignore',
              }),
          })

          assert.deepEqual(result, { code: 0 })

          const agent = await readFile(
            path.join(directory, 'agent.txt'),
            'utf8',
          )

          assert.ok(agent.startsWith(`${name}/`), agent)
        },
      )
    },
  )
}
