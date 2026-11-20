/**
 * Directory listings (the official MCP Registry, mcptry) and agents read the
 * tool list as documentation: every argument of every tool needs a
 * description, and the server names its icon. Uses a stub database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/lib/config.js'
import { TtlCache } from '../src/lib/cache.js'
import { buildLinks } from '../src/lib/links.js'
import type { ToolContext } from '../src/lib/context.js'
import { SERVER_ICONS, SERVER_VERSION } from '../src/server.js'
import { TOOL_NAMES } from '../src/tools/index.js'

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

interface ListedTool {
  name: string
  description?: string
  inputSchema: { properties?: Record<string, { description?: string }> }
}

/** The transport answers with JSON or with one SSE `data:` line. */
const parseRpc = (text: string): { result: Record<string, unknown> } => {
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return JSON.parse(line ? line.slice(5) : text)
}

describe('tool documentation', () => {
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

  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
    expect(res.status).toBe(200)
    return parseRpc(await res.text()).result
  }

  it('describes every argument of every tool', async () => {
    const { tools } = (await rpc('tools/list')) as { tools: ListedTool[] }
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
    const missing = tools.flatMap((t) =>
      Object.entries(t.inputSchema.properties ?? {})
        .filter(([, prop]) => !prop.description || prop.description.trim().length < 10)
        .map(([arg]) => `${t.name}.${arg}`)
    )
    expect(missing).toEqual([])
  })

  it('names its icon when a client connects', async () => {
    const result = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' }
    })
    const info = result.serverInfo as { version: string; icons?: unknown }
    expect(info.version).toBe(SERVER_VERSION)
    expect(info.icons).toEqual(SERVER_ICONS)
  })

  it('serves the icon server.json points at', async () => {
    const manifest = JSON.parse(readFileSync('server.json', 'utf8')) as {
      version: string
      icons: { src: string; mimeType: string; sizes: string[] }[]
    }
    expect(manifest.version).toBe(SERVER_VERSION)
    expect(manifest.icons).toEqual(SERVER_ICONS)
    const path = new URL(manifest.icons[0].src).pathname
    const res = await fetch(`${base}${path}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const bytes = Buffer.from(await res.arrayBuffer())
    // PNG header: width and height are big-endian at bytes 16 and 20.
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(manifest.icons[0].sizes[0])
  })
})
