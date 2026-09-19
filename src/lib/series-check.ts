/**
 * Sanity check for "mover" claims. seo_cards.pct_change_30d compares two
 * captures, and a graded series with few sales can swing 10× between
 * captures (Gengar-EX xy4-114 PSA 10: $30,947 → $1,808 → $10,961 → $690 in
 * five weeks). Before a card is reported as a gainer or a drop, its own
 * recent series must look like a market: enough captures, a baseline that
 * holds together, and a current value that has held for more than a day.
 */
import type { ServiceClient } from './supabase.js'
import { primaryVariant } from './prices.js'
import { pickDailySeries, type ArchiveRow } from '../tools/price-history.js'

export interface SeriesPoint { date: string; market_usd: number | null }
export interface SeriesVerdict { ok: boolean; reason: string | null }

const WINDOW_DAYS = 40
const MIN_CAPTURES = 5
/** Baseline captures (27–37 days back) may not spread more than this. */
const MAX_BASELINE_SPREAD = 2
/** Whole-window max/min beyond this is noise, not a trend (a real +300% is 4×). */
const MAX_WINDOW_SPREAD = 6
/** The latest value must be within this of the capture before it. */
const MAX_LAST_STEP = 0.5

const dayDiff = (iso: string, now: Date): number => Math.round((now.getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000)

/** Pure rule set; `now` is injectable for tests. */
export const seriesLooksReal = (points: SeriesPoint[], now = new Date()): SeriesVerdict => {
  const vals = points.filter((p): p is { date: string; market_usd: number } => p.market_usd !== null && p.market_usd > 0)
  if (vals.length < MIN_CAPTURES) return { ok: false, reason: `only ${vals.length} captures in ${WINDOW_DAYS} days` }
  const prices = vals.map((p) => p.market_usd)
  const spread = Math.max(...prices) / Math.min(...prices)
  if (spread > MAX_WINDOW_SPREAD) return { ok: false, reason: `series swings ${spread.toFixed(1)}× within ${WINDOW_DAYS} days` }
  const baseline = vals.filter((p) => { const d = dayDiff(p.date, now); return d >= 27 && d <= 37 }).map((p) => p.market_usd)
  if (baseline.length >= 2) {
    const bs = Math.max(...baseline) / Math.min(...baseline)
    if (bs > MAX_BASELINE_SPREAD) return { ok: false, reason: `30-day baseline is unstable (${bs.toFixed(1)}× spread)` }
  }
  const last = vals[vals.length - 1], prev = vals[vals.length - 2]
  if (last && prev && Math.abs(last.market_usd - prev.market_usd) / prev.market_usd > MAX_LAST_STEP) {
    return { ok: false, reason: 'latest value is a one-capture jump' }
  }
  return { ok: true, reason: null }
}

/** Load the card's own series for the basis the mover was measured on, primary printing only. */
export const loadRecentSeries = async (db: ServiceClient, cardId: string, basis: 'PSA 10' | 'raw'): Promise<SeriesPoint[]> => {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  let q = db
    .from('card_prices')
    .select('captured_on, market, company, grade, price_type, variant, condition, is_signed, is_error, is_perfect')
    .eq('catalog_card_id', cardId)
    .gte('captured_on', since)
    .eq('is_signed', false)
    .eq('is_error', false)
    .eq('is_perfect', false)
    .order('captured_on', { ascending: true })
  q = basis === 'PSA 10' ? q.eq('price_type', 'graded').eq('grade', '10').in('company', ['PSA', '']) : q.eq('price_type', 'raw').in('condition', ['NM', 'Ungraded', ''])
  const { data, error } = await q
  if (error) throw error
  const all = (data ?? []) as ArchiveRow[]
  const primary = primaryVariant(all.filter((r): r is ArchiveRow & { variant: string } => typeof r.variant === 'string' && r.market !== null))
  return pickDailySeries(primary === null ? all : all.filter((r) => r.variant === primary))
}

/** Keep the first `limit` rows whose series passes, checking a few at a time. */
export const filterVerified = async <T>(rows: T[], limit: number, check: (row: T) => Promise<SeriesVerdict>, concurrency = 6): Promise<{ kept: T[]; dropped: number }> => {
  const kept: T[] = []
  let dropped = 0
  for (let i = 0; i < rows.length && kept.length < limit; i += concurrency) {
    const batch = rows.slice(i, i + concurrency)
    const verdicts = await Promise.all(batch.map((r) => check(r).catch((): SeriesVerdict => ({ ok: true, reason: null }))))
    batch.forEach((r, j) => {
      if (kept.length >= limit) return
      if (verdicts[j]?.ok) kept.push(r)
      else dropped += 1
    })
  }
  return { kept, dropped }
}
