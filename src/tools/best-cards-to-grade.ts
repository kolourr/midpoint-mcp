import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, HOUR } from '../lib/cache.js'
import { SEO_CARD_COLS, type SeoCardRow } from '../lib/prices.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { cents, money, multiple } from '../lib/format.js'
import { ok, guarded } from '../lib/tool-result.js'

const WORTH_GRADING_MIN_GRADED = 1000

const input = {
  game: z.enum(GAME_KEYS).describe('Game or sport to rank.'),
  set_slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional().describe('Optional set slug (as used on /sets/<game>/<slug>) to rank inside one set.'),
  limit: z.number().int().min(1).max(50).default(12)
}

const output = {
  game: z.string(),
  criteria: z.string(),
  count: z.number().int(),
  cards: z.array(z.object({
    id: z.string(),
    name: z.string(),
    set: z.string().nullable(),
    number: z.string().nullable(),
    raw_market_usd: z.number().nullable(),
    psa10_usd: z.number().nullable(),
    best_graded_usd: z.number().nullable(),
    gem_premium_multiple: z.number().nullable(),
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
        'Use this when the user asks which cards in a game, sport or set have the biggest payoff from grading (largest PSA 10 premium over raw). Ranks priced cards by gem premium where the graded value is at least $1,000 and raw is at least $5. Returns card ids for grading_roi. Do not use for a single named card.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('best_cards_to_grade', async ({ game, set_slug, limit }) => {
      const key = cacheKey('best_cards_to_grade', { game, set_slug: set_slug ?? '', limit })
      const rows = (await ctx.cache.getOrLoad(key, HOUR, async () => {
        let q = ctx.db
          .from('seo_cards')
          .select(SEO_CARD_COLS)
          .eq('game', game)
          .eq('is_priced', true)
          .eq('product_type', 'card')
          .gte('best_graded', WORTH_GRADING_MIN_GRADED)
          .gte('raw_market', 5)
          .not('gem_premium', 'is', null)
        if (set_slug) q = q.eq('set_slug', set_slug)
        const { data, error } = await q.order('gem_premium', { ascending: false, nullsFirst: false }).limit(limit)
        if (error) throw error
        return (data ?? []) as SeoCardRow[]
      })) as SeoCardRow[]

      const cards = rows.map((r) => ({
        id: r.catalog_card_id,
        name: r.name,
        set: r.set_name,
        number: r.number,
        raw_market_usd: cents(r.raw_market),
        psa10_usd: cents(r.psa10),
        best_graded_usd: cents(r.best_graded),
        gem_premium_multiple: r.gem_premium !== null ? Math.round(r.gem_premium * 10) / 10 : null,
        url: ctx.links.worthGrading(r.catalog_card_id)
      }))
      const structured = {
        game: gameLabel(game),
        criteria: `Ranked by PSA 10 ÷ raw among cards with a graded value ≥ $${WORTH_GRADING_MIN_GRADED} and raw ≥ $5${set_slug ? `, set ${set_slug}` : ''}.`,
        count: cards.length,
        cards,
        links: { worth_grading_index: ctx.links.worthGradingIndex() }
      }
      const text = cards.length
        ? [`Biggest grading premiums in ${structured.game}${set_slug ? ` / ${set_slug}` : ''} (USD):`, ...cards.map((c, i) => `${i + 1}. ${c.name}${c.set ? ` (${c.set})` : ''}: raw ${money(c.raw_market_usd)} → PSA 10 ${money(c.psa10_usd ?? c.best_graded_usd)} (${multiple(c.gem_premium_multiple)}) · id ${c.id}`), '', `More: ${structured.links.worth_grading_index}`].join('\n')
        : `No ${structured.game} cards${set_slug ? ` in ${set_slug}` : ''} meet the criteria (${structured.criteria}).`
      return ok(structured, text)
    })
  )
}
