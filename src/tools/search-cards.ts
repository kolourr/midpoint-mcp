import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { GAME_KEYS } from '../lib/games.js'
import { cacheKey, MINUTE } from '../lib/cache.js'
import { cardSummarySchema, toSummary, type CatalogListRow, type CardSummary } from '../lib/prices.js'
import { fallbackTerm, parseQuery, rankRows, searchTerms, unionRows } from '../lib/search.js'
import { money } from '../lib/format.js'
import { ok, guarded } from '../lib/tool-result.js'

const CANDIDATE_ROWS = 200

const input = {
  query: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .describe('Card name, optionally with set, number or year. Examples: "Umbreon VMAX Evolving Skies", "1986 Fleer Jordan", "Charizard base set 4/102".'),
  game: z.enum(GAME_KEYS).optional().describe('Restrict to one game or sport. Omit when unsure.'),
  set_id: z.string().trim().max(60).regex(/^[a-zA-Z0-9_.-]*$/).optional().describe('Expansion id from list_sets, to search inside one set.'),
  limit: z.number().int().min(1).max(50).default(10)
}

const output = {
  query: z.string(),
  matched_on: z.string().describe('The search term that produced the results'),
  count: z.number().int(),
  cards: z.array(cardSummarySchema),
  note: z.string().optional()
}

const rpcSearch = async (ctx: ToolContext, term: string, game?: string, setId?: string): Promise<CatalogListRow[]> => {
  const { data, error } = await ctx.db.rpc('prices_index', {
    search: term.replace(/[%_]/g, ' '),
    game_filter: game ?? null,
    max_rows: CANDIDATE_ROWS,
    expansion_filter: setId ?? null,
    rarity_filter: null
  })
  if (error) throw error
  return (data ?? []) as CatalogListRow[]
}

/** Query the full string and the key name tokens in parallel, union, rank by query coverage. */
export const searchCatalog = async (
  ctx: ToolContext,
  query: string,
  game?: string,
  setId?: string
): Promise<{ rows: CatalogListRow[]; matchedOn: string }> => {
  const parsed = parseQuery(query)
  const terms = searchTerms(query)
  const batches = await Promise.all(terms.map((term) => rpcSearch(ctx, term, game, setId)))
  const hit = terms.filter((_, i) => (batches[i]?.length ?? 0) > 0)
  if (hit.length > 0) return { rows: rankRows(unionRows(batches), parsed), matchedOn: hit.join(' + ') }
  const fallback = fallbackTerm(query)
  if (fallback) {
    const rows = await rpcSearch(ctx, fallback, game, setId)
    if (rows.length > 0) return { rows: rankRows(rows, parsed), matchedOn: fallback }
  }
  return { rows: [], matchedOn: query }
}

export const registerSearchCards = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'search_cards',
    {
      title: 'Search card prices',
      description:
        'Use this first when the user names a trading card and wants its value, price, or whether to grade it. Searches 1.5M+ Pokémon, Magic, Yu-Gi-Oh!, One Piece, Lorcana, sports (baseball, basketball, football, hockey, soccer, wrestling, UFC and more) and entertainment cards by name, set, number and year, returning ungraded and PSA 10 market prices in USD from real sold listings. Returns card ids for get_card_prices, grading_roi and get_price_history. Do not use for sealed product, for cards you already have an id for, or for price prediction.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('search_cards', async (args) => {
      const key = cacheKey('search_cards', { q: args.query.toLowerCase(), game: args.game ?? '', set: args.set_id ?? '' })
      const { rows, matchedOn } = (await ctx.cache.getOrLoad(key, 15 * MINUTE, () => searchCatalog(ctx, args.query, args.game, args.set_id))) as Awaited<ReturnType<typeof searchCatalog>>

      const cards: CardSummary[] = rows.slice(0, args.limit).map((row) => toSummary(row, ctx.links.card(row.id)))
      const note =
        cards.length === 0
          ? 'No priced card matched. Try the card or player name alone, check the spelling, or drop the game filter.'
          : matchedOn.includes(' + ') || matchedOn !== args.query.toLowerCase().trim()
            ? 'Ranked by how much of the query each card explains (name, set, year, number); confirm the set and number with the user if several look alike.'
            : undefined
      const lines = cards.map(
        (c) => `- ${c.name}${c.set ? ` (${c.set}${c.number ? ` #${c.number}` : ''})` : ''} [${c.game}]: raw ${money(c.raw_market_usd)}, PSA 10 ${money(c.psa10_market_usd)} · id ${c.id}`
      )
      const text = cards.length
        ? `${cards.length} match${cards.length === 1 ? '' : 'es'} for "${args.query}" (USD, real sold listings):\n${lines.join('\n')}${note ? `\n${note}` : ''}`
        : `No match for "${args.query}". ${note}`
      return ok({ query: args.query, matched_on: matchedOn, count: cards.length, cards, ...(note ? { note } : {}) }, text)
    })
  )
}
