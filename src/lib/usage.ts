import { AsyncLocalStorage } from 'node:async_hooks'
import type { ServiceClient } from './supabase.js'
import { describeError } from './tool-result.js'

/**
 * Per-client tool-call counts for the admin "MCP referrals" panel.
 *
 * Every tool call is counted in memory under (UTC day, client, tool) and
 * the buffer is flushed to `mcp_tool_usage` through the `mcp_usage_bump`
 * RPC once a minute. One row per minute per distinct key, not one write
 * per call, so a busy ChatGPT hour costs a handful of upserts. Nothing
 * about the caller is stored: no IP, no arguments, no user id. The client
 * label is the same utm_source the result links carry (client.ts).
 *
 * The client is set per HTTP request with `withRequestClient` and read by
 * `guarded` in tool-result.ts through AsyncLocalStorage, so the nine tool
 * files stay untouched.
 */
export interface UsageRow {
  day: string
  client: string
  tool: string
  calls: number
  errors: number
}

const scope = new AsyncLocalStorage<{ client: string }>()

export const withRequestClient = <T>(client: string, run: () => Promise<T>): Promise<T> => scope.run({ client }, run)

export const currentClient = (): string => scope.getStore()?.client ?? 'unknown'

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Bounded so a dead database can never grow the process without limit. */
const MAX_KEYS = 5_000

export class UsageBuffer {
  private readonly rows = new Map<string, UsageRow>()

  constructor(private readonly now: () => number = Date.now) {}

  record(client: string, tool: string, ok: boolean): void {
    const day = utcDay(this.now())
    const key = `${day}|${client}|${tool}`
    const existing = this.rows.get(key)
    if (existing) {
      this.rows.set(key, { ...existing, calls: existing.calls + 1, errors: existing.errors + (ok ? 0 : 1) })
      return
    }
    if (this.rows.size >= MAX_KEYS) return
    this.rows.set(key, { day, client, tool, calls: 1, errors: ok ? 0 : 1 })
  }

  /** Merge rows back (after a failed flush) without double counting new arrivals. */
  merge(rows: readonly UsageRow[]): void {
    for (const row of rows) {
      const key = `${row.day}|${row.client}|${row.tool}`
      const existing = this.rows.get(key)
      if (existing) {
        this.rows.set(key, { ...existing, calls: existing.calls + row.calls, errors: existing.errors + row.errors })
      } else if (this.rows.size < MAX_KEYS) {
        this.rows.set(key, { ...row })
      }
    }
  }

  /** Take everything buffered so far; the buffer is empty afterwards. */
  drain(): UsageRow[] {
    const out = Array.from(this.rows.values())
    this.rows.clear()
    return out
  }

  get size(): number {
    return this.rows.size
  }
}

/** Process-wide buffer that `guarded` writes into. */
export const usage = new UsageBuffer()

export const recordToolCall = (tool: string, ok: boolean): void => {
  usage.record(currentClient(), tool, ok)
}

export interface UsageFlusher {
  flush: () => Promise<void>
  stop: () => Promise<void>
}

/**
 * Flush the buffer through the RPC on an interval. A failed flush puts the
 * rows back so the next tick retries; the error is logged once per failure.
 */
export const startUsageFlusher = (db: Pick<ServiceClient, 'rpc'>, buffer: UsageBuffer = usage, intervalMs = 60_000): UsageFlusher => {
  let inflight: Promise<void> | undefined

  const flushOnce = async (): Promise<void> => {
    const rows = buffer.drain()
    if (rows.length === 0) return
    const { error } = await db.rpc('mcp_usage_bump', { p_rows: rows })
    if (error) {
      buffer.merge(rows)
      console.error('[usage] flush failed, will retry:', describeError(error))
    }
  }

  const flush = (): Promise<void> => {
    if (!inflight) {
      inflight = flushOnce().finally(() => {
        inflight = undefined
      })
    }
    return inflight
  }

  const timer = setInterval(() => void flush(), intervalMs)
  timer.unref()

  return {
    flush,
    stop: async () => {
      clearInterval(timer)
      await flush()
    }
  }
}
