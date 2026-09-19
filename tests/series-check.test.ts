import { describe, expect, it } from 'vitest'
import { filterVerified, seriesLooksReal } from '../src/lib/series-check.js'

const now = new Date('2026-09-19T00:00:00Z')
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10)

describe('seriesLooksReal', () => {
  it('rejects the Gengar-EX style series (10× swings, jumpy baseline)', () => {
    const pts = [[40, 30947], [36, 29304], [35, 29304], [34, 1808], [33, 1808], [30, 10961], [29, 10961], [28, 14500], [27, 29304], [24, 1808], [17, 10961], [15, 14500], [12, 685], [1, 690.22]].map(([d, v]) => ({ date: day(d as number), market_usd: v as number }))
    const v = seriesLooksReal(pts, now)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/swings|baseline/)
  })
  it('accepts a steady climb', () => {
    const pts = [...Array(20)].map((_, i) => ({ date: day(38 - i * 2), market_usd: 100 + i * 5 }))
    expect(seriesLooksReal(pts, now)).toEqual({ ok: true, reason: null })
  })
  it('rejects too few captures and one-capture jumps', () => {
    expect(seriesLooksReal([{ date: day(30), market_usd: 10 }, { date: day(1), market_usd: 12 }], now).ok).toBe(false)
    const jump = [...Array(8)].map((_, i) => ({ date: day(30 - i * 3), market_usd: 100 })).concat([{ date: day(1), market_usd: 190 }])
    expect(seriesLooksReal(jump, now).reason).toMatch(/one-capture jump/)
  })
})

describe('filterVerified', () => {
  it('keeps the first N passing rows in order and counts drops', async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8]
    const r = await filterVerified(rows, 3, async (n) => ({ ok: n % 2 === 0, reason: null }), 3)
    expect(r.kept).toEqual([2, 4, 6])
    expect(r.dropped).toBe(3)
  })
  it('treats a failed check as pass so a DB blip does not empty the list', async () => {
    const r = await filterVerified([1, 2], 2, async (n) => { if (n === 1) throw new Error('x'); return { ok: true, reason: null } })
    expect(r.kept).toEqual([1, 2])
  })
})
