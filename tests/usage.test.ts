import { describe, expect, it } from 'vitest'
import { UsageBuffer, currentClient, recordToolCall, startUsageFlusher, usage, withRequestClient } from '../src/lib/usage.js'
import { guarded, ok } from '../src/lib/tool-result.js'

describe('UsageBuffer', () => {
  it('aggregates calls per UTC day, client and tool', () => {
    let now = Date.UTC(2026, 8, 21, 23, 59, 0)
    const b = new UsageBuffer(() => now)
    b.record('claude', 'search_cards', true)
    b.record('claude', 'search_cards', false)
    b.record('chatgpt_plugin', 'search_cards', true)
    now += 2 * 60_000 // crosses midnight UTC
    b.record('claude', 'search_cards', true)
    const rows = b.drain().sort((a, c) => `${a.day}${a.client}`.localeCompare(`${c.day}${c.client}`))
    expect(rows).toEqual([
      { day: '2026-09-21', client: 'chatgpt_plugin', tool: 'search_cards', calls: 1, errors: 0 },
      { day: '2026-09-21', client: 'claude', tool: 'search_cards', calls: 2, errors: 1 },
      { day: '2026-09-22', client: 'claude', tool: 'search_cards', calls: 1, errors: 0 }
    ])
    expect(b.size).toBe(0)
  })

  it('merge adds failed-flush rows back without losing new arrivals', () => {
    const b = new UsageBuffer(() => Date.UTC(2026, 8, 21))
    b.record('claude', 'grading_roi', true)
    const taken = b.drain()
    b.record('claude', 'grading_roi', true)
    b.merge(taken)
    expect(b.drain()).toEqual([{ day: '2026-09-21', client: 'claude', tool: 'grading_roi', calls: 2, errors: 0 }])
  })
})

describe('request scope', () => {
  it('is unknown outside a request and set inside, across awaits', async () => {
    expect(currentClient()).toBe('unknown')
    const seen = await withRequestClient('cursor', async () => {
      await new Promise((r) => setTimeout(r, 1))
      return currentClient()
    })
    expect(seen).toBe('cursor')
    expect(currentClient()).toBe('unknown')
  })

  it('guarded counts a success and a thrown failure under the request client', async () => {
    usage.drain()
    const good = guarded('list_sets', async () => ok({}, 'fine'))
    const bad = guarded('list_sets', async () => {
      throw new Error('boom')
    })
    await withRequestClient('claude_code', async () => {
      await good({})
      const r = await bad({})
      expect(r.isError).toBe(true)
    })
    recordToolCall('list_sets', true)
    const rows = usage.drain().sort((a, c) => a.client.localeCompare(c.client))
    expect(rows.map((r) => [r.client, r.calls, r.errors])).toEqual([
      ['claude_code', 2, 1],
      ['unknown', 1, 0]
    ])
  })
})

describe('startUsageFlusher', () => {
  it('sends drained rows through the RPC and re-buffers them when it fails', async () => {
    const b = new UsageBuffer(() => Date.UTC(2026, 8, 21))
    const calls: unknown[] = []
    let failNext = true
    const db = {
      rpc: async (_fn: string, args: unknown) => {
        calls.push(args)
        return failNext ? { error: { message: 'down' } } : { error: null }
      }
    }
    const f = startUsageFlusher(db as never, b, 60_000)
    b.record('claude', 'search_cards', true)
    await f.flush()
    expect(b.size).toBe(1) // put back
    failNext = false
    await f.flush()
    expect(b.size).toBe(0)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ p_rows: [{ day: '2026-09-21', client: 'claude', tool: 'search_cards', calls: 1, errors: 0 }] })
    await f.flush() // empty: no RPC
    expect(calls).toHaveLength(2)
    await f.stop()
  })
})
