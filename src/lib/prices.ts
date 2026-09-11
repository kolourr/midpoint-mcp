import { z } from 'zod'
import type { ServiceClient } from './supabase.js'
import { cents } from './format.js'

/** Row shape shared by every list-style RPC (search, trending, sets…). */
export interface CatalogListRow {
  id: string
  name: string
  game: string
  expansion_name: string | null
  expansion_id?: string | null
  rarity?: string | null
  number: string | null
  image_small: string | null
  raw_market: number | null
  psa10_market?: number | null
  pct?: number | null
  sales_volume?: number | null
}

export const cardSummarySchema = z.object({
  id: z.string().describe('Catalog card id. Pass to get_card_prices, grading_roi or get_price_history.'),
  name: z.string(),
  game: z.string(),
  set: z.string().nullable(),
  number: z.string().nullable(),
  rarity: z.string().nullable().optional(),
  raw_market_usd: z.number().nullable().describe('Ungraded (raw) market price in USD'),
  psa10_market_usd: z.number().nullable().optional().describe('PSA 10 market price in USD'),
  url: z.string().describe('Card page with the full price ladder and history')
})
export type CardSummary = z.infer<typeof cardSummarySchema>

export const toSummary = (row: CatalogListRow, url: string): CardSummary => ({
  id: row.id,
  name: row.name,
  game: row.game,
  set: row.expansion_name ?? null,
  number: row.number ?? null,
  ...(row.rarity !== undefined ? { rarity: row.rarity ?? null } : {}),
  raw_market_usd: cents(row.raw_market),
  ...(row.psa10_market !== undefined ? { psa10_market_usd: cents(row.psa10_market) } : {}),
  url
})

export interface SeoCardRow {
  catalog_card_id: string
  game: string
  source: string | null
  product_type: string | null
  name: string
  number: string | null
  set_slug: string | null
  set_name: string | null
  set_year: number | null
  player_name: string | null
  raw_market: number | null
  psa10: number | null
  psa9: number | null
  psa8: number | null
  cgc10: number | null
  bgs10: number | null
  sgc10: number | null
  tag10: number | null
  best_graded: number | null
  gem_premium: number | null
  raw_prev30: number | null
  psa10_prev30: number | null
  pct_change_30d: number | null
  captured_on: string | null
  price_points: number
  is_priced: boolean
}

export const SEO_CARD_COLS =
  'catalog_card_id, game, source, product_type, name, number, set_slug, set_name, set_year, player_name, raw_market, psa10, psa9, psa8, cgc10, bgs10, sgc10, tag10, best_graded, gem_premium, raw_prev30, psa10_prev30, pct_change_30d, captured_on, price_points, is_priced'

/** The daily-rebuilt pivot: raw / PSA 9 / PSA 10 / other graders per card. */
export const getSeoCard = async (db: ServiceClient, id: string): Promise<SeoCardRow | null> => {
  const { data, error } = await db.from('seo_cards').select(SEO_CARD_COLS).eq('catalog_card_id', id).maybeSingle()
  if (error) throw error
  return (data as SeoCardRow | null) ?? null
}

export interface CatalogCardRow {
  id: string
  name: string
  game: string
  source: string | null
  expansion_id: string | null
  expansion_name: string | null
  expansion_release_date: string | null
  printed_number: string | null
  number: string | null
  rarity: string | null
  product_type: string | null
}

export const getCatalogCard = async (db: ServiceClient, id: string): Promise<CatalogCardRow | null> => {
  const { data, error } = await db
    .from('card_catalog')
    .select('id, name, game, source, expansion_id, expansion_name, expansion_release_date, printed_number, number, rarity, product_type')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as CatalogCardRow | null) ?? null
}

interface PriceRow {
  variant: string
  price_type: 'raw' | 'graded'
  condition: string
  company: string
  grade: string
  is_perfect: boolean
  is_signed: boolean
  is_error: boolean
  low: number | null
  high: number | null
  market: number | null
  captured_on: string
}

