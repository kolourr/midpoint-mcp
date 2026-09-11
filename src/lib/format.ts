/** Pure formatters, mirrored from midpoint-web/lib/seo/format.ts. */
export const money = (v: number | null | undefined): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a'
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  if (v >= 100) return `$${v.toFixed(0)}`
  return `$${v.toFixed(2)}`
}

export const pct = (v: number | null | undefined, digits = 0): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export const multiple = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? 'n/a' : `${v.toFixed(v >= 10 ? 0 : 1)}×`

/** Round to cents so structured output does not carry numeric noise. */
export const cents = (v: number | null | undefined): number | null =>
  v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 100) / 100
