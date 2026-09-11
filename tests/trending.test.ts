import { describe, expect, it } from 'vitest'
import { moverOf } from '../src/tools/trending-cards.js'

describe('moverOf', () => {
  it('uses the PSA 10 series when present', () => {
    expect(moverOf({ raw_market: 100, raw_prev30: 90, psa10: 400, psa10_prev30: 200, pct_change_30d: 100 })).toEqual({ basis: 'PSA 10', before: 200, after: 400, changePct: 100 })
  })
  it('falls back to raw', () => {
    expect(moverOf({ raw_market: 12, raw_prev30: 10, psa10: null, psa10_prev30: null, pct_change_30d: 20 })).toEqual({ basis: 'raw', before: 10, after: 12, changePct: 20 })
  })
  it('drops absurd moves, penny baselines and implausible raw', () => {
    expect(moverOf({ raw_market: 650, raw_prev30: 650, psa10: 239371, psa10_prev30: 190, pct_change_30d: 125560 })).toBeNull()
    expect(moverOf({ raw_market: 30, raw_prev30: 1, psa10: null, psa10_prev30: null, pct_change_30d: 2900 })).toBeNull()
    expect(moverOf({ raw_market: 9, raw_prev30: 4, psa10: null, psa10_prev30: null, pct_change_30d: 125 })).toBeNull()
    expect(moverOf({ raw_market: 400000, raw_prev30: 400000, psa10: 3700, psa10_prev30: 3000, pct_change_30d: 23 })).toBeNull()
    expect(moverOf({ raw_market: null, raw_prev30: null, psa10: null, psa10_prev30: null, pct_change_30d: 10 })).toBeNull()
  })
})
