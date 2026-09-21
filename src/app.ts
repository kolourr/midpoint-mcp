import path from 'node:path'
import express, { type Request, type Response, type NextFunction } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { ToolContext } from './lib/context.js'
import { RateLimiter, clientIp } from './lib/rate-limit.js'
import { buildLinks } from './lib/links.js'
import { isSharedEgressHost, utmSourceFor } from './lib/client.js'
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js'

/**
 * HTTP surface:
 *   POST/GET/DELETE /mcp                        Streamable HTTP MCP endpoint (stateless)
 *   GET  /healthz                                liveness
 *   GET  /.well-known/openai-apps-challenge      ChatGPT domain-verification token
 *   GET  /                                       human-readable pointer
 */
const header = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

export const createApp = (ctx: ToolContext) => {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '256kb' }))

  const perIp = ctx.config.RATE_LIMIT_PER_MINUTE
  const perAgentHost = ctx.config.RATE_LIMIT_PER_MINUTE_AGENTS ?? perIp * 5
  const limiter = new RateLimiter(perIp, 60_000)

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION })
  })

  // Connector directories (Claude, Muse) show the server host's favicon.
  const iconPath = path.join(process.cwd(), 'assets', 'icon-512.png')
  const sendIcon = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.sendFile(iconPath, (err) => { if (err) res.status(404).end() })
  }
  app.get('/favicon.ico', sendIcon)
  app.get('/icon-512.png', sendIcon)

  app.get('/.well-known/openai-apps-challenge', (_req, res) => {
    const token = ctx.config.OPENAI_APPS_CHALLENGE_TOKEN
    if (!token) {
      res.status(404).type('text/plain').send('not configured')
      return
    }
    res.type('text/plain').set('Cache-Control', 'no-store').send(token)
  })

  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      `${SERVER_NAME} ${SERVER_VERSION}\nMCP endpoint: POST /mcp (Streamable HTTP)\nDocs: ${ctx.config.SITE_URL}/mcp\n`
    )
  })

  const rateLimit = (req: Request, res: Response, next: NextFunction): void => {
    const ip = clientIp(req.headers, req.socket.remoteAddress ?? 'unknown')
    const source = utmSourceFor(req.headers['user-agent'], header(req.headers['x-midpoint-client']))
    // Assistant hosts share egress IPs across all their users: count them
    // per host+IP under the higher ceiling; everyone else per IP.
    const shared = isSharedEgressHost(source)
    const verdict = limiter.hit(shared ? `${source}:${ip}` : ip, shared ? perAgentHost : perIp)
    if (!verdict.allowed) {
      res.status(429).set('Retry-After', String(verdict.retryAfterSec)).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: `Rate limit exceeded. Retry in ${verdict.retryAfterSec}s.` },
        id: null
      })
      return
    }
    next()
  }

  // Distinct user agents are logged once so the client → utm_source rules
  // in client.ts can be refined from real traffic. No IPs, no payloads.
  const seenAgents = new Set<string>()

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const userAgent = req.headers['user-agent']
    if (userAgent && !seenAgents.has(userAgent) && seenAgents.size < 200) {
      seenAgents.add(userAgent)
      console.log(`[mcp] client user-agent: ${userAgent} → utm_source=${utmSourceFor(userAgent)}`)
    }
    const server = createMcpServer({ ...ctx, links: buildLinks(ctx.config.SITE_URL, utmSourceFor(userAgent, header(req.headers['x-midpoint-client']))) })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('[mcp] request failed:', error instanceof Error ? error.message : error)
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
      }
    }
  }

  app.post('/mcp', rateLimit, handleMcp)
  // Stateless: no server-initiated streams and no sessions to delete.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST /mcp.' },
      id: null
    })
  }
  app.get('/mcp', methodNotAllowed)
  app.delete('/mcp', methodNotAllowed)

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found. MCP endpoint is /mcp.')
  })

  // Body-parser and other synchronous errors: JSON-RPC shaped, no stack trace.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : 500
    if (status >= 500) console.error('[http] unhandled:', error instanceof Error ? error.message : error)
    if (res.headersSent) return
    res.status(status).json({
      jsonrpc: '2.0',
      error: { code: status === 400 ? -32700 : -32603, message: status === 400 ? 'Parse error: body must be JSON' : 'Internal server error' },
      id: null
    })
  })

  return app
}
