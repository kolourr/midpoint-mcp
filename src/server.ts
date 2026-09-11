import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './lib/context.js'
import { registerAllTools } from './tools/index.js'

export const SERVER_NAME = 'midpoint-card-prices'
export const SERVER_VERSION = '1.0.0'

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
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS })
  registerAllTools(server, ctx)
  return server
}
