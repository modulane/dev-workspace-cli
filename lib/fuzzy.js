// Fuzzy matching for the search in the project and script lists.
//
// fuzzyMatch() checks whether every character of the query appears in the
// text in order (a subsequence, ignoring case) and scores the best such
// alignment: matches at the start of the text, at the start of a word (after
// - _ . / @ or a space, or a camelCase capital) and runs of consecutive
// characters score higher, gaps between matches lower. It also returns the
// matched positions, so the list can highlight them. Positions count
// characters as [...text] does, so an emoji, or a letter whose lowercase is
// longer (İ), never shifts the highlight.
//
// fuzzyFilter() keeps the items that match and sorts them best first; equal
// scores keep the shorter text first, then the original order.
//
// Used by list.js.

const BONUS_START = 10
const BONUS_WORD = 8
const BONUS_CAMEL = 6
const BONUS_CONSECUTIVE = 5
const MAX_GAP_PENALTY = 3
const EXACT_BONUS = 100

const SEPARATORS = new Set(['-', '_', '.', '/', '@', ' ', ':'])

// The bonus for a match at `index`, from the character before it.
function positionBonus(characters, index) {
  if (index === 0) return BONUS_START

  const previous = characters[index - 1]

  if (SEPARATORS.has(previous)) return BONUS_WORD

  const current = characters[index]

  if (
    previous === previous.toLowerCase() &&
    previous !== previous.toUpperCase() &&
    current !== current.toLowerCase()
  ) {
    return BONUS_CAMEL
  }

  return 0
}

// Return { score, positions } for the best alignment, or null when the query
// is not a subsequence of the text. An empty query matches everything.
export function fuzzyMatch(query, text) {
  if (!query) return { score: 0, positions: [] }

  // One entry per character, each lowercased on its own.
  const characters = [...text]
  const needle = [...query].map(character => character.toLowerCase())
  const haystack = characters.map(character => character.toLowerCase())

  if (needle.length > haystack.length) return null

  // best[i][j]: highest score with needle[i] matched at haystack[j].
  const best = []
  const from = []

  for (let i = 0; i < needle.length; i++) {
    best.push(new Array(haystack.length).fill(-Infinity))
    from.push(new Array(haystack.length).fill(-1))

    for (let j = i; j < haystack.length; j++) {
      if (haystack[j] !== needle[i]) continue

      const bonus = 1 + positionBonus(characters, j)

      if (i === 0) {
        best[i][j] = bonus
        continue
      }

      for (let k = i - 1; k < j; k++) {
        if (best[i - 1][k] === -Infinity) continue

        const gap = j - k - 1
        const link =
          gap === 0 ? BONUS_CONSECUTIVE : -Math.min(gap, MAX_GAP_PENALTY)
        const score = best[i - 1][k] + bonus + link

        if (score > best[i][j]) {
          best[i][j] = score
          from[i][j] = k
        }
      }
    }
  }

  const last = needle.length - 1
  let end = -1

  for (let j = 0; j < haystack.length; j++) {
    if (best[last][j] > (end === -1 ? -Infinity : best[last][end])) end = j
  }

  if (end === -1) return null

  const positions = []

  for (let i = last, j = end; i >= 0; j = from[i][j], i--) {
    positions.unshift(j)
  }

  const exact = needle.join('') === haystack.join('') ? EXACT_BONUS : 0

  return { score: best[last][end] + exact, positions }
}

// Keep the items whose text matches, best first. Returns
// [{ item, positions }] in the new order.
export function fuzzyFilter(items, query, getText) {
  if (!query) return items.map(item => ({ item, positions: [] }))

  return items
    .map((item, index) => {
      const text = getText(item)
      const match = fuzzyMatch(query, text)

      return match && { item, index, length: text.length, ...match }
    })
    .filter(Boolean)
    .sort(
      (a, b) => b.score - a.score || a.length - b.length || a.index - b.index,
    )
    .map(({ item, positions }) => ({ item, positions }))
}
