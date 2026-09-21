import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, HOUR } from '../lib/cache.js'
import { toSummary, cardSummarySchema, type CatalogListRow } from '../lib/prices.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { money } from '../lib/format.js'
import { fail, ok, guarded } from '../lib/tool-result.js'

const input = {
  game: z.enum(GAME_KEYS),
  set_id: z.string().trim().min(1).max(60).regex(/^[a-zA-Z0-9_.-]+$/).describe('Expansion id from list_sets.'),
  sort: z.enum(['value', 'number']).default('value').describe('"value" = most valuable first; "number" = checklist order.'),
  limit: z.number().int().min(1).max(100).default(25)
}

const output = {
  game: z.string(),
  set_id: z.string(),
  set_name: z.string().nullable(),
  total_cards: z.number().int(),
  count: z.number().int(),
  cards: z.array(cardSummarySchema)
}

export const registerGetSetCards = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'get_set_cards',
    {
      title: 'Cards in a set with prices',
      description:
        'Use this when the user wants the most valuable cards in a specific set or a priced checklist of a set. Requires a set id from list_sets. Returns raw and PSA 10 USD prices per card. Do not use for a single named card; use search_cards instead.',
      inputSchema: input,
      outputSchema: output,
      annotations: { title: 'Cards in a set with prices', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('get_set_cards', async ({ game, set_id, sort, limit }) => {
      const key = cacheKey('get_set_cards', { game, set_id })
      const rows = (await ctx.cache.getOrLoad(key, HOUR, async () => {
        const { data, error } = await ctx.db.rpc('set_cards', { gf: game, expansion_filter: set_id })
        if (error) throw error
        return (data ?? []) as CatalogListRow[]
      })) as CatalogListRow[]
      if (rows.length === 0) return fail(`No cards for set "${set_id}" in ${gameLabel(game)}. Call list_sets to find the right set id.`)

      const sorted = sort === 'value' ? [...rows].sort((a, b) => (b.raw_market ?? -1) - (a.raw_market ?? -1)) : rows
      const cards = sorted.slice(0, limit).map((r) => toSummary(r, ctx.links.card(r.id)))
      const structured = { game: gameLabel(game), set_id, set_name: rows[0]?.expansion_name ?? null, total_cards: rows.length, count: cards.length, cards }
      const text = [
        `${structured.set_name ?? set_id} (${structured.game}): ${rows.length} cards, showing ${cards.length} by ${sort} (USD).`,
        ...cards.map((c) => `- ${c.number ? `#${c.number} ` : ''}${c.name}: raw ${money(c.raw_market_usd)}, PSA 10 ${money(c.psa10_market_usd)} · id ${c.id}`)
      ].join('\n')
      return ok(structured, text)
    })
  )
}
