import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, HOUR } from '../lib/cache.js'
import { GAME_KEYS, gameLabel } from '../lib/games.js'
import { ok, guarded } from '../lib/tool-result.js'

const input = {
  game: z.enum(GAME_KEYS),
  query: z.string().trim().max(60).optional().describe('Optional substring to filter set names, e.g. "evolving" or "2019 prizm".'),
  limit: z.number().int().min(1).max(100).default(30)
}

const output = {
  game: z.string(),
  count: z.number().int(),
  sets: z.array(z.object({
    set_id: z.string().describe('Pass to get_set_cards or search_cards.set_id'),
    name: z.string().nullable(),
    release_date: z.string().nullable(),
    card_count: z.number().int()
  })),
  links: z.object({ sets_index: z.string() })
}

interface ExpansionRow { expansion_id: string; expansion_name: string | null; release_date: string | null; card_count: number }

export const registerListSets = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'list_sets',
    {
      title: 'List sets / expansions',
      description:
        'Use this to find the set id for a game or sport (e.g. "Evolving Skies", "2019 Panini Prizm") before calling get_set_cards, or when the user asks which sets exist. Newest first. Do not use to price a single card.',
      inputSchema: input,
      outputSchema: output,
      annotations: { title: 'List sets / expansions', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('list_sets', async ({ game, query, limit }) => {
      const key = cacheKey('list_sets', { game })
      const all = (await ctx.cache.getOrLoad(key, 6 * HOUR, async () => {
        const { data, error } = await ctx.db.rpc('game_expansions', { gf: game })
        if (error) throw error
        return (data ?? []) as ExpansionRow[]
      })) as ExpansionRow[]
      const needle = query?.toLowerCase()
      const sets = all
        .filter((s) => !needle || (s.expansion_name ?? '').toLowerCase().includes(needle) || s.expansion_id.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((s) => ({ set_id: s.expansion_id, name: s.expansion_name, release_date: s.release_date, card_count: Number(s.card_count) }))
      const structured = { game: gameLabel(game), count: sets.length, sets, links: { sets_index: ctx.links.setsIndex(game) } }
      const text = sets.length
        ? [`${gameLabel(game)} sets${needle ? ` matching "${query}"` : ''} (newest first):`, ...sets.map((s) => `- ${s.name ?? s.set_id} (${s.release_date ?? 'n/a'}, ${s.card_count} cards) · set_id ${s.set_id}`)].join('\n')
        : `No ${gameLabel(game)} set matches "${query}". Browse: ${structured.links.sets_index}`
      return ok(structured, text)
    })
  )
}
