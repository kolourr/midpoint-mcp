import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, HOUR } from '../lib/cache.js'
import { SEO_CARD_COLS, type SeoCardRow } from '../lib/prices.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { cents, money, pct } from '../lib/format.js'
import { ok, guarded } from '../lib/tool-result.js'
import { filterVerified, loadRecentSeries, seriesLooksReal } from '../lib/series-check.js'

/**
 * Reads the daily-rebuilt seo_cards pivot (pct_change_30d), which is
 * indexed per game. The live trending_cards RPC exceeds the statement
 * timeout cold, so it is not used here.
 *
 * pct_change_30d is the PSA 10 change when the card has a PSA 10 price,
 * otherwise the raw change (migration 055). The result states which one
 * it is and shows that pair of values. Moves above ±300% or off a
 * baseline under $5 are single poisoned listings, not markets, and are
 * dropped (same caps the liquid_movers RPC applies).
 */
const MAX_ABS_PCT = 300
const MIN_BASELINE_USD = 5
const CANDIDATE_MULTIPLIER = 4

export interface Mover {
  basis: 'PSA 10' | 'raw'
  before: number
  after: number
  changePct: number
}

/** Which series pct_change_30d refers to for this row, and whether it is trustworthy. */
export const moverOf = (r: Pick<SeoCardRow, 'raw_market' | 'raw_prev30' | 'psa10' | 'psa10_prev30' | 'pct_change_30d'>): Mover | null => {
  if (r.pct_change_30d === null || Math.abs(r.pct_change_30d) > MAX_ABS_PCT) return null
  if (r.psa10 !== null && r.psa10 > 0 && r.psa10_prev30 !== null && r.psa10_prev30 > 0) {
    if (r.psa10_prev30 < MIN_BASELINE_USD) return null
    if (r.raw_market !== null && r.raw_market > r.psa10 * 3) return null
    return { basis: 'PSA 10', before: r.psa10_prev30, after: r.psa10, changePct: r.pct_change_30d }
  }
  if (r.raw_market !== null && r.raw_market > 0 && r.raw_prev30 !== null && r.raw_prev30 > 0) {
    if (r.raw_prev30 < MIN_BASELINE_USD) return null
    return { basis: 'raw', before: r.raw_prev30, after: r.raw_market, changePct: r.pct_change_30d }
  }
  return null
}
const input = {
  game: z.enum(GAME_KEYS).optional().describe('Restrict to one game or sport; omit for all.'),
  direction: z.enum(['up', 'down']).default('up').describe('"up" = biggest gainers, "down" = biggest drops.'),
  min_market_usd: z.number().min(0.5).max(1000).default(5).describe('Ignore cards whose raw price is below this.'),
  limit: z.number().int().min(1).max(50).default(15)
}

const card = z.object({
  id: z.string(),
  name: z.string(),
  game: z.string(),
  set: z.string().nullable(),
  number: z.string().nullable(),
  basis: z.enum(['PSA 10', 'raw']).describe('Which price series the change refers to'),
  price_30d_ago_usd: z.number(),
  price_now_usd: z.number(),
  change_30d_pct: z.number(),
  raw_market_usd: z.number().nullable(),
  psa10_market_usd: z.number().nullable(),
  url: z.string()
})

const output = {
  window_days: z.literal(30),
  direction: z.enum(['up', 'down']),
  game: z.string().nullable(),
  count: z.number().int(),
  excluded_unstable: z.number().int().describe('Candidates dropped because their own 40-day series did not hold together (too few captures, a baseline that swings >2×, a >6× range, or a one-capture jump).'),
  criteria: z.string(),
  cards: z.array(card)
}

const perGame = async (ctx: ToolContext, game: string, direction: 'up' | 'down', minMarket: number, limit: number): Promise<SeoCardRow[]> => {
  const { data, error } = await ctx.db
    .from('seo_cards')
    .select(SEO_CARD_COLS)
    .eq('game', game)
    .eq('is_priced', true)
    .eq('product_type', 'card')
    .gte('raw_market', minMarket)
    .gte('price_points', 3)
    .not('pct_change_30d', 'is', null)
    // Push the sanity caps into the indexed scan; otherwise a game whose top
    // rows are all poisoned (Pokémon) yields an empty candidate pool.
    .lte('pct_change_30d', MAX_ABS_PCT)
    .gte('pct_change_30d', -MAX_ABS_PCT)
    .or(`psa10_prev30.gte.${MIN_BASELINE_USD},and(psa10.is.null,raw_prev30.gte.${MIN_BASELINE_USD})`)
    .order('pct_change_30d', { ascending: direction === 'down', nullsFirst: false })
    .limit(limit * CANDIDATE_MULTIPLIER)
  if (error) throw error
  return (data ?? []) as SeoCardRow[]
}

