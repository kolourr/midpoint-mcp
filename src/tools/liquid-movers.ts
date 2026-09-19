import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import type { ServiceClient } from '../lib/supabase.js'
import { toSummary, cardSummarySchema, type CatalogListRow } from '../lib/prices.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { cents, money, pct } from '../lib/format.js'
import { ok, guarded } from '../lib/tool-result.js'

/** Thresholds the app's Home shelf uses; the RPC is too slow to vary per call. */
const MIN_VOLUME = 25
const MIN_MARKET = 5
const SUPERSET_ROWS = 100

export const loadLiquidMovers = async (db: ServiceClient): Promise<CatalogListRow[]> => {
  const { data, error } = await db.rpc('liquid_movers', { max_rows: SUPERSET_ROWS, min_volume: MIN_VOLUME, min_market: MIN_MARKET })
  if (error) throw error
  return (data ?? []) as CatalogListRow[]
}

const input = {
  game: z.enum(GAME_KEYS).optional().describe('Restrict to one game or sport; omit for all.'),
  include_unknown_volume: z.boolean().default(false).describe('Also include cards whose yearly sales count is not tracked (mostly Pokémon from the Scrydex source). Off by default so every result has a verifiable sales figure.'),
  limit: z.number().int().min(1).max(50).default(15)
}

const output = {
  as_of: z.string().describe('When this ranking was computed (ISO 8601)'),
  criteria: z.string(),
  count: z.number().int(),
  cards: z.array(cardSummarySchema.extend({ change_pct: z.number().nullable(), sales_per_year: z.number().int().nullable().describe('Recorded sales in the last year; null only when include_unknown_volume is on and the source does not track volume.') }))
}

export const registerLiquidMovers = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'liquid_movers',
    {
      title: 'Liquid movers (rising cards that actually sell)',
      description:
        'Use this when the user wants cards that are both rising in price and easy to sell: recent gainers filtered to cards with at least 25 recorded sales a year and a raw price of at least $5, across all games and sports. Better than trending_cards for flipping or selling decisions. Do not use for a single named card.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('liquid_movers', async ({ game, include_unknown_volume, limit }) => {
      const { value, loadedAt } = await ctx.warm.liquidMovers.get()
      // The shared cache ranks by |change| and lets untracked volume through;
      // this tool promises RISING cards with REAL volume, so filter here.
      const rows = value
        .filter((r) => !game || r.game === game)
        .filter((r) => (r.pct ?? 0) > 0)
        .filter((r) => include_unknown_volume || (r.sales_volume !== null && r.sales_volume !== undefined && r.sales_volume >= MIN_VOLUME))
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
        .slice(0, limit)
      const cards = rows.map((r) => ({
        ...toSummary(r, ctx.links.card(r.id)),
        change_pct: cents(r.pct),
        sales_per_year: r.sales_volume ?? null
      }))
      const structured = {
        as_of: new Date(loadedAt).toISOString(),
        criteria: include_unknown_volume
          ? `Raw price ≥ $${MIN_MARKET}, 30-day change > 0, ranked by change; cards without a tracked yearly sales count are included (sales_per_year null).`
          : `Raw price ≥ $${MIN_MARKET}, ≥ ${MIN_VOLUME} recorded sales in the last year, 30-day change > 0, ranked by change.`,
        count: cards.length,
        cards
      }
      const text = cards.length
        ? [`Rising cards with real sales volume${game ? ` in ${gameLabel(game)}` : ''} (raw USD):`, ...cards.map((c, i) => `${i + 1}. ${c.name}${c.set ? ` (${c.set})` : ''}: ${money(c.raw_market_usd)} (${pct(c.change_pct)}${c.sales_per_year ? `, ~${c.sales_per_year} sales/yr` : ''}) · id ${c.id}`)].join('\n')
        : `No liquid movers${game ? ` in ${gameLabel(game)}` : ''} right now (${structured.criteria}).`
      return ok(structured, text)
    })
  )
}
