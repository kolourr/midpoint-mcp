import { describe, expect, it } from 'vitest'
import { buildVerdict } from '../src/lib/verdict.js'

const base = { name: 'Umbreon VMAX', bestGraded: null, bestGradedLabel: null }

describe('buildVerdict', () => {
  it('returns null without raw or graded prices', () => {
    expect(buildVerdict({ ...base, raw: null, psa9: null, psa10: 100 })).toBeNull()
    expect(buildVerdict({ ...base, raw: 10, psa9: null, psa10: null })).toBeNull()
  })

  it('is strong when even a PSA 9 clears the fee', () => {
    const v = buildVerdict({ ...base, raw: 300, psa9: 500, psa10: 1400 })
    expect(v?.tone).toBe('strong')
    expect(v?.headline).toMatch(/PSA 9 beats raw/)
  })

  it('is conditional when only the 10 covers the fee', () => {
    const v = buildVerdict({ ...base, raw: 20, psa9: 25, psa10: 55 })
    expect(v?.tone).toBe('conditional')
  })

  it('is weak when the spread is below the fee', () => {
    const v = buildVerdict({ ...base, raw: 20, psa9: 18, psa10: 30 })
    expect(v?.tone).toBe('weak')
    expect(v?.body).toMatch(/less than raw/)
  })

  it('falls back to the best graded label when there is no PSA 10', () => {
    const v = buildVerdict({ ...base, raw: 50, psa9: null, psa10: null, bestGraded: 400, bestGradedLabel: 'CGC 10' })
    expect(v?.headline).toMatch(/CGC 10/)
  })

  it('respects a custom fee', () => {
    expect(buildVerdict({ ...base, raw: 20, psa9: null, psa10: 55 }, 25)?.tone).toBe('conditional')
    expect(buildVerdict({ ...base, raw: 20, psa9: null, psa10: 55 }, 150)?.tone).toBe('weak')
  })
})
