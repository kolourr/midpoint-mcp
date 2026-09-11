import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Every tool returns structuredContent for the model plus a short text
 * rendering. Errors are tool errors with an actionable message, never a
 * thrown exception (which the SDK would turn into a generic failure).
 */
export const ok = (structured: Record<string, unknown>, text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structured
})

export const fail = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: message }]
})

/** PostgREST errors are plain objects, not Error instances. */
export const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [e.code, e.message, e.details, e.hint].filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (parts.length) return parts.join(' — ')
    return JSON.stringify(error).slice(0, 300)
  }
  return String(error)
}

/** Wrap a loader so infrastructure failures surface as readable tool errors. */
export const guarded =
  <A>(label: string, run: (args: A) => Promise<CallToolResult>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return await run(args)
    } catch (error) {
      const detail = describeError(error)
      console.error(`[${label}] failed:`, detail)
      return fail(`${label} is temporarily unavailable (${detail.slice(0, 200)}). Retry in a moment.`)
    }
  }