export const registerTrendingCards = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'trending_cards',
    {
      title: 'Trending cards (30-day price movers)',
      description:
        'Use this when the user asks which cards are rising, hot, spiking, crashing or trending, in one game or across all games. Returns the biggest 30-day gainers (or drops) with the percentage change, measured on the PSA 10 price where the card has one and on the raw price otherwise; moves over 300% are excluded as bad data. Do not use for a single named card or for long-term history.',
      inputSchema: input,
      outputSchema: output,
      annotations: { title: 'Trending cards (30-day price movers)', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('trending_cards', async ({ game, direction, min_market_usd, limit }) => {
      const key = cacheKey('trending_cards', { game: game ?? '', direction, min_market_usd, limit })
      const { rows, dropped } = (await ctx.cache.getOrLoad(key, HOUR, async () => {
        const games = game ? [game] : [...GAME_KEYS]
        const batches = await Promise.all(games.map((g) => perGame(ctx, g, direction, min_market_usd, limit)))
        const sign = direction === 'up' ? -1 : 1
        const candidates = batches
          .flat()
          .filter((r) => moverOf(r) !== null)
          .sort((a, b) => sign * ((a.pct_change_30d ?? 0) - (b.pct_change_30d ?? 0)))
          .slice(0, limit * CANDIDATE_MULTIPLIER)
        // A two-point change on a jumpy series is not a move. Check each
        // candidate's own recent series before reporting it.
        const verified = await filterVerified(candidates, limit, async (r) => seriesLooksReal(await loadRecentSeries(ctx.db, r.catalog_card_id, (moverOf(r) as Mover).basis)))
        return { rows: verified.kept, dropped: verified.dropped }
      })) as { rows: SeoCardRow[]; dropped: number }

      const cards = rows.map((r) => {
        const m = moverOf(r) as Mover
        return {
          id: r.catalog_card_id,
          name: r.name,
          game: gameLabel(r.game),
          set: r.set_name,
          number: r.number,
          basis: m.basis,
          price_30d_ago_usd: cents(m.before) as number,
          price_now_usd: cents(m.after) as number,
          change_30d_pct: cents(m.changePct) as number,
          raw_market_usd: cents(r.raw_market),
          psa10_market_usd: cents(r.psa10),
          url: ctx.links.card(r.catalog_card_id)
        }
      })
      const structured = {
        window_days: 30 as const,
        direction,
        game: game ? gameLabel(game) : null,
        count: cards.length,
        excluded_unstable: dropped,
        criteria: `Raw price ≥ $${min_market_usd}; change measured on the PSA 10 series where the card has one, else raw; each card on its primary printing; |change| ≤ ${MAX_ABS_PCT}%; baseline ≥ $${MIN_BASELINE_USD}; cards whose own 40-day series is unstable are excluded.`,
        cards
      }
      const label = direction === 'up' ? 'gainers' : 'drops'
      const text = cards.length
        ? [`Biggest 30-day ${label}${game ? ` in ${gameLabel(game)}` : ''} (USD; PSA 10 series where the card has one, raw otherwise; each card measured on its primary printing${dropped ? `; ${dropped} candidate(s) with an unstable series excluded` : ''}):`, ...cards.map((c, i) => `${i + 1}. ${c.name}${c.set ? ` (${c.set})` : ''}${game ? '' : ` [${c.game}]`}: ${c.basis} ${money(c.price_30d_ago_usd)} → ${money(c.price_now_usd)} (${pct(c.change_30d_pct)}) · id ${c.id}`)].join('\n')
        : `No 30-day ${label} above $${min_market_usd}${game ? ` for ${gameLabel(game)}` : ''}.`
      return ok(structured, text)
    })
  )
}
