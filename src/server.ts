import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './lib/context.js'
import { registerAllTools } from './tools/index.js'

export const SERVER_NAME = 'midpoint-card-prices'
export const SERVER_VERSION = '1.0.1'
export const SERVER_TITLE = 'Midpoint Card Prices'
export const SERVER_WEBSITE = 'https://www.cardcenteringtool.com/mcp'

/**
 * The app icon, served by this server at /icon-512.png (src/app.ts).
 * server.json carries the same list for the MCP Registry; a test keeps the
 * two and the file's real size in step.
 */
export const SERVER_ICONS = [
  { src: 'https://mcp.cardcenteringtool.com/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] }
]

/**
 * Kept under 512 characters per OpenAI's guidance. Describes coverage only;
 * no behavioural instructions and no promotion (fair-play rule).
 */
export const INSTRUCTIONS =
  'Midpoint trading-card market data: 1.5M+ Pokémon, Magic, Yu-Gi-Oh!, One Piece, Lorcana, Gundam, sports (baseball, basketball, football, hockey, soccer, wrestling, UFC, golf, tennis, boxing, racing) and entertainment cards. ' +
  'All prices are USD market values from real sold listings, refreshed daily; raw = ungraded. ' +
  'Start with search_cards to get a card id, then get_card_prices, grading_roi or get_price_history. ' +
  'No account is needed and nothing is written.'

/** A fresh server per request: the transport is stateless. */
export const createMcpServer = (ctx: ToolContext): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION, websiteUrl: SERVER_WEBSITE, icons: SERVER_ICONS },
    { instructions: INSTRUCTIONS }
  )
  registerAllTools(server, ctx)
  return server
}
