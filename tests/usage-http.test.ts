/**
 * The client label must survive the MCP SDK's HTTP transport: a tools/call
 * over POST /mcp is counted under the utm_source derived from the request,
 * not under "unknown". Uses a stub database so no network is involved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/lib/config.js'
import { TtlCache } from '../src/lib/cache.js'
import { buildLinks } from '../src/lib/links.js'
import type { ToolContext } from '../src/lib/context.js'
import { usage } from '../src/lib/usage.js'

const stubCtx = (): ToolContext => {
  const config = loadConfig({ SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SECRET_KEY: 'x'.repeat(32) })
  return {
    config,
    db: { rpc: async () => ({ data: [], error: null }) } as unknown as ToolContext['db'],
    cache: new TtlCache<unknown>(100),
    links: buildLinks(config.SITE_URL),
    warm: { liquidMovers: { get: async () => ({ value: [], loadedAt: 0 }), stop: () => undefined } as unknown as ToolContext['warm']['liquidMovers'] }
  }
}

describe('usage over HTTP', () => {
  let server: Server
  let base = ''

  beforeAll(async () => {
    server = createApp(stubCtx()).listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r))
  })

  const call = (headers: Record<string, string>) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_cards', arguments: { query: 'nothing matches this' } } })
    })

  it('counts the call under the client derived from User-Agent / X-Midpoint-Client', async () => {
    usage.drain()
    const a = await call({ 'user-agent': 'claude-user/1.0' })
    expect(a.status).toBe(200)
    await a.text()
    const b = await call({ 'user-agent': 'node', 'x-midpoint-client': 'chrome-extension/0.2.0' })
    expect(b.status).toBe(200)
    await b.text()
    const rows = usage.drain().sort((x, y) => x.client.localeCompare(y.client))
    expect(rows.map((r) => [r.client, r.tool, r.calls, r.errors])).toEqual([
      ['chrome_extension', 'search_cards', 1, 0],
      ['claude', 'search_cards', 1, 0]
    ])
  })
})
