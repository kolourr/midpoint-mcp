import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '../lib/context.js'
import { cacheKey, MINUTE } from '../lib/cache.js'
import { bestGradedLabel, getSeoCard, type SeoCardRow } from '../lib/prices.js'
import { gameLabel } from '../lib/games.js'
import { cents, money, multiple } from '../lib/format.js'
import { breakEvenGemProbability, breakEvenRows, ECONOMY_FEE, expectedValueRows, FEE_TIERS, GRADER_STANDARDS, graderValues } from '../lib/grading-math.js'
import { buildVerdict } from '../lib/verdict.js'
import { fail, ok, guarded } from '../lib/tool-result.js'

const input = {
  card_id: z.string().trim().min(1).max(80).describe('Catalog card id from search_cards.'),
  grading_fee_usd: z.number().min(0).max(5000).optional().describe('Grading fee to assume. Defaults to a $25 economy tier; the table also shows $50 and $150.')
}

const output = {
  card: z.object({ id: z.string(), name: z.string(), game: z.string(), set: z.string().nullable(), number: z.string().nullable() }),
  currency: z.literal('USD'),
  captured_on: z.string().nullable(),
  raw_market_usd: z.number().nullable(),
  psa9_usd: z.number().nullable(),
  psa10_usd: z.number().nullable(),
  gem_premium_multiple: z.number().nullable().describe('PSA 10 price ÷ raw price'),
  verdict: z.object({ tone: z.enum(['strong', 'conditional', 'weak']), headline: z.string(), body: z.string() }).nullable(),
  top_grade_by_company: z.array(z.object({ company: z.string(), grade: z.string(), value_usd: z.number(), centering_tolerance_front: z.string(), centering_tolerance_back: z.string() })),
  net_after_fee: z.array(z.object({ outcome: z.string(), sale_usd: z.number(), net_usd_by_fee: z.array(z.object({ fee_usd: z.number(), net_usd: z.number() })) })),
  expected_value: z.array(z.object({ gem_probability: z.number(), expected_sale_usd: z.number(), expected_net_usd: z.number() })),
  break_even_gem_probability: z.number().nullable().describe('Chance of a PSA 10 needed to break even at the assumed fee; null when grading never breaks even'),
  assumed_fee_usd: z.number(),
  links: z.object({ worth_grading: z.string(), card_page: z.string(), measure_centering: z.string() })
}

export const registerGradingRoi = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'grading_roi',
    {
      title: 'Is this card worth grading?',
      description:
        'Use this when the user asks whether a card is worth grading, submitting to PSA/CGC/BGS/SGC/TAG, or what a PSA 10 adds. Returns raw vs PSA 9 vs PSA 10 market prices, the gem premium, net profit after grading fees per outcome, expected value by gem probability, the break-even gem rate, which company pays most, and a plain-language verdict. Requires a card id from search_cards. It does not assess the condition of the user\'s copy.',
      inputSchema: input,
      outputSchema: output,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    guarded('grading_roi', async ({ card_id, grading_fee_usd }) => {
      const key = cacheKey('grading_roi_card', { card_id })
      const seo = (await ctx.cache.getOrLoad(key, 10 * MINUTE, () => getSeoCard(ctx.db, card_id))) as SeoCardRow | null
      if (!seo) return fail(`No card with id "${card_id}". Call search_cards to find the id first.`)
      if (seo.raw_market === null && seo.best_graded === null) {
        return fail(`"${seo.name}" has no recent sales on record, so grading economics cannot be computed. See ${ctx.links.card(card_id)}.`)
      }

      const fee = grading_fee_usd ?? ECONOMY_FEE
      const raw = seo.raw_market
      const label = bestGradedLabel(seo)
      const verdict = buildVerdict({ name: seo.name, raw, psa9: seo.psa9, psa10: seo.psa10, bestGraded: seo.best_graded, bestGradedLabel: label }, fee)

      const graders = graderValues(seo).map((g) => {
        const std = GRADER_STANDARDS.find((s) => s.company === g.company)
        return {
          company: g.company,
          grade: '10',
          value_usd: cents(g.value) as number,
          centering_tolerance_front: std?.front ?? 'n/a',
          centering_tolerance_back: std?.back ?? 'n/a'
        }
      })

      const outcomes = [
        { label: 'PSA 10', value: seo.psa10 },
        { label: 'PSA 9', value: seo.psa9 },
        { label: 'PSA 8', value: seo.psa8 }
      ]
      const feeTiers = [...new Set([fee, ...FEE_TIERS.map((t) => t.fee)])].sort((a, b) => a - b)
      const net = raw === null ? [] : breakEvenRows(raw, outcomes).map((row) => ({
        outcome: row.outcome,
        sale_usd: cents(row.sale) as number,
        net_usd_by_fee: feeTiers.map((f) => ({ fee_usd: f, net_usd: cents(row.sale - raw - f) as number }))
      }))
      const ev = raw !== null && seo.psa10 !== null && seo.psa9 !== null
        ? expectedValueRows(raw, seo.psa10, seo.psa9, fee).map((r) => ({
            gem_probability: r.gemProbability,
            expected_sale_usd: cents(r.expectedSale) as number,
            expected_net_usd: cents(r.expectedNet) as number
          }))
        : []
      const breakEven = raw !== null && seo.psa10 !== null && seo.psa9 !== null ? breakEvenGemProbability(raw, seo.psa10, seo.psa9, fee) : null

      const structured = {
        card: { id: seo.catalog_card_id, name: seo.name, game: gameLabel(seo.game), set: seo.set_name, number: seo.number },
        currency: 'USD' as const,
        captured_on: seo.captured_on,
        raw_market_usd: cents(raw),
        psa9_usd: cents(seo.psa9),
        psa10_usd: cents(seo.psa10),
        gem_premium_multiple: seo.gem_premium !== null ? Math.round(seo.gem_premium * 10) / 10 : null,
        verdict,
        top_grade_by_company: graders,
        net_after_fee: net,
        expected_value: ev,
        break_even_gem_probability: breakEven !== null ? Math.round(breakEven * 100) / 100 : null,
        assumed_fee_usd: fee,
        links: { worth_grading: ctx.links.worthGrading(seo.catalog_card_id), card_page: ctx.links.card(seo.catalog_card_id), measure_centering: ctx.links.measure() }
      }

      const text = [
        `${seo.name}${seo.set_name ? ` — ${seo.set_name}` : ''}${seo.number ? ` #${seo.number}` : ''}`,
        `Raw ${money(raw)} · PSA 9 ${money(seo.psa9)} · PSA 10 ${money(seo.psa10)} · gem premium ${multiple(seo.gem_premium)} (USD, last capture ${seo.captured_on ?? 'n/a'}).`,
        verdict ? `${verdict.headline}. ${verdict.body}` : 'Not enough graded sales to give a verdict.',
        ...(net.length ? ['', `Net after a $${fee} fee:`, ...net.map((n) => `- ${n.outcome} (${money(n.sale_usd)}): ${money(n.net_usd_by_fee.find((x) => x.fee_usd === fee)?.net_usd ?? null)}`)] : []),
        ...(breakEven !== null ? [`Break-even gem rate at $${fee}: ${Math.round(breakEven * 100)}%.`] : []),
        ...(graders.length ? [`Top-grade value by company: ${graders.map((g) => `${g.company} ${money(g.value_usd)}`).join(', ')}.`] : []),
        '',
        `Full break-even tables: ${structured.links.worth_grading}`,
        `Centering decides most 10-vs-9 outcomes; measure the copy first: ${structured.links.measure_centering}`
      ].join('\n')
      return ok(structured, text)
    })
  )
}
