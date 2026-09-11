/**
 * Pure grading-ROI helpers, mirrored from midpoint-web/lib/seo/grading-math.ts.
 * No I/O; every function is total over null inputs.
 */
export const FEE_TIERS = [
  { label: 'Economy / bulk', fee: 25 },
  { label: 'Standard', fee: 50 },
  { label: 'Express', fee: 150 }
] as const

export const ECONOMY_FEE = FEE_TIERS[0].fee
export const STANDARD_FEE = FEE_TIERS[1].fee

export type Grader = 'PSA' | 'CGC' | 'BGS' | 'SGC' | 'TAG'

export interface GraderStandard {
  company: Grader
  topGrade: string
  front: string
  back: string
}

/** Published centering tolerance for each grader's standard top grade. */
export const GRADER_STANDARDS: GraderStandard[] = [
  { company: 'PSA', topGrade: '10', front: '55/45', back: '75/25' },
  { company: 'CGC', topGrade: '10', front: '55/45', back: '75/25' },
  { company: 'BGS', topGrade: '10', front: '55/45', back: '70/30' },
  { company: 'TAG', topGrade: '10', front: '55/45', back: '72/28' },
  { company: 'SGC', topGrade: '10', front: '55/45', back: '75/25' }
]

export interface GraderValue {
  company: Grader
  value: number
}

export const graderValues = (v: {
  psa10: number | null
  cgc10: number | null
  bgs10: number | null
  sgc10: number | null
  tag10: number | null
}): GraderValue[] =>
  (
    [
      ['PSA', v.psa10],
      ['CGC', v.cgc10],
      ['BGS', v.bgs10],
      ['SGC', v.sgc10],
      ['TAG', v.tag10]
    ] as Array<[Grader, number | null]>
  )
    .filter((x): x is [Grader, number] => x[1] !== null && x[1] > 0)
    .map(([company, value]) => ({ company, value }))
    .sort((a, b) => b.value - a.value)

export interface BreakEvenRow {
  outcome: string
  sale: number
  /** net = sale − raw − fee, one entry per FEE_TIERS row */
  net: number[]
}

export const breakEvenRows = (
  raw: number,
  outcomes: Array<{ label: string; value: number | null }>
): BreakEvenRow[] =>
  outcomes
    .filter((o): o is { label: string; value: number } => o.value !== null && o.value > 0)
    .map((o) => ({
      outcome: o.label,
      sale: o.value,
      net: FEE_TIERS.map((t) => o.value - raw - t.fee)
    }))

export interface EvRow {
  gemProbability: number
  expectedSale: number
  expectedNet: number
}

/** Expected value of submitting at a few gem probabilities, a miss lands
 *  at the "nine" price. */
export const expectedValueRows = (raw: number, ten: number, nine: number, fee: number = STANDARD_FEE): EvRow[] =>
  [0.25, 0.5, 0.75].map((p) => {
    const expectedSale = p * ten + (1 - p) * nine
    return { gemProbability: p, expectedSale, expectedNet: expectedSale - raw - fee }
  })

/** Gem probability at which submitting breaks even (0..1); null when it
 *  never does. 0 when even a miss clears the fee. */
export const breakEvenGemProbability = (
  raw: number,
  ten: number,
  nine: number,
  fee: number = STANDARD_FEE
): number | null => {
  const target = raw + fee
  if (ten === nine) return null
  const p = (target - nine) / (ten - nine)
  if (!Number.isFinite(p)) return null
  if (p <= 0) return 0
  if (p >= 1) return null
  return p
}
