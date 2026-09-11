import { describe, expect, it } from 'vitest'
import { isPlausibleGradingRow } from '../src/tools/best-cards-to-grade.js'

describe('isPlausibleGradingRow', () => {
  it('keeps real extremes and drops poisoned rows', () => {
    expect(isPlausibleGradingRow({ raw_market: 2146, psa10: 414330, psa9: 10000, gem_premium: 193, best_graded: 414330 })).toBe(true)
    expect(isPlausibleGradingRow({ raw_market: 148, psa10: 999999, psa9: 300, gem_premium: 6743, best_graded: 999999 })).toBe(false)
    expect(isPlausibleGradingRow({ raw_market: 12.89, psa10: 36175, psa9: 1200, gem_premium: 2807, best_graded: 36175 })).toBe(false)
    expect(isPlausibleGradingRow({ raw_market: 650, psa10: 239371, psa9: 300, gem_premium: 368, best_graded: 239371 })).toBe(false)
    expect(isPlausibleGradingRow({ raw_market: 50, psa10: 4000, psa9: null, gem_premium: 80, best_graded: 4000 })).toBe(true)
  })
})
