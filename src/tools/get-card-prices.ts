import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, MINUTE } from '../lib/cache.js'
import { getCatalogCard, getLatestLadder, getSeoCard, type Ladder } from '../lib/prices.js'
import { gameLabel } from '../lib/games.js'
import { cents, money, pct } from '../lib/format.js'
import { fail, ok, guarded } from '../lib/tool-result.js'

const input = {
  card_id: z.string().trim().min(1).max(80).describe('Catalog card id from search_cards, e.g. "swsh7-215" or "pricecharting-1821843".')
}

const output = {
  card: z.object({
    id: z.string(),
    name: z.string(),
    game: z.string(),
    set: z.string().nullable(),
    number: z.string().nullable(),
    rarity: z.string().nullable(),
    set_release_date: z.string().nullable()
  }),
  currency: z.literal('USD'),
  captured_on: z.string().nullable().describe('Date of the latest price capture (UTC)'),
  variant: z.string().nullable().describe('The printing the raw and graded rungs refer to (e.g. "holofoil", "1st edition"). Other printings are listed under other_variants.'),
  raw_note: z.string().nullable().describe('Set when the raw condition ladder is out of order (thin data): treat raw prices as low confidence.'),
  raw: z.array(z.object({ condition: z.string(), market_usd: z.number().nullable(), low_usd: z.number().nullable(), high_usd: z.number().nullable() })),
  graded: z.array(z.object({ company: z.string(), grade: z.string(), market_usd: z.number().nullable() })),
  other_variants: z.array(z.object({ variant: z.string(), raw: z.array(z.object({ condition: z.string(), market_usd: z.number().nullable(), low_usd: z.number().nullable(), high_usd: z.number().nullable() })), graded: z.array(z.object({ company: z.string(), grade: z.string(), market_usd: z.number().nullable() })) })).describe('Other printings of the same card id (reverse holo, 1st edition…) with their own prices. Never mix these with the main ladder.'),
  summary: z.object({
    raw_market_usd: z.number().nullable(),
    psa9_usd: z.number().nullable(),
    psa10_usd: z.number().nullable(),
    best_graded_usd: z.number().nullable(),
    change_30d_pct: z.number().nullable()
  }),
  links: z.object({ card_page: z.string(), worth_grading: z.string() })
}

export const registerGetCardPrices = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_card_prices',
    {
      title: 'Get card price ladder',
      description:
        'Use this when the user wants the full current value of a specific card: ungraded prices by condition (NM/LP/MP/HP) and graded prices for every company and grade on record (PSA, CGC, BGS, SGC, TAG). Requires a card id from search_cards. Prices are USD market values from real sold listings, refreshed daily. Do not use to search by name.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('get_card_prices', async ({ card_id }) => {
      const card = await getCatalogCard(ctx.db, card_id)
      if (!card) return fail(`No card with id "${card_id}". Call search_cards to find the id first.`)

      const key = cacheKey('get_card_prices', { card_id })
      const { ladder, seo } = (await ctx.cache.getOrLoad(key, 10 * MINUTE, async () => ({
        ladder: await getLatestLadder(ctx.db, card_id),
        seo: await getSeoCard(ctx.db, card_id)
      }))) as { ladder: Ladder; seo: Awaited<ReturnType<typeof getSeoCard>> }

      const summary = {
        raw_market_usd: cents(seo?.raw_market ?? ladder.raw[0]?.market_usd ?? null),
        psa9_usd: cents(seo?.psa9 ?? null),
        psa10_usd: cents(seo?.psa10 ?? null),
        best_graded_usd: cents(seo?.best_graded ?? null),
        change_30d_pct: cents(seo?.pct_change_30d ?? null)
      }
      const structured = {
        card: {
          id: card.id,
          name: card.name,
          game: gameLabel(card.game),
          set: card.expansion_name,
          number: card.printed_number ?? card.number,
          rarity: card.rarity,
          set_release_date: card.expansion_release_date
        },
        currency: 'USD' as const,
        captured_on: ladder.captured_on ?? seo?.captured_on ?? null,
        variant: ladder.variant,
        raw_note: ladder.raw_note,
        raw: ladder.raw,
        graded: ladder.graded,
        other_variants: ladder.other_variants,
        summary,
        links: { card_page: ctx.links.card(card.id), worth_grading: ctx.links.worthGrading(card.id) }
      }

      const head = `${card.name}${card.expansion_name ? ` — ${card.expansion_name}` : ''}${structured.card.number ? ` #${structured.card.number}` : ''} (${structured.card.game})`
      const rawLines = ladder.raw.length ? ladder.raw.map((r) => `- ${r.condition}: ${money(r.market_usd)}`) : ['- no recent raw sales']
      const gradedLines = ladder.graded.length ? ladder.graded.slice(0, 12).map((g) => `- ${g.company} ${g.grade}: ${money(g.market_usd)}`) : ['- no recent graded sales']
      const otherLines = ladder.other_variants.map((v) => `- ${v.variant}: ${[...v.raw.slice(0, 1).map((r) => `raw ${r.condition} ${money(r.market_usd)}`), ...v.graded.slice(0, 2).map((g) => `${g.company} ${g.grade} ${money(g.market_usd)}`)].join(', ') || 'no recent sales'}`)
      const text = [
        head,
        `USD market prices from real sold listings, last capture ${structured.captured_on ?? 'n/a'}${summary.change_30d_pct !== null ? `, 30-day change ${pct(summary.change_30d_pct)}` : ''}.${ladder.variant ? ` Prices below are for the ${ladder.variant} printing.` : ''}`,
        '',
        'Raw (ungraded):',
        ...rawLines,
        ...(ladder.raw_note ? [`Note: ${ladder.raw_note}`] : []),
        '',
        'Graded:',
        ...gradedLines,
        ...(otherLines.length ? ['', 'Other printings of this card (separate markets):', ...otherLines] : []),
        '',
        `Full ladder and price history: ${structured.links.card_page}`
      ].join('\n')
      return ok(structured, text)
    })
  )
}
