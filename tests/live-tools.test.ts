/**
 * End-to-end tool calls against the live database through an in-memory
 * MCP client/server pair. Run with `npm run test:live` and SUPABASE_URL /
 * SUPABASE_SECRET_KEY in the environment. Skipped otherwise.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { loadConfig } from '../src/lib/config.js'
import { buildContext } from '../src/context.js'
import { createMcpServer } from '../src/server.js'
import { TOOL_NAMES } from '../src/tools/index.js'

const live = process.env.MCP_LIVE_TESTS === '1'
const d = live ? describe : describe.skip

d('live tools', () => {
  let client: Client
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: args })) as CallToolResult

  beforeAll(async () => {
    const server = createMcpServer(buildContext(loadConfig()))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientTransport)
  })

  it('lists every tool with title and all three hints', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true)
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false)
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false)
      expect(tool.outputSchema, tool.name).toBeTruthy()
      expect(tool.name.length).toBeLessThanOrEqual(64)
    }
  })

  it('search_cards finds Umbreon VMAX and returns ids', async () => {
    const r = await call('search_cards', { query: 'Umbreon VMAX Evolving Skies', game: 'pokemon' })
    expect(r.isError).toBeFalsy()
    const s = r.structuredContent as { count: number; cards: Array<{ id: string; url: string }> }
    expect(s.count).toBeGreaterThan(0)
    expect(s.cards[0]?.url).toContain('utm_medium=mcp')
  })

  it('search_cards handles a sports query', async () => {
    const r = await call('search_cards', { query: '1986 Fleer Michael Jordan', game: 'basketball' })
    const s = r.structuredContent as { count: number; cards: Array<{ name: string }> }
    expect(s.count).toBeGreaterThan(0)
    expect(s.cards.some((c) => /jordan/i.test(c.name))).toBe(true)
  })

  it('get_card_prices returns a ladder for swsh7-215', async () => {
    const r = await call('get_card_prices', { card_id: 'swsh7-215' })
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
    const s = r.structuredContent as { card: { name: string }; raw: unknown[]; graded: unknown[]; currency: string }
    expect(s.card.name).toMatch(/Umbreon/i)
    expect(s.currency).toBe('USD')
    expect(s.raw.length + s.graded.length).toBeGreaterThan(0)
  })

  it('get_card_prices errors cleanly on an unknown id', async () => {
    const r = await call('get_card_prices', { card_id: 'nope-999' })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toMatch(/search_cards/)
  })

  it('grading_roi produces a verdict and tables', async () => {
    const r = await call('grading_roi', { card_id: 'swsh7-215' })
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
    const s = r.structuredContent as { verdict: { tone: string } | null; net_after_fee: unknown[]; links: { worth_grading: string } }
    expect(s.verdict?.tone).toMatch(/strong|conditional|weak/)
    expect(s.net_after_fee.length).toBeGreaterThan(0)
  })

  it('grading_roi honours a custom fee', async () => {
    const r = await call('grading_roi', { card_id: 'swsh7-215', grading_fee_usd: 150 })
    const s = r.structuredContent as { assumed_fee_usd: number }
    expect(s.assumed_fee_usd).toBe(150)
  })

  it('get_price_history returns dated points for a PriceCharting card', async () => {
    const r = await call('get_price_history', { card_id: 'pricecharting-1821843', days: 90 })
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
    const s = r.structuredContent as { points: Array<{ date: string }>; series: string }
    expect(s.series).toBe('raw')
    expect(s.points.length).toBeGreaterThan(0)
  })

  it('get_price_history returns a graded series', async () => {
    const r = await call('get_price_history', { card_id: 'pricecharting-1821843', days: 180, grade: '10' })
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
    expect((r.structuredContent as { series: string }).series).toBe('PSA 10')
  })

  it('best_cards_to_grade ranks pokemon', async () => {
    const r = await call('best_cards_to_grade', { game: 'pokemon', limit: 5 })
    const s = r.structuredContent as { cards: Array<{ expected_net_usd_at_50pct_gem: number; psa9_usd: number; raw_market_usd: number }> }
    expect(s.cards.length).toBe(5)
    expect(s.cards[0]!.expected_net_usd_at_50pct_gem).toBeGreaterThanOrEqual(s.cards[4]!.expected_net_usd_at_50pct_gem)
    expect(s.cards[0]!.psa9_usd).toBeGreaterThan(0)
    expect(s.cards[0]!.raw_market_usd).toBeGreaterThanOrEqual(5)
  })

  it('trending_cards returns movers across all games and per game', async () => {
    const all = await call('trending_cards', { limit: 5 })
    expect(all.isError, JSON.stringify(all.content)).toBeFalsy()
    const s = all.structuredContent as { count: number; cards: Array<{ change_30d_pct: number; basis: string; price_30d_ago_usd: number }> }
    expect(s.count).toBe(5)
    expect(s.cards[0]!.change_30d_pct).toBeGreaterThanOrEqual(s.cards[4]!.change_30d_pct)
    expect(s.cards[0]!.change_30d_pct).toBeLessThanOrEqual(300)
    expect(s.cards[0]!.price_30d_ago_usd).toBeGreaterThanOrEqual(5)
    expect(['PSA 10', 'raw']).toContain(s.cards[0]!.basis)
    const down = await call('trending_cards', { game: 'pokemon', direction: 'down', limit: 3 })
    const d = down.structuredContent as { cards: Array<{ change_30d_pct: number }> }
    expect(d.cards[0]!.change_30d_pct).toBeLessThanOrEqual(0)
  })

  it('search_cards decomposes "charizard base set"', async () => {
    const r = await call('search_cards', { query: 'charizard base set', game: 'pokemon', limit: 5 })
    const s = r.structuredContent as { count: number; cards: Array<{ name: string; set: string | null }> }
    expect(s.count).toBeGreaterThan(0)
    expect(s.cards[0]!.name).toMatch(/charizard/i)
    expect(s.cards[0]!.set ?? '').toMatch(/base/i)
  })

  it('liquid_movers returns cards with volume', async () => {
    const r = await call('liquid_movers', { limit: 5 })
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy()
    expect((r.structuredContent as { count: number }).count).toBeGreaterThan(0)
  })

  it('list_sets then get_set_cards round-trips', async () => {
    const sets = await call('list_sets', { game: 'pokemon', query: 'evolving skies' })
    const s = sets.structuredContent as { sets: Array<{ set_id: string }> }
    expect(s.sets.length).toBeGreaterThan(0)
    const cards = await call('get_set_cards', { game: 'pokemon', set_id: s.sets[0]!.set_id, limit: 5 })
    expect(cards.isError, JSON.stringify(cards.content)).toBeFalsy()
    expect((cards.structuredContent as { count: number }).count).toBe(5)
  })

  it('rejects invalid input with a schema error, not a crash', async () => {
    const r = await call('search_cards', { query: 'x' })
    expect(r.isError).toBe(true)
  })
})
