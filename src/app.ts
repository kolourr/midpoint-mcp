import express, { type Request, type Response, type NextFunction } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { ToolContext } from './lib/context.js'
import { RateLimiter, clientIp } from './lib/rate-limit.js'
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js'

/**
 * HTTP surface:
 *   POST/GET/DELETE /mcp                        Streamable HTTP MCP endpoint (stateless)
 *   GET  /healthz                                liveness
 *   GET  /.well-known/openai-apps-challenge      ChatGPT domain-verification token
 *   GET  /                                       human-readable pointer
 */
export const createApp = (ctx: ToolContext) => {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(express.json({ limit: '256kb' }))

  const limiter = new RateLimiter(ctx.config.RATE_LIMIT_PER_MINUTE, 60_000)

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION })
  })

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
    const verdict = limiter.hit(ip)
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

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const server = createMcpServer(ctx)
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
