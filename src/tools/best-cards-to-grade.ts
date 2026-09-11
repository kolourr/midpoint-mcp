import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, HOUR } from '../lib/cache.js'
import { SEO_CARD_COLS, type SeoCardRow } from '../lib/prices.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { cents, money, multiple } from '../lib/format.js'
import { ECONOMY_FEE } from '../lib/grading-math.js'
import { ok, guarded } from '../lib/tool-result.js'

/**
 * "Best cards to grade" ranked by expected net profit at a 50% gem rate:
 *   0.5 × PSA 10 + 0.5 × PSA 9 − raw − fee.
 * Ranking by the raw PSA 10 ÷ raw ratio (as the site's hub does) surfaces
 * thin-market artefacts: a $6 POP Series card with one $3,000 PSA 10 sale.
 * Requiring both PSA 9 and PSA 10 prices and ranking on money rather than
 * a ratio favours cards a collector would actually submit.
 */
const MIN_RAW = 5
const MIN_PSA10 = 100
/** PSA 10 above 100× PSA 9 is a single poisoned listing, not a market. */
const MAX_PSA10_TO_PSA9 = 100
const CANDIDATE_POOL = 400

export interface RankedCard {
  row: SeoCardRow
  expectedNet: number
}

export const isPlausibleGradingRow = (r: Pick<SeoCardRow, 'raw_market' | 'psa10' | 'psa9'>): boolean =>
  r.raw_market !== null &&
  r.raw_market >= MIN_RAW &&
  r.psa10 !== null &&
  r.psa10 >= MIN_PSA10 &&
  r.psa10 < 999_999 &&
  r.psa9 !== null &&
  r.psa9 > 0 &&
  r.psa10 <= r.psa9 * MAX_PSA10_TO_PSA9

/** Expected net at a 50% gem rate; a miss lands at the PSA 9 price. Pure. */
export const rankByExpectedNet = (rows: SeoCardRow[], fee: number, limit: number): RankedCard[] =>
  rows
    .filter(isPlausibleGradingRow)
    .map((row) => ({ row, expectedNet: 0.5 * (row.psa10 as number) + 0.5 * (row.psa9 as number) - (row.raw_market as number) - fee }))
    .filter((c) => c.expectedNet > 0)
    .sort((a, b) => b.expectedNet - a.expectedNet)
    .slice(0, limit)

const input = {
  game: z.enum(GAME_KEYS).describe('Game or sport to rank.'),
  set_slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional().describe('Optional set slug (as used on /sets/<game>/<slug>) to rank inside one set.'),
  grading_fee_usd: z.number().min(0).max(5000).optional().describe('Grading fee to assume. Defaults to $25.'),
  limit: z.number().int().min(1).max(50).default(12)
}

const output = {
  game: z.string(),
  criteria: z.string(),
  assumed_fee_usd: z.number(),
  count: z.number().int(),
  cards: z.array(z.object({
    id: z.string(),
    name: z.string(),
    set: z.string().nullable(),
    number: z.string().nullable(),
    raw_market_usd: z.number(),
    psa9_usd: z.number(),
    psa10_usd: z.number(),
    expected_net_usd_at_50pct_gem: z.number().describe('0.5 × PSA 10 + 0.5 × PSA 9 − raw − fee'),
    gem_premium_multiple: z.number().nullable().describe('PSA 10 ÷ raw'),
    url: z.string()
  })),
  links: z.object({ worth_grading_index: z.string() })
}

export const registerBestCardsToGrade = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'best_cards_to_grade',
    {
      title: 'Best cards to grade',
      description:
        'Use this when the user asks which cards in a game, sport or set have the biggest payoff from grading. Ranks priced cards by expected net profit at a 50% gem rate (half PSA 10, half PSA 9, minus raw and the fee), requiring both PSA 9 and PSA 10 prices so thin-market outliers are excluded. Returns card ids for grading_roi. Do not use for a single named card.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('best_cards_to_grade', async ({ game, set_slug, grading_fee_usd, limit }) => {
      const fee = grading_fee_usd ?? ECONOMY_FEE
      const key = cacheKey('best_cards_to_grade', { game, set_slug: set_slug ?? '' })
      const pool = (await ctx.cache.getOrLoad(key, HOUR, async () => {
        let q = ctx.db
          .from('seo_cards')
          .select(SEO_CARD_COLS)
          .eq('game', game)
          .eq('is_priced', true)
          .eq('product_type', 'card')
          .gte('raw_market', MIN_RAW)
          .gte('psa10', MIN_PSA10)
          .not('psa9', 'is', null)
        if (set_slug) q = q.eq('set_slug', set_slug)
        // Expected net is bounded by PSA 10, so the top of the PSA 10 ranking
        // contains every card that can top the expected-net ranking.
        const { data, error } = await q.order('psa10', { ascending: false, nullsFirst: false }).limit(CANDIDATE_POOL)
        if (error) throw error
        return (data ?? []) as SeoCardRow[]
      })) as SeoCardRow[]

      const ranked = rankByExpectedNet(pool, fee, limit)
      const cards = ranked.map(({ row: r, expectedNet }) => ({
        id: r.catalog_card_id,
        name: r.name,
        set: r.set_name,
        number: r.number,
        raw_market_usd: cents(r.raw_market) as number,
        psa9_usd: cents(r.psa9) as number,
        psa10_usd: cents(r.psa10) as number,
        expected_net_usd_at_50pct_gem: cents(expectedNet) as number,
        gem_premium_multiple: r.gem_premium !== null ? Math.round(r.gem_premium * 10) / 10 : null,
        url: ctx.links.worthGrading(r.catalog_card_id)
      }))
      const structured = {
        game: gameLabel(game),
        criteria: `Ranked by expected net at a 50% gem rate (½ PSA 10 + ½ PSA 9 − raw − $${fee} fee) among cards with raw ≥ $${MIN_RAW}, PSA 10 ≥ $${MIN_PSA10}, a PSA 9 price on record and PSA 10 ≤ ${MAX_PSA10_TO_PSA9}× PSA 9${set_slug ? `, set ${set_slug}` : ''}.`,
        assumed_fee_usd: fee,
        count: cards.length,
        cards,
        links: { worth_grading_index: ctx.links.worthGradingIndex() }
      }
      const text = cards.length
        ? [
            `Best ${structured.game}${set_slug ? ` / ${set_slug}` : ''} cards to grade, by expected net at a 50% gem rate after a $${fee} fee (USD):`,
            ...cards.map((c, i) => `${i + 1}. ${c.name}${c.set ? ` (${c.set})` : ''}: raw ${money(c.raw_market_usd)}, PSA 9 ${money(c.psa9_usd)}, PSA 10 ${money(c.psa10_usd)} → expected net ${money(c.expected_net_usd_at_50pct_gem)} (${multiple(c.gem_premium_multiple)} premium) · id ${c.id}`),
            '',
            `More: ${structured.links.worth_grading_index}`
          ].join('\n')
        : `No ${structured.game} cards${set_slug ? ` in ${set_slug}` : ''} meet the criteria (${structured.criteria}).`
      return ok(structured, text)
    })
  )
}
