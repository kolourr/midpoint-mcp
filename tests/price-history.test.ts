import { describe, expect, it } from 'vitest'
import { pickDailySeries } from '../src/tools/price-history.js'

describe('pickDailySeries', () => {
  it('follows NM across days regardless of row order and sorts oldest first', () => {
    const points = pickDailySeries([
      { captured_on: '2026-08-15', condition: 'MP', market: 1555 },
      { captured_on: '2026-08-15', condition: 'NM', market: 2244 },
      { captured_on: '2026-08-10', condition: 'LP', market: 1680 },
      { captured_on: '2026-08-10', condition: 'NM', market: 2327 }
    ])
    expect(points).toEqual([
      { date: '2026-08-10', market_usd: 2327 },
      { date: '2026-08-15', market_usd: 2244 }
    ])
  })
  it('falls back to the generic rung and to worse conditions', () => {
    const points = pickDailySeries([
      { captured_on: '2026-08-01', condition: '', market: 10 },
      { captured_on: '2026-08-02', condition: 'HP', market: 3 },
      { captured_on: '2026-08-02', condition: 'LP', market: 7 },
      { captured_on: '2026-08-03', condition: 'NM', market: null }
    ])
    expect(points).toEqual([
      { date: '2026-08-01', market_usd: 10 },
      { date: '2026-08-02', market_usd: 7 }
    ])
  })
  it('prefers PSA over the generic company on graded rows', () => {
    const points = pickDailySeries([
      { captured_on: '2026-08-01', condition: '', company: '', market: 50 },
      { captured_on: '2026-08-01', condition: '', company: 'PSA', market: 60 }
    ])
    expect(points).toEqual([{ date: '2026-08-01', market_usd: 60 }])
  })
})
