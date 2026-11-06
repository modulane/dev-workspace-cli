import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import spawn from 'cross-spawn'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// What `npm publish` would put in the package, from `npm pack --dry-run`.
function packedFiles() {
  const result = spawn.sync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)

  // npm 11 prints an array, npm 12 an object keyed by package name.
  const report = JSON.parse(result.stdout)
  const [{ files }] = Array.isArray(report) ? report : Object.values(report)

  return files.map(file => file.path)
}

test('the published package holds only the CLI, never development tools', () => {
  const allowed =
    /^(index\.js|lib\/[^/]+\.js|package\.json|README\.md|LICENSE)$/
  const files = packedFiles()

  assert.ok(files.includes('index.js'))
  assert.deepEqual(
    files.filter(file => !allowed.test(file)),
    [],
  )
})
