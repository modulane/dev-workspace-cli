import test from 'node:test'
import assert from 'node:assert/strict'

import { fuzzyFilter, fuzzyMatch } from '../lib/fuzzy.js'

const names = items => items.map(({ item }) => item)

test('fuzzyMatch accepts subsequences, ignoring case', () => {
  assert.deepEqual(fuzzyMatch('dsy', 'design-system').positions, [0, 7, 8])
  assert.deepEqual(fuzzyMatch('API', 'billing-api').positions, [8, 9, 10])
  assert.equal(fuzzyMatch('xyz', 'design-system'), null)
  assert.equal(fuzzyMatch('webapp', 'web'), null)
})

test('fuzzyMatch counts positions in characters, as the list does', () => {
  // An emoji is two UTF-16 units, and "İ" lowercases to two characters.
  assert.deepEqual(fuzzyMatch('api', '📦api').positions, [1, 2, 3])
  assert.deepEqual(fuzzyMatch('web', 'İweb').positions, [1, 2, 3])
  assert.equal(fuzzyMatch('🚀', 'app🚀').score > 0, true)
})

test('fuzzyMatch matches everything with an empty query', () => {
  assert.deepEqual(fuzzyMatch('', 'web'), { score: 0, positions: [] })
})

test('fuzzyMatch prefers word starts and consecutive characters', () => {
  // "ds" can match d…s in "design" or d + the s of "system"; the word start
  // scores higher.
  assert.deepEqual(fuzzyMatch('ds', 'design-system').positions, [0, 7])
  assert.deepEqual(fuzzyMatch('ui', 'myUiKit').positions, [2, 3])
  assert.ok(fuzzyMatch('web', 'web').score > fuzzyMatch('web', 'webapp').score)
  assert.ok(
    fuzzyMatch('api', 'api-gateway').score >
      fuzzyMatch('api', 'rapid-ui').score,
  )
})

test('fuzzyFilter keeps matches, best first, and the order on ties', () => {
  const projects = [
    'storefront',
    'billing-api',
    'api',
    'design-system',
    'api-gateway',
    'docs',
  ]
  const byName = name => name

  assert.deepEqual(names(fuzzyFilter(projects, 'api', byName)), [
    'api',
    'api-gateway',
    'billing-api',
  ])
  assert.deepEqual(names(fuzzyFilter(projects, 'ds', byName)), [
    'design-system',
    'docs',
  ])
  assert.deepEqual(names(fuzzyFilter(projects, '', byName)), projects)
  assert.deepEqual(fuzzyFilter(projects, 'zzz', byName), [])
})

// Every query of up to three characters taken from the name, in order.
function shortQueries(name) {
  const queries = new Set()

  for (let a = 0; a < name.length; a++) {
    queries.add(name[a])

    for (let b = a + 1; b < name.length; b++) {
      queries.add(name[a] + name[b])

      for (let c = b + 1; c < name.length; c++) {
        queries.add(name[a] + name[b] + name[c])
      }
    }
  }

  return [...queries].sort((x, y) => x.length - y.length)
}

// The roadmap goal: at most three keystrokes plus Enter. A keystroke is a
// typed character or a press of the Down arrow in the filtered list.
test('three keystrokes find any project in a 50-project workspace', () => {
  const words = [
    'web',
    'api',
    'admin',
    'docs',
    'mobile',
    'auth',
    'billing',
    'search',
    'shop',
    'chat',
  ]
  const suffixes = ['', '-app', '-service', '-ui', '-legacy']
  const projects = words.flatMap(word => suffixes.map(suffix => word + suffix))

  assert.equal(projects.length, 50)

  for (const project of projects) {
    const found = shortQueries(project).some(query => {
      const results = names(fuzzyFilter(projects, query, name => name))
      const downPresses = results.indexOf(project)

      return downPresses !== -1 && downPresses <= 3 - query.length
    })

    assert.ok(found, project)
  }
})
