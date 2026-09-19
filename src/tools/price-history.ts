import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, HOUR } from '../lib/cache.js'
import { getCatalogCard, getRawBounds, primaryVariant, variantLabel, withinRawBounds, type RawBounds } from '../lib/prices.js'
import { isPriceChartingId, SCRYDEX_GAMES } from '../lib/games.js'
import { cents, money, pct } from '../lib/format.js'
import { fetchScrydexHistory } from '../lib/scrydex.js'
import { fail, ok, guarded } from '../lib/tool-result.js'

const input = {
  card_id: z.string().trim().min(1).max(80).describe('Catalog card id from search_cards.'),
  days: z.number().int().min(7).max(180).default(90),
  grade: z.string().trim().max(10).optional().describe('PSA grade for a graded series, e.g. "10" or "9". Omit for the raw (ungraded) series.')
}

const point = z.object({ date: z.string(), market_usd: z.number().nullable() })
const output = {
  card_id: z.string(),
  name: z.string(),
  series: z.string().describe('"raw" or "PSA <grade>"'),
  variant: z.string().nullable().describe('The printing the series follows (e.g. "holofoil"); other printings are separate markets and are never mixed in.'),
  days: z.number().int(),
  coverage: z.object({
    days_with_data: z.number().int(),
    note: z.string()
  }).describe('How many of the requested days have a capture, and how to read repeated or sparse values.'),
  currency: z.literal('USD'),
  points: z.array(point).describe('Oldest first. Graded series only contain days with sales; gaps are normal.'),
  first_usd: z.number().nullable(),
  last_usd: z.number().nullable(),
  change_pct: z.number().nullable().describe('First-to-last change; null when change_note is set because a single step carries it.'),
  change_note: z.string().nullable().describe('Set when one step between consecutive captures accounts for the change: usually a data correction, not a market move. change_pct is null in that case.'),
  source: z.string(),
  links: z.object({ card_page: z.string() })
}

interface Point { date: string; market_usd: number | null }
const SCRYDEX_CACHE_TTL_MS = 24 * HOUR
const PSA_GRADES = new Set(['1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'])

/** Captures happen on a subset of days; say so instead of letting a flat
 *  or sparse series read as a frozen or wildly swinging market. */
/** A flat series that jumps ≥2.5× (or drops to ≤40%) in one step and stays
 *  there is a corrected price, not a trend; say so instead of headlining it. */
export const stepNote = (points: Point[]): string | null => {
  const vals = points.filter((p): p is { date: string; market_usd: number } => p.market_usd !== null && p.market_usd > 0)
  if (vals.length < 3) return null
  let worst: { from: number; to: number; date: string; ratio: number } | null = null
  for (let i = 1; i < vals.length; i += 1) {
    const a = vals[i - 1], b = vals[i]
    if (!a || !b) continue
    const ratio = b.market_usd / a.market_usd
    const size = ratio >= 1 ? ratio : 1 / ratio
    if ((ratio >= 2.5 || ratio <= 0.4) && (!worst || size > worst.ratio)) worst = { from: a.market_usd, to: b.market_usd, date: b.date, ratio: size }
  }
  if (!worst) return null
  const first = vals[0]?.market_usd ?? 0, last = vals[vals.length - 1]?.market_usd ?? 0
  const overall = first > 0 ? last / first : 1
  const stepShare = Math.abs(Math.log(worst.to / worst.from)) / Math.max(1e-9, Math.abs(Math.log(overall)))
  const carries = Number.isFinite(stepShare) && stepShare >= 0.8
  return `A single step from ${money(worst.from)} to ${money(worst.to)} on ${worst.date}${carries ? ' accounts for the whole change' : ' dominates the series'}; a jump of that size between two captures on an otherwise flat series is usually a corrected price, not a market move. Do not quote the change figure as a trend.`
}

export const coverageNote = (points: Point[], days: number): { days_with_data: number; note: string } => {
  const n = points.filter((p) => p.market_usd !== null).length
  const parts: string[] = [`${n} of the last ${days} days have a price capture.`]
  if (n > 0 && n < Math.max(4, Math.round(days / 6))) parts.push(`Sparse series: the change figure compares the first and last capture only and can be moved by a single day; check the card page chart before quoting a trend.`)
  parts.push('A value repeated on consecutive days is an unchanged market estimate (no new sales in between), not a frozen market.')
  return { days_with_data: n, note: parts.join(' ') }
}

