import { describe, expect, it } from 'vitest'
import { isPlausibleGradingRow, rankByExpectedNet } from '../src/tools/best-cards-to-grade.js'
import type { SeoCardRow } from '../src/lib/prices.js'

const row = (id: string, raw: number | null, psa9: number | null, psa10: number | null): SeoCardRow =>
  ({ catalog_card_id: id, game: 'pokemon', source: 'scrydex', product_type: 'card', name: id, number: null, set_slug: null, set_name: null, set_year: null, player_name: null,
    raw_market: raw, psa10, psa9, psa8: null, cgc10: null, bgs10: null, sgc10: null, tag10: null, best_graded: psa10, gem_premium: raw && psa10 ? psa10 / raw : null,
    raw_prev30: null, psa10_prev30: null, pct_change_30d: null, captured_on: null, price_points: 5, is_priced: true }) as SeoCardRow

describe('isPlausibleGradingRow', () => {
  it('requires raw, PSA 9 and PSA 10 and drops poisoned ladders', () => {
    expect(isPlausibleGradingRow(row('charizard', 2146, 10000, 414330))).toBe(true)
    expect(isPlausibleGradingRow(row('kyogre', 148, 300, 999999))).toBe(false)
    expect(isPlausibleGradingRow(row('pikachu', 650, 300, 239371))).toBe(false)
    expect(isPlausibleGradingRow(row('no-psa9', 50, null, 4000))).toBe(false)
    expect(isPlausibleGradingRow(row('penny', 2, 20, 300))).toBe(false)
  })
})

describe('rankByExpectedNet', () => {
  it('ranks by money, not ratio, and drops negative expectations', () => {
    const rows = [
      row('thin', 6, 40, 3000),      // 475× premium but EV = 1520-6-25 = 1489
      row('umbreon', 2368, 2337, 3882), // EV = 3109.5-2368-25 = 716.5
      row('charizard', 2146, 10000, 414330), // EV ≈ 210k
      row('loser', 100, 60, 130)     // EV = 95-100-25 < 0
    ]
    const ranked = rankByExpectedNet(rows, 25, 10)
    expect(ranked.map((r) => r.row.catalog_card_id)).toEqual(['charizard', 'thin', 'umbreon'])
    expect(ranked[2]?.expectedNet).toBeCloseTo(716.5)
  })
})
