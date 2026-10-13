import type { ServiceClient } from './supabase.js'
import type { CatalogListRow } from './prices.js'

/**
 * Sets for the games the Home-feed expansions cache does not cover.
 *
 * `game_expansions` reads a cache built for the app's Home shelves, which
 * holds six trading-card games. Every sport (and Yu-Gi-Oh!, Marvel, Star
 * Wars…) came back as zero sets from list_sets, and get_set_cards could not
 * open a sports set at all: it filters card_catalog.expansion_id, which
 * PriceCharting-sourced cards do not have. For those games the sets live in
 * seo_sets and their cards in seo_cards, keyed by the set's slug.
 */

export interface SetItem {
  set_id: string
  name: string | null
  release_date: string | null
  card_count: number
}

export interface SeoSetRow {
  slug: string
  name: string | null
  year: number | null
  release_date: string | null
  card_count: number | null
}

export interface SeoSetCardRow {
  catalog_card_id: string
  name: string
  game: string
  set_name: string | null
  number: string | null
  raw_market: number | null
  psa10: number | null
}

/** Sports cards carry their checklist number in the name ("Roger Maris
 *  [Gray Back] #202"); the catalog's number column is empty for them. */
export const cardNumberFromName = (name: string): string | null => {
  const m = name.match(/#\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*$/)
  return m?.[1] ?? null
}

/** Lowercase filter words with anything PostgREST could read as syntax removed. */
export const queryWords = (query: string | undefined): string[] =>
  (query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9'&.-]/g, ''))
    .filter((w) => w.length > 0)
    .slice(0, 6)

export const seoSetToItem = (row: SeoSetRow): SetItem => ({
  set_id: row.slug,
  name: row.name,
  release_date: row.release_date ?? (row.year !== null ? String(row.year) : null),
  card_count: Number(row.card_count ?? 0)
})

export const seoCardToListRow = (row: SeoSetCardRow): CatalogListRow => ({
  id: row.catalog_card_id,
  name: row.name,
  game: row.game,
  expansion_name: row.set_name,
  number: row.number ?? cardNumberFromName(row.name),
  image_small: null,
  raw_market: row.raw_market,
  psa10_market: row.psa10
})

const numericPart = (n: string | null): number => {
  const m = (n ?? '').match(/\d+/)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}

/** "value" = most valuable raw price first; "number" = checklist order. */
export const sortSetRows = (rows: readonly CatalogListRow[], sort: 'value' | 'number'): CatalogListRow[] =>
  sort === 'value'
    ? [...rows].sort((a, b) => (b.raw_market ?? -1) - (a.raw_market ?? -1))
    : [...rows].sort(
        (a, b) => numericPart(a.number) - numericPart(b.number) || (a.number ?? '').localeCompare(b.number ?? '') || a.name.localeCompare(b.name)
      )

/** With a filter, the set it names exactly comes first, then names that
 *  start with it; otherwise the given (newest first) order stands. Without
 *  this, "1959 topps" listed three 2017-2023 retro sets above 1959 Topps. */
export const rankSetItems = (items: readonly SetItem[], query: string | undefined): SetItem[] => {
  const needle = queryWords(query).join(' ')
  if (!needle) return [...items]
  const score = (item: SetItem): number => {
    const name = (item.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    return name === needle ? 0 : name.startsWith(needle) ? 1 : 2
  }
  return items.map((item, i) => ({ item, i, s: score(item) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.item)
}

/** PriceCharting lists a "Complete Set" product inside each set; it is not
 *  a card and would top every by-value checklist. */
export const isSetChecklistRow = (name: string): boolean => !/^complete set$/i.test(name.trim())

/** How many filter matches to pull before ranking (the exact set may not be
 *  among the newest few). */
const RANK_POOL = 200

/** Sets of a game from seo_sets, newest first, filtered server-side (a
 *  sport has thousands of sets; PostgREST returns at most 1,000 rows). */
export const listSeoSets = async (db: ServiceClient, game: string, query: string | undefined, limit: number): Promise<SetItem[]> => {
  let q = db.from('seo_sets').select('slug, name, year, release_date, card_count').eq('game', game)
  for (const word of queryWords(query)) q = q.ilike('name', `%${word}%`)
  const { data, error } = await q
    .order('year', { ascending: false, nullsFirst: false })
    .order('card_count', { ascending: false })
    .limit(Math.max(limit, queryWords(query).length > 0 ? RANK_POOL : limit))
  if (error) throw error
  return rankSetItems(((data ?? []) as SeoSetRow[]).map(seoSetToItem), query).slice(0, limit)
}

/** Largest set we will load for one call (the biggest sports sets run to
 *  a few thousand cards; this bounds the work). */
const MAX_SET_CARDS = 5000

/** Every card of a set by its slug, from the daily price pivot. */
export const loadSeoSetCards = async (db: ServiceClient, game: string, slug: string): Promise<CatalogListRow[]> => {
  const out: CatalogListRow[] = []
  for (let from = 0; from < MAX_SET_CARDS; from += 1000) {
    const { data, error } = await db
      .from('seo_cards')
      .select('catalog_card_id, name, game, set_name, number, raw_market, psa10')
      .eq('game', game)
      .eq('set_slug', slug)
      .eq('product_type', 'card')
      .order('catalog_card_id')
      .range(from, from + 999)
    if (error) throw error
    const batch = (data ?? []) as SeoSetCardRow[]
    out.push(...batch.filter((r) => isSetChecklistRow(r.name)).map(seoCardToListRow))
    if (batch.length < 1000) break
  }
  return out
}
