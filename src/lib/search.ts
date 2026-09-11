import type { CatalogListRow } from './prices.js'

/**
 * Chat users type "charizard base set 4/102" or "1986 fleer jordan"; the
 * prices_index RPC matches the whole string as a substring of the card
 * name or set name, so multi-part queries miss. This module decomposes a
 * query into a search term plus ranking tokens, and scores candidates.
 */
const STOP = new Set([
  'card', 'cards', 'the', 'of', 'a', 'an', 'and', 'psa', 'cgc', 'bgs', 'sgc', 'tag', 'graded', 'raw', 'ungraded', 'price', 'prices',
  'value', 'worth', 'how', 'much', 'is', 'my', 'for', 'in', 'set', 'edition', 'rc', 'rookie', 'grade', 'grading', 'tcg',
  // Game / sport names carry no ranking signal inside one catalog game.
  'pokemon', 'pokémon', 'mtg', 'magic', 'gathering', 'yugioh', 'yu-gi-oh', 'lorcana', 'disney', 'onepiece', 'one', 'piece', 'gundam',
  'digimon', 'dragonball', 'riftbound', 'sports', 'baseball', 'basketball', 'football', 'hockey', 'soccer', 'wrestling', 'ufc',
  'golf', 'tennis', 'boxing', 'racing', 'marvel', 'starwars', 'gpk', 'nba', 'nfl', 'mlb', 'nhl'
])

/** Raw above 3× the card's own PSA 10 is a poisoned listing, not a market. */
export const RAW_IMPLAUSIBLE_MULTIPLE = 3
export const isImplausibleRaw = (row: CatalogListRow): boolean =>
  row.raw_market !== null &&
  row.psa10_market !== null &&
  row.psa10_market !== undefined &&
  row.psa10_market > 0 &&
  row.raw_market > row.psa10_market * RAW_IMPLAUSIBLE_MULTIPLE

export interface ParsedQuery {
  tokens: string[]
  years: string[]
  numbers: string[]
  /** Alphabetic tokens to try as the RPC search term, most specific first. */
  terms: string[]
}

export const normalise = (q: string): string =>
  q
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9#/\-. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const parseQuery = (raw: string): ParsedQuery => {
  const q = normalise(raw)
  const parts = q.split(' ').filter(Boolean)
  const years = parts.filter((p) => /^(19|20)\d{2}$/.test(p))
  const numbers = parts
    .filter((p) => /^#?\d{1,4}(\/\d{1,4})?$/.test(p) && !years.includes(p))
    .map((p) => p.replace(/^#/, ''))
  const tokens = parts.filter((p) => !years.includes(p) && !numbers.includes(p) && !numbers.includes(p.replace(/^#/, '')))
  const alpha = tokens.filter((t) => /^[a-z][a-z\-.]{2,}$/.test(t) && !STOP.has(t))
  // Longest first: the card/player name is usually the most distinctive token.
  const terms = [...new Set(alpha)].sort((a, b) => b.length - a.length).slice(0, 3)
  return { tokens, years, numbers, terms }
}

/**
 * Terms to query in parallel: the full string (exact substring or fuzzy
 * hit) plus the two most distinctive name tokens, whose result sets are
 * unioned and ranked. A single-token query is just itself.
 */
export const searchTerms = (raw: string): string[] => {
  const p = parseQuery(raw)
  const full = normalise(raw).replace(/[#]/g, '').trim()
  const candidates = [full, ...p.terms.slice(0, 2)].filter((t) => t.length >= 2)
  return [...new Set(candidates)]
}

/** Fallback when every parallel term misses: the first two name tokens together. */
export const fallbackTerm = (raw: string): string | null => {
  const p = parseQuery(raw)
  const alphaOrdered = p.tokens.filter((t) => !STOP.has(t) && /^[a-z]/.test(t))
  const pair = alphaOrdered.slice(0, 2).join(' ')
  return pair.length >= 2 && pair !== normalise(raw) ? pair : null
}

/** Union result sets by id, keeping first-seen order. */
export const unionRows = (batches: CatalogListRow[][]): CatalogListRow[] => {
  const seen = new Set<string>()
  const out: CatalogListRow[] = []
  for (const batch of batches) {
    for (const row of batch) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
  }
  return out
}

const haystack = (row: CatalogListRow): { name: string; set: string; number: string; rarity: string } => ({
  name: (row.name ?? '').toLowerCase(),
  set: (row.expansion_name ?? '').toLowerCase(),
  number: (row.number ?? '').toLowerCase(),
  rarity: (row.rarity ?? '').toLowerCase()
})

/** Higher is better. Counts how much of the user's query the row explains. */
export const scoreRow = (row: CatalogListRow, parsed: ParsedQuery): number => {
  const h = haystack(row)
  let score = 0
  for (const t of parsed.tokens) {
    if (STOP.has(t)) continue
    if (h.name.includes(t)) score += 3
    else if (h.set.includes(t)) score += 2
    else if (h.rarity.includes(t)) score += 1
  }
  // A year in the set name is the real issue; a year in the card name is
  // usually a reprint or tribute ("Mickey Mantle [1952]" from 1991).
  for (const y of parsed.years) {
    if (h.set.includes(y)) score += 4
    else if (h.name.includes(y)) score += 1
  }
  for (const n of parsed.numbers) {
    const [num] = n.split('/')
    if (h.number === n || h.number === num || h.number.startsWith(`${num}/`)) score += 4
    else if (h.name.includes(`#${num}`) || h.name.includes(` ${num}`)) score += 2
  }
  return score
}

/** Market value for tie-breaking: the larger of raw and PSA 10, ignoring a
 *  raw price that fails the plausibility check. */
export const rowValue = (row: CatalogListRow): number => {
  const raw = isImplausibleRaw(row) ? 0 : (row.raw_market ?? 0)
  return Math.max(raw, row.psa10_market ?? 0)
}

/** Score desc (implausible raw rows demoted), then market value desc (the
 *  fuzzy branch returns rows in similarity order, so the RPC order is not a
 *  usable tiebreak), then first-seen order. */
export const rankRows = (rows: CatalogListRow[], parsed: ParsedQuery): CatalogListRow[] =>
  rows
    .map((row, i) => ({ row, i, s: scoreRow(row, parsed) - (isImplausibleRaw(row) ? 2 : 0), v: rowValue(row) }))
    .sort((a, b) => b.s - a.s || b.v - a.v || a.i - b.i)
    .map((x) => x.row)