export const registerPriceHistory = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_price_history',
    {
      title: 'Get price history',
      description:
        'Use this when the user asks how a card\'s price has changed over weeks or months, or wants a trend for the raw or a PSA-graded series. Returns dated USD market values for the last 7 to 180 days. Requires a card id from search_cards. Do not use for forecasts.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('get_price_history', async ({ card_id, days, grade }) => {
      const card = await getCatalogCard(ctx.db, card_id)
      if (!card) return fail(`No card with id "${card_id}". Call search_cards to find the id first.`)
      const cleanGrade = grade?.replace(/[^0-9.]/g, '') || undefined
      if (cleanGrade !== undefined && !PSA_GRADES.has(cleanGrade)) return fail(`"${grade}" is not a PSA grade. Use a whole or half grade from 1 to 10 (e.g. "10", "9", "8.5"), or omit grade for the raw series.`)

      const key = cacheKey('get_price_history', { card_id, days, grade: cleanGrade ?? '' })
      const { points, source, variant } = (await ctx.cache.getOrLoad(key, HOUR, async () => {
        const useScrydex = !isPriceChartingId(card_id) && SCRYDEX_GAMES.has(card.game) && ctx.config.SCRYDEX_API_KEY && ctx.config.SCRYDEX_TEAM_ID
        return useScrydex ? loadScrydex(ctx, card.game, card_id, days, cleanGrade) : loadArchive(ctx, card_id, days, cleanGrade)
      })) as { points: Point[]; source: string; variant: string | null }
      const coverage = coverageNote(points, days)
      const changeNote = stepNote(points)

      const first = points.find((p) => p.market_usd !== null)?.market_usd ?? null
      const last = [...points].reverse().find((p) => p.market_usd !== null)?.market_usd ?? null
      // No headline change when one step carries it: the number would be
      // quoted as a trend, and it is not one.
      const change = changeNote === null && first !== null && last !== null && first > 0 ? cents(((last - first) / first) * 100) : null
      const series = cleanGrade ? `PSA ${cleanGrade}` : 'raw'
      const structured = {
        card_id,
        name: card.name,
        series,
        variant,
        days,
        coverage,
        currency: 'USD' as const,
        points,
        first_usd: first,
        last_usd: last,
        change_pct: change,
        change_note: changeNote,
        source,
        links: { card_page: ctx.links.card(card_id) }
      }
      const sample = points.length > 12 ? points.filter((_, i) => i % Math.ceil(points.length / 12) === 0 || i === points.length - 1) : points
      const text = points.length
        ? [`${card.name} ${series} price${variant ? ` (${variant} printing)` : ''}, last ${days} days: ${money(first)} → ${money(last)} (${changeNote ? 'change not meaningful' : pct(change)}), ${points.length} data points.`, coverage.note, ...(changeNote ? [`Caution: ${changeNote}`] : []), ...sample.map((p) => `- ${p.date}: ${money(p.market_usd)}`), `Chart: ${structured.links.card_page}`].join('\n')
        : `No ${series} price points for ${card.name} in the last ${days} days. The card page may still show a longer history: ${structured.links.card_page}`
      return ok(structured, text)
    })
  )
}

/** Our own daily snapshot archive. PSA or generic-company rungs for graded.
 *  Follows ONE printing (the variant with the most rows in the window):
 *  a card id can hold holofoil and reverse-holofoil rows on the same day,
 *  10× apart, and picking per day at random produced one-day "blips". */
const loadArchive = async (ctx: ToolContext, cardId: string, days: number, grade?: string): Promise<{ points: Point[]; source: string; variant: string | null }> => {
  const since = new Date(Date.now() - days * 24 * HOUR).toISOString().slice(0, 10)
  let q = ctx.db
    .from('card_prices')
    .select('captured_on, market, company, grade, price_type, variant, condition, is_signed, is_error, is_perfect')
    .eq('catalog_card_id', cardId)
    .gte('captured_on', since)
    .eq('is_signed', false)
    .eq('is_error', false)
    .eq('is_perfect', false)
    .order('captured_on', { ascending: true })
  q = grade ? q.eq('price_type', 'graded').eq('grade', grade).in('company', ['PSA', '']) : q.eq('price_type', 'raw')
  const { data, error } = await q
  if (error) throw error
  const bounds: RawBounds = grade ? { ceiling: null, floor: null } : await getRawBounds(ctx.db, cardId)
  const all = (data ?? []) as ArchiveRow[]
  const primary = primaryVariant(all.filter((r): r is ArchiveRow & { variant: string } => typeof r.variant === 'string' && r.market !== null))
  const rows = primary === null ? all : all.filter((r) => r.variant === primary)
  // Raw points outside the card's own graded-implied bounds (troll listing
  // above, damaged-copy floor below) are data errors, not prices.
  const points = pickDailySeries(rows).filter((p) => withinRawBounds(bounds, p.market_usd))
  return { points, source: 'Midpoint daily archive of real sold listings', variant: primary === null ? null : variantLabel(primary) }
}

