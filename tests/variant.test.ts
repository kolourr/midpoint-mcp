import { describe, expect, it } from 'vitest'
import { primaryVariant, rawOrderNote, variantLabel } from '../src/lib/prices.js'
import { coverageNote, pickDailySeries } from '../src/tools/price-history.js'

describe('primaryVariant', () => {
  it('picks the printing with the most rows', () => {
    const rows = [...Array(5)].map(() => ({ variant: 'holofoil' })).concat([...Array(3)].map(() => ({ variant: 'reverseHolofoil' })))
    expect(primaryVariant(rows)).toBe('holofoil')
  })
  it('is deterministic on ties and null when empty', () => {
    expect(primaryVariant([{ variant: 'b' }, { variant: 'a' }])).toBe('a')
    expect(primaryVariant([])).toBeNull()
  })
})

describe('variantLabel', () => {
  it('humanises camelCase codes', () => {
    expect(variantLabel('reverseHolofoil')).toBe('reverse holofoil')
    expect(variantLabel('firstEditionHolofoil')).toBe('1st edition holofoil')
    expect(variantLabel('')).toBe('standard')
  })
})

describe('rawOrderNote', () => {
  const rung = (condition: string, market_usd: number | null) => ({ condition, market_usd, low_usd: null, high_usd: null })
  it('flags a worse condition priced above a better one', () => {
    expect(rawOrderNote([rung('NM', 1500), rung('LP', 2400)])).toMatch(/LP .* above NM/)
  })
  it('stays quiet for an ordered ladder or small noise', () => {
    expect(rawOrderNote([rung('NM', 100), rung('LP', 80), rung('MP', 50)])).toBeNull()
    expect(rawOrderNote([rung('NM', 100), rung('LP', 105)])).toBeNull()
  })
})

describe('archive series follows one printing', () => {
  it('does not flip between variants day to day once filtered by primary', () => {
    const rows = [
      { captured_on: '2026-09-11', market: 84579, variant: 'holofoil', company: 'PSA' },
      { captured_on: '2026-09-11', market: 13595, variant: 'reverseHolofoil', company: 'PSA' },
      { captured_on: '2026-09-12', market: 13595, variant: 'reverseHolofoil', company: 'PSA' },
      { captured_on: '2026-09-12', market: 84579, variant: 'holofoil', company: 'PSA' }
    ]
    const primary = primaryVariant(rows)
    const points = pickDailySeries(rows.filter((r) => r.variant === primary))
    expect(points.map((p) => p.market_usd)).toEqual([84579, 84579])
  })
})

describe('coverageNote', () => {
  it('counts days with data and warns when sparse', () => {
    const pts = [{ date: '2026-09-01', market_usd: 1 }, { date: '2026-09-15', market_usd: 2 }]
    const c = coverageNote(pts, 90)
    expect(c.days_with_data).toBe(2)
    expect(c.note).toMatch(/Sparse series/)
  })
  it('does not warn for a dense series', () => {
    const pts = [...Array(25)].map((_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, market_usd: 10 }))
    expect(coverageNote(pts, 30).note).not.toMatch(/Sparse/)
  })
})

import { stepNote } from '../src/tools/price-history.js'
describe('stepNote', () => {
  it('flags a flat series with one 6× step', () => {
    const pts = [...Array(8)].map((_, i) => ({ date: `2026-08-${String(4 + i).padStart(2, '0')}`, market_usd: 249.95 })).concat([{ date: '2026-09-15', market_usd: 1500 }, { date: '2026-09-18', market_usd: 1500 }])
    const n = stepNote(pts)
    expect(n).toMatch(/single step from \$250 to \$1,500 on 2026-09-15 accounts for the whole change/)
  })
  it('stays quiet on a gradual climb', () => {
    const pts = [...Array(10)].map((_, i) => ({ date: `2026-09-${String(1 + i).padStart(2, '0')}`, market_usd: 100 * 1.15 ** i }))
    expect(stepNote(pts)).toBeNull()
  })
})

import { rawFloor, withinRawBounds } from '../src/lib/prices.js'
describe('raw floor from low grades', () => {
  const g = (grade: string, market: number) => ({ price_type: 'graded' as const, company: 'PSA', grade, market })
  it('is half the lowest PSA 1–4 price and drops the $250 Charizard point', () => {
    const rows = [g('1', 5455.2), g('2', 5940.63), g('2.5', 2249), g('3', 6293.99), g('10', 84579.4)]
    const floor = rawFloor(rows)
    expect(floor).toBeCloseTo(1124.5, 1)
    const b = { ceiling: 84579.4, floor }
    expect(withinRawBounds(b, 249.95)).toBe(false)
    expect(withinRawBounds(b, 1500)).toBe(true)
    expect(withinRawBounds(b, null)).toBe(true)
  })
  it('needs two low-grade rows', () => {
    expect(rawFloor([g('1', 100), g('10', 1000)])).toBeNull()
  })
})
