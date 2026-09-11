import { describe, expect, it } from 'vitest'
import { TtlCache, cacheKey } from '../src/lib/cache.js'
import { RateLimiter, clientIp } from '../src/lib/rate-limit.js'
import { buildLinks } from '../src/lib/links.js'
import { isSharedEgressHost, utmSourceFor } from '../src/lib/client.js'
import { loadConfig } from '../src/lib/config.js'

describe('TtlCache', () => {
  it('expires entries and evicts oldest at capacity', () => {
    let now = 0
    const cache = new TtlCache<number>(2, () => now)
    cache.set('a', 1, 100)
    cache.set('b', 2, 100)
    cache.set('c', 3, 100)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
    now = 101
    expect(cache.get('c')).toBeUndefined()
  })

  it('getOrLoad loads once', async () => {
    const cache = new TtlCache<number>(10)
    let calls = 0
    const load = async () => ++calls
    expect(await cache.getOrLoad('k', 1000, load)).toBe(1)
    expect(await cache.getOrLoad('k', 1000, load)).toBe(1)
    expect(calls).toBe(1)
  })

  it('cacheKey is order independent', () => {
    expect(cacheKey('t', { a: 1, b: 2 })).toBe(cacheKey('t', { b: 2, a: 1 }))
  })
})

describe('RateLimiter', () => {
  it('allows up to the limit per window then resets', () => {
    let now = 0
    const rl = new RateLimiter(2, 1000, () => now)
    expect(rl.hit('ip').allowed).toBe(true)
    expect(rl.hit('ip').allowed).toBe(true)
    const third = rl.hit('ip')
    expect(third.allowed).toBe(false)
    expect(third.retryAfterSec).toBe(1)
    now = 1001
    expect(rl.hit('ip').allowed).toBe(true)
  })

  it('applies a per-call limit override', () => {
    const rl = new RateLimiter(1, 1000, () => 0)
    expect(rl.hit('agent:ip', 3).allowed).toBe(true)
    expect(rl.hit('agent:ip', 3).allowed).toBe(true)
    expect(rl.hit('agent:ip', 3).allowed).toBe(true)
    expect(rl.hit('agent:ip', 3).allowed).toBe(false)
    expect(rl.hit('other').allowed).toBe(true)
    expect(rl.hit('other').allowed).toBe(false)
  })

  it('prefers cf-connecting-ip, then x-forwarded-for, then fallback', () => {
    expect(clientIp({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }, '3.3.3.3')).toBe('1.1.1.1')
    expect(clientIp({ 'x-forwarded-for': '2.2.2.2, 9.9.9.9' }, '3.3.3.3')).toBe('2.2.2.2')
    expect(clientIp({}, '3.3.3.3')).toBe('3.3.3.3')
  })
})

describe('links', () => {
  it('builds attributed first-party URLs and encodes ids', () => {
    const links = buildLinks('https://www.cardcenteringtool.com/', 'chatgpt_plugin')
    expect(links.card('swsh7-215')).toBe('https://www.cardcenteringtool.com/prices/swsh7-215?utm_source=chatgpt_plugin&utm_medium=mcp')
    expect(buildLinks('https://x.test').card('a')).toBe('https://x.test/prices/a?utm_source=mcp&utm_medium=mcp')
    expect(links.worthGrading('a b')).toContain('/worth-grading/a%20b?')
    expect(links.measure()).toContain('/measure?')
  })
})

describe('utmSourceFor', () => {
  it('maps known hosts and falls back to mcp', () => {
    expect(utmSourceFor('openai-mcp/1.0')).toBe('chatgpt_plugin')
    expect(utmSourceFor('ChatGPT-User/1.0')).toBe('chatgpt_plugin')
    expect(utmSourceFor('Claude-User/1.0 anthropic')).toBe('claude')
    expect(utmSourceFor('claude-code/2.1.0')).toBe('claude_code')
    expect(utmSourceFor('Cursor/1.4')).toBe('cursor')
    expect(utmSourceFor('node')).toBe('mcp')
    expect(utmSourceFor(undefined)).toBe('mcp')
    expect(isSharedEgressHost('chatgpt_plugin')).toBe(true)
    expect(isSharedEgressHost('claude')).toBe(true)
    expect(isSharedEgressHost('claude_code')).toBe(false)
    expect(isSharedEgressHost('mcp')).toBe(false)
  })
})

describe('config', () => {
  it('rejects a missing secret with a readable message', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toThrow(/SUPABASE_SECRET_KEY/)
  })
  it('applies defaults', () => {
    const c = loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k'.repeat(30) })
    expect(c.PORT).toBe(3000)
    expect(c.RATE_LIMIT_PER_MINUTE).toBe(120)
    expect(c.RATE_LIMIT_PER_MINUTE_AGENTS).toBeUndefined()
    expect(c.SITE_URL).toBe('https://www.cardcenteringtool.com')
  })
})
