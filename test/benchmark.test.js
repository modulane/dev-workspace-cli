// The "Bigger workspaces" milestone's goal: a 200-project workspace searched
// two levels deep lists in under 500 ms.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getProjects } from '../lib/workspace.js'

const BUDGET = 500

test('a 200-project workspace with depth 2 lists in under 500 ms', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dev-workspace-bench-'))

  try {
    // 20 groups of 10 projects, as in clients/<client>/<project>, each with
    // the files a real project has next to its package.json.
    for (let group = 0; group < 20; group++) {
      for (let index = 0; index < 10; index++) {
        const project = path.join(root, `group-${group}`, `project-${index}`)

        await mkdir(path.join(project, 'node_modules', 'dependency'), {
          recursive: true,
        })
        await mkdir(path.join(project, 'src'))
        await mkdir(path.join(project, '.git'))
        await writeFile(
          path.join(project, 'package.json'),
          JSON.stringify({ name: `project-${index}`, scripts: { dev: 'x' } }),
        )
      }
    }

    const started = performance.now()
    const projects = await getProjects(root, { depth: 2 })
    const elapsed = performance.now() - started

    assert.equal(projects.length, 200)
    assert.ok(
      elapsed < BUDGET,
      `listed in ${elapsed.toFixed(0)} ms, budget ${BUDGET} ms`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
