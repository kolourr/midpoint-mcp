/**
 * Minimal MCP-over-HTTP client for the Discord bot: one JSON-RPC
 * tools/call per command against the public server. Identifies itself
 * with X-Midpoint-Client so the server labels usage and links
 * (utm_source) as "discord". Parses both a plain JSON response and the
 * SSE form the Streamable HTTP transport may answer with.
 */
export interface ToolCallResult {
  isError?: boolean
  structuredContent?: Record<string, unknown>
  content?: Array<{ type: string; text?: string }>
}

export class McpHttpClient {
  private nextId = 1

  constructor(
    private readonly url: string,
    private readonly clientTag = 'discord/1.0',
    private readonly timeoutMs = 20_000
  ) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': 'midpoint-discord-bot/1.0',
          'x-midpoint-client': this.clientTag
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } }),
        signal: controller.signal
      })
      if (res.status === 429) throw new Error('rate limited')
      if (!res.ok) throw new Error(`MCP HTTP ${res.status}`)
      const text = await res.text()
      const payload = parseRpc(text, res.headers.get('content-type') ?? '')
      if (payload.error) throw new Error(payload.error.message ?? 'MCP error')
      return (payload.result ?? {}) as ToolCallResult
    } finally {
      clearTimeout(timer)
    }
  }
}

interface RpcEnvelope {
  result?: unknown
  error?: { message?: string }
}

/** JSON body, or the last `data:` line of an SSE body. */
export const parseRpc = (text: string, contentType: string): RpcEnvelope => {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text) as RpcEnvelope
  const lines = text.split('\n').filter((l) => l.startsWith('data:'))
  const last = lines[lines.length - 1]
  if (!last) throw new Error('empty SSE response')
  return JSON.parse(last.slice(5).trim()) as RpcEnvelope
}
