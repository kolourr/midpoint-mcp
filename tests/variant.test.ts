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