export interface ArchiveRow {
  captured_on: string
  market: number | null
  condition?: string | null
  company?: string | null
  variant?: string | null
}

/** Raw rows carry several conditions per day; the series must follow one.
 *  NM is what seo_cards.raw_market reports, so prefer it, then the generic
 *  PriceCharting rung, then progressively worse conditions. */
const CONDITION_RANK: Record<string, number> = { NM: 0, '': 1, Ungraded: 1, LP: 2, MP: 3, HP: 4, DM: 5 }
const conditionRank = (c: string | null | undefined): number => CONDITION_RANK[c ?? ''] ?? 6

export const pickDailySeries = (rows: ArchiveRow[]): Point[] => {
  const byDay = new Map<string, ArchiveRow>()
  for (const row of rows) {
    if (row.market === null) continue
    const current = byDay.get(row.captured_on)
    // Prefer the better condition; among equals prefer PSA over the generic company.
    if (!current || conditionRank(row.condition) < conditionRank(current.condition) || (conditionRank(row.condition) === conditionRank(current.condition) && row.company === 'PSA' && current.company !== 'PSA')) {
      byDay.set(row.captured_on, row)
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, r]) => ({ date, market_usd: cents(r.market) }))
}

/** Live Scrydex history, cached 24h in scrydex_cache (shared with the web app). */
const loadScrydex = async (ctx: ToolContext, game: string, cardId: string, days: number, grade?: string): Promise<{ points: Point[]; source: string; variant: string | null }> => {
  const company = grade ? 'PSA' : ''
  const cacheKeyDb = `hist:${game}:${cardId}:${days}:::${company}:${grade ?? ''}`
  const { data: cached } = await ctx.db.from('scrydex_cache').select('payload, fetched_at').eq('cache_key', cacheKeyDb).maybeSingle()
  const bounds: RawBounds = grade ? { ceiling: null, floor: null } : await getRawBounds(ctx.db, cardId)
  const guard = (pts: Point[]): Point[] => pts.filter((p) => withinRawBounds(bounds, p.market_usd))

  if (cached && Date.now() - new Date(cached.fetched_at as string).getTime() < SCRYDEX_CACHE_TTL_MS) {
    const payload = cached.payload as { points?: Array<{ date: string; market: number | null }> }
    return { points: guard((payload.points ?? []).map((p) => ({ date: p.date, market_usd: cents(p.market) }))), source: 'Scrydex market history (cached)', variant: null }
  }

  try {
    const history = await fetchScrydexHistory(
      { apiKey: ctx.config.SCRYDEX_API_KEY as string, teamId: ctx.config.SCRYDEX_TEAM_ID as string },
      game,
      cardId,
      { days, ...(grade ? { company, grade } : {}) }
    )
    const raw = history
      .map((day) => {
        const price = day.prices.find((p) => !(p.is_signed ?? false) && !(p.is_error ?? false) && !(p.is_perfect ?? false)) ?? day.prices[0]
        return { date: day.date.replaceAll('/', '-'), market: price?.market ?? null, low: price?.low ?? null, high: price?.high ?? null }
      })
      .filter((p) => p.market !== null)
      .reverse()
    await ctx.db.from('scrydex_cache').upsert({ cache_key: cacheKeyDb, payload: { cardId, days, points: raw }, fetched_at: new Date().toISOString() })
    return { points: guard(raw.map((p) => ({ date: p.date, market_usd: cents(p.market) }))), source: 'Scrydex market history', variant: null }
  } catch (error) {
    console.error('[get_price_history] scrydex failed, falling back to archive:', error instanceof Error ? error.message : error)
    return loadArchive(ctx, cardId, days, grade)
  }
}
