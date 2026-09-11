import type { Config } from './lib/config.js'
import type { ToolContext } from './lib/context.js'
import { createServiceClient } from './lib/supabase.js'
import { TtlCache, HOUR } from './lib/cache.js'
import { buildLinks } from './lib/links.js'
import { Warmer } from './lib/warm.js'
import { loadLiquidMovers } from './tools/liquid-movers.js'

/** Build the shared process context (used by index.ts and the live tests). */
export const buildContext = (config: Config): ToolContext => {
  const db = createServiceClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY)
  return {
    config,
    db,
    cache: new TtlCache<unknown>(5000),
    links: buildLinks(config.SITE_URL),
    warm: {
      liquidMovers: new Warmer(() => loadLiquidMovers(db), { label: 'liquid_movers', refreshMs: 55 * 60_000, attempts: 3, backoffMs: 10_000 })
    }
  }
}

export const startWarmers = (ctx: ToolContext): void => {
  ctx.warm.liquidMovers.start()
}

export { HOUR }
