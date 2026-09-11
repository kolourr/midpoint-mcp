import { loadConfig } from './lib/config.js'
import { buildContext, startWarmers } from './context.js'
import { createApp } from './app.js'
import { SERVER_NAME, SERVER_VERSION } from './server.js'

const config = loadConfig()
const ctx = buildContext(config)
startWarmers(ctx)

const app = createApp(ctx)
const httpServer = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`${SERVER_NAME} ${SERVER_VERSION} listening on :${config.PORT} (/mcp)`)
})

const shutdown = (signal: string): void => {
  console.log(`${signal} received, closing`)
  ctx.warm.liquidMovers.stop()
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
