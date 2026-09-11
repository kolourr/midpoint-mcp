import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { registerSearchCards } from './search-cards.js'
import { registerGetCardPrices } from './get-card-prices.js'
import { registerGradingRoi } from './grading-roi.js'
import { registerBestCardsToGrade } from './best-cards-to-grade.js'
import { registerTrendingCards } from './trending-cards.js'
import { registerLiquidMovers } from './liquid-movers.js'
import { registerPriceHistory } from './price-history.js'
import { registerListSets } from './list-sets.js'
import { registerGetSetCards } from './get-set-cards.js'

export const TOOL_NAMES = [
  'search_cards',
  'get_card_prices',
  'grading_roi',
  'get_price_history',
  'best_cards_to_grade',
  'trending_cards',
  'liquid_movers',
  'list_sets',
  'get_set_cards'
] as const

export const registerAllTools = (server: McpServer, ctx: ToolContext): void => {
  registerSearchCards(server, ctx)
  registerGetCardPrices(server, ctx)
  registerGradingRoi(server, ctx)
  registerPriceHistory(server, ctx)
  registerBestCardsToGrade(server, ctx)
  registerTrendingCards(server, ctx)
  registerLiquidMovers(server, ctx)
  registerListSets(server, ctx)
  registerGetSetCards(server, ctx)
}
