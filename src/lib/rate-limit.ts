/**
 * Fixed-window per-key limiter. Keys are client IPs; ChatGPT and Claude
 * call from a small published egress range, so the limit is deliberately
 * generous per IP and relies on the response cache for real protection.
 */
interface Window {
  count: number
  resetAt: number
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Returns true when the request is allowed. */
  hit(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = this.now()
    const current = this.windows.get(key)
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs })
      if (this.windows.size > 10_000) this.sweep(now)
      return { allowed: true, retryAfterSec: 0 }
    }
    const next = { ...current, count: current.count + 1 }
    this.windows.set(key, next)
    return {
      allowed: next.count <= this.limit,
      retryAfterSec: Math.ceil((next.resetAt - now) / 1000)
    }
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key)
    }
  }
}

/** Client IP behind Cloudflare → Traefik → us. */
export const clientIp = (headers: Record<string, string | string[] | undefined>, fallback: string): string => {
  const cf = headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf) return cf
  const xff = headers['x-forwarded-for']
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim()
  return first || fallback
}
