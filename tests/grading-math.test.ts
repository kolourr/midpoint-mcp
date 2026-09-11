import { describe, expect, it } from 'vitest'
import { breakEvenGemProbability, breakEvenRows, expectedValueRows, graderValues } from '../src/lib/grading-math.js'

describe('grading math', () => {
  it('orders grader values best first and drops nulls', () => {
    const v = graderValues({ psa10: 500, cgc10: null, bgs10: 700, sgc10: 0, tag10: 100 })
    expect(v.map((x) => x.company)).toEqual(['BGS', 'PSA', 'TAG'])
  })

  it('computes net per fee tier', () => {
    const rows = breakEvenRows(100, [{ label: 'PSA 10', value: 400 }, { label: 'PSA 9', value: null }])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.net).toEqual([275, 250, 150])
  })

  it('expected value interpolates between nine and ten', () => {
    const ev = expectedValueRows(100, 400, 150, 50)
    expect(ev[1]?.expectedSale).toBe(275)
    expect(ev[1]?.expectedNet).toBe(125)
  })

  it('break-even probability handles edge cases', () => {
    expect(breakEvenGemProbability(100, 400, 150, 50)).toBeCloseTo(0)
    expect(breakEvenGemProbability(100, 400, 120, 50)).toBeCloseTo(30 / 280)
    expect(breakEvenGemProbability(100, 120, 110, 50)).toBeNull()
    expect(breakEvenGemProbability(100, 200, 200, 50)).toBeNull()
  })
})
