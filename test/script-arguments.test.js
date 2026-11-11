import test from 'node:test'
import assert from 'node:assert/strict'

import { needsArguments } from '../lib/script-arguments.js'

test('needsArguments recognises helpers that only take the rest of a command', () => {
  for (const command of [
    "yarn workspaces foreach --all --include '@modulane/*' --topological-dev --verbose",
    'yarn workspaces foreach -A -j 4',
    'yarn workspace @shop/api',
    'pnpm -r',
    'pnpm --filter "./packages/**"',
    'npm -ws',
    'npm --workspace packages/api',
    'npm exec',
    'npx',
    'bun --filter "*"',
    'turbo run --filter web',
    'lerna exec --scope api',
    'yarn build && yarn workspaces foreach -A',
  ]) {
    assert.equal(needsArguments(command), true, command)
  }
})

test('needsArguments lets every other script run on its own', () => {
  for (const command of [
    'yarn packages run check',
    'yarn workspaces foreach -A run build',
    'yarn workspace @shop/api run dev',
    'yarn lint',
    'yarn',
    'pnpm -r build',
    'pnpm --filter web dev',
    'pnpm',
    'pnpm --version',
    'npm run build --workspaces',
    'npm exec eslint',
    'npx eslint .',
    'bun --filter "*" build',
    'turbo run build',
    'lerna run test',
    'eslint .',
    'yarn workspaces foreach -A | tee log.txt',
    'node -e "unclosed',
  ]) {
    assert.equal(needsArguments(command), false, command)
  }
})
