/**
 * Tiny in-memory TTL cache. The price data refreshes once a day, so a
 * short cache absorbs the burst pattern chat clients produce (the same
 * search repeated across turns) without any external dependency.
 */
interface Entry<V> {
  value: V
  expiresAt: number
}

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>()

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs })
  }

  async getOrLoad(key: string, ttlMs: number, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key)
    if (hit !== undefined) return hit
    const value = await load()
    this.set(key, value, ttlMs)
    return value
  }

  get size(): number {
    return this.store.size
  }
}

export const cacheKey = (tool: string, args: Record<string, unknown>): string =>
  `${tool}:${JSON.stringify(args, Object.keys(args).sort())}`

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
