import { money, multiple } from './format.js'
import { ECONOMY_FEE } from './grading-math.js'

/**
 * The "worth grading?" verdict, mirrored from midpoint-web/lib/seo/card-copy.ts
 * so the plugin says the same thing the card page does.
 */
export interface VerdictFacts {
  name: string
  raw: number | null
  psa9: number | null
  psa10: number | null
  bestGraded: number | null
  bestGradedLabel: string | null
}

export interface Verdict {
  tone: 'strong' | 'conditional' | 'weak'
  headline: string
  body: string
}

export const buildVerdict = (f: VerdictFacts, fee: number = ECONOMY_FEE): Verdict | null => {
  const graded = f.psa10 ?? f.bestGraded
  const gradedLabel = f.psa10 !== null ? 'PSA 10' : f.bestGradedLabel
  if (f.raw === null || graded === null || f.raw <= 0 || !gradedLabel) return null
  const premium = graded / f.raw
  const spread = graded - f.raw
  const nineNet = f.psa9 !== null ? f.psa9 - f.raw - fee : null
  const nineClears = nineNet !== null && nineNet > 0
  const nineSentence =
    f.psa9 === null
      ? ''
      : nineClears
        ? ` Even a PSA 9 (${money(f.psa9)}) clears the raw price after a ~$${fee} fee, so a near-miss still comes out ahead.`
        : f.psa9 - f.raw > 0
          ? ` A PSA 9 (${money(f.psa9)}) only about breaks even after fees, so the case rests on gemming.`
          : ` A PSA 9 (${money(f.psa9)}) sells for less than raw, so anything short of a 10 loses money.`

  if ((premium >= 3 && spread >= 40) || (nineClears && spread >= fee)) {
    return {
      tone: 'strong',
      headline: nineClears
        ? 'Worth grading: even a PSA 9 beats raw'
        : `Strong grading candidate: ${multiple(premium)} premium in ${gradedLabel}`,
      body: `A ${gradedLabel} ${f.name} sells for ${money(graded)} against ${money(f.raw)} raw: a ${money(spread)} spread, ${multiple(premium)} the ungraded price.${nineSentence} Centering is the usual reason a clean copy misses the 10, so measure it before submitting.`
    }
  }
  if (spread >= fee) {
    return {
      tone: 'conditional',
      headline: 'Worth grading only if it gems',
      body: `A ${gradedLabel} ${f.name} brings ${money(graded)} versus ${money(f.raw)} raw, a ${money(spread)} spread that covers a ~$${fee} grading fee.${nineSentence || ' Without PSA 9 sales on record, budget for the fee being lost on a near-miss.'}`
    }
  }
  return {
    tone: 'weak',
    headline: 'Grading rarely pays for this card',
    body: `${gradedLabel} copies of ${f.name} sell for ${money(graded)}, only ${money(Math.max(spread, 0))} above the ${money(f.raw)} raw price, less than a ~$${fee} grading fee.${nineSentence} Keep it raw unless you are grading for the slab itself.`
  }
}
