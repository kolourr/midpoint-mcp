import { describeError } from './tool-result.js'

/**
 * Keeps one expensive query result hot in memory. The liquid_movers RPC
 * runs close to the service-role statement timeout, so it is loaded at
 * boot with retries and refreshed on a timer; tool calls never wait on
 * a cold run once the first load has landed.
 */
export interface WarmerOptions {
  label: string
  refreshMs: number
  attempts?: number
  backoffMs?: number
  now?: () => number
}

export class Warmer<V> {
  private value: V | undefined
  private loadedAt = 0
  private inflight: Promise<V> | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly load: () => Promise<V>,
    private readonly opts: WarmerOptions
  ) {}

  /** Kick off the first load and the refresh timer. Never throws. */
  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Current value, or wait for the in-flight/first load. */
  async get(): Promise<{ value: V; loadedAt: number }> {
    if (this.value !== undefined) return { value: this.value, loadedAt: this.loadedAt }
    const value = await (this.inflight ?? this.refresh())
    return { value, loadedAt: this.loadedAt }
  }

  private async refresh(): Promise<V> {
    if (this.inflight) return this.inflight
    this.inflight = this.loadWithRetry().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private async loadWithRetry(): Promise<V> {
    const attempts = this.opts.attempts ?? 3
    const backoff = this.opts.backoffMs ?? 5000
    let lastError: unknown
    for (let i = 0; i < attempts; i += 1) {
      try {
        const value = await this.load()
        this.value = value
        this.loadedAt = (this.opts.now ?? Date.now)()
        return value
      } catch (error) {
        lastError = error
        console.error(`[warm:${this.opts.label}] attempt ${i + 1}/${attempts} failed: ${describeError(error)}`)
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoff * (i + 1)))
      }
    }
    if (this.value !== undefined) return this.value
    throw lastError
  }
}
