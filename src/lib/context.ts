import type { Config } from './config.js'
import type { TtlCache } from './cache.js'
import type { Links } from './links.js'
import type { ServiceClient } from './supabase.js'
import type { Warmer } from './warm.js'
import type { CatalogListRow } from './prices.js'

/** Everything a tool needs, built once per process and shared per request. */
export interface ToolContext {
  db: ServiceClient
  cache: TtlCache<unknown>
  links: Links
  config: Config
  warm: {
    liquidMovers: Warmer<CatalogListRow[]>
  }
}