export interface RawRung {
  condition: string
  market_usd: number | null
  low_usd: number | null
  high_usd: number | null
}
export interface GradedRung {
  company: string
  grade: string
  market_usd: number | null
}
export interface Ladder {
  captured_on: string | null
  raw: RawRung[]
  graded: GradedRung[]
}

const RAW_ORDER = ['NM', 'LP', 'MP', 'HP', 'DM', 'Ungraded']
const gradeNumber = (grade: string): number => {
  const n = Number.parseFloat(grade)
  return Number.isFinite(n) ? n : -1
}

/**
 * Latest plain (unsigned, non-error, non-perfect) price per
 * variant/type/condition/company/grade tuple, from the append-only archive.
 * Same reduction the /api/ai/card route performs.
 */
export const getLatestLadder = async (db: ServiceClient, id: string): Promise<Ladder> => {
  const { data, error } = await db
    .from('card_prices')
    .select('variant, price_type, condition, company, grade, is_perfect, is_signed, is_error, low, high, market, captured_on')
    .eq('catalog_card_id', id)
    .order('captured_on', { ascending: false })
    .limit(500)
  if (error) throw error

  const seen = new Map<string, PriceRow>()
  for (const row of (data ?? []) as PriceRow[]) {
    if (row.is_signed || row.is_perfect || row.is_error || row.market === null) continue
    const key = `${row.variant}|${row.price_type}|${row.condition}|${row.company}|${row.grade}`
    if (!seen.has(key)) seen.set(key, row)
  }
  const latest = [...seen.values()]
  const anchor = rawAnchor(latest)

  const raw = latest
    .filter((p) => p.price_type === 'raw')
    .filter((p) => anchor === null || p.market === null || p.market <= anchor * RAW_ANCHOR_MULTIPLE)
    .sort((a, b) => RAW_ORDER.indexOf(a.condition) - RAW_ORDER.indexOf(b.condition))
    .map((p) => ({ condition: p.condition, market_usd: cents(p.market), low_usd: cents(p.low), high_usd: cents(p.high) }))
  const graded = latest
    .filter((p) => p.price_type === 'graded')
    .sort((a, b) => gradeNumber(b.grade) - gradeNumber(a.grade) || a.company.localeCompare(b.company))
    .map((p) => ({ company: p.company || 'Generic', grade: p.grade, market_usd: cents(p.market) }))

  return { captured_on: latest[0]?.captured_on ?? null, raw, graded }
}

/** A single troll listing can poison the raw market price; cap raw at 3×
 *  the card's own plain PSA 8+ ceiling when enough graded rows exist. */
export const RAW_ANCHOR_MULTIPLE = 3
const RAW_GUARD_MIN_GRADED_ROWS = 5
const rawAnchor = (rows: PriceRow[]): number | null => {
  const graded = rows.filter((r) => r.price_type === 'graded' && r.market !== null)
  if (graded.length < RAW_GUARD_MIN_GRADED_ROWS) return null
  const top = Math.max(0, ...graded.filter((r) => r.company === 'PSA' && gradeNumber(r.grade) >= 8).map((r) => r.market as number))
  return top > 0 ? top : null
}

export const getRawAnchor = async (db: ServiceClient, id: string): Promise<number | null> => {
  const { data, error } = await db
    .from('card_prices')
    .select('company, grade, market, price_type')
    .eq('catalog_card_id', id)
    .eq('price_type', 'graded')
    .eq('is_signed', false)
    .eq('is_error', false)
    .eq('is_perfect', false)
    .not('market', 'is', null)
  if (error) throw error
  return rawAnchor((data ?? []) as PriceRow[])
}

export const bestGradedLabel = (c: SeoCardRow): string | null => {
  const candidates: Array<[string, number | null]> = [
    ['PSA 10', c.psa10],
    ['CGC 10', c.cgc10],
    ['BGS 10', c.bgs10],
    ['SGC 10', c.sgc10],
    ['TAG 10', c.tag10],
    ['PSA 9', c.psa9]
  ]
  const best = candidates.filter((x): x is [string, number] => x[1] !== null && x[1] > 0).sort((a, b) => b[1] - a[1])[0]
  return best?.[0] ?? null
}
